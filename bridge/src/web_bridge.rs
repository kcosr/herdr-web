use std::collections::{HashMap, HashSet};
use std::env;
use std::fmt;
use std::io::{self, ErrorKind, Write};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Query, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
    ACCESS_CONTROL_MAX_AGE, ACCESS_CONTROL_REQUEST_HEADERS, HOST, ORIGIN, VARY,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{extract::Request as AxumRequest, Json, Router};
use futures_util::{SinkExt, StreamExt};
use herdr_compat::TryClone as _;
use serde::{Deserialize, Serialize};
use tower_http::services::ServeDir;
use tracing::{debug, info, warn};

use herdr_compat::api::client::{ApiClient, ApiClientError};
use herdr_compat::api::schema::{
    EmptyParams, EventData, EventEnvelope, EventsSubscribeParams, Method,
    PaneAgentStatusChangedEvent, PaneInfo, PaneLayoutParams, PaneLayoutSnapshot, PaneListParams,
    PaneMoveDestination, PaneTarget, Request, ResponseResult, SplitDirection, Subscription,
    SubscriptionEventData, SubscriptionEventEnvelope, TabInfo, TabListParams, TabTarget,
    WorkspaceInfo, WorkspaceTarget,
};
use herdr_compat::protocol::{
    self, AttachScrollDirection, AttachScrollSource, ClientKeybindings, ClientLaunchMode,
    ClientMessage, RenderEncoding, ServerMessage, MAX_FRAME_SIZE, MAX_GRAPHICS_FRAME_SIZE,
    PROTOCOL_VERSION,
};

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8787;
const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
const DEFAULT_STATIC_DIR: &str = "web/dist";
const MIN_TERMINAL_ATTACH_PROTOCOL: u32 = 13;
const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;
const DAEMON_STATUS_TIMEOUT: Duration = Duration::from_secs(5);
const STATE_STREAM_READ_TIMEOUT: Duration = Duration::from_millis(250);
const STATE_STREAM_REBUILD_DEBOUNCE: Duration = Duration::from_millis(100);
const STATE_STREAM_STARTUP_DRAIN: Duration = Duration::from_millis(50);
const STATE_STREAM_STARTUP_CONVERGENCE_LIMIT: usize = 3;
static UPLOAD_TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);
static STATE_STREAM_COUNTER: AtomicUsize = AtomicUsize::new(0);
static STATE_REFRESH_COUNTER: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone)]
struct BridgeOptions {
    host: String,
    port: u16,
    static_dir: PathBuf,
    upload_dir: PathBuf,
    allowed_hosts: Vec<String>,
    allowed_origins: Vec<String>,
}

#[derive(Clone)]
struct BridgeState {
    api: ApiClient,
    client_socket_path: PathBuf,
    request_policy: RequestPolicy,
    terminal_sessions: Arc<Mutex<HashMap<String, SharedTerminalSession>>>,
    selected_pane_id: Arc<Mutex<Option<String>>>,
    ui_event_tx: tokio::sync::broadcast::Sender<String>,
    state_refresh_tx: tokio::sync::broadcast::Sender<StateRefreshEvent>,
    active_state_streams: Arc<Mutex<HashSet<String>>>,
    upload_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct RequestPolicy {
    bind_host: String,
    bind_port: u16,
    allowed_hosts: Vec<String>,
    allowed_origins: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct Snapshot {
    workspaces: Vec<SnapshotWorkspaceInfo>,
    tabs: Vec<SnapshotTabInfo>,
    panes: Vec<PaneInfo>,
    layouts: Vec<PaneLayoutSnapshot>,
    selected_pane_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct SnapshotWorkspaceInfo {
    #[serde(flatten)]
    info: WorkspaceInfo,
    can_clear_name: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct SnapshotTabInfo {
    #[serde(flatten)]
    info: TabInfo,
    can_clear_name: bool,
}

#[derive(Debug, Serialize)]
struct Capabilities {
    commands: &'static [&'static str],
    state_stream: bool,
}

#[derive(Debug)]
struct BridgeProjection {
    snapshot: Snapshot,
    generation: u64,
    next_sequence: u64,
    quiescent: bool,
}

#[derive(Debug, Clone)]
struct StateRefreshEvent {
    target_stream_id: Option<String>,
    refresh_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StateRefreshRequest {
    stream_id: String,
    reason: StateRefreshReason,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum StateRefreshReason {
    Visibility,
    AndroidResume,
    ResyncRequired,
    Manual,
    Safety,
}

#[derive(Debug, Serialize)]
struct StateRefreshResponse {
    refresh_id: String,
}

struct ActiveStateStreamGuard {
    stream_id: String,
    active_state_streams: Arc<Mutex<HashSet<String>>>,
}

impl Drop for ActiveStateStreamGuard {
    fn drop(&mut self) {
        if let Ok(mut active_state_streams) = self.active_state_streams.lock() {
            active_state_streams.remove(&self.stream_id);
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum StateMessage {
    #[serde(rename = "snapshot")]
    Snapshot {
        generation: u64,
        sequence: u64,
        snapshot: Snapshot,
        stream_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        refresh_ids: Option<Vec<String>>,
    },
    #[serde(rename = "pane.agent_status_changed")]
    PaneAgentStatusChanged {
        generation: u64,
        sequence: u64,
        pane: PaneInfo,
        workspace: SnapshotWorkspaceInfo,
        tab: SnapshotTabInfo,
    },
    #[serde(rename = "pane.agent_detected")]
    PaneAgentDetected {
        generation: u64,
        sequence: u64,
        pane: PaneInfo,
        workspace: SnapshotWorkspaceInfo,
        tab: SnapshotTabInfo,
    },
    #[serde(rename = "selection.changed")]
    SelectionChanged {
        generation: u64,
        sequence: u64,
        pane_id: String,
    },
    #[serde(rename = "resync_required")]
    ResyncRequired {
        generation: u64,
        sequence: u64,
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        refresh_ids: Option<Vec<String>>,
    },
    #[serde(rename = "error")]
    Error {
        generation: u64,
        sequence: u64,
        code: &'static str,
        message: String,
    },
}

#[derive(Debug, Deserialize)]
struct TerminalQuery {
    terminal_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    #[serde(default)]
    takeover: bool,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
enum TerminalClientFrame {
    Input {
        data: String,
    },
    Resize {
        cols: u16,
        rows: u16,
        #[serde(default)]
        cell_width_px: u32,
        #[serde(default)]
        cell_height_px: u32,
    },
    Scroll {
        direction: ScrollDirection,
        #[serde(default = "default_scroll_lines")]
        lines: u16,
    },
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ScrollDirection {
    Up,
    Down,
}

fn default_scroll_lines() -> u16 {
    3
}

#[derive(Debug, Clone)]
enum TerminalOutput {
    Bytes(Vec<u8>),
    Close(String),
}

#[derive(Clone)]
struct SharedTerminalSession {
    write_tx: mpsc::Sender<ClientMessage>,
    output_tx: tokio::sync::broadcast::Sender<TerminalOutput>,
    client_count: Arc<AtomicUsize>,
}

#[derive(Debug)]
enum BridgeError {
    Api(ApiClientError),
    Io(io::Error),
    BadRequest(String),
    Forbidden(String),
    Protocol(String),
}

#[derive(Debug)]
enum UploadError {
    BadRequest(String),
    Conflict { name: String, path: String },
    Forbidden(String),
    TooLarge,
    Io(io::Error),
}

impl fmt::Display for BridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Api(err) => write!(f, "{err}"),
            Self::Io(err) => write!(f, "{err}"),
            Self::BadRequest(message) => write!(f, "{message}"),
            Self::Forbidden(message) => write!(f, "{message}"),
            Self::Protocol(message) => write!(f, "{message}"),
        }
    }
}

impl BridgeError {
    fn is_unknown_pane(&self) -> bool {
        matches!(self, Self::Protocol(message) if message.contains("unknown pane "))
    }
}

impl IntoResponse for BridgeError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::Api(_) | Self::Io(_) | Self::Protocol(_) => StatusCode::BAD_GATEWAY,
        };
        let body = Json(serde_json::json!({
            "error": self.to_string(),
        }));
        (status, body).into_response()
    }
}

impl From<ApiClientError> for BridgeError {
    fn from(err: ApiClientError) -> Self {
        Self::Api(err)
    }
}

impl From<io::Error> for BridgeError {
    fn from(err: io::Error) -> Self {
        Self::Io(err)
    }
}

impl IntoResponse for UploadError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            Self::BadRequest(message) => (
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": message }),
            ),
            Self::Conflict { name, path } => (
                StatusCode::CONFLICT,
                serde_json::json!({
                    "error": "file exists",
                    "name": name,
                    "path": path,
                }),
            ),
            Self::Forbidden(message) => (
                StatusCode::FORBIDDEN,
                serde_json::json!({ "error": message }),
            ),
            Self::TooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                serde_json::json!({ "error": "upload exceeds 25 MB limit" }),
            ),
            Self::Io(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({ "error": err.to_string() }),
            ),
        };
        (status, Json(body)).into_response()
    }
}

impl From<io::Error> for UploadError {
    fn from(err: io::Error) -> Self {
        Self::Io(err)
    }
}

pub(crate) fn run_command(args: &[String]) -> io::Result<i32> {
    let options = match parse_options(args) {
        Ok(Some(options)) => options,
        Ok(None) => return Ok(0),
        Err(message) => {
            eprintln!("{message}");
            eprintln!(
                "usage: herdr-web-bridge [--session NAME] [--host HOST] [--port PORT] [--static-dir DIR] [--allow-origin ORIGIN] [--allow-host HOSTNAME]"
            );
            return Ok(2);
        }
    };

    herdr_compat::logging::init_file_logging(crate::session::data_dir(), "herdr-web.log");
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to create tokio runtime");

    match runtime.block_on(run_server(options)) {
        Ok(()) => Ok(0),
        Err(err) => {
            eprintln!("{err}");
            Ok(1)
        }
    }
}

fn parse_options(args: &[String]) -> Result<Option<BridgeOptions>, String> {
    let mut host = DEFAULT_HOST.to_string();
    let mut port = DEFAULT_PORT;
    let mut static_dir = PathBuf::from(DEFAULT_STATIC_DIR);
    let mut upload_dir = default_upload_dir();
    let mut allowed_hosts = Vec::new();
    let mut allowed_origins = Vec::new();
    let mut explicit_session = None;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "help" | "--help" | "-h" => {
                print_help();
                return Ok(None);
            }
            "--host" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --host".into());
                };
                host = value.clone();
                index += 2;
            }
            "--session" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --session".into());
                };
                crate::session::validate_session_name(value)?;
                explicit_session = Some(value.clone());
                index += 2;
            }
            "--port" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --port".into());
                };
                port = value
                    .parse::<u16>()
                    .map_err(|_| "port must be between 0 and 65535".to_string())?;
                index += 2;
            }
            "--static-dir" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --static-dir".into());
                };
                static_dir = PathBuf::from(value);
                index += 2;
            }
            "--upload-dir" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --upload-dir".into());
                };
                upload_dir = expand_home(value);
                index += 2;
            }
            "--allow-host" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --allow-host".into());
                };
                allowed_hosts.push(normalize_allowed_host(value)?);
                index += 2;
            }
            "--allow-origin" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --allow-origin".into());
                };
                allowed_origins.push(normalize_allowed_origin(value)?);
                index += 2;
            }
            arg => return Err(format!("unknown herdr-web option: {arg}")),
        }
    }

    if let Some(name) = explicit_session {
        crate::session::configure_explicit_session(&name)?;
    }

    Ok(Some(BridgeOptions {
        host,
        port,
        static_dir,
        upload_dir,
        allowed_hosts,
        allowed_origins,
    }))
}

fn print_help() {
    println!("{}", help_text());
}

fn help_text() -> &'static str {
    "herdr-web-bridge\n\
\n\
Usage: herdr-web-bridge [--session NAME] [--host HOST] [--port PORT] [--static-dir DIR] [--upload-dir DIR] [--allow-origin ORIGIN] [--allow-host HOSTNAME]\n\
\n\
Runs the local HTTP/WebSocket bridge for herdr-web.\n\
Defaults to the active Herdr daemon sockets and 127.0.0.1:8787.\n\
Use --session NAME to target a named Herdr session and ignore HERDR_SOCKET_PATH.\n\
Use --host 0.0.0.0 to listen on non-loopback interfaces.\n\
Use --allow-origin http://localhost for bundled Android app access.\n\
Use --allow-host HOSTNAME to accept that exact DNS hostname in Host headers.\n\
Uploads default to HERDR_WEB_UPLOAD_DIR, XDG_DATA_HOME/herdr-web/uploads, or ~/.local/share/herdr-web/uploads."
}

async fn run_server(options: BridgeOptions) -> io::Result<()> {
    if !is_loopback_bind_host(&options.host) {
        warn!(
            host = %options.host,
            port = options.port,
            "herdr-web-bridge has no browser authentication yet; bind only on trusted networks"
        );
    }
    ensure_upload_dir(&options.upload_dir)?;
    let request_policy = RequestPolicy {
        bind_host: options.host.clone(),
        bind_port: options.port,
        allowed_hosts: options.allowed_hosts.clone(),
        allowed_origins: options.allowed_origins.clone(),
    };
    let api = ApiClient::for_socket_path(crate::session::active_api_socket_path());
    let daemon_protocol = startup_daemon_protocol(&api)?;
    info!(
        protocol = daemon_protocol,
        "herdr-web bridge connected to compatible Herdr daemon"
    );
    let state = BridgeState {
        api,
        client_socket_path: crate::session::active_client_socket_path(),
        request_policy: request_policy.clone(),
        terminal_sessions: Arc::new(Mutex::new(HashMap::new())),
        selected_pane_id: Arc::new(Mutex::new(None)),
        ui_event_tx: tokio::sync::broadcast::channel(256).0,
        state_refresh_tx: tokio::sync::broadcast::channel(256).0,
        active_state_streams: Arc::new(Mutex::new(HashSet::new())),
        upload_dir: options.upload_dir.clone(),
    };
    let app = Router::new()
        .route(
            "/api/snapshot",
            get(snapshot_handler).options(preflight_handler),
        )
        .route(
            "/api/capabilities",
            get(capabilities_handler).options(preflight_handler),
        )
        .route(
            "/api/command",
            post(command_handler).options(preflight_handler),
        )
        .route(
            "/api/state/refresh",
            post(state_refresh_handler).options(preflight_handler),
        )
        .route(
            "/api/selection",
            post(selection_handler).options(preflight_handler),
        )
        .route(
            "/api/uploads",
            post(upload_handler).options(preflight_handler),
        )
        .route("/ws/events", get(events_ws_handler))
        .route("/ws/state", get(state_ws_handler))
        .route("/ws/ui-events", get(ui_events_ws_handler))
        .route("/ws/terminal", get(terminal_ws_handler))
        .fallback_service(ServeDir::new(options.static_dir))
        .layer(middleware::from_fn_with_state(
            request_policy.clone(),
            add_security_headers,
        ))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES))
        .with_state(state);
    let bind = format!("{}:{}", options.host, options.port);
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    info!(url = %format!("http://{bind}"), "herdr-web-bridge listening");
    axum::serve(listener, app).await
}

async fn add_security_headers(
    State(policy): State<RequestPolicy>,
    request: AxumRequest,
    next: Next,
) -> Response {
    let cors_origin = cors_origin_header(request.headers(), &policy);
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' data:; \
             img-src 'self' data: blob:; \
             style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; \
             frame-ancestors 'none'",
        ),
    );
    if let Some(origin) = cors_origin {
        insert_cors_headers(headers, origin);
    }
    response
}

async fn preflight_handler(
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Result<Response, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let Some(origin) = cors_origin_header(&headers, &state.request_policy) else {
        return Err(BridgeError::Forbidden(
            "cross-origin requests are not allowed".to_string(),
        ));
    };
    let mut response = StatusCode::NO_CONTENT.into_response();
    insert_cors_headers(response.headers_mut(), origin);
    if let Some(request_headers) = headers.get(ACCESS_CONTROL_REQUEST_HEADERS) {
        response
            .headers_mut()
            .insert(ACCESS_CONTROL_ALLOW_HEADERS, request_headers.clone());
    }
    Ok(response)
}

fn cors_origin_header(headers: &HeaderMap, policy: &RequestPolicy) -> Option<HeaderValue> {
    let origin = headers.get(ORIGIN)?;
    if request_allowed(headers, policy) {
        Some(origin.clone())
    } else {
        None
    }
}

fn insert_cors_headers(headers: &mut HeaderMap, origin: HeaderValue) {
    headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    if !headers.contains_key(ACCESS_CONTROL_ALLOW_HEADERS) {
        headers.insert(
            ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("content-type"),
        );
    }
    headers.insert(ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("600"));
    headers.insert(VARY, HeaderValue::from_static("Origin"));
}

fn is_loopback_bind_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn default_upload_dir() -> PathBuf {
    if let Some(path) = non_empty_env_path("HERDR_WEB_UPLOAD_DIR") {
        return path;
    }
    if let Some(data_home) = non_empty_env_path("XDG_DATA_HOME") {
        return data_home.join("herdr-web").join("uploads");
    }
    if let Some(home) = non_empty_env_path("HOME") {
        return home
            .join(".local")
            .join("share")
            .join("herdr-web")
            .join("uploads");
    }
    PathBuf::from("herdr-web-uploads")
}

fn non_empty_env_path(name: &str) -> Option<PathBuf> {
    let value = env::var(name).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(expand_home(trimmed))
    }
}

fn expand_home(value: &str) -> PathBuf {
    if value == "~" {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home);
        }
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(value)
}

fn ensure_upload_dir(path: &Path) -> io::Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn sanitize_upload_file_name(input: &str) -> Option<String> {
    let normalized = input.replace('\\', "/");
    let file_name = Path::new(&normalized).file_name()?.to_string_lossy();
    let mut output = String::new();
    for ch in file_name.trim().chars() {
        if ch == '/' || ch == '\\' || ch.is_control() {
            continue;
        }
        output.push(ch);
    }
    let output = output.trim_matches('.').trim().to_string();
    if output.is_empty() || output == "." || output == ".." {
        return None;
    }
    if output.len() > 180 {
        let mut truncated = String::new();
        for ch in output.chars() {
            if truncated.len() + ch.len_utf8() > 180 {
                break;
            }
            truncated.push(ch);
        }
        return finalize_upload_file_name(truncated);
    }
    finalize_upload_file_name(output)
}

fn finalize_upload_file_name(name: String) -> Option<String> {
    let name = name.trim_matches('.').trim().to_string();
    if name.is_empty() || name == "." || name == ".." {
        None
    } else {
        Some(name)
    }
}

fn generated_upload_name(mime: Option<&str>) -> String {
    let extension = upload_extension_for_mime(mime).unwrap_or("bin");
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let suffix = UPLOAD_TEMP_COUNTER.fetch_add(1, Ordering::AcqRel);
    format!("pasted-file-{millis}-{suffix}.{extension}")
}

fn upload_extension_for_mime(mime: Option<&str>) -> Option<&'static str> {
    match mime?
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        "text/plain" => Some("txt"),
        "application/pdf" => Some("pdf"),
        _ => None,
    }
}

fn is_direct_child(parent: &Path, child: &Path) -> bool {
    child
        .parent()
        .is_some_and(|child_parent| child_parent == parent)
}

/// Mutating methods the browser client is allowed to invoke. Anything outside
/// this list (e.g. `server.stop`, `pane.send_keys`) is rejected so the bridge
/// only exposes the workspace/tab/pane lifecycle the UI needs.
const ALLOWED_COMMANDS: &[&str] = &[
    "workspace.create",
    "workspace.rename",
    "workspace.close",
    "workspace.focus",
    "tab.create",
    "tab.rename",
    "tab.close",
    "tab.focus",
    "pane.rename",
    "pane.close",
    // Narrow input path used to run a selected launch command in a just-created tab.
    "pane.send_input",
    // Layout-mutating: the web client builds splits directly.
    "pane.split",
    // Directional pane focus: explicit pane_id only, matching the web selection.
    "pane.focus_direction",
    // Narrow live pane moves: new tab or new workspace destinations only.
    "pane.move",
    // Agent creation: exposes Herdr's native agent.start placement and argv path.
    "agent.start",
];

fn ensure_allowed_request(headers: &HeaderMap, policy: &RequestPolicy) -> Result<(), BridgeError> {
    if request_allowed(headers, policy) {
        return Ok(());
    }
    Err(BridgeError::Forbidden(
        "cross-origin requests are not allowed".to_string(),
    ))
}

fn request_allowed(headers: &HeaderMap, policy: &RequestPolicy) -> bool {
    request_host_allowed(headers, policy) && request_origin_allowed(headers, policy)
}

fn request_host_allowed(headers: &HeaderMap, policy: &RequestPolicy) -> bool {
    let Some(host) = headers.get(HOST).and_then(|host| host.to_str().ok()) else {
        return false;
    };
    host_authority_allowed(host, policy)
}

fn host_authority_allowed(authority: &str, policy: &RequestPolicy) -> bool {
    let host = host_part(authority);
    if host.is_empty() {
        return false;
    }

    if is_loopback_host(host) {
        return true;
    }

    if !authority_port_matches(authority, policy.bind_port) {
        return false;
    }

    if policy
        .allowed_hosts
        .iter()
        .any(|allowed| host.eq_ignore_ascii_case(allowed))
    {
        return true;
    }

    if is_unspecified_bind_host(&policy.bind_host) {
        return host.parse::<IpAddr>().is_ok();
    }

    host.eq_ignore_ascii_case(&policy.bind_host)
}

fn request_origin_allowed(headers: &HeaderMap, policy: &RequestPolicy) -> bool {
    let Some(origin) = headers.get(ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let Some(origin_authority) = origin_authority(origin) else {
        return false;
    };
    let Some(host) = headers.get(HOST).and_then(|host| host.to_str().ok()) else {
        return false;
    };

    same_authority(origin_authority, host)
        || (is_loopback_authority(origin_authority) && is_loopback_authority(host))
        || policy
            .allowed_origins
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(origin))
}

fn origin_authority(origin: &str) -> Option<&str> {
    let rest = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))?;
    if rest.is_empty() || rest.contains('/') {
        return None;
    }
    Some(rest)
}

fn normalize_allowed_origin(origin: &str) -> Result<String, String> {
    let origin = origin.trim();
    let Some(authority) = origin_authority(origin) else {
        return Err("allowed origin must be an http or https origin without a path".into());
    };
    if authority.is_empty() {
        return Err("allowed origin must include a host".into());
    }
    Ok(origin.to_ascii_lowercase())
}

fn normalize_allowed_host(host: &str) -> Result<String, String> {
    let host = host.trim().trim_matches('.');
    if host.is_empty() {
        return Err("allowed host must not be empty".into());
    }
    if host.contains(':') || host.contains('/') || host.contains('\\') {
        return Err("allowed host must be a hostname without scheme, port, or path".into());
    }
    if !is_valid_dns_hostname(host) {
        return Err("allowed host is not a valid hostname".into());
    }
    Ok(host.to_ascii_lowercase())
}

fn is_valid_dns_hostname(host: &str) -> bool {
    if host.len() > 253 {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}

fn same_authority(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

fn is_loopback_authority(authority: &str) -> bool {
    let host = host_part(authority);
    is_loopback_host(host)
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
}

fn is_unspecified_bind_host(host: &str) -> bool {
    matches!(host, "0.0.0.0" | "::" | "[::]")
}

fn authority_port_matches(authority: &str, expected_port: u16) -> bool {
    match authority_port(authority) {
        Some(port) => port == expected_port,
        None => expected_port == 80,
    }
}

fn authority_port(authority: &str) -> Option<u16> {
    if authority.parse::<IpAddr>().is_ok() {
        return None;
    }
    if let Some(rest) = authority.strip_prefix('[') {
        let end = rest.find(']')?;
        return rest[end + 1..]
            .strip_prefix(':')
            .and_then(|port| port.parse().ok());
    }
    let (_, port) = authority.rsplit_once(':')?;
    if port.contains(':') {
        return None;
    }
    port.parse().ok()
}

fn host_part(authority: &str) -> &str {
    if let Some(rest) = authority.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            return &rest[..end];
        }
    }
    if authority.parse::<IpAddr>().is_ok() {
        return authority;
    }
    authority.split(':').next().unwrap_or(authority)
}

fn validate_web_command(method: &Method) -> Result<(), BridgeError> {
    match method {
        Method::WorkspaceCreate(params) => {
            if params.cwd.is_some() || !params.env.is_empty() || !params.focus {
                return Err(BridgeError::BadRequest(
                    "workspace.create is limited to focused default workspaces through herdr-web"
                        .to_string(),
                ));
            }
            if params
                .label
                .as_deref()
                .is_some_and(|label| label.trim().is_empty() || label.len() > 120)
            {
                return Err(BridgeError::BadRequest(
                    "workspace.create label must be non-empty and up to 120 bytes".to_string(),
                ));
            }
        }
        Method::TabCreate(params) => {
            if params
                .workspace_id
                .as_deref()
                .is_none_or(|workspace_id| workspace_id.trim().is_empty())
                || params.cwd.is_some()
                || !params.env.is_empty()
                || !params.focus
            {
                return Err(BridgeError::BadRequest(
                    "tab.create is limited to focused tabs in an existing workspace through herdr-web"
                        .to_string(),
                ));
            }
            if params
                .label
                .as_deref()
                .is_some_and(|label| label.trim().is_empty() || label.len() > 120)
            {
                return Err(BridgeError::BadRequest(
                    "tab.create label must be non-empty and up to 120 bytes".to_string(),
                ));
            }
        }
        Method::WorkspaceRename(params) => {
            if params.workspace_id.trim().is_empty() {
                return Err(BridgeError::BadRequest(
                    "workspace_id is required".to_string(),
                ));
            }
            validate_optional_label(&params.label, "workspace.rename label")?;
        }
        Method::TabRename(params) => {
            if params.tab_id.trim().is_empty() {
                return Err(BridgeError::BadRequest("tab_id is required".to_string()));
            }
            validate_optional_label(&params.label, "tab.rename label")?;
        }
        Method::PaneSendInput(params) => {
            if params.pane_id.trim().is_empty() {
                return Err(BridgeError::BadRequest("pane_id is required".to_string()));
            }
            if params.keys.len() != 1 || params.keys[0] != "Enter" {
                return Err(BridgeError::BadRequest(
                    "pane.send_input is limited to Enter-submitted launch commands".to_string(),
                ));
            }
            if !is_allowed_agent_command(&params.text) {
                return Err(BridgeError::BadRequest(
                    "pane.send_input launch command is not allowed".to_string(),
                ));
            }
        }
        Method::PaneSplit(params) => {
            if params
                .target_pane_id
                .as_deref()
                .is_none_or(|pane_id| pane_id.trim().is_empty())
            {
                return Err(BridgeError::BadRequest(
                    "pane.split requires target_pane_id".to_string(),
                ));
            }
            if params.workspace_id.is_some()
                || params.ratio.is_some()
                || params.cwd.is_some()
                || !params.env.is_empty()
            {
                return Err(BridgeError::BadRequest(
                    "pane.split supports only target pane, direction, and focus through herdr-web"
                        .to_string(),
                ));
            }
        }
        Method::PaneFocusDirection(params) => {
            if params
                .pane_id
                .as_deref()
                .is_none_or(|pane_id| pane_id.trim().is_empty())
            {
                return Err(BridgeError::BadRequest(
                    "pane.focus_direction requires pane_id".to_string(),
                ));
            }
        }
        Method::PaneMove(params) => {
            if params.pane_id.trim().is_empty() {
                return Err(BridgeError::BadRequest("pane_id is required".to_string()));
            }
            if !params.focus {
                return Err(BridgeError::BadRequest(
                    "pane.move must focus the moved pane through herdr-web".to_string(),
                ));
            }
            match &params.destination {
                PaneMoveDestination::NewTab {
                    workspace_id,
                    label,
                } => {
                    if workspace_id
                        .as_deref()
                        .is_none_or(|workspace_id| workspace_id.trim().is_empty())
                    {
                        return Err(BridgeError::BadRequest(
                            "pane.move new_tab requires workspace_id through herdr-web".to_string(),
                        ));
                    }
                    validate_optional_label(label, "pane.move new_tab label")?;
                }
                PaneMoveDestination::NewWorkspace { label, tab_label } => {
                    validate_optional_label(label, "pane.move new_workspace label")?;
                    validate_optional_label(tab_label, "pane.move new_workspace tab_label")?;
                }
                PaneMoveDestination::Tab { .. } => {
                    return Err(BridgeError::BadRequest(
                        "pane.move to existing tabs is not exposed through herdr-web".to_string(),
                    ));
                }
            }
        }
        Method::AgentStart(params) => {
            if params.name.trim().is_empty() || params.name.len() > 120 {
                return Err(BridgeError::BadRequest(
                    "agent.start requires a non-empty launch name up to 120 bytes".to_string(),
                ));
            }
            if params
                .tab_id
                .as_deref()
                .is_none_or(|tab_id| tab_id.trim().is_empty())
                || params.workspace_id.is_some()
                || params.cwd.is_some()
                || !params.env.is_empty()
                || !params.focus
                || !matches!(
                    params.split.as_ref(),
                    Some(SplitDirection::Right) | Some(SplitDirection::Down)
                )
                || !is_allowed_agent_argv(&params.argv)
            {
                return Err(BridgeError::BadRequest(
                    "agent.start is limited to focused Codex, Claude, or pi splits in an existing tab"
                        .to_string(),
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_optional_label(label: &Option<String>, field: &str) -> Result<(), BridgeError> {
    if label
        .as_deref()
        .is_some_and(|label| label.trim().is_empty() || label.len() > 120)
    {
        return Err(BridgeError::BadRequest(format!(
            "{field} must be non-empty and up to 120 bytes"
        )));
    }
    Ok(())
}

fn is_allowed_agent_command(text: &str) -> bool {
    matches!(text, "codex" | "claude" | "pi")
}

fn is_allowed_agent_argv(argv: &[String]) -> bool {
    matches!(argv, [command] if is_allowed_agent_command(command))
}

#[derive(Debug, Deserialize)]
struct CommandRequest {
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct SelectionRequest {
    pane_id: String,
}

#[derive(Debug, Deserialize)]
struct UploadQuery {
    name: Option<String>,
    #[serde(default)]
    overwrite: bool,
}

#[derive(Debug, Serialize)]
struct UploadEntry {
    name: String,
    path: String,
    size: usize,
    mime: Option<String>,
}

#[derive(Debug, Serialize)]
struct UploadResponse {
    file: UploadEntry,
}

async fn command_handler(
    State(state): State<BridgeState>,
    headers: HeaderMap,
    Json(body): Json<CommandRequest>,
) -> Result<Json<serde_json::Value>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    if !ALLOWED_COMMANDS.contains(&body.method.as_str()) {
        return Err(BridgeError::Forbidden(format!(
            "command not allowed: {}",
            body.method
        )));
    }

    let params = if body.params.is_null() {
        serde_json::json!({})
    } else {
        body.params
    };
    let request_value = serde_json::json!({
        "id": format!("herdr-web:cmd:{}", body.method),
        "method": body.method,
        "params": params,
    });
    let mut request: Request = serde_json::from_value(request_value)
        .map_err(|err| BridgeError::BadRequest(format!("invalid command: {err}")))?;
    validate_web_command(&request.method)?;
    fill_clear_rename_labels(&state.api, &mut request.method)?;
    let should_prune_terminal_sessions = command_may_close_terminal_session(&request.method);
    let should_refresh_state_streams = command_may_change_structure(&request.method);

    let api = state.api.clone();
    let response = tokio::task::spawn_blocking(move || api.request(request))
        .await
        .map_err(|err| BridgeError::Protocol(err.to_string()))??;
    let value = serde_json::to_value(response.result)
        .map_err(|err| BridgeError::Protocol(err.to_string()))?;
    if should_prune_terminal_sessions {
        let prune_state = state.clone();
        tokio::task::spawn_blocking(move || prune_detached_terminal_sessions(&prune_state));
    }
    if should_refresh_state_streams {
        let state_refresh_tx = state.state_refresh_tx.clone();
        let event = StateRefreshEvent {
            target_stream_id: None,
            refresh_id: None,
        };
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            let _ = state_refresh_tx.send(event);
        });
    }
    Ok(Json(value))
}

async fn state_refresh_handler(
    State(state): State<BridgeState>,
    headers: HeaderMap,
    Json(body): Json<StateRefreshRequest>,
) -> Result<Json<StateRefreshResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    if body.stream_id.trim().is_empty() {
        return Err(BridgeError::BadRequest("missing stream_id".to_string()));
    }
    {
        let active_state_streams = state.active_state_streams.lock().map_err(|_| {
            BridgeError::Protocol("state stream registry lock poisoned".to_string())
        })?;
        if !active_state_streams.contains(&body.stream_id) {
            return Err(BridgeError::BadRequest(format!(
                "unknown stream_id: {}",
                body.stream_id
            )));
        }
    }
    let refresh_id = next_state_refresh_id();
    let _ = &body.reason;
    let state_refresh_tx = state.state_refresh_tx.clone();
    let event = StateRefreshEvent {
        target_stream_id: Some(body.stream_id),
        refresh_id: Some(refresh_id.clone()),
    };
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(10)).await;
        let _ = state_refresh_tx.send(event);
    });
    Ok(Json(StateRefreshResponse { refresh_id }))
}

fn command_may_close_terminal_session(method: &Method) -> bool {
    matches!(
        method,
        Method::WorkspaceClose(_)
            | Method::TabClose(_)
            | Method::PaneClose(_)
            | Method::PaneMove(_)
    )
}

fn command_may_change_structure(method: &Method) -> bool {
    matches!(
        method,
        Method::WorkspaceCreate(_)
            | Method::WorkspaceClose(_)
            | Method::WorkspaceRename(_)
            | Method::WorkspaceFocus(_)
            | Method::WorktreeOpen(_)
            | Method::WorktreeRemove(_)
            | Method::AgentStart(_)
            | Method::TabCreate(_)
            | Method::TabClose(_)
            | Method::TabRename(_)
            | Method::TabFocus(_)
            | Method::PaneSplit(_)
            | Method::PaneClose(_)
            | Method::PaneMove(_)
            | Method::PaneSwap(_)
            | Method::PaneZoom(_)
            | Method::PaneResize(_)
            | Method::PaneRename(_)
            | Method::PaneFocusDirection(_)
            | Method::LayoutApply(_)
    )
}

fn next_state_stream_id() -> String {
    format!(
        "stream-{}",
        STATE_STREAM_COUNTER.fetch_add(1, Ordering::Relaxed) + 1
    )
}

fn next_state_refresh_id() -> String {
    format!(
        "refresh-{}",
        STATE_REFRESH_COUNTER.fetch_add(1, Ordering::Relaxed) + 1
    )
}

fn fill_clear_rename_labels(api: &ApiClient, method: &mut Method) -> Result<(), BridgeError> {
    match method {
        Method::WorkspaceRename(params) if params.label.is_none() => {
            params.label = Some(default_workspace_label(api, &params.workspace_id)?);
        }
        Method::TabRename(params) if params.label.is_none() => {
            params.label = Some(default_tab_label(api, &params.tab_id)?);
        }
        _ => {}
    }
    Ok(())
}

fn default_tab_label(api: &ApiClient, tab_id: &str) -> Result<String, BridgeError> {
    match api_request(
        api,
        "herdr-web:clear-tab-label",
        Method::TabList(TabListParams::default()),
    )? {
        ResponseResult::TabList { tabs } => tabs
            .into_iter()
            .find(|tab| tab.tab_id == tab_id)
            .map(|tab| tab.number.to_string())
            .ok_or_else(|| BridgeError::BadRequest(format!("tab not found: {tab_id}"))),
        other => Err(BridgeError::Protocol(format!(
            "unexpected response: {other:?}"
        ))),
    }
}

fn default_workspace_label(api: &ApiClient, workspace_id: &str) -> Result<String, BridgeError> {
    Ok(default_workspace_label_from_panes(
        workspace_id,
        current_panes(api)?.iter(),
    ))
}

fn default_workspace_label_from_panes<'a>(
    workspace_id: &str,
    panes: impl Iterator<Item = &'a PaneInfo>,
) -> String {
    panes
        .filter(|pane| pane.workspace_id == workspace_id)
        .filter_map(|pane| pane.foreground_cwd.as_ref().or(pane.cwd.as_ref()))
        .min()
        .map(|cwd| crate::workspace::derive_label_from_cwd(Path::new(cwd)))
        .filter(|label| !label.trim().is_empty())
        .unwrap_or_else(|| "workspace".to_string())
}

async fn selection_handler(
    State(state): State<BridgeState>,
    headers: HeaderMap,
    Json(body): Json<SelectionRequest>,
) -> Result<Json<serde_json::Value>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let pane_id = body.pane_id.trim();
    if pane_id.is_empty() {
        return Err(BridgeError::BadRequest("missing pane_id".to_string()));
    }
    let panes = current_panes(&state.api)?;
    if !panes.iter().any(|pane| pane.pane_id == pane_id) {
        return Err(BridgeError::Protocol(format!("pane not found: {pane_id}")));
    }
    {
        let mut selected = state
            .selected_pane_id
            .lock()
            .map_err(|_| BridgeError::Protocol("selection lock poisoned".to_string()))?;
        *selected = Some(pane_id.to_string());
    }
    let _ = state.ui_event_tx.send(
        serde_json::json!({
            "type": "herdr_web.selection_changed",
            "pane_id": pane_id,
        })
        .to_string(),
    );
    Ok(Json(serde_json::json!({ "selected_pane_id": pane_id })))
}

async fn upload_handler(
    State(state): State<BridgeState>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<UploadResponse>, UploadError> {
    ensure_allowed_request(&headers, &state.request_policy)
        .map_err(|err| UploadError::Forbidden(err.to_string()))?;
    if body.len() > MAX_UPLOAD_BYTES {
        return Err(UploadError::TooLarge);
    }

    let mime = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    debug!(
        bytes = body.len(),
        mime = ?mime,
        overwrite = query.overwrite,
        "herdr-web-bridge upload request"
    );
    let name = match query.name.as_deref().and_then(sanitize_upload_file_name) {
        Some(name) => name,
        None => generated_upload_name(mime.as_deref()),
    };
    let destination = state.upload_dir.join(&name);
    if !is_direct_child(&state.upload_dir, &destination) {
        return Err(UploadError::BadRequest("invalid file name".to_string()));
    }

    tokio::fs::create_dir_all(&state.upload_dir).await?;
    let existing = tokio::fs::symlink_metadata(&destination).await.ok();
    if let Some(existing) = existing {
        if !query.overwrite {
            info!(
                name = %name,
                "herdr-web-bridge upload conflict"
            );
            return Err(UploadError::Conflict {
                name,
                path: destination.display().to_string(),
            });
        }
        if existing.file_type().is_symlink() || existing.is_dir() {
            return Err(UploadError::BadRequest(
                "refusing to overwrite non-file path".to_string(),
            ));
        }
    }

    if !query.overwrite {
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .await
        {
            Ok(mut file) => {
                tokio::io::AsyncWriteExt::write_all(&mut file, &body).await?;
                tokio::io::AsyncWriteExt::flush(&mut file).await?;
            }
            Err(err) if err.kind() == ErrorKind::AlreadyExists => {
                return Err(UploadError::Conflict {
                    name,
                    path: destination.display().to_string(),
                });
            }
            Err(err) => return Err(UploadError::Io(err)),
        }
    } else {
        let temp_path = state.upload_dir.join(format!(
            ".herdr-web-upload-{}-{}.tmp",
            std::process::id(),
            UPLOAD_TEMP_COUNTER.fetch_add(1, Ordering::AcqRel)
        ));
        tokio::fs::write(&temp_path, &body).await?;
        if destination.exists() {
            tokio::fs::remove_file(&destination).await?;
        }
        match tokio::fs::rename(&temp_path, &destination).await {
            Ok(()) => {}
            Err(err) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err(UploadError::Io(err));
            }
        }
    }

    let response = UploadResponse {
        file: UploadEntry {
            name,
            path: destination.display().to_string(),
            size: body.len(),
            mime,
        },
    };
    info!(bytes = body.len(), "herdr-web-bridge upload saved");
    Ok(Json(response))
}

async fn snapshot_handler(
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Result<Json<Snapshot>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    Ok(Json(build_snapshot(&state)?))
}

fn build_snapshot(state: &BridgeState) -> Result<Snapshot, BridgeError> {
    let workspaces = match api_request(
        &state.api,
        "herdr-web:workspace-list",
        Method::WorkspaceList(EmptyParams::default()),
    )? {
        ResponseResult::WorkspaceList { workspaces } => workspaces,
        other => {
            return Err(BridgeError::Protocol(format!(
                "unexpected response: {other:?}"
            )))
        }
    };
    let tabs = match api_request(
        &state.api,
        "herdr-web:tab-list",
        Method::TabList(TabListParams::default()),
    )? {
        ResponseResult::TabList { tabs } => tabs,
        other => {
            return Err(BridgeError::Protocol(format!(
                "unexpected response: {other:?}"
            )))
        }
    };
    let panes = current_panes(&state.api)?;
    let layouts = collect_tab_layouts(&state.api, &tabs, &panes);
    let selected_pane_id = shared_selected_pane(&state, &panes)?;
    let workspaces = workspaces
        .into_iter()
        .map(|workspace| wrap_workspace(workspace, &panes))
        .collect();
    let tabs = tabs.into_iter().map(wrap_tab).collect();

    Ok(Snapshot {
        workspaces,
        tabs,
        panes,
        layouts,
        selected_pane_id,
    })
}

fn is_default_tab_label(label: &str) -> bool {
    let label = label.trim();
    !label.is_empty() && label.chars().all(|ch| ch.is_ascii_digit())
}

async fn capabilities_handler(
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Result<Json<Capabilities>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    Ok(Json(Capabilities {
        commands: ALLOWED_COMMANDS,
        state_stream: true,
    }))
}

fn workspace_info(api: &ApiClient, workspace_id: &str) -> Result<WorkspaceInfo, BridgeError> {
    match api_request(
        api,
        &format!("herdr-web:workspace-get:{workspace_id}"),
        Method::WorkspaceGet(WorkspaceTarget {
            workspace_id: workspace_id.to_string(),
        }),
    )? {
        ResponseResult::WorkspaceInfo { workspace } => Ok(workspace),
        other => Err(BridgeError::Protocol(format!(
            "unexpected response: {other:?}"
        ))),
    }
}

fn tab_info(api: &ApiClient, tab_id: &str) -> Result<TabInfo, BridgeError> {
    match api_request(
        api,
        &format!("herdr-web:tab-get:{tab_id}"),
        Method::TabGet(TabTarget {
            tab_id: tab_id.to_string(),
        }),
    )? {
        ResponseResult::TabInfo { tab } => Ok(tab),
        other => Err(BridgeError::Protocol(format!(
            "unexpected response: {other:?}"
        ))),
    }
}

fn pane_info(api: &ApiClient, pane_id: &str) -> Result<PaneInfo, BridgeError> {
    match api_request(
        api,
        &format!("herdr-web:pane-get:{pane_id}"),
        Method::PaneGet(PaneTarget {
            pane_id: pane_id.to_string(),
        }),
    )? {
        ResponseResult::PaneInfo { pane } => Ok(pane),
        other => Err(BridgeError::Protocol(format!(
            "unexpected response: {other:?}"
        ))),
    }
}

fn wrap_workspace(workspace: WorkspaceInfo, panes: &[PaneInfo]) -> SnapshotWorkspaceInfo {
    let can_clear_name = workspace.label
        != default_workspace_label_from_panes(&workspace.workspace_id, panes.iter());
    SnapshotWorkspaceInfo {
        info: workspace,
        can_clear_name,
    }
}

fn wrap_tab(tab: TabInfo) -> SnapshotTabInfo {
    let can_clear_name = !is_default_tab_label(&tab.label);
    SnapshotTabInfo {
        info: tab,
        can_clear_name,
    }
}

fn current_panes(api: &ApiClient) -> Result<Vec<PaneInfo>, BridgeError> {
    match api_request(
        api,
        "herdr-web:pane-list",
        Method::PaneList(PaneListParams::default()),
    )? {
        ResponseResult::PaneList { panes } => Ok(panes),
        other => Err(BridgeError::Protocol(format!(
            "unexpected response: {other:?}"
        ))),
    }
}

fn shared_selected_pane(
    state: &BridgeState,
    panes: &[PaneInfo],
) -> Result<Option<String>, BridgeError> {
    let mut selected = state
        .selected_pane_id
        .lock()
        .map_err(|_| BridgeError::Protocol("selection lock poisoned".to_string()))?;
    if selected
        .as_ref()
        .is_some_and(|pane_id| panes.iter().any(|pane| pane.pane_id == pane_id.as_str()))
    {
        return Ok(selected.clone());
    }
    *selected = None;
    Ok(None)
}

fn api_request(api: &ApiClient, id: &str, method: Method) -> Result<ResponseResult, BridgeError> {
    Ok(api
        .request(Request {
            id: id.to_string(),
            method,
        })?
        .result)
}

fn collect_tab_layouts(
    api: &ApiClient,
    tabs: &[TabInfo],
    panes: &[PaneInfo],
) -> Vec<PaneLayoutSnapshot> {
    tabs.iter()
        .filter_map(|tab| {
            let pane = panes.iter().find(|pane| pane.tab_id == tab.tab_id)?;
            match api_request(
                api,
                &format!("herdr-web:layout:{}", tab.tab_id),
                Method::PaneLayout(PaneLayoutParams {
                    pane_id: Some(pane.pane_id.clone()),
                }),
            ) {
                Ok(ResponseResult::PaneLayout { layout }) => Some(layout),
                Ok(_) | Err(_) => None,
            }
        })
        .collect()
}

async fn terminal_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<BridgeState>,
    Query(query): Query<TerminalQuery>,
    headers: HeaderMap,
) -> Response {
    if let Err(err) = ensure_allowed_request(&headers, &state.request_policy) {
        return err.into_response();
    }
    ws.on_upgrade(move |socket| handle_terminal_socket(socket, state, query))
        .into_response()
}

async fn events_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Response {
    if let Err(err) = ensure_allowed_request(&headers, &state.request_policy) {
        return err.into_response();
    }
    ws.on_upgrade(move |socket| handle_events_socket(socket, state))
        .into_response()
}

async fn ui_events_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Response {
    if let Err(err) = ensure_allowed_request(&headers, &state.request_policy) {
        return err.into_response();
    }
    ws.on_upgrade(move |socket| handle_ui_events_socket(socket, state))
        .into_response()
}

async fn state_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Response {
    if let Err(err) = ensure_allowed_request(&headers, &state.request_policy) {
        return err.into_response();
    }
    ws.on_upgrade(move |socket| handle_state_socket(socket, state))
        .into_response()
}

async fn handle_events_socket(socket: WebSocket, state: BridgeState) {
    let api = state.api.clone();
    let mut ui_event_rx = state.ui_event_tx.subscribe();
    let subscribed = tokio::task::spawn_blocking(move || open_event_subscription(api)).await;
    let Ok(Ok(mut event_rx)) = subscribed else {
        return;
    };

    let (mut ws_sender, mut ws_receiver) = socket.split();
    loop {
        tokio::select! {
            Some(event) = event_rx.recv() => {
                if event_may_close_terminal_session(&event) {
                    let prune_state = state.clone();
                    tokio::task::spawn_blocking(move || prune_detached_terminal_sessions(&prune_state));
                }
                if ws_sender.send(Message::Text(event.into())).await.is_err() {
                    break;
                }
            }
            event = ui_event_rx.recv() => {
                match event {
                    Ok(event) => {
                        if ws_sender.send(Message::Text(event.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            Some(message) = ws_receiver.next() => {
                match message {
                    Ok(Message::Close(_)) | Err(_) => break,
                    Ok(Message::Text(_))
                    | Ok(Message::Binary(_))
                    | Ok(Message::Ping(_))
                    | Ok(Message::Pong(_)) => {}
                }
            }
            else => break,
        }
    }
}

async fn handle_state_socket(socket: WebSocket, state: BridgeState) {
    let stream_id = next_state_stream_id();
    {
        let mut active_state_streams = match state.active_state_streams.lock() {
            Ok(active_state_streams) => active_state_streams,
            Err(_) => return,
        };
        active_state_streams.insert(stream_id.clone());
    }
    let _stream_guard = ActiveStateStreamGuard {
        stream_id: stream_id.clone(),
        active_state_streams: state.active_state_streams.clone(),
    };
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let setup_state = state.clone();
    let setup = tokio::task::spawn_blocking(move || open_state_projection(setup_state)).await;
    let (mut projection, mut upstream) = match setup {
        Ok(Ok(result)) => result,
        Ok(Err(err)) => {
            let message = StateMessage::Error {
                generation: 0,
                sequence: 0,
                code: "state_setup_failed",
                message: err.to_string(),
            };
            if let Ok(text) = serde_json::to_string(&message) {
                let _ = ws_sender.send(Message::Text(text.into())).await;
            }
            return;
        }
        Err(err) => {
            let message = StateMessage::Error {
                generation: 0,
                sequence: 0,
                code: "state_setup_failed",
                message: err.to_string(),
            };
            if let Ok(text) = serde_json::to_string(&message) {
                let _ = ws_sender.send(Message::Text(text.into())).await;
            }
            return;
        }
    };

    let mut ui_event_rx = state.ui_event_tx.subscribe();
    let mut refresh_rx = state.state_refresh_tx.subscribe();
    let snapshot_message = projection.snapshot_message(&stream_id, None);
    let Ok(text) = serde_json::to_string(&snapshot_message) else {
        return;
    };
    if ws_sender.send(Message::Text(text.into())).await.is_err() {
        return;
    }

    loop {
        tokio::select! {
            event = upstream.rx.recv() => {
                let Some(event) = event else {
                    let message = projection.resync_required("Herdr subscription stream closed", None);
                    let Ok(text) = serde_json::to_string(&message) else {
                        return;
                    };
                    let _ = ws_sender.send(Message::Text(text.into())).await;
                    return;
                };
                match event {
                    UpstreamStateEvent::Envelope(envelope) => {
                        if event_closes_terminal_session(&envelope) {
                            let prune_state = state.clone();
                            tokio::task::spawn_blocking(move || prune_detached_terminal_sessions(&prune_state));
                        }
                        if !projection.accepts_upstream_patch() {
                            continue;
                        }
                        let event = match projection.apply_event(&state, envelope) {
                            Ok(Some(message)) => Some(message),
                            Ok(None) => None,
                            Err(err) if err.is_unknown_pane() => {
                                let refresh_result = refresh_state_projection(
                                    &state,
                                    &stream_id,
                                    &mut projection,
                                    &mut upstream,
                                    Vec::new(),
                                ).await;
                                match refresh_result {
                                    Ok(message) => {
                                        let Ok(text) = serde_json::to_string(&message) else {
                                            return;
                                        };
                                        if ws_sender.send(Message::Text(text.into())).await.is_err() {
                                            return;
                                        }
                                        None
                                    }
                                    Err(err) => {
                                        projection.quiescent = true;
                                        Some(projection.patch_failed(err, None))
                                    }
                                }
                            }
                            Err(err) => Some(projection.patch_failed(err, None)),
                        };
                        if let Some(message) = event {
                            let Ok(text) = serde_json::to_string(&message) else {
                                return;
                            };
                            if ws_sender.send(Message::Text(text.into())).await.is_err() {
                                return;
                            }
                        }
                    }
                    UpstreamStateEvent::Status(status) => {
                        if !projection.accepts_upstream_patch() {
                            continue;
                        }
                        match projection.apply_status(&state, status, false) {
                            Ok(message) => {
                                let Ok(text) = serde_json::to_string(&message) else {
                                    continue;
                                };
                                if ws_sender.send(Message::Text(text.into())).await.is_err() {
                                    return;
                                }
                            }
                            Err(err) if err.is_unknown_pane() => {
                                match refresh_state_projection(
                                    &state,
                                    &stream_id,
                                    &mut projection,
                                    &mut upstream,
                                    Vec::new(),
                                ).await {
                                    Ok(message) => {
                                        let Ok(text) = serde_json::to_string(&message) else {
                                            return;
                                        };
                                        if ws_sender.send(Message::Text(text.into())).await.is_err() {
                                            return;
                                        }
                                    }
                                    Err(err) => {
                                        projection.quiescent = true;
                                        let message = projection.patch_failed(err, None);
                                        let Ok(text) = serde_json::to_string(&message) else {
                                            return;
                                        };
                                        if ws_sender.send(Message::Text(text.into())).await.is_err() {
                                            return;
                                        }
                                    }
                                }
                            }
                            Err(err) => {
                                let message = projection.patch_failed(err, None);
                                let Ok(text) = serde_json::to_string(&message) else {
                                    return;
                                };
                                if ws_sender.send(Message::Text(text.into())).await.is_err() {
                                    return;
                                }
                            }
                        }
                    }
                    UpstreamStateEvent::ResyncRequired(reason) => {
                        let message = projection.resync_required(reason, None);
                        let Ok(text) = serde_json::to_string(&message) else {
                            return;
                        };
                        if ws_sender.send(Message::Text(text.into())).await.is_err() {
                            return;
                        }
                    }
                    UpstreamStateEvent::Error(error) => {
                        let message = projection.error("subscription_failed", error);
                        let Ok(text) = serde_json::to_string(&message) else {
                            return;
                        };
                        let _ = ws_sender.send(Message::Text(text.into())).await;
                        return;
                    }
                }
            }
            event = ui_event_rx.recv() => {
                match event {
                    Ok(event) => {
                        if let Some(pane_id) = selection_event_pane_id(&event) {
                            if !projection.accepts_selection_change(&pane_id) {
                                continue;
                            }
                            projection.snapshot.selected_pane_id = Some(pane_id.clone());
                            let message = projection.selection_changed(pane_id);
                            let Ok(text) = serde_json::to_string(&message) else {
                                continue;
                            };
                            if ws_sender.send(Message::Text(text.into())).await.is_err() {
                                return;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let message = projection.resync_required("selection event stream lagged", None);
                        let Ok(text) = serde_json::to_string(&message) else {
                            return;
                        };
                        if ws_sender.send(Message::Text(text.into())).await.is_err() {
                            return;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                }
            }
            event = refresh_rx.recv() => {
                match event {
                    Ok(event) => {
                        if event.target_stream_id.as_deref().is_some_and(|target| target != stream_id) {
                            continue;
                        }
                        let mut refresh_ids = event.refresh_id.into_iter().collect::<Vec<_>>();
                        tokio::time::sleep(STATE_STREAM_REBUILD_DEBOUNCE).await;
                        while let Ok(event) = refresh_rx.try_recv() {
                            if event.target_stream_id.as_deref().is_some_and(|target| target != stream_id) {
                                continue;
                            }
                            refresh_ids.extend(event.refresh_id);
                        }
                        match refresh_state_projection(
                            &state,
                            &stream_id,
                            &mut projection,
                            &mut upstream,
                            refresh_ids.clone(),
                        ).await {
                            Ok(message) => {
                                let Ok(text) = serde_json::to_string(&message) else {
                                    return;
                                };
                                if ws_sender.send(Message::Text(text.into())).await.is_err() {
                                    return;
                                }
                            }
                            Err(err) => {
                                projection.quiescent = true;
                                let message = projection.patch_failed_with_refresh_ids(err, refresh_ids);
                                let Ok(text) = serde_json::to_string(&message) else {
                                    return;
                                };
                                if ws_sender.send(Message::Text(text.into())).await.is_err() {
                                    return;
                                }
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let message = projection.resync_required("state refresh stream lagged", None);
                        let Ok(text) = serde_json::to_string(&message) else {
                            return;
                        };
                        if ws_sender.send(Message::Text(text.into())).await.is_err() {
                            return;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                }
            }
            Some(message) = ws_receiver.next() => {
                match message {
                    Ok(Message::Close(_)) | Err(_) => return,
                    Ok(Message::Text(_))
                    | Ok(Message::Binary(_))
                    | Ok(Message::Ping(_))
                    | Ok(Message::Pong(_)) => {}
                }
            }
            else => return,
        }
    }
}

async fn refresh_state_projection(
    state: &BridgeState,
    stream_id: &str,
    projection: &mut BridgeProjection,
    upstream: &mut StateSubscription,
    refresh_ids: Vec<String>,
) -> Result<StateMessage, BridgeError> {
    let rebuild_state = state.clone();
    let rebuilt = tokio::task::spawn_blocking(move || open_state_projection(rebuild_state))
        .await
        .map_err(|err| BridgeError::Protocol(err.to_string()))??;
    let (mut next_projection, next_upstream) = rebuilt;
    next_projection.generation = projection.generation + 1;
    next_projection.next_sequence = projection.next_sequence;
    next_projection.quiescent = false;
    upstream.cancel();
    *upstream = next_upstream;
    *projection = next_projection;
    Ok(projection.snapshot_message(stream_id, (!refresh_ids.is_empty()).then_some(refresh_ids)))
}

async fn handle_ui_events_socket(socket: WebSocket, state: BridgeState) {
    let mut ui_event_rx = state.ui_event_tx.subscribe();
    let (mut ws_sender, mut ws_receiver) = socket.split();
    loop {
        tokio::select! {
            event = ui_event_rx.recv() => {
                match event {
                    Ok(event) => {
                        if ws_sender.send(Message::Text(event.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            Some(message) = ws_receiver.next() => {
                match message {
                    Ok(Message::Close(_)) | Err(_) => break,
                    Ok(Message::Text(_))
                    | Ok(Message::Binary(_))
                    | Ok(Message::Ping(_))
                    | Ok(Message::Pong(_)) => {}
                }
            }
            else => break,
        }
    }
}

#[derive(Debug)]
enum UpstreamStateEvent {
    Envelope(EventEnvelope),
    Status(PaneAgentStatusChangedEvent),
    ResyncRequired(String),
    Error(String),
}

struct StateSubscription {
    rx: tokio::sync::mpsc::UnboundedReceiver<UpstreamStateEvent>,
    cancellations: Vec<Arc<AtomicBool>>,
}

impl StateSubscription {
    fn cancel(&self) {
        for cancelled in &self.cancellations {
            cancelled.store(true, Ordering::Release);
        }
    }
}

impl Drop for StateSubscription {
    fn drop(&mut self) {
        self.cancel();
    }
}

impl BridgeProjection {
    fn new(snapshot: Snapshot) -> Self {
        Self {
            snapshot,
            generation: 1,
            next_sequence: 1,
            quiescent: false,
        }
    }

    fn next_sequence(&mut self) -> u64 {
        let sequence = self.next_sequence;
        self.next_sequence += 1;
        sequence
    }

    fn accepts_upstream_patch(&self) -> bool {
        !self.quiescent
    }

    fn accepts_selection_change(&self, pane_id: &str) -> bool {
        !self.quiescent
            || self
                .snapshot
                .panes
                .iter()
                .any(|pane| pane.pane_id == pane_id)
    }

    fn snapshot_message(
        &mut self,
        stream_id: &str,
        refresh_ids: Option<Vec<String>>,
    ) -> StateMessage {
        StateMessage::Snapshot {
            generation: self.generation,
            sequence: self.next_sequence(),
            snapshot: self.snapshot.clone(),
            stream_id: stream_id.to_string(),
            refresh_ids,
        }
    }

    fn resync_required(
        &mut self,
        reason: impl Into<String>,
        refresh_id: Option<String>,
    ) -> StateMessage {
        StateMessage::ResyncRequired {
            generation: self.generation,
            sequence: self.next_sequence(),
            reason: reason.into(),
            refresh_ids: refresh_id.map(|id| vec![id]),
        }
    }

    fn error(&mut self, code: &'static str, message: impl Into<String>) -> StateMessage {
        StateMessage::Error {
            generation: self.generation,
            sequence: self.next_sequence(),
            code,
            message: message.into(),
        }
    }

    fn patch_failed(&mut self, err: BridgeError, refresh_id: Option<String>) -> StateMessage {
        self.resync_required(format!("state patch failed: {err}"), refresh_id)
    }

    fn patch_failed_with_refresh_ids(
        &mut self,
        err: BridgeError,
        refresh_ids: Vec<String>,
    ) -> StateMessage {
        StateMessage::ResyncRequired {
            generation: self.generation,
            sequence: self.next_sequence(),
            reason: format!("state patch failed: {err}"),
            refresh_ids: (!refresh_ids.is_empty()).then_some(refresh_ids),
        }
    }

    fn selection_changed(&mut self, pane_id: String) -> StateMessage {
        StateMessage::SelectionChanged {
            generation: self.generation,
            sequence: self.next_sequence(),
            pane_id,
        }
    }

    fn apply_status(
        &mut self,
        state: &BridgeState,
        event: PaneAgentStatusChangedEvent,
        detected: bool,
    ) -> Result<StateMessage, BridgeError> {
        let index = self
            .snapshot
            .panes
            .iter()
            .position(|pane| pane.pane_id == event.pane_id)
            .ok_or_else(|| BridgeError::Protocol(format!("unknown pane {}", event.pane_id)))?;
        self.snapshot.panes[index].agent_status = event.agent_status;
        self.snapshot.panes[index].agent = event.agent;
        self.snapshot.panes[index].custom_status = event.custom_status;
        self.snapshot.panes[index].title = event.title;
        self.snapshot.panes[index].display_agent = event.display_agent;
        self.snapshot.panes[index].state_labels = event.state_labels;
        let pane = self.snapshot.panes[index].clone();
        let workspace = self.refresh_workspace(&state.api, &pane.workspace_id)?;
        let tab = self.refresh_tab(&state.api, &pane.tab_id)?;
        let generation = self.generation;
        let sequence = self.next_sequence();
        if detected {
            Ok(StateMessage::PaneAgentDetected {
                generation,
                sequence,
                pane,
                workspace,
                tab,
            })
        } else {
            Ok(StateMessage::PaneAgentStatusChanged {
                generation,
                sequence,
                pane,
                workspace,
                tab,
            })
        }
    }

    fn apply_event(
        &mut self,
        state: &BridgeState,
        envelope: EventEnvelope,
    ) -> Result<Option<StateMessage>, BridgeError> {
        match envelope.data {
            EventData::PaneAgentDetected { pane_id, .. } => {
                let pane = pane_info(&state.api, &pane_id)?;
                let status = PaneAgentStatusChangedEvent {
                    pane_id: pane.pane_id.clone(),
                    workspace_id: pane.workspace_id.clone(),
                    agent_status: pane.agent_status,
                    agent: pane.agent.clone(),
                    custom_status: pane.custom_status.clone(),
                    title: pane.title.clone(),
                    display_agent: pane.display_agent.clone(),
                    state_labels: pane.state_labels.clone(),
                };
                return Ok(Some(self.apply_status(state, status, true)?));
            }
            EventData::PaneOutputChanged { .. } | EventData::PaneAgentStatusChanged { .. } => {}
            _ => {}
        }
        Ok(None)
    }

    fn refresh_workspace(
        &mut self,
        api: &ApiClient,
        workspace_id: &str,
    ) -> Result<SnapshotWorkspaceInfo, BridgeError> {
        let workspace = workspace_info(api, workspace_id)?;
        Ok(self.upsert_workspace(workspace))
    }

    fn refresh_tab(
        &mut self,
        api: &ApiClient,
        tab_id: &str,
    ) -> Result<SnapshotTabInfo, BridgeError> {
        let tab = tab_info(api, tab_id)?;
        Ok(self.upsert_tab(tab))
    }

    fn upsert_workspace(&mut self, workspace: WorkspaceInfo) -> SnapshotWorkspaceInfo {
        let wrapped = wrap_workspace(workspace, &self.snapshot.panes);
        upsert_by(&mut self.snapshot.workspaces, wrapped.clone(), |item| {
            item.info.workspace_id.as_str()
        });
        wrapped
    }

    fn upsert_tab(&mut self, tab: TabInfo) -> SnapshotTabInfo {
        let wrapped = wrap_tab(tab);
        upsert_by(&mut self.snapshot.tabs, wrapped.clone(), |item| {
            item.info.tab_id.as_str()
        });
        wrapped
    }
}

fn upsert_by<T>(items: &mut Vec<T>, item: T, key: impl Fn(&T) -> &str) {
    let id = key(&item).to_string();
    if let Some(index) = items.iter().position(|candidate| key(candidate) == id) {
        items[index] = item;
    } else {
        items.push(item);
    }
}

async fn handle_terminal_socket(socket: WebSocket, state: BridgeState, query: TerminalQuery) {
    if query.terminal_id.trim().is_empty() {
        return;
    }

    let terminal_id = query.terminal_id.clone();
    let cols = query.cols.unwrap_or(DEFAULT_COLS);
    let rows = query.rows.unwrap_or(DEFAULT_ROWS);
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let session = match acquire_terminal_session(
        state.clone(),
        terminal_id.clone(),
        cols,
        rows,
        query.takeover,
    )
    .await
    {
        Ok(session) => session,
        Err(err) => {
            let _ = ws_sender
                .send(Message::Text(close_message(&err.to_string()).into()))
                .await;
            return;
        }
    };
    session.client_count.fetch_add(1, Ordering::AcqRel);

    let write_tx = session.write_tx.clone();
    let mut terminal_rx = session.output_tx.subscribe();
    let _ = write_tx.send(ClientMessage::Resize {
        cols,
        rows,
        cell_width_px: 0,
        cell_height_px: 0,
    });

    loop {
        tokio::select! {
            output = terminal_rx.recv() => {
                match output {
                    Ok(output) => match output {
                    TerminalOutput::Bytes(bytes) => {
                        if ws_sender.send(Message::Binary(bytes.into())).await.is_err() {
                            break;
                        }
                    }
                    TerminalOutput::Close(reason) => {
                        let _ = ws_sender.send(Message::Text(close_message(&reason).into())).await;
                        break;
                    }
                    },
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            Some(message) = ws_receiver.next() => {
                match message {
                    Ok(Message::Text(text)) => {
                        if handle_terminal_text_frame(&write_tx, text.as_str()).is_err() {
                            break;
                        }
                    }
                    Ok(Message::Binary(bytes)) => {
                        let _ = write_tx.send(ClientMessage::Input { data: bytes.to_vec() });
                    }
                    Ok(Message::Close(_)) => break,
                    Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                    Err(_) => break,
                }
            }
            else => break,
        }
    }

    release_terminal_session(&state, &terminal_id, &session);
}

async fn acquire_terminal_session(
    state: BridgeState,
    terminal_id: String,
    cols: u16,
    rows: u16,
    takeover: bool,
) -> Result<SharedTerminalSession, BridgeError> {
    tokio::task::spawn_blocking(move || {
        let mut sessions = state
            .terminal_sessions
            .lock()
            .map_err(|_| BridgeError::Protocol("terminal session lock poisoned".to_string()))?;
        if let Some(session) = sessions.get(&terminal_id) {
            return Ok(session.clone());
        }

        let protocol_version = terminal_attach_protocol(&state.api)?;
        let (output_tx, _) = tokio::sync::broadcast::channel(256);
        let attach = open_terminal_attach(
            state.client_socket_path.clone(),
            terminal_id.clone(),
            cols,
            rows,
            takeover,
            protocol_version,
            output_tx.clone(),
        )?;
        let session = SharedTerminalSession {
            write_tx: attach.write_tx,
            output_tx,
            client_count: Arc::new(AtomicUsize::new(0)),
        };
        sessions.insert(terminal_id, session.clone());
        Ok(session)
    })
    .await
    .map_err(|err| BridgeError::Protocol(err.to_string()))?
}

fn release_terminal_session(
    state: &BridgeState,
    terminal_id: &str,
    session: &SharedTerminalSession,
) {
    if session.client_count.fetch_sub(1, Ordering::AcqRel) != 1 {
        return;
    }

    let _ = session.write_tx.send(ClientMessage::Detach);
    let Ok(mut sessions) = state.terminal_sessions.lock() else {
        return;
    };
    if sessions
        .get(terminal_id)
        .is_some_and(|current| Arc::ptr_eq(&current.client_count, &session.client_count))
    {
        sessions.remove(terminal_id);
    }
}

fn prune_detached_terminal_sessions(state: &BridgeState) {
    let Ok(panes) = current_panes(&state.api) else {
        warn!("failed to prune herdr web terminal sessions");
        return;
    };
    let active_terminal_ids = panes
        .iter()
        .map(|pane| pane.terminal_id.as_str())
        .collect::<HashSet<_>>();
    let stale_sessions = {
        let Ok(sessions) = state.terminal_sessions.lock() else {
            warn!("failed to lock herdr web terminal sessions for pruning");
            return;
        };
        sessions
            .iter()
            .filter(|(terminal_id, _)| !active_terminal_ids.contains(terminal_id.as_str()))
            .map(|(terminal_id, session)| (terminal_id.clone(), session.clone()))
            .collect::<Vec<_>>()
    };

    for (terminal_id, session) in stale_sessions {
        close_terminal_session(state, &terminal_id, &session, "terminal closed by Herdr");
    }
}

fn close_terminal_session(
    state: &BridgeState,
    terminal_id: &str,
    session: &SharedTerminalSession,
    reason: &str,
) {
    let _ = session
        .output_tx
        .send(TerminalOutput::Close(reason.to_string()));
    let _ = session.write_tx.send(ClientMessage::Detach);
    let Ok(mut sessions) = state.terminal_sessions.lock() else {
        return;
    };
    if sessions
        .get(terminal_id)
        .is_some_and(|current| Arc::ptr_eq(&current.client_count, &session.client_count))
    {
        sessions.remove(terminal_id);
    }
}

fn event_may_close_terminal_session(event: &str) -> bool {
    event.contains("workspace.closed")
        || event.contains("tab.closed")
        || event.contains("pane.closed")
}

fn event_closes_terminal_session(event: &EventEnvelope) -> bool {
    matches!(
        event.data,
        EventData::WorkspaceClosed { .. }
            | EventData::TabClosed { .. }
            | EventData::PaneClosed { .. }
            | EventData::PaneMoved { .. }
    )
}

fn close_message(reason: &str) -> String {
    format!(
        r#"{{"type":"closed","reason":{}}}"#,
        serde_json::to_string(reason).unwrap_or_else(|_| "\"closed\"".into())
    )
}

fn open_event_subscription(
    api: ApiClient,
) -> Result<tokio::sync::mpsc::UnboundedReceiver<String>, BridgeError> {
    let request = Request {
        id: "herdr-web:events".to_string(),
        method: Method::EventsSubscribe(EventsSubscribeParams {
            subscriptions: vec![
                Subscription::WorkspaceCreated {},
                Subscription::WorkspaceUpdated {},
                Subscription::WorkspaceRenamed {},
                Subscription::WorkspaceClosed {},
                Subscription::WorkspaceFocused {},
                Subscription::TabCreated {},
                Subscription::TabClosed {},
                Subscription::TabFocused {},
                Subscription::TabRenamed {},
                Subscription::PaneCreated {},
                Subscription::PaneClosed {},
                Subscription::PaneFocused {},
                Subscription::PaneMoved {},
                Subscription::PaneExited {},
                Subscription::PaneAgentDetected {},
            ],
        }),
    };
    let (ack, mut stream) = api.subscribe_value(&request, None)?;
    let response = herdr_compat::api::client::parse_response_value(ack)?;
    if !matches!(response.result, ResponseResult::SubscriptionStarted {}) {
        return Err(BridgeError::Protocol(format!(
            "unexpected subscription response: {:?}",
            response.result
        )));
    }

    let (event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();
    thread::spawn(move || loop {
        match stream.next_value() {
            Ok(Some(event)) => {
                if event_tx.send(event.to_string()).is_err() {
                    break;
                }
            }
            Ok(None) => break,
            Err(err) => {
                let _ = event_tx.send(
                    serde_json::json!({
                        "type": "error",
                        "error": err.to_string(),
                    })
                    .to_string(),
                );
                break;
            }
        }
    });

    Ok(event_rx)
}

fn open_state_projection(
    state: BridgeState,
) -> Result<(BridgeProjection, StateSubscription), BridgeError> {
    let mut pane_ids = current_panes(&state.api)?
        .into_iter()
        .map(|pane| pane.pane_id)
        .collect::<Vec<_>>();
    pane_ids.sort();
    pane_ids.dedup();

    let mut subscription = open_state_subscription(state.api.clone(), pane_ids.clone())?;
    for _ in 0..STATE_STREAM_STARTUP_CONVERGENCE_LIMIT {
        drain_state_subscription_replay(&mut subscription);
        let snapshot = build_snapshot(&state)?;
        let mut snapshot_pane_ids = snapshot
            .panes
            .iter()
            .map(|pane| pane.pane_id.clone())
            .collect::<Vec<_>>();
        snapshot_pane_ids.sort();
        snapshot_pane_ids.dedup();
        if snapshot_pane_ids == pane_ids {
            return Ok((BridgeProjection::new(snapshot), subscription));
        }
        subscription.cancel();
        pane_ids = snapshot_pane_ids;
        subscription = open_state_subscription(state.api.clone(), pane_ids.clone())?;
    }

    Err(BridgeError::Protocol(
        "state stream startup did not converge".to_string(),
    ))
}

fn drain_state_subscription_replay(subscription: &mut StateSubscription) {
    thread::sleep(STATE_STREAM_STARTUP_DRAIN);
    while subscription.rx.try_recv().is_ok() {}
}

fn open_state_subscription(
    api: ApiClient,
    pane_ids: Vec<String>,
) -> Result<StateSubscription, BridgeError> {
    let subscriptions = state_subscriptions(&pane_ids);
    match open_state_subscription_stream(api.clone(), subscriptions) {
        Ok(subscription) => Ok(subscription),
        Err(first_err) => {
            warn!("state stream batched subscription failed: {first_err}");
            let pane_ids = current_panes(&api)?
                .into_iter()
                .map(|pane| pane.pane_id)
                .collect::<Vec<_>>();
            match open_state_subscription_stream(api.clone(), state_subscriptions(&pane_ids)) {
                Ok(subscription) => Ok(subscription),
                Err(second_err) => {
                    warn!("state stream retry subscription failed: {second_err}");
                    open_state_subscription_fallback(api, pane_ids).map_err(|fallback_err| {
                        BridgeError::Protocol(format!(
                            "state stream subscription failed: {second_err}; fallback failed: {fallback_err}"
                        ))
                    })
                }
            }
        }
    }
}

fn state_subscriptions(pane_ids: &[String]) -> Vec<Subscription> {
    let mut subscriptions = structural_state_subscriptions();
    subscriptions.extend(
        pane_ids
            .iter()
            .map(|pane_id| Subscription::PaneAgentStatusChanged {
                pane_id: pane_id.clone(),
                agent_status: None,
            }),
    );
    subscriptions
}

fn structural_state_subscriptions() -> Vec<Subscription> {
    vec![Subscription::PaneAgentDetected {}]
}

fn open_state_subscription_fallback(
    api: ApiClient,
    pane_ids: Vec<String>,
) -> Result<StateSubscription, BridgeError> {
    let (event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut cancellations = Vec::new();
    open_state_stream_into(
        api.clone(),
        structural_state_subscriptions(),
        event_tx.clone(),
        &mut cancellations,
    )?;
    for pane_id in pane_ids {
        if let Err(err) = open_state_stream_into(
            api.clone(),
            vec![Subscription::PaneAgentStatusChanged {
                pane_id: pane_id.clone(),
                agent_status: None,
            }],
            event_tx.clone(),
            &mut cancellations,
        ) {
            warn!("state stream skipped pane status subscription for {pane_id}: {err}");
            let _ = event_tx.send(UpstreamStateEvent::ResyncRequired(format!(
                "failed to subscribe to pane {pane_id}: {err}"
            )));
        }
    }
    Ok(StateSubscription {
        rx: event_rx,
        cancellations,
    })
}

fn open_state_subscription_stream(
    api: ApiClient,
    subscriptions: Vec<Subscription>,
) -> Result<StateSubscription, BridgeError> {
    let (event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut cancellations = Vec::new();
    open_state_stream_into(api, subscriptions, event_tx, &mut cancellations)?;
    Ok(StateSubscription {
        rx: event_rx,
        cancellations,
    })
}

fn open_state_stream_into(
    api: ApiClient,
    subscriptions: Vec<Subscription>,
    event_tx: tokio::sync::mpsc::UnboundedSender<UpstreamStateEvent>,
    cancellations: &mut Vec<Arc<AtomicBool>>,
) -> Result<(), BridgeError> {
    let request = Request {
        id: "herdr-web:state-events".to_string(),
        method: Method::EventsSubscribe(EventsSubscribeParams { subscriptions }),
    };
    let (ack, mut stream) = api.subscribe_value(&request, Some(STATE_STREAM_READ_TIMEOUT))?;
    let response = herdr_compat::api::client::parse_response_value(ack)?;
    if !matches!(response.result, ResponseResult::SubscriptionStarted {}) {
        return Err(BridgeError::Protocol(format!(
            "unexpected subscription response: {:?}",
            response.result
        )));
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    cancellations.push(cancelled.clone());
    thread::spawn(move || loop {
        if cancelled.load(Ordering::Acquire) {
            break;
        }
        match stream.next_value() {
            Ok(Some(value)) => match decode_state_event(value) {
                Ok(event) => {
                    if event_tx.send(event).is_err() {
                        break;
                    }
                }
                Err(err) => {
                    let _ = event_tx.send(UpstreamStateEvent::Error(err.to_string()));
                    break;
                }
            },
            Ok(None) => {
                let _ = event_tx.send(UpstreamStateEvent::ResyncRequired(
                    "Herdr subscription stream closed".to_string(),
                ));
                break;
            }
            Err(ApiClientError::Io(err)) if is_read_timeout(&err) => continue,
            Err(err) => {
                let _ = event_tx.send(UpstreamStateEvent::Error(err.to_string()));
                break;
            }
        }
    });
    Ok(())
}

fn decode_state_event(value: serde_json::Value) -> Result<UpstreamStateEvent, BridgeError> {
    if let Ok(envelope) = serde_json::from_value::<SubscriptionEventEnvelope>(value.clone()) {
        if let SubscriptionEventData::PaneAgentStatusChanged(status) = envelope.data {
            return Ok(UpstreamStateEvent::Status(status));
        }
    }
    let envelope = serde_json::from_value::<EventEnvelope>(value)
        .map_err(|err| BridgeError::Protocol(err.to_string()))?;
    Ok(UpstreamStateEvent::Envelope(envelope))
}

fn is_read_timeout(err: &io::Error) -> bool {
    matches!(err.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut)
}

fn selection_event_pane_id(event: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(event).ok()?;
    if value.get("type")?.as_str()? != "herdr_web.selection_changed" {
        return None;
    }
    value.get("pane_id")?.as_str().map(str::to_string)
}

fn handle_terminal_text_frame(
    write_tx: &mpsc::Sender<ClientMessage>,
    text: &str,
) -> Result<(), String> {
    match parse_terminal_client_frame(text)? {
        TerminalClientFrame::Input { data } => write_tx
            .send(ClientMessage::Input {
                data: data.into_bytes(),
            })
            .map_err(|_| "terminal writer closed".to_string()),
        TerminalClientFrame::Resize {
            cols,
            rows,
            cell_width_px,
            cell_height_px,
        } => write_tx
            .send(ClientMessage::Resize {
                cols,
                rows,
                cell_width_px,
                cell_height_px,
            })
            .map_err(|_| "terminal writer closed".to_string()),
        TerminalClientFrame::Scroll { direction, lines } => write_tx
            .send(ClientMessage::AttachScroll {
                source: AttachScrollSource::Wheel,
                direction: match direction {
                    ScrollDirection::Up => AttachScrollDirection::Up,
                    ScrollDirection::Down => AttachScrollDirection::Down,
                },
                lines: lines.max(1),
                column: None,
                row: None,
                modifiers: 0,
            })
            .map_err(|_| "terminal writer closed".to_string()),
    }
}

fn parse_terminal_client_frame(text: &str) -> Result<TerminalClientFrame, String> {
    serde_json::from_str(text).map_err(|err| format!("invalid terminal frame: {err}"))
}

struct TerminalAttach {
    write_tx: mpsc::Sender<ClientMessage>,
}

fn open_terminal_attach(
    client_socket_path: PathBuf,
    terminal_id: String,
    cols: u16,
    rows: u16,
    takeover: bool,
    protocol_version: u32,
    output_tx: tokio::sync::broadcast::Sender<TerminalOutput>,
) -> Result<TerminalAttach, BridgeError> {
    let mut stream = herdr_compat::ipc::connect_local_stream(&client_socket_path)?;
    protocol::write_message(
        &mut stream,
        &ClientMessage::Hello {
            version: protocol_version,
            cols,
            rows,
            cell_width_px: 0,
            cell_height_px: 0,
            requested_encoding: RenderEncoding::TerminalAnsi,
            keybindings: ClientKeybindings::Server,
            launch_mode: ClientLaunchMode::TerminalAttach,
        },
    )
    .map_err(|err| BridgeError::Protocol(err.to_string()))?;

    let welcome: ServerMessage = protocol::read_message(&mut stream, MAX_FRAME_SIZE)
        .map_err(|err| BridgeError::Protocol(err.to_string()))?;
    match welcome {
        ServerMessage::Welcome { error: None, .. } => {}
        ServerMessage::Welcome {
            error: Some(error), ..
        } => return Err(BridgeError::Protocol(error)),
        other => {
            return Err(BridgeError::Protocol(format!(
                "expected welcome, got {other:?}"
            )))
        }
    }

    protocol::write_message(
        &mut stream,
        &ClientMessage::AttachTerminal {
            terminal_id,
            takeover,
        },
    )
    .map_err(|err| BridgeError::Protocol(err.to_string()))?;

    let mut read_stream = stream.try_clone()?;
    let (write_tx, write_rx) = mpsc::channel::<ClientMessage>();

    thread::spawn(move || {
        let mut write_stream = stream;
        for message in write_rx {
            if protocol::write_message(&mut write_stream, &message).is_err() {
                break;
            }
            let _ = write_stream.flush();
        }
    });

    thread::spawn(move || loop {
        let message: ServerMessage =
            match protocol::read_message(&mut read_stream, MAX_GRAPHICS_FRAME_SIZE) {
                Ok(message) => message,
                Err(err) => {
                    let _ = output_tx.send(TerminalOutput::Close(err.to_string()));
                    break;
                }
            };
        match message {
            ServerMessage::Terminal(frame) => {
                let _ = output_tx.send(TerminalOutput::Bytes(frame.bytes));
            }
            ServerMessage::ServerShutdown { reason } => {
                let _ = output_tx.send(TerminalOutput::Close(
                    reason.unwrap_or_else(|| "server shutdown".to_string()),
                ));
                break;
            }
            ServerMessage::Welcome { .. } => {}
            ServerMessage::Notify { .. }
            | ServerMessage::Clipboard { .. }
            | ServerMessage::WindowTitle { .. }
            | ServerMessage::ReloadSoundConfig
            | ServerMessage::MouseCapture { .. }
            | ServerMessage::Frame(_)
            | ServerMessage::Graphics { .. } => {}
        }
    });

    Ok(TerminalAttach { write_tx })
}

fn terminal_attach_protocol(api: &ApiClient) -> Result<u32, BridgeError> {
    daemon_protocol_from_status(api.status_with_timeout(DAEMON_STATUS_TIMEOUT)?)
}

fn daemon_protocol_from_status(
    status: herdr_compat::api::RuntimeStatus,
) -> Result<u32, BridgeError> {
    let protocol = status.protocol.ok_or_else(|| {
        BridgeError::Protocol("Herdr daemon status did not include a protocol".to_string())
    })?;
    if supported_terminal_attach_protocol(protocol) {
        Ok(protocol)
    } else {
        Err(BridgeError::Protocol(unsupported_daemon_protocol_message(
            protocol,
        )))
    }
}

fn startup_daemon_protocol(api: &ApiClient) -> io::Result<u32> {
    terminal_attach_protocol(api).map_err(startup_daemon_error)
}

fn startup_daemon_error(err: BridgeError) -> io::Error {
    io::Error::new(
        ErrorKind::ConnectionRefused,
        format!(
            "unable to start herdr-web bridge: {err}. Start or update Herdr, then restart herdr-web-bridge."
        ),
    )
}

fn supported_terminal_attach_protocol(protocol: u32) -> bool {
    (MIN_TERMINAL_ATTACH_PROTOCOL..=PROTOCOL_VERSION).contains(&protocol)
}

fn unsupported_daemon_protocol_message(protocol: u32) -> String {
    if protocol < MIN_TERMINAL_ATTACH_PROTOCOL {
        format!(
            "Herdr daemon protocol {protocol} is too old for herdr-web; need protocol {MIN_TERMINAL_ATTACH_PROTOCOL} or newer"
        )
    } else {
        format!(
            "Herdr daemon protocol {protocol} is newer than this herdr-web bridge supports; need protocol {PROTOCOL_VERSION} or older"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_snapshot() -> Snapshot {
        Snapshot {
            workspaces: vec![SnapshotWorkspaceInfo {
                info: WorkspaceInfo {
                    workspace_id: "w1".to_string(),
                    number: 1,
                    label: "repo".to_string(),
                    focused: true,
                    pane_count: 1,
                    tab_count: 1,
                    active_tab_id: "t1".to_string(),
                    agent_status: herdr_compat::api::schema::AgentStatus::Idle,
                    worktree: None,
                },
                can_clear_name: false,
            }],
            tabs: vec![SnapshotTabInfo {
                info: TabInfo {
                    tab_id: "t1".to_string(),
                    workspace_id: "w1".to_string(),
                    number: 1,
                    label: "main".to_string(),
                    focused: true,
                    pane_count: 1,
                    agent_status: herdr_compat::api::schema::AgentStatus::Idle,
                },
                can_clear_name: true,
            }],
            panes: vec![PaneInfo {
                pane_id: "p1".to_string(),
                terminal_id: "term-1".to_string(),
                workspace_id: "w1".to_string(),
                tab_id: "t1".to_string(),
                focused: true,
                cwd: None,
                foreground_cwd: None,
                label: None,
                agent: None,
                agent_session: None,
                title: None,
                display_agent: None,
                agent_status: herdr_compat::api::schema::AgentStatus::Idle,
                custom_status: None,
                state_labels: HashMap::new(),
                revision: 1,
            }],
            layouts: Vec::new(),
            selected_pane_id: Some("p1".to_string()),
        }
    }

    fn test_bridge_state() -> BridgeState {
        BridgeState {
            api: ApiClient::for_socket_path(PathBuf::from("/tmp/herdr-web-test.sock")),
            client_socket_path: PathBuf::from("/tmp/herdr-web-client-test.sock"),
            request_policy: test_policy("127.0.0.1", 8787),
            terminal_sessions: Arc::new(Mutex::new(HashMap::new())),
            selected_pane_id: Arc::new(Mutex::new(None)),
            ui_event_tx: tokio::sync::broadcast::channel(16).0,
            state_refresh_tx: tokio::sync::broadcast::channel(16).0,
            active_state_streams: Arc::new(Mutex::new(HashSet::new())),
            upload_dir: PathBuf::from("/tmp"),
        }
    }

    #[test]
    fn parses_input_frame() {
        assert_eq!(
            parse_terminal_client_frame(r#"{"type":"input","data":"ls\n"}"#).unwrap(),
            TerminalClientFrame::Input {
                data: "ls\n".to_string()
            }
        );
    }

    #[test]
    fn parses_resize_frame_with_default_cell_size() {
        assert_eq!(
            parse_terminal_client_frame(r#"{"type":"resize","cols":100,"rows":40}"#).unwrap(),
            TerminalClientFrame::Resize {
                cols: 100,
                rows: 40,
                cell_width_px: 0,
                cell_height_px: 0
            }
        );
    }

    #[test]
    fn rejects_unknown_frame_type() {
        assert!(parse_terminal_client_frame(r#"{"type":"zoom"}"#).is_err());
    }

    #[test]
    fn parses_scroll_frame() {
        assert_eq!(
            parse_terminal_client_frame(r#"{"type":"scroll","direction":"up","lines":5}"#).unwrap(),
            TerminalClientFrame::Scroll {
                direction: ScrollDirection::Up,
                lines: 5
            }
        );
    }

    #[test]
    fn scroll_frame_defaults_lines() {
        assert_eq!(
            parse_terminal_client_frame(r#"{"type":"scroll","direction":"down"}"#).unwrap(),
            TerminalClientFrame::Scroll {
                direction: ScrollDirection::Down,
                lines: 3
            }
        );
    }

    #[test]
    fn command_allow_list_excludes_dangerous_methods() {
        assert!(ALLOWED_COMMANDS.contains(&"workspace.create"));
        assert!(ALLOWED_COMMANDS.contains(&"tab.close"));
        assert!(ALLOWED_COMMANDS.contains(&"pane.rename"));
        assert!(!ALLOWED_COMMANDS.contains(&"server.stop"));
        assert!(!ALLOWED_COMMANDS.contains(&"pane.send_keys"));
        assert!(ALLOWED_COMMANDS.contains(&"pane.send_input"));
        // pane.split is intentionally allowed so the web client can create splits.
        assert!(ALLOWED_COMMANDS.contains(&"pane.split"));
        assert!(ALLOWED_COMMANDS.contains(&"pane.focus_direction"));
        assert!(ALLOWED_COMMANDS.contains(&"pane.move"));
        assert!(ALLOWED_COMMANDS.contains(&"agent.start"));
    }

    #[test]
    fn state_subscriptions_include_per_pane_status() {
        let subscriptions = state_subscriptions(&["p1".to_string(), "p2".to_string()]);
        assert!(subscriptions
            .iter()
            .any(|item| matches!(item, Subscription::PaneAgentDetected {})));
        assert_eq!(
            subscriptions
                .iter()
                .filter(|item| matches!(item, Subscription::PaneAgentStatusChanged { .. }))
                .count(),
            2
        );
        assert!(subscriptions.iter().all(|item| matches!(
            item,
            Subscription::PaneAgentDetected {} | Subscription::PaneAgentStatusChanged { .. }
        )));
    }

    #[test]
    fn state_refresh_reasons_are_local_only() {
        assert!(
            serde_json::from_value::<StateRefreshRequest>(serde_json::json!({
                "stream_id": "stream-1",
                "reason": "manual"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<StateRefreshRequest>(serde_json::json!({
                "stream_id": "stream-1",
                "reason": "visibility"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<StateRefreshRequest>(serde_json::json!({
                "stream_id": "stream-1",
                "reason": "command"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<StateRefreshRequest>(serde_json::json!({
                "stream_id": "stream-1",
                "reason": "initial_load"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<StateRefreshRequest>(serde_json::json!({
                "stream_id": "stream-1",
                "reason": "stream_reconnect"
            }))
            .is_err()
        );
    }

    #[tokio::test]
    async fn state_refresh_handler_requires_active_stream_and_broadcasts_refresh_id() {
        let state = test_bridge_state();
        let unknown = state_refresh_handler(
            State(state.clone()),
            origin_headers("127.0.0.1:8787", Some("http://127.0.0.1:8787")),
            Json(StateRefreshRequest {
                stream_id: "missing".to_string(),
                reason: StateRefreshReason::Manual,
            }),
        )
        .await
        .unwrap_err();
        assert!(
            matches!(unknown, BridgeError::BadRequest(message) if message.contains("unknown stream_id"))
        );

        state
            .active_state_streams
            .lock()
            .unwrap()
            .insert("stream-1".to_string());
        let mut refresh_rx = state.state_refresh_tx.subscribe();
        let Json(response) = state_refresh_handler(
            State(state),
            origin_headers("127.0.0.1:8787", Some("http://127.0.0.1:8787")),
            Json(StateRefreshRequest {
                stream_id: "stream-1".to_string(),
                reason: StateRefreshReason::Manual,
            }),
        )
        .await
        .unwrap();

        let event = tokio::time::timeout(Duration::from_secs(1), refresh_rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(event.target_stream_id.as_deref(), Some("stream-1"));
        assert_eq!(
            event.refresh_id.as_deref(),
            Some(response.refresh_id.as_str())
        );
    }

    #[test]
    fn command_structure_refresh_classification_is_pinned() {
        assert!(command_may_change_structure(&Method::WorkspaceFocus(
            WorkspaceTarget {
                workspace_id: "w1".to_string(),
            },
        )));
        assert!(command_may_change_structure(&Method::PaneRename(
            herdr_compat::api::schema::PaneRenameParams {
                pane_id: "p1".to_string(),
                label: Some("editor".to_string()),
            },
        )));
        assert!(command_may_change_structure(&Method::AgentStart(
            herdr_compat::api::schema::AgentStartParams {
                name: "codex".to_string(),
                cwd: None,
                workspace_id: None,
                tab_id: None,
                split: None,
                focus: true,
                argv: vec!["codex".to_string()],
                env: HashMap::new(),
            },
        )));
        assert!(!command_may_change_structure(&Method::PaneList(
            PaneListParams::default(),
        )));
        assert!(!command_may_change_structure(&Method::PaneLayout(
            PaneLayoutParams::default(),
        )));
    }

    #[test]
    fn state_snapshot_message_carries_stream_and_refresh_ids() {
        let mut projection = BridgeProjection::new(test_snapshot());

        let message = projection.snapshot_message("stream-1", Some(vec!["refresh-1".to_string()]));

        match message {
            StateMessage::Snapshot {
                generation,
                sequence,
                stream_id,
                refresh_ids,
                ..
            } => {
                assert_eq!(generation, 1);
                assert_eq!(sequence, 1);
                assert_eq!(stream_id, "stream-1");
                assert_eq!(refresh_ids, Some(vec!["refresh-1".to_string()]));
            }
            other => panic!("unexpected state message: {other:?}"),
        }
    }

    #[test]
    fn quiescent_projection_suppresses_upstream_patches_but_allows_known_selection() {
        let mut projection = BridgeProjection::new(test_snapshot());
        assert!(projection.accepts_upstream_patch());
        assert!(projection.accepts_selection_change("missing"));

        projection.quiescent = true;

        assert!(!projection.accepts_upstream_patch());
        assert!(projection.accepts_selection_change("p1"));
        assert!(!projection.accepts_selection_change("missing"));
    }

    #[test]
    fn state_patch_failures_emit_resync_required() {
        let mut projection = BridgeProjection::new(Snapshot {
            workspaces: Vec::new(),
            tabs: Vec::new(),
            panes: Vec::new(),
            layouts: Vec::new(),
            selected_pane_id: None,
        });

        let message =
            projection.patch_failed(BridgeError::Protocol("unknown pane p1".to_string()), None);

        match message {
            StateMessage::ResyncRequired { reason, .. } => {
                assert!(reason.contains("unknown pane p1"));
            }
            other => panic!("unexpected state message: {other:?}"),
        }
    }

    #[test]
    fn state_event_decoder_accepts_subscription_status_envelope() {
        let event = serde_json::json!({
            "event": "pane.agent_status_changed",
            "data": {
                "pane_id": "p1",
                "workspace_id": "w1",
                "agent_status": "working",
                "agent": "codex",
                "state_labels": { "working": "Working" }
            }
        });

        match decode_state_event(event).unwrap() {
            UpstreamStateEvent::Status(status) => {
                assert_eq!(status.pane_id, "p1");
                assert_eq!(
                    status.agent_status,
                    herdr_compat::api::schema::AgentStatus::Working
                );
            }
            other => panic!("unexpected decoded event: {other:?}"),
        }
    }

    #[test]
    fn state_event_decoder_accepts_structural_event_envelope() {
        let event = serde_json::json!({
            "event": "pane_focused",
            "data": {
                "type": "pane_focused",
                "pane_id": "p1",
                "workspace_id": "w1"
            }
        });

        match decode_state_event(event).unwrap() {
            UpstreamStateEvent::Envelope(envelope) => {
                assert!(matches!(envelope.data, EventData::PaneFocused { .. }));
            }
            other => panic!("unexpected decoded event: {other:?}"),
        }
    }

    #[test]
    fn state_subscription_timeout_errors_are_nonfatal_ticks() {
        assert!(is_read_timeout(&io::Error::new(
            ErrorKind::WouldBlock,
            "idle"
        )));
        assert!(is_read_timeout(&io::Error::new(
            ErrorKind::TimedOut,
            "idle"
        )));
        assert!(!is_read_timeout(&io::Error::new(
            ErrorKind::ConnectionReset,
            "closed"
        )));
    }

    #[test]
    fn decoded_close_events_prune_terminal_sessions() {
        let event = EventEnvelope {
            event: herdr_compat::api::schema::EventKind::PaneClosed,
            data: EventData::PaneClosed {
                pane_id: "p1".to_string(),
                workspace_id: "w1".to_string(),
            },
        };
        assert!(event_closes_terminal_session(&event));

        let event = EventEnvelope {
            event: herdr_compat::api::schema::EventKind::PaneFocused,
            data: EventData::PaneFocused {
                pane_id: "p1".to_string(),
                workspace_id: "w1".to_string(),
            },
        };
        assert!(!event_closes_terminal_session(&event));

        let event = EventEnvelope {
            event: herdr_compat::api::schema::EventKind::PaneMoved,
            data: EventData::PaneMoved {
                previous_pane_id: "p1".to_string(),
                previous_workspace_id: "w1".to_string(),
                previous_tab_id: "t1".to_string(),
                pane: Box::new(PaneInfo {
                    pane_id: "p2".to_string(),
                    terminal_id: "term-1".to_string(),
                    workspace_id: "w1".to_string(),
                    tab_id: "t2".to_string(),
                    focused: true,
                    cwd: None,
                    foreground_cwd: None,
                    label: None,
                    agent: None,
                    agent_session: None,
                    title: None,
                    display_agent: None,
                    agent_status: herdr_compat::api::schema::AgentStatus::Idle,
                    custom_status: None,
                    state_labels: HashMap::new(),
                    revision: 1,
                }),
                created_workspace: None,
                created_tab: None,
                closed_workspace_id: None,
                closed_tab_id: None,
            },
        };
        assert!(event_closes_terminal_session(&event));
    }

    #[test]
    fn request_gate_allows_same_origin_and_loopback_dev_proxy() {
        let policy = test_policy("127.0.0.1", 8787);
        assert!(request_allowed(
            &origin_headers("127.0.0.1:8787", None),
            &policy
        ));
        assert!(request_allowed(
            &origin_headers("127.0.0.1:8787", Some("http://127.0.0.1:8787")),
            &policy
        ));
        assert!(request_allowed(
            &origin_headers("127.0.0.1:5173", Some("http://127.0.0.1:5173")),
            &policy
        ));
    }

    #[test]
    fn request_gate_rejects_dns_rebinding_hosts() {
        let policy = test_policy("0.0.0.0", 4000);
        assert!(!request_allowed(
            &origin_headers("evil.example:4000", Some("http://evil.example:4000")),
            &policy
        ));
        assert!(request_allowed(
            &origin_headers("192.168.1.10:4000", Some("http://192.168.1.10:4000")),
            &policy
        ));
        assert!(!request_allowed(
            &origin_headers("192.168.1.10:8787", Some("http://192.168.1.10:8787")),
            &policy
        ));
    }

    #[test]
    fn request_gate_rejects_cross_site_browser_origins() {
        let policy = test_policy("127.0.0.1", 8787);
        assert!(!request_allowed(
            &origin_headers("127.0.0.1:8787", Some("https://example.com")),
            &policy
        ));
        assert!(!request_allowed(
            &origin_headers("192.168.1.10:8787", Some("http://127.0.0.1:5173")),
            &policy
        ));
        assert!(!request_allowed(
            &origin_headers("127.0.0.1:8787", Some("null")),
            &policy
        ));
    }

    #[test]
    fn request_gate_allows_configured_android_origin() {
        let policy = RequestPolicy {
            bind_host: "0.0.0.0".to_string(),
            bind_port: 4000,
            allowed_hosts: Vec::new(),
            allowed_origins: vec!["http://localhost".to_string()],
        };
        assert!(request_allowed(
            &origin_headers("192.168.1.10:4000", Some("http://localhost")),
            &policy
        ));
        assert!(!request_allowed(
            &origin_headers("192.168.1.10:4000", Some("https://example.com")),
            &policy
        ));
    }

    #[test]
    fn origin_gate_allows_same_origin_and_loopback_dev_proxy() {
        let policy = test_policy("127.0.0.1", 8787);
        assert!(request_origin_allowed(
            &origin_headers("127.0.0.1:8787", None),
            &policy
        ));
        assert!(request_origin_allowed(
            &origin_headers("127.0.0.1:8787", Some("http://127.0.0.1:8787")),
            &policy
        ));
        assert!(request_origin_allowed(
            &origin_headers("127.0.0.1:8787", Some("http://127.0.0.1:5173")),
            &policy
        ));
    }

    #[test]
    fn origin_gate_rejects_cross_site_browser_origins() {
        let policy = test_policy("127.0.0.1", 8787);
        assert!(!request_origin_allowed(
            &origin_headers("127.0.0.1:8787", Some("https://example.com")),
            &policy
        ));
        assert!(!request_origin_allowed(
            &origin_headers("192.168.1.10:8787", Some("http://127.0.0.1:5173")),
            &policy
        ));
        assert!(!request_origin_allowed(
            &origin_headers("127.0.0.1:8787", Some("null")),
            &policy
        ));
    }

    #[test]
    fn host_gate_accepts_exact_loopback_and_ip_literal_binds() {
        let loopback = test_policy("127.0.0.1", 8787);
        assert!(host_authority_allowed("localhost:5173", &loopback));
        assert!(host_authority_allowed("127.0.0.1:8787", &loopback));
        assert!(!host_authority_allowed("127.0.0.2:8787", &loopback));

        let lan = test_policy("0.0.0.0", 4000);
        assert!(host_authority_allowed("192.168.1.10:4000", &lan));
        assert!(host_authority_allowed("[::1]:5173", &lan));
        assert!(!host_authority_allowed("evil.example:4000", &lan));
    }

    #[test]
    fn host_gate_accepts_configured_hostname_only_on_bridge_port() {
        let policy = RequestPolicy {
            bind_host: "0.0.0.0".to_string(),
            bind_port: 4000,
            allowed_hosts: vec!["herdr-host.local".to_string()],
            allowed_origins: Vec::new(),
        };
        assert!(host_authority_allowed("herdr-host.local:4000", &policy));
        assert!(host_authority_allowed("HERDR-HOST.LOCAL:4000", &policy));
        assert!(!host_authority_allowed("herdr-host.local:8787", &policy));
        assert!(!host_authority_allowed("evil.example:4000", &policy));
    }

    #[test]
    fn cors_headers_reflect_only_allowed_origins() {
        let policy = RequestPolicy {
            bind_host: "0.0.0.0".to_string(),
            bind_port: 4000,
            allowed_hosts: Vec::new(),
            allowed_origins: vec!["http://localhost".to_string()],
        };
        assert_eq!(
            cors_origin_header(
                &origin_headers("192.168.1.10:4000", Some("http://localhost")),
                &policy
            )
            .and_then(|value| value.to_str().ok().map(str::to_string)),
            Some("http://localhost".to_string())
        );
        assert!(cors_origin_header(
            &origin_headers("192.168.1.10:4000", Some("https://example.com")),
            &policy
        )
        .is_none());
    }

    #[test]
    fn cors_headers_preserve_preflight_requested_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(
            ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("content-type, authorization"),
        );

        insert_cors_headers(&mut headers, HeaderValue::from_static("http://localhost"));

        assert_eq!(
            headers
                .get(ACCESS_CONTROL_ALLOW_HEADERS)
                .and_then(|value| value.to_str().ok()),
            Some("content-type, authorization")
        );
    }

    #[test]
    fn validates_narrow_agent_start_commands() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "agent.start",
            "params": {
                "name": "Codex 2",
                "tab_id": "1-1",
                "split": "right",
                "focus": true,
                "argv": ["codex"]
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "agent.start",
            "params": {
                "name": "server",
                "tab_id": "1-1",
                "split": "right",
                "focus": true,
                "argv": ["sh", "-c", "date"],
                "env": { "X": "1" }
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());
    }

    #[test]
    fn validates_narrow_workspace_and_tab_create_commands() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "workspace.create",
            "params": {
                "focus": true
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "workspace.create",
            "params": {
                "focus": true,
                "cwd": "/tmp",
                "env": { "X": "1" }
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "tab.create",
            "params": {
                "workspace_id": "w1",
                "focus": true,
                "label": "Codex"
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "tab.create",
            "params": {
                "workspace_id": "w1",
                "focus": true,
                "cwd": "/tmp",
                "env": { "X": "1" }
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());
    }

    #[test]
    fn validates_narrow_workspace_and_tab_rename_commands() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "workspace.rename",
            "params": {
                "workspace_id": "w1",
                "label": null
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "tab.rename",
            "params": {
                "tab_id": "w1:t1",
                "label": "Review"
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "tab.rename",
            "params": {
                "tab_id": "w1:t1",
                "label": "   "
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());
    }

    #[test]
    fn validates_narrow_pane_launch_commands() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.send_input",
            "params": {
                "pane_id": "1-1",
                "text": "claude",
                "keys": ["Enter"]
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.send_input",
            "params": {
                "pane_id": "1-1",
                "text": "rm -rf /tmp/nope",
                "keys": ["Enter"]
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());
    }

    #[test]
    fn validates_narrow_pane_splits() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.split",
            "params": {
                "target_pane_id": "1-1",
                "direction": "down",
                "focus": true
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.split",
            "params": {
                "target_pane_id": "1-1",
                "direction": "down",
                "cwd": "/tmp",
                "env": { "X": "1" }
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());
    }

    #[test]
    fn validates_narrow_pane_moves() {
        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.move",
            "params": {
                "pane_id": "w1:p1",
                "destination": {
                    "type": "new_tab",
                    "workspace_id": "w1",
                    "label": "Moved"
                },
                "focus": true
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.move",
            "params": {
                "pane_id": "w1:p1",
                "destination": {
                    "type": "new_workspace",
                    "label": "Moved",
                    "tab_label": "Pane"
                },
                "focus": true
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_ok());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.move",
            "params": {
                "pane_id": "w1:p1",
                "destination": {
                    "type": "tab",
                    "tab_id": "w1:t2",
                    "target_pane_id": "w1:p2",
                    "split": "right"
                },
                "focus": true
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());

        let request: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "pane.move",
            "params": {
                "pane_id": "w1:p1",
                "destination": {
                    "type": "new_tab",
                    "workspace_id": "w1"
                },
                "focus": false
            }
        }))
        .unwrap();
        assert!(validate_web_command(&request.method).is_err());
    }

    #[test]
    fn command_request_parses_into_wire_request() {
        let body: CommandRequest = serde_json::from_str(
            r#"{"method":"workspace.rename","params":{"workspace_id":"w1","label":"api"}}"#,
        )
        .unwrap();
        let request_value = serde_json::json!({
            "id": "test",
            "method": body.method,
            "params": body.params,
        });
        let request: Request = serde_json::from_value(request_value).unwrap();
        assert!(matches!(request.method, Method::WorkspaceRename(_)));
    }

    #[test]
    fn loopback_host_detection_warns_for_network_binds() {
        assert!(is_loopback_bind_host("127.0.0.1"));
        assert!(is_loopback_bind_host("localhost"));
        assert!(!is_loopback_bind_host("0.0.0.0"));
        assert!(!is_loopback_bind_host("192.168.1.10"));
    }

    #[test]
    fn terminal_attach_protocol_supports_current_and_latest_release_protocols() {
        assert!(supported_terminal_attach_protocol(PROTOCOL_VERSION));
        assert!(supported_terminal_attach_protocol(13));
        assert!(!supported_terminal_attach_protocol(12));
        assert!(!supported_terminal_attach_protocol(PROTOCOL_VERSION + 1));
    }

    #[test]
    fn daemon_status_protocol_accepts_supported_range() {
        assert_eq!(daemon_protocol_from_status(runtime_status(13)).unwrap(), 13);
        assert_eq!(
            daemon_protocol_from_status(runtime_status(PROTOCOL_VERSION)).unwrap(),
            PROTOCOL_VERSION
        );
    }

    #[test]
    fn daemon_status_protocol_rejects_defensive_missing_protocol() {
        let missing = herdr_compat::api::RuntimeStatus {
            version: Some("0.7.0".to_string()),
            protocol: None,
            capabilities: None,
        };
        assert!(daemon_protocol_from_status(missing)
            .unwrap_err()
            .to_string()
            .contains("did not include a protocol"));
    }

    #[test]
    fn daemon_status_protocol_rejects_unsupported_protocols() {
        assert!(
            daemon_protocol_from_status(runtime_status(MIN_TERMINAL_ATTACH_PROTOCOL - 1))
                .unwrap_err()
                .to_string()
                .contains("too old")
        );

        assert!(
            daemon_protocol_from_status(runtime_status(PROTOCOL_VERSION + 1))
                .unwrap_err()
                .to_string()
                .contains("newer")
        );
    }

    #[test]
    fn startup_daemon_error_maps_reachable_status_failures_to_actionable_io_error() {
        let err = BridgeError::from(ApiClientError::UnexpectedResult(
            "WorkspaceList".to_string(),
        ));
        let io_err = startup_daemon_error(err);

        assert_eq!(io_err.kind(), ErrorKind::ConnectionRefused);
        let message = io_err.to_string();
        assert!(message.contains("unable to start herdr-web bridge"));
        assert!(message.contains("unexpected api result"));
        assert!(message.contains("Start or update Herdr"));
        assert!(message.contains("restart herdr-web-bridge"));
    }

    #[test]
    fn help_text_is_bridge_specific() {
        let help = help_text();

        assert!(help.contains("herdr-web-bridge"));
        assert!(help.contains("Usage: herdr-web-bridge"));
        assert!(help.contains("--session NAME"));
        assert!(!help.contains("herdr web-bridge"));
    }

    #[test]
    fn parse_options_configures_explicit_session() {
        let _guard = crate::session::TEST_ENV_LOCK.lock().unwrap();
        let previous_session = std::env::var(crate::session::SESSION_ENV_VAR).ok();
        let previous_socket = std::env::var(herdr_compat::api::SOCKET_PATH_ENV_VAR).ok();

        std::env::set_var(
            herdr_compat::api::SOCKET_PATH_ENV_VAR,
            "/tmp/ignored-herdr.sock",
        );
        let args = vec!["--session".to_string(), "work".to_string()];
        let options = parse_options(&args).unwrap().unwrap();

        assert_eq!(options.port, DEFAULT_PORT);
        assert!(crate::session::explicit_session_requested());
        assert!(crate::session::active_api_socket_path().ends_with("sessions/work/herdr.sock"));

        restore_env(crate::session::SESSION_ENV_VAR, previous_session);
        restore_env(herdr_compat::api::SOCKET_PATH_ENV_VAR, previous_socket);
        crate::session::clear_explicit_session_for_test();
    }

    fn restore_env(name: &str, value: Option<String>) {
        match value {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }

    fn runtime_status(protocol: u32) -> herdr_compat::api::RuntimeStatus {
        herdr_compat::api::RuntimeStatus {
            version: Some("0.7.0".to_string()),
            protocol: Some(protocol),
            capabilities: None,
        }
    }

    #[test]
    fn upload_file_name_sanitization_uses_basename() {
        assert_eq!(
            sanitize_upload_file_name("../../screen shot.png").as_deref(),
            Some("screen shot.png")
        );
        assert_eq!(
            sanitize_upload_file_name(r"..\notes.txt").as_deref(),
            Some("notes.txt")
        );
        assert_eq!(sanitize_upload_file_name(".."), None);
        assert_eq!(sanitize_upload_file_name(""), None);
    }

    #[test]
    fn upload_file_name_sanitization_rechecks_truncated_name() {
        let name = format!("{}.", "a".repeat(180));
        let expected = "a".repeat(180);
        assert_eq!(
            sanitize_upload_file_name(&name).as_deref(),
            Some(expected.as_str())
        );
        let dots = ".".repeat(181);
        assert_eq!(sanitize_upload_file_name(&dots), None);
    }

    #[test]
    fn upload_extension_comes_from_mime() {
        assert_eq!(upload_extension_for_mime(Some("image/png")), Some("png"));
        assert_eq!(
            upload_extension_for_mime(Some("image/jpeg; charset=binary")),
            Some("jpg")
        );
        assert_eq!(
            upload_extension_for_mime(Some("application/octet-stream")),
            None
        );
    }

    #[test]
    fn upload_child_check_rejects_nested_paths() {
        let parent = PathBuf::from("/tmp/herdr-web/uploads");
        assert!(is_direct_child(&parent, &parent.join("file.png")));
        assert!(!is_direct_child(&parent, &parent.join("nested/file.png")));
    }

    fn origin_headers(host: &str, origin: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(HOST, host.parse().unwrap());
        if let Some(origin) = origin {
            headers.insert(ORIGIN, origin.parse().unwrap());
        }
        headers
    }

    fn test_policy(bind_host: &str, bind_port: u16) -> RequestPolicy {
        RequestPolicy {
            bind_host: bind_host.to_string(),
            bind_port,
            allowed_hosts: Vec::new(),
            allowed_origins: Vec::new(),
        }
    }
}
