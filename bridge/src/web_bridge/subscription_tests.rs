use super::*;
use std::io::{BufRead, BufReader};
use std::os::unix::net::{UnixListener, UnixStream};

struct FakeDaemon {
    listener: UnixListener,
    path: PathBuf,
}

impl FakeDaemon {
    fn new() -> Self {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "herdr-recovery-{}-{}.sock",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let listener = UnixListener::bind(&path).unwrap();
        listener.set_nonblocking(true).unwrap();
        Self { listener, path }
    }

    fn accept(&self, method: &str) -> (UnixStream, serde_json::Value) {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let socket = loop {
            match self.listener.accept() {
                Ok((socket, _)) => break socket,
                Err(err) if err.kind() == ErrorKind::WouldBlock => {
                    assert!(std::time::Instant::now() < deadline, "missing {method}");
                    thread::sleep(Duration::from_millis(5));
                }
                Err(err) => panic!("accept failed: {err}"),
            }
        };
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut line = String::new();
        BufReader::new(socket.try_clone().unwrap())
            .read_line(&mut line)
            .unwrap();
        let request: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(request["method"], method);
        (socket, request)
    }

    fn subscribe(&self) -> UnixStream {
        let (mut socket, request) = self.accept("events.subscribe");
        respond(
            &mut socket,
            &request,
            serde_json::json!({"type": "subscription_started"}),
        );
        socket
    }

    fn panes(&self, panes: Vec<PaneInfo>) {
        let (mut socket, request) = self.accept("pane.list");
        respond(
            &mut socket,
            &request,
            serde_json::to_value(ResponseResult::PaneList { panes }).unwrap(),
        );
    }
}

impl Drop for FakeDaemon {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_dir(self.path.with_extension("pins"));
        let _ = std::fs::remove_dir(self.path.with_extension("notes"));
    }
}

fn respond(socket: &mut UnixStream, request: &serde_json::Value, result: serde_json::Value) {
    writeln!(
        socket,
        "{}",
        serde_json::json!({"id": request["id"], "result": result})
    )
    .unwrap();
}

fn lost_events(socket: &mut UnixStream) {
    writeln!(socket, "{}", serde_json::json!({
        "id": "subscription", "error": {"code": "events_lost", "message": "events lost; resubscribe"}
    })).unwrap();
}

fn test_state(api_path: PathBuf) -> BridgeState {
    BridgeState {
        api: ApiClient::for_socket_path(api_path.clone()),
        client_socket_path: api_path.clone(),
        request_policy: RequestPolicy {
            bind_host: "127.0.0.1".into(),
            bind_port: 0,
            allowed_hosts: vec![],
            allowed_origins: vec![],
            allowed_connect_sources: vec![],
        },
        terminal_sessions: Arc::new(Mutex::new(TerminalSessions::default())),
        selected_pane_id: Arc::new(Mutex::new(None)),
        agent_activity: Arc::new(AgentActivityManager::new()),
        agent_pins: Arc::new(
            AgentPinsManager::for_test(api_path.with_extension("pins"), "test").unwrap(),
        ),
        launcher_presets: Arc::new(LauncherPresetStore::load(None).unwrap()),
        notes: Arc::new(NotesManager::for_test(api_path.with_extension("notes"), "test").unwrap()),
        ui_event_tx: tokio::sync::broadcast::channel(256).0,
        activity_tx: tokio::sync::broadcast::channel(512).0,
        upload_dir: api_path.with_extension("uploads"),
    }
}

async fn test_events_handler(ws: WebSocketUpgrade, State(state): State<BridgeState>) -> Response {
    ws.on_upgrade(move |socket| handle_events_socket(socket, state))
        .into_response()
}

#[tokio::test]
async fn events_socket_closes_on_eof_error_or_invalid_json_and_reconnects() {
    for failure in ["eof", "events_lost", "invalid_json"] {
        let daemon = FakeDaemon::new();
        let state = test_state(daemon.path.clone());
        let app = Router::new()
            .route("/ws", get(test_events_handler))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let (release_tx, release_rx) = mpsc::channel();
        let daemon_thread = thread::spawn(move || {
            let mut stream = daemon.subscribe();
            match failure {
                "eof" => drop(stream),
                "events_lost" => {
                    lost_events(&mut stream);
                    // Keep the socket open to prove the error itself causes recovery.
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                }
                _ => {
                    writeln!(stream, "invalid JSON").unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                }
            }
            let mut stream = daemon.subscribe();
            writeln!(
                stream,
                "{}",
                serde_json::json!({
                    "event": "workspace.created", "data": {"workspace_id": "recovered"}
                })
            )
            .unwrap();
        });

        let (mut client, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws"))
            .await
            .unwrap();
        let ready = tokio::time::timeout(Duration::from_secs(3), client.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let ready: serde_json::Value = serde_json::from_str(ready.to_text().unwrap()).unwrap();
        assert_eq!(ready["type"], "resync_required");
        let closed = tokio::time::timeout(Duration::from_secs(3), client.next())
            .await
            .expect("events WebSocket remained open after upstream failure");
        assert!(
            matches!(
                closed,
                Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_)))
            ),
            "{failure}: {closed:?}"
        );
        if failure != "eof" {
            release_tx.send(()).unwrap();
        }
        let (mut client, _) = tokio_tungstenite::connect_async(format!("ws://{address}/ws"))
            .await
            .unwrap();
        let ready = tokio::time::timeout(Duration::from_secs(3), client.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let ready: serde_json::Value = serde_json::from_str(ready.to_text().unwrap()).unwrap();
        assert_eq!(ready["type"], "resync_required");
        let event = tokio::time::timeout(Duration::from_secs(3), client.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let event: serde_json::Value = serde_json::from_str(event.to_text().unwrap()).unwrap();
        assert_eq!(event["data"]["workspace_id"], "recovered");
        daemon_thread.join().unwrap();
        server.abort();
    }
}

#[test]
fn structural_reconnect_requests_membership_refresh_without_new_events() {
    let daemon = FakeDaemon::new();
    let state = test_state(daemon.path.clone());
    let (signal_tx, signal_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let daemon_thread = thread::spawn(move || {
        for _ in 0..2 {
            let mut socket = daemon.subscribe();
            lost_events(&mut socket);
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        }
    });
    for _ in 0..2 {
        let err = run_agent_activity_structural_subscription(&state, &signal_tx).unwrap_err();
        assert!(
            matches!(err, BridgeError::Api(ApiClientError::ErrorResponse(response)) if response.error.code == "events_lost")
        );
        signal_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("subscription ack must refresh membership");
        release_tx.send(()).unwrap();
    }
    daemon_thread.join().unwrap();
}

#[test]
fn activity_reconnect_rebuilds_baseline_and_requests_browser_resync() {
    let daemon = FakeDaemon::new();
    let state = test_state(daemon.path.clone());
    let mut activity_rx = state.activity_tx.subscribe();
    let (_signal_tx, signal_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let daemon_thread = thread::spawn(move || {
        for pane_id in ["before-disconnect", "created-during-disconnect"] {
            let mut pane = super::tests::test_pane(pane_id);
            pane.agent = Some("codex".into());
            daemon.panes(vec![pane.clone()]);
            let (mut socket, request) = daemon.accept("events.subscribe");
            assert_eq!(request["params"]["subscriptions"][0]["pane_id"], pane_id);
            respond(
                &mut socket,
                &request,
                serde_json::json!({"type": "subscription_started"}),
            );
            pane.agent_status = AgentStatus::Working;
            daemon.panes(vec![pane]);
            lost_events(&mut socket);
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        }
    });
    for pane_id in ["before-disconnect", "created-during-disconnect"] {
        let err = run_agent_activity_subscription(&state, &signal_rx).unwrap_err();
        assert!(
            matches!(err, BridgeError::Api(ApiClientError::ErrorResponse(response)) if response.error.code == "events_lost")
        );
        assert!(matches!(
            activity_rx.try_recv(),
            Ok(ActivityMessage::ResyncRequired { .. })
        ));
        let mut pane = super::tests::test_pane(pane_id);
        pane.agent = Some("codex".into());
        pane.agent_status = AgentStatus::Working;
        let list = state.agent_activity.list(&[pane]);
        assert_eq!(list.records.len(), 1);
        assert_eq!(list.records[0].pane_id, pane_id);
        assert_eq!(list.records[0].agent_status, AgentStatus::Working);
        release_tx.send(()).unwrap();
    }
    daemon_thread.join().unwrap();
}
