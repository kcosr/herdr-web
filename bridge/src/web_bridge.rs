use std::collections::{HashMap, HashSet};
use std::env;
use std::fmt;
use std::io::{self, ErrorKind, Write};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Path as AxumPath, Query, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
    ACCESS_CONTROL_MAX_AGE, ACCESS_CONTROL_REQUEST_HEADERS, CACHE_CONTROL, HOST, ORIGIN, VARY,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{extract::Request as AxumRequest, Json, Router};
use flate2::write::GzEncoder;
use flate2::Compression;
use futures_util::{SinkExt, StreamExt};
use herdr_compat::TryClone as _;
use serde::{Deserialize, Serialize};
use tokio::time::Instant;
use tower::ServiceBuilder;
use tower_http::compression::CompressionLayer;
use tower_http::services::ServeDir;
use tracing::{debug, info, warn};

use herdr_compat::api::client::{ApiClient, ApiClientError};
use herdr_compat::api::schema::{
    AgentInfo, AgentStartParams, AgentStatus, AgentTarget, EmptyParams, EventsSubscribeParams,
    LayoutApplyParams, LayoutExportParams, Method, PaneInfo, PaneLayoutSnapshot, PaneListParams,
    PaneMoveDestination, PaneSplitParams, PaneTarget, Request, ResponseResult, SessionSnapshot,
    SplitDirection, Subscription, SubscriptionEventData, SubscriptionEventEnvelope,
    SubscriptionEventKind, TabCreateParams, TabInfo, TabListParams, TabTarget, WorkspaceInfo,
};
use herdr_compat::protocol::{
    self, AttachScrollDirection, AttachScrollSource, ClientKeybindings, ClientLaunchMode,
    ClientMessage, RenderEncoding, ServerMessage, MAX_FRAME_SIZE, MAX_GRAPHICS_FRAME_SIZE,
    PROTOCOL_VERSION,
};

use crate::agent_activity::{AgentActivityListResponse, AgentActivityManager};
use crate::agent_pins::{AgentPinsError, AgentPinsListResponse, AgentPinsManager};
use crate::launcher_presets::{
    layout_leaf_for_preset, split_layout_with_command_preset, CustomCommandPreset,
    LauncherPresetLaunch, LauncherPresetStore, ManagedAgentKind, ResolvedLauncherPreset,
    MAX_LABEL_BYTES,
};
use crate::notes::{
    AttachNoteRequest, CreateNoteRequest, NoteResponse, NotesError, NotesListQuery,
    NotesListResponse, NotesManager, RevisionRequest, UpdateNoteRequest,
};

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8787;
const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
const DEFAULT_STATIC_DIR: &str = "web/dist";
const MIN_HERDR_VERSION: (u64, u64, u64) = (0, 8, 0);
const MIN_HERDR_VERSION_LABEL: &str = "0.8.0";
const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;
const MAX_NOTES_REQUEST_BYTES: usize = 512 * 1024;
const MAX_TERMINAL_INPUT_CHUNK_BYTES: usize = 768 * 1024;
const MAX_QUEUED_TERMINAL_INPUT_BYTES: usize = 8 * 1024 * 1024;
const TERMINAL_DETACH_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_TERMINAL_DETACH_DRAIN_WAITS: usize = 4;
const MAX_ATTACH_HANDSHAKE_RETRIES: usize = 2;
const TERMINAL_ATTACH_GATE_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_TERMINAL_OUTPUT_COALESCE_MS: u64 = 16;
const MAX_TERMINAL_OUTPUT_COALESCE_MS: u64 = 256;
const TERMINAL_OUTPUT_COALESCE_MAX_BYTES: usize = 32 * 1024;
const TERMINAL_OUTPUT_COALESCE_MAX_CHUNKS: usize = 256;
const TERMINAL_OUTPUT_FRAME_RAW: u8 = 0;
const TERMINAL_OUTPUT_FRAME_GZIP: u8 = 1;
const TERMINAL_OUTPUT_GZIP_MIN_BYTES: usize = 256;
const TERMINAL_OUTPUT_GZIP_ACKNOWLEDGEMENT: &str =
    r#"{"type":"terminal_output_encoding","encoding":"gzip"}"#;
const DAEMON_STATUS_TIMEOUT: Duration = Duration::from_secs(5);
const ACTIVITY_WATCHER_INITIAL_BACKOFF: Duration = Duration::from_secs(1);
const ACTIVITY_WATCHER_MAX_BACKOFF: Duration = Duration::from_secs(30);
const ACTIVITY_RESUBSCRIBE_DEBOUNCE: Duration = Duration::from_millis(100);
const ACTIVITY_READ_TIMEOUT: Duration = Duration::from_millis(250);
const MANAGED_AGENT_SHELL_SETTLE_DELAY: Duration = Duration::from_millis(100);
const MANAGED_AGENT_SHELL_RETRY_INITIAL_DELAY: Duration = Duration::from_millis(300);
const MANAGED_AGENT_SHELL_READY_TIMEOUT: Duration = Duration::from_secs(3);
const MANAGED_AGENT_START_TIMEOUT: Duration = Duration::from_secs(30);
const MANAGED_AGENT_POLL_INTERVAL: Duration = Duration::from_millis(100);
static UPLOAD_TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone)]
struct BridgeOptions {
    host: String,
    port: u16,
    static_dir: PathBuf,
    upload_dir: PathBuf,
    launcher_presets_path: Option<PathBuf>,
    allowed_hosts: Vec<String>,
    allowed_origins: Vec<String>,
    public_origins: Vec<String>,
    allowed_connect_sources: Vec<String>,
}

#[derive(Clone)]
struct BridgeState {
    api: ApiClient,
    client_socket_path: PathBuf,
    request_policy: RequestPolicy,
    terminal_sessions: Arc<Mutex<TerminalSessions>>,
    selected_pane_id: Arc<Mutex<Option<String>>>,
    agent_activity: Arc<AgentActivityManager>,
    agent_pins: Arc<AgentPinsManager>,
    launcher_presets: Arc<LauncherPresetStore>,
    notes: Arc<NotesManager>,
    ui_event_tx: tokio::sync::broadcast::Sender<String>,
    activity_tx: tokio::sync::broadcast::Sender<ActivityMessage>,
    upload_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct RequestPolicy {
    bind_host: String,
    bind_port: u16,
    allowed_hosts: Vec<String>,
    allowed_origins: Vec<String>,
    public_origins: Vec<String>,
    allowed_connect_sources: Vec<String>,
}

#[derive(Debug, Serialize)]
struct Snapshot {
    workspaces: Vec<SnapshotWorkspaceInfo>,
    tabs: Vec<SnapshotTabInfo>,
    panes: Vec<PaneInfo>,
    layouts: Vec<PaneLayoutSnapshot>,
    selected_pane_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct SnapshotWorkspaceInfo {
    #[serde(flatten)]
    info: WorkspaceInfo,
    can_clear_name: bool,
}

#[derive(Debug, Serialize)]
struct SnapshotTabInfo {
    #[serde(flatten)]
    info: TabInfo,
    can_clear_name: bool,
}

#[derive(Debug, Serialize)]
struct Capabilities {
    commands: &'static [&'static str],
    agent_activity: AgentActivityCapability,
    agent_pins: AgentPinsCapability,
    launcher_presets: LauncherPresetsCapability,
    notes: NotesCapability,
}

#[derive(Debug, Serialize)]
struct AgentActivityCapability {
    version: u32,
}

#[derive(Debug, Serialize)]
struct AgentPinsCapability {
    version: u32,
}

#[derive(Debug, Serialize)]
struct LauncherPresetsCapability {
    version: u32,
}

#[derive(Debug, Serialize)]
struct NotesCapability {
    version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ActivityMessage {
    #[serde(rename = "pane.agent_status_changed")]
    PaneAgentStatusChanged {
        pane_id: String,
        workspace_id: String,
        agent_status: AgentStatus,
        agent: Option<String>,
        title: Option<String>,
        display_agent: Option<String>,
        state_labels: HashMap<String, String>,
    },
    #[serde(rename = "resync_required")]
    ResyncRequired { reason: String },
}

#[derive(Debug, Deserialize)]
struct TerminalQuery {
    terminal_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    coalesce_ms: Option<u64>,
    output_encoding: Option<TerminalOutputWireEncoding>,
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
    Bytes(Bytes),
    Close(String),
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TerminalOutputWireEncoding {
    Identity,
    Gzip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TerminalOutputFlushReason {
    Timer,
    ByteThreshold,
    ChunkThreshold,
    Close,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TerminalOutputCoalescingDecision {
    SendNow(Bytes),
    Pending,
    FlushPending(TerminalOutputFlushReason),
}

#[cfg(test)]
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct TerminalOutputCoalescingStats {
    source_frames: u64,
    source_bytes: u64,
    sent_frames: u64,
    sent_bytes: u64,
    immediate_frames: u64,
    coalesced_source_frames: u64,
    coalesced_sent_frames: u64,
    timer_flushes: u64,
    byte_flushes: u64,
    chunk_flushes: u64,
    single_chunk_flushes: u64,
    merged_flushes: u64,
    lagged_events: u64,
    lagged_frames: u64,
    max_pending_bytes: usize,
    max_pending_chunks: usize,
    total_flush_latency_us: u128,
    max_flush_latency_us: u128,
}

#[cfg(test)]
impl TerminalOutputCoalescingStats {
    fn record_source(&mut self, bytes: usize) {
        self.source_frames += 1;
        self.source_bytes += bytes as u64;
    }

    fn record_immediate_send(&mut self, bytes: usize) {
        self.sent_frames += 1;
        self.sent_bytes += bytes as u64;
        self.immediate_frames += 1;
    }

    fn record_pending(&mut self, bytes: usize, chunks: usize) {
        self.max_pending_bytes = self.max_pending_bytes.max(bytes);
        self.max_pending_chunks = self.max_pending_chunks.max(chunks);
    }

    fn record_flush_reason(&mut self, reason: TerminalOutputFlushReason) {
        match reason {
            TerminalOutputFlushReason::Timer => self.timer_flushes += 1,
            TerminalOutputFlushReason::ByteThreshold => self.byte_flushes += 1,
            TerminalOutputFlushReason::ChunkThreshold => self.chunk_flushes += 1,
            TerminalOutputFlushReason::Close => {}
        }
    }

    fn record_coalesced_send(&mut self, source_chunks: usize, bytes: usize, latency: Duration) {
        self.sent_frames += 1;
        self.sent_bytes += bytes as u64;
        self.coalesced_source_frames += source_chunks as u64;
        self.coalesced_sent_frames += 1;
        if source_chunks <= 1 {
            self.single_chunk_flushes += 1;
        } else {
            self.merged_flushes += 1;
        }

        let latency_us = latency.as_micros();
        self.total_flush_latency_us += latency_us;
        self.max_flush_latency_us = self.max_flush_latency_us.max(latency_us);
    }

    fn record_lagged(&mut self, frames: u64) {
        self.lagged_events += 1;
        self.lagged_frames += frames;
    }

    #[cfg(test)]
    fn frames_saved(&self) -> u64 {
        self.source_frames.saturating_sub(self.sent_frames)
    }

    #[cfg(test)]
    fn coalescing_ratio(&self) -> f64 {
        if self.sent_frames == 0 {
            return 0.0;
        }
        self.source_frames as f64 / self.sent_frames as f64
    }

    #[cfg(test)]
    fn avg_source_frame_bytes(&self) -> f64 {
        if self.source_frames == 0 {
            return 0.0;
        }
        self.source_bytes as f64 / self.source_frames as f64
    }

    #[cfg(test)]
    fn avg_sent_frame_bytes(&self) -> f64 {
        if self.sent_frames == 0 {
            return 0.0;
        }
        self.sent_bytes as f64 / self.sent_frames as f64
    }

    #[cfg(test)]
    fn avg_flush_latency_us(&self) -> f64 {
        if self.coalesced_sent_frames == 0 {
            return 0.0;
        }
        self.total_flush_latency_us as f64 / self.coalesced_sent_frames as f64
    }
}

struct TerminalOutputCoalescer {
    window: Duration,
    pending: Vec<Bytes>,
    pending_bytes: usize,
    pending_started_at: Option<Instant>,
    deadline: Option<Instant>,
    #[cfg(test)]
    lifetime_stats: TerminalOutputCoalescingStats,
}

impl TerminalOutputCoalescer {
    fn new(window: Duration) -> Self {
        Self {
            window,
            pending: Vec::new(),
            pending_bytes: 0,
            pending_started_at: None,
            deadline: None,
            #[cfg(test)]
            lifetime_stats: TerminalOutputCoalescingStats::default(),
        }
    }

    fn deadline(&self) -> Option<Instant> {
        self.deadline
    }

    fn push_bytes(&mut self, bytes: Bytes, now: Instant) -> TerminalOutputCoalescingDecision {
        let byte_count = bytes.len();
        self.record_source(byte_count);

        if self.window.is_zero() {
            self.record_immediate_send(byte_count);
            return TerminalOutputCoalescingDecision::SendNow(bytes);
        }

        if self.deadline.is_none() {
            self.deadline = Some(now + self.window);
            self.record_immediate_send(byte_count);
            return TerminalOutputCoalescingDecision::SendNow(bytes);
        }

        if self.pending.is_empty() {
            self.pending_started_at = Some(now);
        }
        self.pending_bytes += byte_count;
        self.pending.push(bytes);
        self.record_pending();

        if self.pending_bytes >= TERMINAL_OUTPUT_COALESCE_MAX_BYTES {
            TerminalOutputCoalescingDecision::FlushPending(TerminalOutputFlushReason::ByteThreshold)
        } else if self.pending.len() >= TERMINAL_OUTPUT_COALESCE_MAX_CHUNKS {
            TerminalOutputCoalescingDecision::FlushPending(
                TerminalOutputFlushReason::ChunkThreshold,
            )
        } else {
            TerminalOutputCoalescingDecision::Pending
        }
    }

    fn handle_deadline(&mut self) -> Option<TerminalOutputFlushReason> {
        self.deadline?;
        if self.pending.is_empty() {
            self.deadline = None;
            return None;
        }
        Some(TerminalOutputFlushReason::Timer)
    }

    fn flush_pending(&mut self, reason: TerminalOutputFlushReason, now: Instant) -> Option<Bytes> {
        if self.pending.is_empty() {
            self.pending_bytes = 0;
            self.pending_started_at = None;
            if matches!(reason, TerminalOutputFlushReason::Close) {
                self.deadline = None;
            }
            return None;
        }

        self.record_flush_reason(reason);
        let source_chunks = self.pending.len();
        let latency = self
            .pending_started_at
            .map(|started_at| now.saturating_duration_since(started_at))
            .unwrap_or_default();
        let Some(bytes) = drain_terminal_output_pending(&mut self.pending, &mut self.pending_bytes)
        else {
            self.pending_started_at = None;
            return None;
        };

        self.pending_started_at = None;
        if matches!(reason, TerminalOutputFlushReason::Close) {
            self.deadline = None;
        } else {
            // Keep a trailing window warm so sustained redraws continue batching between flushes.
            self.deadline = Some(now + self.window);
        }
        self.record_coalesced_send(source_chunks, bytes.len(), latency);
        Some(bytes)
    }

    #[cfg(test)]
    fn record_lagged(&mut self, frames: u64) {
        self.lifetime_stats.record_lagged(frames);
    }

    #[cfg(not(test))]
    fn record_lagged(&mut self, _frames: u64) {}

    #[cfg(test)]
    fn record_source(&mut self, bytes: usize) {
        self.lifetime_stats.record_source(bytes);
    }

    #[cfg(not(test))]
    fn record_source(&mut self, _bytes: usize) {}

    #[cfg(test)]
    fn record_immediate_send(&mut self, bytes: usize) {
        self.lifetime_stats.record_immediate_send(bytes);
    }

    #[cfg(not(test))]
    fn record_immediate_send(&mut self, _bytes: usize) {}

    #[cfg(test)]
    fn record_pending(&mut self) {
        self.lifetime_stats
            .record_pending(self.pending_bytes, self.pending.len());
    }

    #[cfg(not(test))]
    fn record_pending(&mut self) {}

    #[cfg(test)]
    fn record_flush_reason(&mut self, reason: TerminalOutputFlushReason) {
        self.lifetime_stats.record_flush_reason(reason);
    }

    #[cfg(not(test))]
    fn record_flush_reason(&mut self, _reason: TerminalOutputFlushReason) {}

    #[cfg(test)]
    fn record_coalesced_send(&mut self, chunks: usize, bytes: usize, latency: Duration) {
        self.lifetime_stats
            .record_coalesced_send(chunks, bytes, latency);
    }

    #[cfg(not(test))]
    fn record_coalesced_send(&mut self, _chunks: usize, _bytes: usize, _latency: Duration) {}
}

fn encode_terminal_output_frame(bytes: Bytes, encoding: TerminalOutputWireEncoding) -> Bytes {
    if matches!(encoding, TerminalOutputWireEncoding::Identity) {
        return bytes;
    }

    if bytes.len() < TERMINAL_OUTPUT_GZIP_MIN_BYTES {
        return raw_terminal_output_frame(bytes);
    }

    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    if encoder.write_all(&bytes).is_ok() {
        if let Ok(compressed) = encoder.finish() {
            if compressed.len() < bytes.len() {
                let mut frame = Vec::with_capacity(compressed.len() + 1);
                frame.push(TERMINAL_OUTPUT_FRAME_GZIP);
                frame.extend_from_slice(&compressed);
                return Bytes::from(frame);
            }
        }
    }

    raw_terminal_output_frame(bytes)
}

fn raw_terminal_output_frame(bytes: Bytes) -> Bytes {
    let mut frame = Vec::with_capacity(bytes.len() + 1);
    frame.push(TERMINAL_OUTPUT_FRAME_RAW);
    frame.extend_from_slice(&bytes);
    Bytes::from(frame)
}

fn drain_terminal_output_pending(
    pending: &mut Vec<Bytes>,
    pending_bytes: &mut usize,
) -> Option<Bytes> {
    if pending.is_empty() {
        *pending_bytes = 0;
        return None;
    }

    let byte_count = *pending_bytes;
    *pending_bytes = 0;
    if pending.len() == 1 {
        return pending.pop();
    }

    let mut output = Vec::with_capacity(byte_count);
    for chunk in pending.drain(..) {
        output.extend_from_slice(&chunk);
    }
    Some(Bytes::from(output))
}

fn terminal_output_coalesce_window(coalesce_ms: Option<u64>) -> Duration {
    Duration::from_millis(
        coalesce_ms
            .unwrap_or(DEFAULT_TERMINAL_OUTPUT_COALESCE_MS)
            .min(MAX_TERMINAL_OUTPUT_COALESCE_MS),
    )
}

/// Shared attach connections keyed by terminal id. `draining` remembers
/// connections whose `Detach` has been queued but not yet flushed to the
/// daemon and shut down by the writer thread. A reattach waits for that
/// teardown so the new attach cannot reach the daemon ahead of the pending
/// `Detach` and be rejected as a second concurrent client. The daemon never
/// closes attach sockets itself, so the close that resolves a draining entry
/// is always the bridge's own post-`Detach` shutdown. `attaching` serializes
/// fresh attach handshakes per terminal: with two concurrent attaches the
/// daemon accepts one and rejects the other, and which one the map would
/// keep is an independent race — so concurrent acquires instead wait for the
/// in-flight handshake and join the session it publishes.
#[derive(Default)]
struct TerminalSessions {
    active: HashMap<String, SharedTerminalSession>,
    draining: HashMap<String, Arc<ConnectionClosed>>,
    attaching: HashMap<String, Arc<ConnectionClosed>>,
}

/// Signals that a daemon attach connection has fully closed.
#[derive(Default)]
struct ConnectionClosed {
    closed: Mutex<bool>,
    condvar: Condvar,
}

impl ConnectionClosed {
    fn mark_closed(&self) {
        let mut closed = match self.closed.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *closed = true;
        drop(closed);
        self.condvar.notify_all();
    }

    fn is_closed(&self) -> bool {
        match self.closed.lock() {
            Ok(guard) => *guard,
            Err(poisoned) => *poisoned.into_inner(),
        }
    }

    /// Returns true once the connection is closed, or false on timeout.
    fn wait_closed(&self, timeout: Duration) -> bool {
        let closed = match self.closed.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        match self
            .condvar
            .wait_timeout_while(closed, timeout, |closed| !*closed)
        {
            Ok((closed, _)) => *closed,
            Err(poisoned) => *poisoned.into_inner().0,
        }
    }
}

#[derive(Clone)]
struct SharedTerminalSession {
    write_tx: TerminalWriter,
    output_tx: tokio::sync::broadcast::Sender<TerminalOutput>,
    client_count: Arc<AtomicUsize>,
    connection_closed: Arc<ConnectionClosed>,
}

/// Sender for daemon-bound terminal messages that bounds how many input
/// bytes may sit in the writer queue, so a client streaming input faster
/// than the pty consumes it cannot balloon bridge memory.
#[derive(Clone)]
struct TerminalWriter {
    tx: mpsc::Sender<ClientMessage>,
    queued_input_bytes: Arc<AtomicUsize>,
}

impl TerminalWriter {
    fn send(&self, message: ClientMessage) -> Result<(), mpsc::SendError<ClientMessage>> {
        self.tx.send(message)
    }

    /// Reserve queue budget for a whole input frame before any of its chunks
    /// are enqueued, so an oversized frame is rejected atomically instead of
    /// delivering truncated input to the pty.
    fn reserve_input_bytes(&self, len: usize) -> Result<(), String> {
        let queued = self.queued_input_bytes.fetch_add(len, Ordering::AcqRel);
        if queued + len > MAX_QUEUED_TERMINAL_INPUT_BYTES {
            self.queued_input_bytes.fetch_sub(len, Ordering::AcqRel);
            return Err("terminal input backlog exceeded".to_string());
        }
        Ok(())
    }

    fn release_input_bytes(&self, len: usize) {
        self.queued_input_bytes.fetch_sub(len, Ordering::AcqRel);
    }
}

#[derive(Debug)]
enum BridgeError {
    Api(ApiClientError),
    Io(io::Error),
    BadRequest(String),
    Conflict(String),
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
            Self::Conflict(message) => write!(f, "{message}"),
            Self::Forbidden(message) => write!(f, "{message}"),
            Self::Protocol(message) => write!(f, "{message}"),
        }
    }
}

impl IntoResponse for BridgeError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Conflict(_) => StatusCode::CONFLICT,
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

impl From<NotesError> for BridgeError {
    fn from(err: NotesError) -> Self {
        match err {
            NotesError::BadRequest(message) => Self::BadRequest(message),
            NotesError::Conflict(message) => Self::Conflict(message),
            NotesError::Io(err) => Self::Io(err),
            NotesError::Store(message) => Self::Protocol(message),
        }
    }
}

impl From<AgentPinsError> for BridgeError {
    fn from(err: AgentPinsError) -> Self {
        match err {
            AgentPinsError::BadRequest(message) => Self::BadRequest(message),
            AgentPinsError::Io(err) => Self::Io(err),
            AgentPinsError::Store(message) => Self::Protocol(message),
        }
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
                "usage: herdr-web-bridge [--session NAME] [--host HOST] [--port PORT] [--static-dir DIR] [--launcher-presets PATH] [--allow-origin ORIGIN] [--public-origin ORIGIN] [--allow-host HOSTNAME] [--allow-connect-origin ORIGIN]"
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
    let mut launcher_presets_path = None;
    let mut allowed_hosts = Vec::new();
    let mut allowed_origins = Vec::new();
    let mut public_origins = Vec::new();
    let mut allowed_connect_sources = Vec::new();
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
            "--launcher-presets" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --launcher-presets".into());
                };
                launcher_presets_path = Some(expand_home(value));
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
            "--public-origin" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --public-origin".into());
                };
                public_origins.push(normalize_allowed_origin(value)?);
                index += 2;
            }
            "--allow-connect-origin" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("missing value for --allow-connect-origin".into());
                };
                allowed_connect_sources.extend(connect_sources_for_origin(value)?);
                index += 2;
            }
            arg => return Err(format!("unknown herdr-web option: {arg}")),
        }
    }

    allowed_connect_sources.sort();
    allowed_connect_sources.dedup();

    if let Some(name) = explicit_session {
        crate::session::configure_explicit_session(&name)?;
    }

    Ok(Some(BridgeOptions {
        host,
        port,
        static_dir,
        upload_dir,
        launcher_presets_path,
        allowed_hosts,
        allowed_origins,
        public_origins,
        allowed_connect_sources,
    }))
}

fn print_help() {
    println!("{}", help_text());
}

fn help_text() -> &'static str {
    "herdr-web-bridge\n\
\n\
Usage: herdr-web-bridge [--session NAME] [--host HOST] [--port PORT] [--static-dir DIR] [--upload-dir DIR] [--launcher-presets PATH] [--allow-origin ORIGIN] [--public-origin ORIGIN] [--allow-host HOSTNAME] [--allow-connect-origin ORIGIN]\n\
\n\
Runs the local HTTP/WebSocket bridge for herdr-web.\n\
Defaults to the active Herdr daemon sockets and 127.0.0.1:8787.\n\
Use --session NAME to target a named Herdr session and ignore HERDR_SOCKET_PATH.\n\
Use --host 0.0.0.0 to listen on non-loopback interfaces.\n\
Use --allow-origin http://localhost for bundled Android app access.\n\
Use --public-origin ORIGIN when a trusted reverse proxy serves the bridge from that external origin.\n\
Use --allow-host HOSTNAME to accept that exact DNS hostname in Host headers.\n\
Use --allow-connect-origin ORIGIN to let the served web app connect to another bridge origin.\n\
Use --launcher-presets PATH or HERDR_WEB_LAUNCHER_PRESETS to load custom launch presets.\n\
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
    let agent_activity = Arc::new(AgentActivityManager::new());
    let agent_pins = Arc::new(AgentPinsManager::new()?);
    let launcher_presets = Arc::new(
        LauncherPresetStore::load(options.launcher_presets_path.clone())
            .map_err(|message| io::Error::new(ErrorKind::InvalidInput, message))?,
    );
    let notes = Arc::new(NotesManager::new()?);
    let request_policy = RequestPolicy {
        bind_host: options.host.clone(),
        bind_port: options.port,
        allowed_hosts: options.allowed_hosts.clone(),
        allowed_origins: options.allowed_origins.clone(),
        public_origins: options.public_origins.clone(),
        allowed_connect_sources: options.allowed_connect_sources.clone(),
    };
    let api = ApiClient::for_socket_path(crate::session::active_api_socket_path());
    let daemon_status = startup_daemon_status(&api)?;
    let daemon_protocol = daemon_status
        .protocol
        .expect("startup_daemon_status validates protocol");
    let daemon_version = daemon_status
        .version
        .as_deref()
        .expect("startup_daemon_status validates version");
    info!(
        version = daemon_version,
        protocol = daemon_protocol,
        "herdr-web bridge connected to compatible Herdr daemon"
    );
    let state = BridgeState {
        api,
        client_socket_path: crate::session::active_client_socket_path(),
        request_policy: request_policy.clone(),
        terminal_sessions: Arc::new(Mutex::new(TerminalSessions::default())),
        selected_pane_id: Arc::new(Mutex::new(None)),
        agent_activity,
        agent_pins,
        launcher_presets,
        notes,
        ui_event_tx: tokio::sync::broadcast::channel(256).0,
        activity_tx: tokio::sync::broadcast::channel(512).0,
        upload_dir: options.upload_dir.clone(),
    };
    spawn_agent_activity_watcher(state.clone());
    let agent_activity_routes = Router::new().route(
        "/api/agent-activity",
        get(agent_activity_list_handler).options(preflight_handler),
    );
    let agent_pins_routes = Router::new()
        .route(
            "/api/agent-pins",
            get(agent_pins_list_handler).options(preflight_handler),
        )
        .route(
            "/api/agent-pins/{pane_id}/pin",
            post(agent_pins_pin_handler).options(preflight_handler),
        )
        .route(
            "/api/agent-pins/{pane_id}/unpin",
            post(agent_pins_unpin_handler).options(preflight_handler),
        );
    let notes_routes = Router::new()
        .route(
            "/api/notes",
            get(notes_list_handler)
                .post(notes_create_handler)
                .options(preflight_handler),
        )
        .route(
            "/api/notes/{note_id}/update",
            post(notes_update_handler).options(preflight_handler),
        )
        .route(
            "/api/notes/{note_id}/attach",
            post(notes_attach_handler).options(preflight_handler),
        )
        .route(
            "/api/notes/{note_id}/detach",
            post(notes_detach_handler).options(preflight_handler),
        )
        .route(
            "/api/notes/{note_id}/archive",
            post(notes_archive_handler).options(preflight_handler),
        )
        .route(
            "/api/notes/{note_id}/restore",
            post(notes_restore_handler).options(preflight_handler),
        )
        .route(
            "/api/notes/{note_id}/delete",
            post(notes_delete_handler).options(preflight_handler),
        )
        .layer(DefaultBodyLimit::max(MAX_NOTES_REQUEST_BYTES));
    let launcher_preset_routes = Router::new()
        .route(
            "/api/launcher-presets",
            get(launcher_presets_handler).options(preflight_handler),
        )
        .route(
            "/api/launcher-presets/launch",
            post(launcher_preset_launch_handler).options(preflight_handler),
        );
    let app = Router::new()
        .merge(agent_activity_routes)
        .merge(agent_pins_routes)
        .merge(notes_routes)
        .merge(launcher_preset_routes)
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
            "/api/selection",
            post(selection_handler).options(preflight_handler),
        )
        .route(
            "/api/uploads",
            post(upload_handler).options(preflight_handler),
        )
        .route("/ws/events", get(events_ws_handler))
        .route("/ws/activity", get(activity_ws_handler))
        .route("/ws/ui-events", get(ui_events_ws_handler))
        .route("/ws/terminal", get(terminal_ws_handler))
        .fallback_service(
            ServiceBuilder::new()
                .layer(middleware::from_fn(add_static_cache_headers))
                .layer(CompressionLayer::new())
                .service(ServeDir::new(options.static_dir)),
        )
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
        content_security_policy(&policy),
    );
    if let Some(origin) = cors_origin {
        insert_cors_headers(headers, origin);
    }
    response
}

async fn add_static_cache_headers(request: AxumRequest, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let mut response = next.run(request).await;
    let status = response.status();
    insert_static_cache_header(response.headers_mut(), &path, status);
    response
}

fn insert_static_cache_header(headers: &mut HeaderMap, path: &str, status: StatusCode) {
    if headers.contains_key(CACHE_CONTROL)
        || (!status.is_success() && status != StatusCode::NOT_MODIFIED)
    {
        return;
    }
    let value = if path.starts_with("/assets/") {
        HeaderValue::from_static("public, max-age=31536000, immutable")
    } else {
        HeaderValue::from_static("no-cache")
    };
    headers.insert(CACHE_CONTROL, value);
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

// Intentionally diverges from `store_util::non_empty_env_path`: upload dir
// configuration trims whitespace and expands a leading `~`.
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
    // Only tighten permissions on directories the bridge itself creates; an
    // operator-supplied pre-existing directory keeps its permissions.
    let pre_existing = path.is_dir();
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    if !pre_existing {
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
    // Atomic same-session workspace ordering; the browser supplies explicit ids only.
    "workspace.move_block",
    "tab.create",
    "tab.rename",
    "tab.close",
    "tab.focus",
    "pane.rename",
    "pane.close",
    // Layout-mutating: the web client builds splits directly.
    "pane.split",
    // Directional pane focus: explicit pane_id only, matching the web selection.
    "pane.focus_direction",
    // Narrow live pane moves: new tab or new workspace destinations only.
    "pane.move",
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

    if policy
        .public_origins
        .iter()
        .filter_map(|origin| origin_authority(origin))
        .any(|public_authority| same_authority(public_authority, authority))
    {
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
            .chain(&policy.public_origins)
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
    let origin = origin.trim().to_ascii_lowercase();
    let Some(authority) = origin_authority(&origin) else {
        return Err("allowed origin must be an http or https origin without a path".into());
    };
    if authority.is_empty() {
        return Err("allowed origin must include a host".into());
    }
    Ok(origin)
}

fn connect_sources_for_origin(origin: &str) -> Result<Vec<String>, String> {
    let origin = normalize_allowed_origin(origin)?;
    let websocket_origin = if let Some(authority) = origin.strip_prefix("http://") {
        format!("ws://{authority}")
    } else if let Some(authority) = origin.strip_prefix("https://") {
        format!("wss://{authority}")
    } else {
        unreachable!("normalize_allowed_origin only accepts http and https origins")
    };
    Ok(vec![origin, websocket_origin])
}

fn content_security_policy(policy: &RequestPolicy) -> HeaderValue {
    let mut connect_src = vec!["'self'".to_string(), "data:".to_string()];
    connect_src.extend(policy.allowed_connect_sources.iter().cloned());
    let value = format!(
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src {}; \
         img-src 'self' data: blob:; \
         style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; \
         frame-ancestors 'none'",
        connect_src.join(" ")
    );
    HeaderValue::from_str(&value).expect("connect-src sources are validated origins")
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
        Method::WorkspaceMoveBlock(params) => {
            if params.workspace_ids.is_empty() || params.workspace_ids.len() > 256 {
                return Err(BridgeError::BadRequest(
                    "workspace.move_block requires between 1 and 256 workspace_ids".to_string(),
                ));
            }
            let mut unique_ids = HashSet::with_capacity(params.workspace_ids.len());
            if params.workspace_ids.iter().any(|workspace_id| {
                workspace_id.trim().is_empty()
                    || workspace_id.len() > 256
                    || !unique_ids.insert(workspace_id.as_str())
            }) {
                return Err(BridgeError::BadRequest(
                    "workspace.move_block workspace_ids must be unique, non-empty, and at most 256 bytes"
                        .to_string(),
                ));
            }
            if params
                .before_workspace_id
                .as_deref()
                .is_some_and(|workspace_id| {
                    workspace_id.trim().is_empty()
                        || workspace_id.len() > 256
                        || unique_ids.contains(workspace_id)
                })
            {
                return Err(BridgeError::BadRequest(
                    "workspace.move_block before_workspace_id must be a distinct valid workspace id"
                        .to_string(),
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
        Method::PaneRename(params) => {
            if params.pane_id.trim().is_empty() {
                return Err(BridgeError::BadRequest("pane_id is required".to_string()));
            }
            validate_optional_label(&params.label, "pane.rename label")?;
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

#[derive(Debug, Deserialize)]
struct LauncherPresetLaunchRequest {
    preset_id: String,
    target: LauncherPresetLaunchTarget,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
enum LauncherPresetLaunchTarget {
    Tab {
        workspace_id: String,
    },
    Split {
        tab_id: String,
        target_pane_id: String,
        direction: SplitDirection,
    },
}

#[derive(Debug, Serialize)]
struct LauncherPresetLaunchResponse {
    preset_id: String,
    title: String,
    workspace_id: String,
    tab_id: String,
    pane_id: String,
}

#[derive(Debug)]
struct LauncherPresetError {
    status: StatusCode,
    code: &'static str,
    message: String,
    herdr_code: Option<String>,
}

impl LauncherPresetError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "invalid_preset_launch",
            message: message.into(),
            herdr_code: None,
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code: "forbidden",
            message: message.into(),
            herdr_code: None,
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "preset_not_found",
            message: message.into(),
            herdr_code: None,
        }
    }

    fn layout_changed(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            code: "layout_changed",
            message: message.into(),
            herdr_code: None,
        }
    }

    fn launch_failed(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            code: "herdr_launch_failed",
            message: message.into(),
            herdr_code: None,
        }
    }

    fn from_herdr_error(code: String, message: String) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            code: "herdr_launch_failed",
            message,
            herdr_code: Some(code),
        }
    }

    fn from_request_policy_error(err: BridgeError) -> Self {
        match err {
            BridgeError::Forbidden(message) => Self::forbidden(message),
            BridgeError::BadRequest(message) => Self::invalid(message),
            other => Self::invalid(other.to_string()),
        }
    }
}

impl IntoResponse for LauncherPresetError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({
                "code": self.code,
                "error": self.message,
            })),
        )
            .into_response()
    }
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
    let should_prune_terminal_sessions = command_may_close_terminal_session(&request.method);

    let api = state.api.clone();
    let response = tokio::task::spawn_blocking(move || {
        fill_clear_rename_labels(&api, &mut request.method)?;
        Ok::<_, BridgeError>(api.request(request)?)
    })
    .await
    .map_err(|err| BridgeError::Protocol(err.to_string()))??;
    if let ResponseResult::PaneMove { move_result } = &response.result {
        if move_result.changed {
            let notes = state.notes.clone();
            let previous_pane_id = move_result.previous_pane_id.clone();
            let moved_pane = (*move_result.pane).clone();
            match tokio::task::spawn_blocking(move || {
                notes.update_for_pane_move(&previous_pane_id, &moved_pane)
            })
            .await
            .map_err(|err| BridgeError::Protocol(err.to_string()))?
            {
                Ok(true) => broadcast_notes_changed(&state, None, None),
                Ok(false) => {}
                Err(err) => warn!(error = %err, "failed to update note attachment after pane move"),
            }
        }
    }
    let value = serde_json::to_value(response.result)
        .map_err(|err| BridgeError::Protocol(err.to_string()))?;
    if should_prune_terminal_sessions {
        let prune_state = state.clone();
        tokio::task::spawn_blocking(move || prune_detached_terminal_sessions(&prune_state));
    }
    Ok(Json(value))
}

async fn launcher_presets_handler(
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Result<Json<crate::launcher_presets::LauncherPresetsResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    Ok(Json(state.launcher_presets.response()))
}

async fn launcher_preset_launch_handler(
    State(state): State<BridgeState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<LauncherPresetLaunchResponse>, LauncherPresetError> {
    ensure_allowed_request(&headers, &state.request_policy)
        .map_err(LauncherPresetError::from_request_policy_error)?;
    let body = parse_launcher_preset_launch_request(&body)?;
    let preset = state
        .launcher_presets
        .preset(&body.preset_id)
        .cloned()
        .ok_or_else(|| LauncherPresetError::not_found("launcher preset not found"))?;
    let title = resolve_launch_title(body.title.as_deref(), &preset.label)?;
    info!(
        preset_id = %preset.id,
        title = %title,
        target = body.target.kind(),
        "launching configured preset"
    );
    let api = state.api.clone();
    let response = tokio::task::spawn_blocking(move || {
        launch_preset_blocking(&api, &preset, &title, body.target)
    })
    .await
    .map_err(|err| LauncherPresetError::launch_failed(err.to_string()))??;
    Ok(Json(response))
}

fn parse_launcher_preset_launch_request(
    body: &[u8],
) -> Result<LauncherPresetLaunchRequest, LauncherPresetError> {
    serde_json::from_slice(body).map_err(|err| LauncherPresetError::invalid(err.to_string()))
}

fn resolve_launch_title(
    requested: Option<&str>,
    fallback: &str,
) -> Result<String, LauncherPresetError> {
    let title = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .trim()
        .to_string();
    if title.is_empty() || title.len() > MAX_LABEL_BYTES || title.contains('\0') {
        return Err(LauncherPresetError::invalid(
            "launch title must be non-empty, NUL-free, and up to 120 bytes",
        ));
    }
    Ok(title)
}

fn launch_preset_blocking(
    api: &ApiClient,
    preset: &ResolvedLauncherPreset,
    title: &str,
    target: LauncherPresetLaunchTarget,
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let mut api = HerdrLauncherApi(api);
    launch_preset_with(&mut api, preset, title, target)
}

trait LauncherApiRequest {
    fn request(&mut self, id: &str, method: Method) -> Result<ResponseResult, LauncherPresetError>;

    fn now(&self) -> std::time::Instant {
        std::time::Instant::now()
    }

    fn wait(&mut self, duration: Duration) {
        thread::sleep(duration);
    }
}

struct HerdrLauncherApi<'a>(&'a ApiClient);

impl LauncherApiRequest for HerdrLauncherApi<'_> {
    fn request(&mut self, id: &str, method: Method) -> Result<ResponseResult, LauncherPresetError> {
        api_request(self.0, id, method).map_err(|err| match err {
            BridgeError::Api(ApiClientError::ErrorResponse(response)) => {
                LauncherPresetError::from_herdr_error(response.error.code, response.error.message)
            }
            err => LauncherPresetError::launch_failed(err.to_string()),
        })
    }
}

fn launch_preset_with(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    target: LauncherPresetLaunchTarget,
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    match target {
        LauncherPresetLaunchTarget::Tab { workspace_id } => {
            if workspace_id.trim().is_empty() {
                return Err(LauncherPresetError::invalid("workspace_id is required"));
            }
            match &preset.launch {
                LauncherPresetLaunch::Shell => {
                    launch_builtin_shell_tab(api, preset, title, workspace_id)
                }
                LauncherPresetLaunch::ManagedAgent { kind, args } => {
                    launch_managed_agent_tab(api, preset, title, workspace_id, *kind, args)
                }
                LauncherPresetLaunch::CustomCommand(command) => {
                    launch_layout_tab(api, preset, title, workspace_id, command)
                }
            }
        }
        LauncherPresetLaunchTarget::Split {
            tab_id,
            target_pane_id,
            direction,
        } => {
            if tab_id.trim().is_empty() || target_pane_id.trim().is_empty() {
                return Err(LauncherPresetError::invalid(
                    "tab_id and target_pane_id are required",
                ));
            }
            match &preset.launch {
                LauncherPresetLaunch::Shell => {
                    launch_builtin_shell_split(api, preset, title, target_pane_id, direction)
                }
                LauncherPresetLaunch::ManagedAgent { kind, args } => launch_managed_agent_split(
                    api,
                    preset,
                    title,
                    target_pane_id,
                    direction,
                    *kind,
                    args,
                ),
                LauncherPresetLaunch::CustomCommand(command) => launch_layout_split(
                    api,
                    preset,
                    title,
                    tab_id,
                    target_pane_id,
                    direction,
                    command,
                ),
            }
        }
    }
}

impl LauncherPresetLaunchTarget {
    fn kind(&self) -> &'static str {
        match self {
            Self::Tab { .. } => "tab",
            Self::Split { .. } => "split",
        }
    }
}

fn launch_builtin_shell_tab(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    workspace_id: String,
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let result = api.request(
        "herdr-web:launcher:builtin-shell-tab",
        Method::TabCreate(TabCreateParams {
            workspace_id: Some(workspace_id),
            cwd: None,
            focus: true,
            label: None,
            env: HashMap::new(),
        }),
    )?;
    let ResponseResult::TabCreated { tab, root_pane } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for shell tab launch",
        ));
    };
    if let Err(error) = rename_launched_pane(api, &root_pane.pane_id, title) {
        rollback_created_tab(api, &tab.tab_id, &error);
        return Err(error);
    }
    Ok(LauncherPresetLaunchResponse {
        preset_id: preset.id.clone(),
        title: title.into(),
        workspace_id: tab.workspace_id,
        tab_id: tab.tab_id,
        pane_id: root_pane.pane_id,
    })
}

fn launch_builtin_shell_split(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    target_pane_id: String,
    direction: SplitDirection,
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let result = api.request(
        "herdr-web:launcher:builtin-shell-split",
        Method::PaneSplit(PaneSplitParams {
            workspace_id: None,
            target_pane_id: Some(target_pane_id),
            direction,
            ratio: None,
            cwd: None,
            focus: true,
            env: HashMap::new(),
        }),
    )?;
    let ResponseResult::PaneInfo { pane } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for shell split launch",
        ));
    };
    if let Err(error) = rename_launched_pane(api, &pane.pane_id, title) {
        rollback_created_pane(api, &pane.pane_id, &error);
        return Err(error);
    }
    Ok(LauncherPresetLaunchResponse {
        preset_id: preset.id.clone(),
        title: title.into(),
        workspace_id: pane.workspace_id,
        tab_id: pane.tab_id,
        pane_id: pane.pane_id,
    })
}

fn launch_managed_agent_tab(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    workspace_id: String,
    kind: ManagedAgentKind,
    args: &[String],
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let result = api.request(
        "herdr-web:launcher:managed-agent-tab",
        Method::TabCreate(TabCreateParams {
            workspace_id: Some(workspace_id),
            cwd: None,
            focus: true,
            label: None,
            env: HashMap::new(),
        }),
    )?;
    let ResponseResult::TabCreated { tab, root_pane } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for managed agent tab launch",
        ));
    };
    if let Err(error) = rename_launched_pane(api, &root_pane.pane_id, title) {
        rollback_created_tab(api, &tab.tab_id, &error);
        return Err(error);
    }
    if let Err(error) = start_managed_agent(api, &root_pane.pane_id, kind, args) {
        rollback_created_tab(api, &tab.tab_id, &error);
        return Err(error);
    }
    Ok(LauncherPresetLaunchResponse {
        preset_id: preset.id.clone(),
        title: title.into(),
        workspace_id: tab.workspace_id,
        tab_id: tab.tab_id,
        pane_id: root_pane.pane_id,
    })
}

fn launch_managed_agent_split(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    target_pane_id: String,
    direction: SplitDirection,
    kind: ManagedAgentKind,
    args: &[String],
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let result = api.request(
        "herdr-web:launcher:managed-agent-split",
        Method::PaneSplit(PaneSplitParams {
            workspace_id: None,
            target_pane_id: Some(target_pane_id),
            direction,
            ratio: None,
            cwd: None,
            focus: true,
            env: HashMap::new(),
        }),
    )?;
    let ResponseResult::PaneInfo { pane } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for managed agent split launch",
        ));
    };
    if let Err(error) = rename_launched_pane(api, &pane.pane_id, title) {
        rollback_created_pane(api, &pane.pane_id, &error);
        return Err(error);
    }
    if let Err(error) = start_managed_agent(api, &pane.pane_id, kind, args) {
        rollback_created_pane(api, &pane.pane_id, &error);
        return Err(error);
    }
    Ok(LauncherPresetLaunchResponse {
        preset_id: preset.id.clone(),
        title: title.into(),
        workspace_id: pane.workspace_id,
        tab_id: pane.tab_id,
        pane_id: pane.pane_id,
    })
}

fn start_managed_agent(
    api: &mut impl LauncherApiRequest,
    pane_id: &str,
    kind: ManagedAgentKind,
    args: &[String],
) -> Result<(), LauncherPresetError> {
    let name = managed_agent_name(kind, pane_id);
    // Herdr v0.8 can acknowledge pane creation before its process detector sees the shell as the
    // pane's foreground job. The API exposes no shell-ready event or authoritative readiness flag,
    // so allow that shell to settle and retry only the transient `agent_pane_busy` response.
    let deadline = api.now() + MANAGED_AGENT_SHELL_READY_TIMEOUT;
    api.wait(MANAGED_AGENT_SHELL_SETTLE_DELAY);
    let mut retry_delay = MANAGED_AGENT_SHELL_RETRY_INITIAL_DELAY;
    let result = loop {
        match api.request(
            "herdr-web:launcher:start-managed-agent",
            Method::AgentStart(AgentStartParams {
                name: name.clone(),
                kind: kind.as_str().to_string(),
                pane_id: pane_id.to_string(),
                args: args.to_vec(),
                timeout_ms: None,
            }),
        ) {
            Ok(result) => break result,
            Err(error)
                if error.herdr_code.as_deref() == Some("agent_pane_busy")
                    && api.now() < deadline =>
            {
                let remaining = deadline.saturating_duration_since(api.now());
                api.wait(retry_delay.min(remaining));
                retry_delay = retry_delay.saturating_mul(3);
            }
            Err(error) => return Err(error),
        }
    };
    let ResponseResult::AgentStarted { agent, .. } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for managed agent launch",
        ));
    };
    let terminal_id = agent.terminal_id.clone();
    wait_for_managed_agent(api, &name, pane_id, kind, &terminal_id, agent)
}

fn wait_for_managed_agent(
    api: &mut impl LauncherApiRequest,
    name: &str,
    pane_id: &str,
    kind: ManagedAgentKind,
    terminal_id: &str,
    mut agent: AgentInfo,
) -> Result<(), LauncherPresetError> {
    let deadline = std::time::Instant::now() + MANAGED_AGENT_START_TIMEOUT;
    loop {
        match managed_agent_launch_state(&agent, name, kind, terminal_id) {
            Ok(true) => return Ok(()),
            Ok(false) => {}
            Err(error) => return Err(error),
        }
        if std::time::Instant::now() >= deadline {
            let _ = api.request(
                "herdr-web:launcher:managed-agent-timeout-reconcile",
                Method::AgentGet(AgentTarget {
                    target: name.to_string(),
                }),
            );
            return Err(LauncherPresetError::launch_failed(
                "timed out waiting for managed agent startup",
            ));
        }

        agent = match api.request(
            "herdr-web:launcher:managed-agent-ready",
            Method::AgentGet(AgentTarget {
                target: name.to_string(),
            }),
        ) {
            Ok(ResponseResult::AgentInfo { agent }) => agent,
            Ok(_) => {
                return Err(LauncherPresetError::launch_failed(
                    "unexpected response while waiting for managed agent startup",
                ));
            }
            Err(_) => match api.request(
                "herdr-web:launcher:managed-agent-ready-by-pane",
                Method::AgentGet(AgentTarget {
                    target: pane_id.to_string(),
                }),
            ) {
                Ok(ResponseResult::AgentInfo { agent }) => agent,
                Ok(_) => {
                    return Err(LauncherPresetError::launch_failed(
                        "unexpected response while resolving managed agent pane",
                    ));
                }
                Err(_) => {
                    thread::sleep(MANAGED_AGENT_POLL_INTERVAL);
                    continue;
                }
            },
        };
        if !agent.interactive_ready && agent.launch_pending {
            thread::sleep(MANAGED_AGENT_POLL_INTERVAL);
        }
    }
}

fn managed_agent_launch_state(
    agent: &AgentInfo,
    name: &str,
    kind: ManagedAgentKind,
    terminal_id: &str,
) -> Result<bool, LauncherPresetError> {
    if agent.terminal_id != terminal_id {
        return Err(LauncherPresetError::launch_failed(format!(
            "managed agent {name} no longer owns the target terminal"
        )));
    }
    if agent.name.as_deref() != Some(name) {
        return Err(LauncherPresetError::launch_failed(format!(
            "managed agent was not found under the expected name {name}"
        )));
    }
    if agent
        .agent
        .as_deref()
        .is_some_and(|actual| actual != kind.as_str())
    {
        return Err(LauncherPresetError::launch_failed(format!(
            "managed agent kind mismatch: expected {}, detected {}",
            kind.as_str(),
            agent.agent.as_deref().unwrap_or_default()
        )));
    }
    if agent.interactive_ready {
        return Ok(true);
    }
    if !agent.launch_pending {
        return Err(LauncherPresetError::launch_failed(
            "managed agent process exited before becoming interactive",
        ));
    }
    Ok(false)
}

fn managed_agent_name(kind: ManagedAgentKind, pane_id: &str) -> String {
    let hash = pane_id.bytes().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    });
    format!("web-{}-{hash:016x}", kind.as_str())
}

fn launch_layout_tab(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    workspace_id: String,
    layout_preset: &CustomCommandPreset,
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let result = api.request(
        "herdr-web:launcher:layout-tab",
        Method::LayoutApply(LayoutApplyParams {
            workspace_id: Some(workspace_id),
            tab_id: None,
            tab_label: Some(title.into()),
            focus: true,
            root: layout_leaf_for_preset(layout_preset, title),
        }),
    )?;
    let ResponseResult::LayoutApply { layout } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for layout tab launch",
        ));
    };
    Ok(LauncherPresetLaunchResponse {
        preset_id: preset.id.clone(),
        title: title.into(),
        workspace_id: layout.workspace_id,
        tab_id: layout.tab_id,
        pane_id: layout.focused_pane_id,
    })
}

fn launch_layout_split(
    api: &mut impl LauncherApiRequest,
    preset: &ResolvedLauncherPreset,
    title: &str,
    tab_id: String,
    target_pane_id: String,
    direction: SplitDirection,
    layout_preset: &CustomCommandPreset,
) -> Result<LauncherPresetLaunchResponse, LauncherPresetError> {
    let exported = api.request(
        "herdr-web:launcher:layout-export",
        Method::LayoutExport(LayoutExportParams {
            tab_id: Some(tab_id.clone()),
            pane_id: None,
        }),
    )?;
    let ResponseResult::LayoutExport { layout } = exported else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for layout export",
        ));
    };
    if !layout_contains_pane(&layout.root, &target_pane_id) {
        return Err(LauncherPresetError::layout_changed(
            "target pane is no longer present in the tab layout",
        ));
    }
    let original_root = layout.root.clone();
    let before_panes = layout_pane_ids(&original_root);
    let root = split_layout_with_command_preset(
        layout.root,
        &target_pane_id,
        direction,
        layout_preset,
        title,
    )
    .map_err(|_| LauncherPresetError::layout_changed("target pane changed before launch"))?;
    let latest = api.request(
        "herdr-web:launcher:layout-export-check",
        Method::LayoutExport(LayoutExportParams {
            tab_id: Some(tab_id.clone()),
            pane_id: None,
        }),
    )?;
    let ResponseResult::LayoutExport { layout: latest } = latest else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for layout export check",
        ));
    };
    if latest.root != original_root {
        return Err(LauncherPresetError::layout_changed(
            "tab layout changed before launch",
        ));
    }
    let result = api.request(
        "herdr-web:launcher:layout-split",
        Method::LayoutApply(LayoutApplyParams {
            workspace_id: None,
            tab_id: Some(tab_id),
            tab_label: None,
            focus: true,
            root,
        }),
    )?;
    let ResponseResult::LayoutApply { layout } = result else {
        return Err(LauncherPresetError::launch_failed(
            "unexpected response for layout split launch",
        ));
    };
    let pane_id = layout_pane_ids(&layout.root)
        .into_iter()
        .find(|pane_id| !before_panes.contains(pane_id))
        .unwrap_or_else(|| layout.focused_pane_id.clone());
    Ok(LauncherPresetLaunchResponse {
        preset_id: preset.id.clone(),
        title: title.into(),
        workspace_id: layout.workspace_id,
        tab_id: layout.tab_id,
        pane_id,
    })
}

fn rename_launched_pane(
    api: &mut impl LauncherApiRequest,
    pane_id: &str,
    title: &str,
) -> Result<(), LauncherPresetError> {
    api.request(
        "herdr-web:launcher:rename-pane",
        Method::PaneRename(herdr_compat::api::schema::PaneRenameParams {
            pane_id: pane_id.into(),
            label: Some(title.into()),
        }),
    )?;
    Ok(())
}

fn rollback_created_tab(
    api: &mut impl LauncherApiRequest,
    tab_id: &str,
    original_error: &LauncherPresetError,
) {
    if let Err(cleanup_error) = api.request(
        "herdr-web:launcher:rollback-tab",
        Method::TabClose(TabTarget {
            tab_id: tab_id.to_string(),
        }),
    ) {
        warn!(
            tab_id,
            original_error = %original_error.message,
            cleanup_error = %cleanup_error.message,
            "failed to roll back launcher-created tab"
        );
    }
}

fn rollback_created_pane(
    api: &mut impl LauncherApiRequest,
    pane_id: &str,
    original_error: &LauncherPresetError,
) {
    if let Err(cleanup_error) = api.request(
        "herdr-web:launcher:rollback-pane",
        Method::PaneClose(PaneTarget {
            pane_id: pane_id.to_string(),
        }),
    ) {
        warn!(
            pane_id,
            original_error = %original_error.message,
            cleanup_error = %cleanup_error.message,
            "failed to roll back launcher-created pane"
        );
    }
}

fn layout_contains_pane(root: &herdr_compat::api::schema::LayoutNode, pane_id: &str) -> bool {
    match root {
        herdr_compat::api::schema::LayoutNode::Pane { pane } => {
            pane.pane_id.as_deref() == Some(pane_id)
        }
        herdr_compat::api::schema::LayoutNode::Split { first, second, .. } => {
            layout_contains_pane(first, pane_id) || layout_contains_pane(second, pane_id)
        }
    }
}

fn layout_pane_ids(root: &herdr_compat::api::schema::LayoutNode) -> HashSet<String> {
    let mut ids = HashSet::new();
    collect_layout_pane_ids(root, &mut ids);
    ids
}

fn collect_layout_pane_ids(
    root: &herdr_compat::api::schema::LayoutNode,
    ids: &mut HashSet<String>,
) {
    match root {
        herdr_compat::api::schema::LayoutNode::Pane { pane } => {
            if let Some(pane_id) = &pane.pane_id {
                ids.insert(pane_id.clone());
            }
        }
        herdr_compat::api::schema::LayoutNode::Split { first, second, .. } => {
            collect_layout_pane_ids(first, ids);
            collect_layout_pane_ids(second, ids);
        }
    }
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

fn fill_clear_rename_labels(api: &ApiClient, method: &mut Method) -> Result<(), BridgeError> {
    fill_clear_rename_labels_with(
        method,
        |workspace_id| default_workspace_label(api, workspace_id),
        |tab_id| default_tab_label(api, tab_id),
    )
}

fn fill_clear_rename_labels_with(
    method: &mut Method,
    mut workspace_default: impl FnMut(&str) -> Result<String, BridgeError>,
    mut tab_default: impl FnMut(&str) -> Result<String, BridgeError>,
) -> Result<(), BridgeError> {
    match method {
        Method::WorkspaceRename(params) if params.label.is_none() => {
            params.label = Some(workspace_default(&params.workspace_id)?);
        }
        Method::TabRename(params) if params.label.is_none() => {
            params.label = Some(tab_default(&params.tab_id)?);
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
        ResponseResult::TabList { tabs } => default_tab_label_from_tabs(tab_id, tabs.iter()),
        other => Err(BridgeError::Protocol(format!(
            "unexpected response: {other:?}"
        ))),
    }
}

fn default_tab_label_from_tabs<'a>(
    tab_id: &str,
    mut tabs: impl Iterator<Item = &'a TabInfo>,
) -> Result<String, BridgeError> {
    tabs.find(|tab| tab.tab_id == tab_id)
        .map(|tab| tab.number.to_string())
        .ok_or_else(|| BridgeError::BadRequest(format!("tab not found: {tab_id}")))
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
    let api = state.api.clone();
    let panes = tokio::task::spawn_blocking(move || current_panes(&api))
        .await
        .map_err(|err| BridgeError::Protocol(err.to_string()))??;
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
    let api_state = state.clone();
    let session_snapshot = tokio::task::spawn_blocking(move || {
        match api_request(
            &api_state.api,
            "herdr-web:session-snapshot",
            Method::SessionSnapshot(EmptyParams::default()),
        )? {
            ResponseResult::SessionSnapshot { snapshot } => Ok(*snapshot),
            other => Err(BridgeError::Protocol(format!(
                "unexpected response: {other:?}"
            ))),
        }
    })
    .await
    .map_err(|err| BridgeError::Protocol(err.to_string()))??;
    observe_agent_activity_snapshot(&state, &session_snapshot.panes);
    let notes = state.notes.clone();
    let note_panes = session_snapshot.panes.clone();
    match tokio::task::spawn_blocking(move || notes.observe_panes(&note_panes))
        .await
        .map_err(|err| BridgeError::Protocol(err.to_string()))?
    {
        Ok(true) => broadcast_notes_changed(&state, None, None),
        Ok(false) => {}
        Err(err) => warn!(error = %err, "failed to update pane note observations"),
    }
    let selected_pane_id = shared_selected_pane(&state, &session_snapshot.panes)?;

    Ok(Json(web_snapshot_from_session_snapshot(
        session_snapshot,
        selected_pane_id,
    )))
}

fn web_snapshot_from_session_snapshot(
    snapshot: SessionSnapshot,
    selected_pane_id: Option<String>,
) -> Snapshot {
    let SessionSnapshot {
        focused_pane_id,
        workspaces,
        tabs,
        panes,
        layouts,
        ..
    } = snapshot;
    let selected_pane_id = selected_pane_id
        .filter(|pane_id| panes.iter().any(|pane| pane.pane_id == pane_id.as_str()))
        .or_else(|| {
            focused_pane_id
                .filter(|pane_id| panes.iter().any(|pane| pane.pane_id == pane_id.as_str()))
        });
    let workspaces = workspaces
        .into_iter()
        .map(|workspace| {
            let can_clear_name = workspace.label
                != default_workspace_label_from_panes(&workspace.workspace_id, panes.iter());
            SnapshotWorkspaceInfo {
                info: workspace,
                can_clear_name,
            }
        })
        .collect();
    let tabs = tabs
        .into_iter()
        .map(|tab| {
            let can_clear_name = !is_default_tab_label(&tab.label);
            SnapshotTabInfo {
                info: tab,
                can_clear_name,
            }
        })
        .collect();

    Snapshot {
        workspaces,
        tabs,
        panes,
        layouts,
        selected_pane_id,
    }
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
        agent_activity: AgentActivityCapability { version: 1 },
        agent_pins: AgentPinsCapability { version: 1 },
        launcher_presets: LauncherPresetsCapability { version: 1 },
        notes: NotesCapability { version: 1 },
    }))
}

async fn agent_activity_list_handler(
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Result<Json<AgentActivityListResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let list_state = state.clone();
    let response = tokio::task::spawn_blocking(move || {
        let panes = current_panes(&list_state.api)?;
        observe_agent_activity_snapshot(&list_state, &panes);
        Ok::<_, BridgeError>(list_state.agent_activity.list(&panes))
    })
    .await
    .map_err(|err| BridgeError::Protocol(err.to_string()))??;
    Ok(Json(response))
}

async fn agent_pins_list_handler(
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Result<Json<AgentPinsListResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    Ok(Json(
        run_store_task(state, move |state| {
            let panes = current_panes(&state.api)?;
            Ok(state.agent_pins.list(&panes)?)
        })
        .await?,
    ))
}

async fn agent_pins_pin_handler(
    State(state): State<BridgeState>,
    AxumPath(pane_id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<Json<AgentPinsListResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let event_pane_id = pane_id.clone();
    let response = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.agent_pins.pin(&pane_id, &panes)?)
    })
    .await?;
    broadcast_agent_pins_changed(&state, Some(&event_pane_id));
    Ok(Json(response))
}

async fn agent_pins_unpin_handler(
    State(state): State<BridgeState>,
    AxumPath(pane_id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<Json<AgentPinsListResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let event_pane_id = pane_id.clone();
    let response = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.agent_pins.unpin(&pane_id, &panes)?)
    })
    .await?;
    broadcast_agent_pins_changed(&state, Some(&event_pane_id));
    Ok(Json(response))
}

async fn notes_list_handler(
    State(state): State<BridgeState>,
    Query(query): Query<NotesListQuery>,
    headers: HeaderMap,
) -> Result<Json<NotesListResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    Ok(Json(
        run_store_task(state, move |state| {
            let panes = current_panes(&state.api)?;
            Ok(state.notes.list(query, &panes)?)
        })
        .await?,
    ))
}

async fn notes_create_handler(
    State(state): State<BridgeState>,
    headers: HeaderMap,
    Json(body): Json<CreateNoteRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.create(body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn notes_update_handler(
    State(state): State<BridgeState>,
    AxumPath(note_id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<UpdateNoteRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.update(&note_id, body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn notes_attach_handler(
    State(state): State<BridgeState>,
    AxumPath(note_id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<AttachNoteRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.attach(&note_id, body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn notes_detach_handler(
    State(state): State<BridgeState>,
    AxumPath(note_id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<RevisionRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.detach(&note_id, body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn notes_archive_handler(
    State(state): State<BridgeState>,
    AxumPath(note_id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<RevisionRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.archive(&note_id, body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn notes_restore_handler(
    State(state): State<BridgeState>,
    AxumPath(note_id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<RevisionRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.restore(&note_id, body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn notes_delete_handler(
    State(state): State<BridgeState>,
    AxumPath(note_id): AxumPath<String>,
    headers: HeaderMap,
    Json(body): Json<RevisionRequest>,
) -> Result<Json<NoteResponse>, BridgeError> {
    ensure_allowed_request(&headers, &state.request_policy)?;
    let note = run_store_task(state.clone(), move |state| {
        let panes = current_panes(&state.api)?;
        Ok(state.notes.delete(&note_id, body, &panes)?)
    })
    .await?;
    broadcast_notes_changed(&state, Some(&note.note.note_id), Some(note.note.revision));
    Ok(Json(note))
}

async fn run_store_task<T, F>(state: BridgeState, task: F) -> Result<T, BridgeError>
where
    T: Send + 'static,
    F: FnOnce(BridgeState) -> Result<T, BridgeError> + Send + 'static,
{
    tokio::task::spawn_blocking(move || task(state))
        .await
        .map_err(|err| BridgeError::Protocol(err.to_string()))?
}

fn broadcast_agent_pins_changed(state: &BridgeState, pane_id: Option<&str>) {
    let mut payload = serde_json::json!({
        "type": "herdr_web.agent_pins_changed",
    });
    if let Some(pane_id) = pane_id {
        payload["pane_id"] = serde_json::json!(pane_id);
    }
    let _ = state.ui_event_tx.send(payload.to_string());
}

fn broadcast_agent_activity_changed(state: &BridgeState) {
    let payload = serde_json::json!({
        "type": "herdr_web.agent_activity_changed",
    });
    let _ = state.ui_event_tx.send(payload.to_string());
}

fn broadcast_notes_changed(state: &BridgeState, note_id: Option<&str>, revision: Option<u64>) {
    let mut payload = serde_json::json!({
        "type": "herdr_web.notes_changed",
    });
    if let Some(note_id) = note_id {
        payload["note_id"] = serde_json::json!(note_id);
    }
    if let Some(revision) = revision {
        payload["revision"] = serde_json::json!(revision);
    }
    let _ = state.ui_event_tx.send(payload.to_string());
}

fn observe_agent_activity_snapshot(state: &BridgeState, panes: &[PaneInfo]) {
    if state.agent_activity.observe_snapshot(panes) {
        broadcast_agent_activity_changed(state);
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

async fn activity_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<BridgeState>,
    headers: HeaderMap,
) -> Response {
    if let Err(err) = ensure_allowed_request(&headers, &state.request_policy) {
        return err.into_response();
    }
    ws.on_upgrade(move |socket| handle_activity_socket(socket, state))
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

async fn handle_activity_socket(socket: WebSocket, state: BridgeState) {
    let mut activity_rx = state.activity_tx.subscribe();
    let (mut ws_sender, mut ws_receiver) = socket.split();
    loop {
        tokio::select! {
            event = activity_rx.recv() => {
                match event {
                    Ok(event) => {
                        if send_activity_message(&mut ws_sender, &event).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let event = ActivityMessage::ResyncRequired {
                            reason: "activity receiver lagged".to_string(),
                        };
                        let _ = send_activity_message(&mut ws_sender, &event).await;
                        break;
                    }
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

async fn send_activity_message(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    event: &ActivityMessage,
) -> Result<(), axum::Error> {
    let text = serde_json::to_string(event).unwrap_or_else(|_| {
        r#"{"type":"resync_required","reason":"activity serialization failed"}"#.to_string()
    });
    ws_sender.send(Message::Text(text.into())).await
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

async fn handle_terminal_socket(socket: WebSocket, state: BridgeState, query: TerminalQuery) {
    if query.terminal_id.trim().is_empty() {
        return;
    }

    let terminal_id = query.terminal_id.clone();
    let cols = query.cols.unwrap_or(DEFAULT_COLS);
    let rows = query.rows.unwrap_or(DEFAULT_ROWS);
    let coalesce_window = terminal_output_coalesce_window(query.coalesce_ms);
    let output_encoding = query
        .output_encoding
        .unwrap_or(TerminalOutputWireEncoding::Identity);
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

    let write_tx = session.write_tx.clone();
    let mut terminal_rx = session.output_tx.subscribe();
    if matches!(output_encoding, TerminalOutputWireEncoding::Gzip)
        && ws_sender
            .send(Message::Text(TERMINAL_OUTPUT_GZIP_ACKNOWLEDGEMENT.into()))
            .await
            .is_err()
    {
        release_terminal_session(&state.terminal_sessions, &terminal_id, &session);
        return;
    }

    let mut output_coalescer = TerminalOutputCoalescer::new(coalesce_window);
    let _ = write_tx.send(ClientMessage::Resize {
        cols,
        rows,
        cell_width_px: 0,
        cell_height_px: 0,
    });

    loop {
        if let Some(deadline) = output_coalescer.deadline() {
            tokio::select! {
                biased;
                _ = tokio::time::sleep_until(deadline) => {
                    if !handle_terminal_output_deadline(
                        &mut ws_sender,
                        &mut output_coalescer,
                        output_encoding,
                    )
                    .await
                    {
                        break;
                    }
                }
                Some(message) = ws_receiver.next() => {
                    if !handle_terminal_client_message(&write_tx, message) {
                        break;
                    }
                }
                output = terminal_rx.recv() => {
                    if !handle_terminal_output_message(
                        output,
                        &mut ws_sender,
                        &mut output_coalescer,
                        output_encoding,
                    )
                    .await
                    {
                        break;
                    }
                }
                else => break,
            }
        } else {
            tokio::select! {
                output = terminal_rx.recv() => {
                    if !handle_terminal_output_message(
                        output,
                        &mut ws_sender,
                        &mut output_coalescer,
                        output_encoding,
                    )
                    .await
                    {
                        break;
                    }
                }
                Some(message) = ws_receiver.next() => {
                    if !handle_terminal_client_message(&write_tx, message) {
                        break;
                    }
                }
                else => break,
            }
        }
    }

    release_terminal_session(&state.terminal_sessions, &terminal_id, &session);
}

async fn handle_terminal_output_deadline(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    output_coalescer: &mut TerminalOutputCoalescer,
    output_encoding: TerminalOutputWireEncoding,
) -> bool {
    let Some(reason) = output_coalescer.handle_deadline() else {
        return true;
    };
    let Some(bytes) = output_coalescer.flush_pending(reason, Instant::now()) else {
        return true;
    };
    send_terminal_output_frame(ws_sender, bytes, output_encoding).await
}

async fn send_terminal_output_frame(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    bytes: Bytes,
    output_encoding: TerminalOutputWireEncoding,
) -> bool {
    ws_sender
        .send(Message::Binary(encode_terminal_output_frame(
            bytes,
            output_encoding,
        )))
        .await
        .is_ok()
}

async fn handle_terminal_output_message(
    output: Result<TerminalOutput, tokio::sync::broadcast::error::RecvError>,
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    output_coalescer: &mut TerminalOutputCoalescer,
    output_encoding: TerminalOutputWireEncoding,
) -> bool {
    match output {
        Ok(TerminalOutput::Bytes(bytes)) => {
            let decision = output_coalescer.push_bytes(bytes, Instant::now());
            match decision {
                TerminalOutputCoalescingDecision::SendNow(bytes) => {
                    if !send_terminal_output_frame(ws_sender, bytes, output_encoding).await {
                        return false;
                    }
                }
                TerminalOutputCoalescingDecision::Pending => {}
                TerminalOutputCoalescingDecision::FlushPending(reason) => {
                    let Some(bytes) = output_coalescer.flush_pending(reason, Instant::now()) else {
                        return true;
                    };
                    if !send_terminal_output_frame(ws_sender, bytes, output_encoding).await {
                        return false;
                    }
                }
            }
            true
        }
        Ok(TerminalOutput::Close(reason)) => {
            if let Some(bytes) =
                output_coalescer.flush_pending(TerminalOutputFlushReason::Close, Instant::now())
            {
                if !send_terminal_output_frame(ws_sender, bytes, output_encoding).await {
                    return false;
                }
            }
            let _ = ws_sender
                .send(Message::Text(close_message(&reason).into()))
                .await;
            false
        }
        Err(tokio::sync::broadcast::error::RecvError::Lagged(frames)) => {
            // Dropped frames would silently corrupt the stateful ANSI stream.
            // Close the socket without a "closed" frame so the client
            // reconnects and gets a clean repaint from a fresh attach.
            output_coalescer.record_lagged(frames);
            warn!(frames, "terminal output lagged; closing socket for resync");
            false
        }
        Err(tokio::sync::broadcast::error::RecvError::Closed) => false,
    }
}

fn handle_terminal_client_message(
    write_tx: &TerminalWriter,
    message: Result<Message, axum::Error>,
) -> bool {
    match message {
        Ok(Message::Text(text)) => handle_terminal_text_frame(write_tx, text.as_str()).is_ok(),
        Ok(Message::Binary(bytes)) => send_terminal_input_chunks(write_tx, &bytes).is_ok(),
        Ok(Message::Close(_)) => false,
        Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => true,
        Err(_) => false,
    }
}

async fn acquire_terminal_session(
    state: BridgeState,
    terminal_id: String,
    cols: u16,
    rows: u16,
    takeover: bool,
) -> Result<SharedTerminalSession, BridgeError> {
    tokio::task::spawn_blocking(move || {
        // What to do after inspecting the maps under one lock hold.
        enum AttachStep {
            WaitDrain(Arc<ConnectionClosed>),
            WaitGate(Arc<ConnectionClosed>),
            Handshake(Arc<ConnectionClosed>),
        }

        let mut drain_waits = 0;
        let mut gate_waits = 0;
        let mut handshake_retries = 0;
        'attach: loop {
            // All maps can change while this thread waits without the lock, so
            // every wait loops back here: a session attached meanwhile must be
            // joined, another thread's in-flight handshake must be awaited
            // (two concurrent fresh attaches make the daemon reject one — it
            // races whichever the map keeps), and a draining connection must
            // finish tearing down before a fresh attach, or the daemon rejects
            // it as a second concurrent client.
            let step = {
                let mut sessions = state.terminal_sessions.lock().map_err(|_| {
                    BridgeError::Protocol("terminal session lock poisoned".to_string())
                })?;
                if let Some(session) = sessions.active.get(&terminal_id) {
                    session.client_count.fetch_add(1, Ordering::AcqRel);
                    return Ok(session.clone());
                }
                if let Some(gate) = sessions.attaching.get(&terminal_id) {
                    if gate_waits < MAX_TERMINAL_DETACH_DRAIN_WAITS {
                        AttachStep::WaitGate(gate.clone())
                    } else {
                        // Progress guard: handshake anyway, without claiming
                        // the gate another thread still holds.
                        warn!(
                            terminal_id = %terminal_id,
                            "attaching despite a stuck concurrent attach handshake"
                        );
                        AttachStep::Handshake(Arc::new(ConnectionClosed::default()))
                    }
                } else if let Some(draining) = sessions.draining.get(&terminal_id) {
                    if drain_waits < MAX_TERMINAL_DETACH_DRAIN_WAITS {
                        AttachStep::WaitDrain(draining.clone())
                    } else {
                        warn!(
                            terminal_id = %terminal_id,
                            "reattaching despite pending detach teardown after repeated drain waits"
                        );
                        let gate = Arc::new(ConnectionClosed::default());
                        sessions.attaching.insert(terminal_id.clone(), gate.clone());
                        AttachStep::Handshake(gate)
                    }
                } else {
                    let gate = Arc::new(ConnectionClosed::default());
                    sessions.attaching.insert(terminal_id.clone(), gate.clone());
                    AttachStep::Handshake(gate)
                }
            };

            let gate = match step {
                AttachStep::WaitGate(gate) => {
                    gate_waits += 1;
                    if !gate.wait_closed(TERMINAL_ATTACH_GATE_TIMEOUT) {
                        warn!(
                            terminal_id = %terminal_id,
                            "timed out waiting for a concurrent terminal attach handshake"
                        );
                    }
                    continue 'attach;
                }
                AttachStep::WaitDrain(draining) => {
                    drain_waits += 1;
                    if !draining.wait_closed(TERMINAL_DETACH_DRAIN_TIMEOUT) {
                        warn!(
                            terminal_id = %terminal_id,
                            "timed out waiting for detached terminal connection to close"
                        );
                    }
                    let mut sessions = state.terminal_sessions.lock().map_err(|_| {
                        BridgeError::Protocol("terminal session lock poisoned".to_string())
                    })?;
                    if sessions
                        .draining
                        .get(&terminal_id)
                        .is_some_and(|entry| Arc::ptr_eq(entry, &draining))
                    {
                        sessions.draining.remove(&terminal_id);
                    }
                    continue 'attach;
                }
                AttachStep::Handshake(gate) => gate,
            };

            // Perform the daemon handshake without holding the map lock so a
            // stalled daemon cannot wedge every other terminal client. The
            // gate keeps concurrent acquires for this terminal waiting; they
            // join the published session once it opens.
            let handshake = || -> Result<SharedTerminalSession, BridgeError> {
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
                Ok(SharedTerminalSession {
                    write_tx: attach.write_tx,
                    output_tx,
                    client_count: Arc::new(AtomicUsize::new(0)),
                    connection_closed: attach.connection_closed,
                })
            };
            let session = match handshake() {
                Ok(session) => session,
                Err(err) => {
                    release_attach_gate(&state.terminal_sessions, &terminal_id, &gate);
                    return Err(err);
                }
            };

            let Ok(mut sessions) = state.terminal_sessions.lock() else {
                let _ = session.write_tx.send(ClientMessage::Detach);
                gate.mark_closed();
                return Err(BridgeError::Protocol(
                    "terminal session lock poisoned".to_string(),
                ));
            };
            if let Some(existing) = sessions.active.get(&terminal_id) {
                // Safety net: only reachable via the stuck-gate fallback.
                // Keep the established session and detach the redundant one.
                existing.client_count.fetch_add(1, Ordering::AcqRel);
                let existing = existing.clone();
                drop(sessions);
                let _ = session.write_tx.send(ClientMessage::Detach);
                release_attach_gate(&state.terminal_sessions, &terminal_id, &gate);
                return Ok(existing);
            }
            if sessions.draining.contains_key(&terminal_id) {
                // A connection attached and began detaching while we were
                // handshaking (only possible via the stuck-gate fallback), so
                // the daemon may have rejected our attach as a second
                // concurrent client. Never publish the possibly dead session:
                // retry, and once the retry budget is spent fail with a reason
                // the web client treats as retryable.
                drop(sessions);
                let _ = session.write_tx.send(ClientMessage::Detach);
                release_attach_gate(&state.terminal_sessions, &terminal_id, &gate);
                if handshake_retries < MAX_ATTACH_HANDSHAKE_RETRIES {
                    handshake_retries += 1;
                    continue 'attach;
                }
                warn!(
                    terminal_id = %terminal_id,
                    "giving up terminal attach amid sustained detach churn"
                );
                return Err(BridgeError::Protocol(
                    "terminal attach conflicted with a pending detach; retry shortly".to_string(),
                ));
            }
            session.client_count.fetch_add(1, Ordering::AcqRel);
            sessions.active.insert(terminal_id.clone(), session.clone());
            drop(sessions);
            release_attach_gate(&state.terminal_sessions, &terminal_id, &gate);
            return Ok(session);
        }
    })
    .await
    .map_err(|err| BridgeError::Protocol(err.to_string()))?
}

fn release_terminal_session(
    sessions: &Mutex<TerminalSessions>,
    terminal_id: &str,
    session: &SharedTerminalSession,
) {
    // Decrement while holding the map lock so a concurrent acquire cannot
    // join the session between the last-client check and its removal.
    let Ok(mut sessions) = sessions.lock() else {
        return;
    };
    if session.client_count.fetch_sub(1, Ordering::AcqRel) != 1 {
        return;
    }

    let _ = session.write_tx.send(ClientMessage::Detach);
    if sessions
        .active
        .get(terminal_id)
        .is_some_and(|current| Arc::ptr_eq(&current.client_count, &session.client_count))
    {
        sessions.active.remove(terminal_id);
        remember_draining_connection(&mut sessions, terminal_id, session);
    }
}

/// Releases a terminal's attach-handshake gate and wakes its waiters, who
/// re-check the maps and normally join the session the handshake published.
fn release_attach_gate(
    sessions: &Mutex<TerminalSessions>,
    terminal_id: &str,
    gate: &Arc<ConnectionClosed>,
) {
    if let Ok(mut sessions) = sessions.lock() {
        if sessions
            .attaching
            .get(terminal_id)
            .is_some_and(|entry| Arc::ptr_eq(entry, gate))
        {
            sessions.attaching.remove(terminal_id);
        }
    }
    gate.mark_closed();
}

/// Records a detached connection so a quick reattach waits for the daemon to
/// finish tearing it down instead of racing the queued `Detach`. Entries are
/// cleared by the next reattach or swept once closed during session pruning.
fn remember_draining_connection(
    sessions: &mut TerminalSessions,
    terminal_id: &str,
    session: &SharedTerminalSession,
) {
    if session.connection_closed.is_closed() {
        return;
    }
    sessions
        .draining
        .insert(terminal_id.to_string(), session.connection_closed.clone());
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
        let Ok(mut sessions) = state.terminal_sessions.lock() else {
            warn!("failed to lock herdr web terminal sessions for pruning");
            return;
        };
        sessions
            .draining
            .retain(|_, connection| !connection.is_closed());
        sessions
            .active
            .iter()
            .filter(|(terminal_id, _)| !active_terminal_ids.contains(terminal_id.as_str()))
            .map(|(terminal_id, session)| (terminal_id.clone(), session.clone()))
            .collect::<Vec<_>>()
    };

    for (terminal_id, session) in stale_sessions {
        close_terminal_session(
            &state.terminal_sessions,
            &terminal_id,
            &session,
            "terminal closed by Herdr",
        );
    }
}

fn close_terminal_session(
    sessions: &Mutex<TerminalSessions>,
    terminal_id: &str,
    session: &SharedTerminalSession,
    reason: &str,
) {
    let _ = session
        .output_tx
        .send(TerminalOutput::Close(reason.to_string()));
    let _ = session.write_tx.send(ClientMessage::Detach);
    let Ok(mut sessions) = sessions.lock() else {
        return;
    };
    if sessions
        .active
        .get(terminal_id)
        .is_some_and(|current| Arc::ptr_eq(&current.client_count, &session.client_count))
    {
        sessions.active.remove(terminal_id);
        remember_draining_connection(&mut sessions, terminal_id, session);
    }
}

fn event_may_close_terminal_session(event: &str) -> bool {
    event.contains("workspace.closed")
        || event.contains("tab.closed")
        || event.contains("pane.closed")
}

fn close_message(reason: &str) -> String {
    format!(
        r#"{{"type":"closed","reason":{}}}"#,
        serde_json::to_string(reason).unwrap_or_else(|_| "\"closed\"".into())
    )
}

fn spawn_agent_activity_watcher(state: BridgeState) {
    let (resubscribe_tx, resubscribe_rx) = mpsc::channel();
    let structural_state = state.clone();
    if let Err(err) = thread::Builder::new()
        .name("herdr-web-activity-structural".to_string())
        .spawn(move || agent_activity_structural_watcher_loop(structural_state, resubscribe_tx))
    {
        warn!(error = %err, "failed to start herdr-web activity structural watcher");
    }
    if let Err(err) = thread::Builder::new()
        .name("herdr-web-activity".to_string())
        .spawn(move || agent_activity_watcher_loop(state, resubscribe_rx))
    {
        warn!(error = %err, "failed to start herdr-web activity watcher");
    }
}

fn agent_activity_structural_watcher_loop(state: BridgeState, resubscribe_tx: mpsc::Sender<()>) {
    let mut backoff = ACTIVITY_WATCHER_INITIAL_BACKOFF;
    loop {
        match run_agent_activity_structural_subscription(&state, &resubscribe_tx) {
            Ok(()) => {
                backoff = ACTIVITY_WATCHER_INITIAL_BACKOFF;
            }
            Err(err) => {
                warn!(error = %err, "herdr-web activity structural watcher will retry");
                thread::sleep(backoff);
                backoff = (backoff * 2).min(ACTIVITY_WATCHER_MAX_BACKOFF);
            }
        }
    }
}

fn agent_activity_watcher_loop(state: BridgeState, resubscribe_rx: mpsc::Receiver<()>) {
    let mut backoff = ACTIVITY_WATCHER_INITIAL_BACKOFF;
    loop {
        match run_agent_activity_subscription(&state, &resubscribe_rx) {
            Ok(()) => {
                backoff = ACTIVITY_WATCHER_INITIAL_BACKOFF;
                thread::sleep(ACTIVITY_RESUBSCRIBE_DEBOUNCE);
            }
            Err(err) => {
                warn!(error = %err, "herdr-web activity watcher will retry");
                thread::sleep(backoff);
                backoff = (backoff * 2).min(ACTIVITY_WATCHER_MAX_BACKOFF);
            }
        }
    }
}

fn run_agent_activity_structural_subscription(
    state: &BridgeState,
    resubscribe_tx: &mpsc::Sender<()>,
) -> Result<(), BridgeError> {
    let request = Request {
        id: "herdr-web:activity-structural".to_string(),
        method: Method::EventsSubscribe(EventsSubscribeParams {
            subscriptions: structural_event_subscriptions(),
        }),
    };
    let (ack, mut stream) = state.api.subscribe_value(&request, None)?;
    let response = herdr_compat::api::client::parse_response_value(ack)?;
    if !matches!(response.result, ResponseResult::SubscriptionStarted {}) {
        return Err(BridgeError::Protocol(format!(
            "unexpected subscription response: {:?}",
            response.result
        )));
    }

    while let Some(value) = stream.next_value()? {
        if is_structural_event_value(&value) && resubscribe_tx.send(()).is_err() {
            return Ok(());
        }
    }
    Err(BridgeError::Protocol(
        "activity structural subscription ended".to_string(),
    ))
}

fn run_agent_activity_subscription(
    state: &BridgeState,
    resubscribe_rx: &mpsc::Receiver<()>,
) -> Result<(), BridgeError> {
    drain_resubscribe_signals(resubscribe_rx);
    let panes = current_panes(&state.api)?;
    observe_agent_activity_snapshot(state, &panes);
    let pane_ids = sorted_pane_ids(&panes);
    if pane_ids.is_empty() {
        wait_for_resubscribe_signal(resubscribe_rx)?;
        return Ok(());
    }
    let request = Request {
        id: "herdr-web:activity".to_string(),
        method: Method::EventsSubscribe(EventsSubscribeParams {
            subscriptions: activity_subscriptions(&pane_ids),
        }),
    };
    let (ack, mut stream) = state.api.subscribe_value(&request, None)?;
    let response = herdr_compat::api::client::parse_response_value(ack)?;
    if !matches!(response.result, ResponseResult::SubscriptionStarted {}) {
        return Err(BridgeError::Protocol(format!(
            "unexpected subscription response: {:?}",
            response.result
        )));
    }
    stream.set_read_timeout(ACTIVITY_READ_TIMEOUT)?;

    loop {
        if drain_resubscribe_signals(resubscribe_rx) {
            let next_panes = current_panes(&state.api)?;
            observe_agent_activity_snapshot(state, &next_panes);
            if !activity_resubscribe_needed(&pane_ids, &next_panes) {
                continue;
            }
            return Ok(());
        }
        match stream.next_value() {
            Ok(Some(value)) => {
                if let Some(message) = activity_message_from_subscription_value(value) {
                    if let ActivityMessage::PaneAgentStatusChanged {
                        pane_id,
                        agent_status,
                        ..
                    } = &message
                    {
                        if state
                            .agent_activity
                            .observe_status_event(pane_id, *agent_status)
                        {
                            broadcast_agent_activity_changed(state);
                        }
                    }
                    let _ = state.activity_tx.send(message);
                }
            }
            Ok(None) => {
                return Err(BridgeError::Protocol(
                    "activity subscription ended".to_string(),
                ))
            }
            Err(err) if is_timeout_error(&err) => continue,
            Err(err) => return Err(err.into()),
        }
    }
}

fn sorted_pane_ids(panes: &[PaneInfo]) -> Vec<String> {
    let mut pane_ids = panes
        .iter()
        .map(|pane| pane.pane_id.clone())
        .collect::<Vec<_>>();
    pane_ids.sort();
    pane_ids.dedup();
    pane_ids
}

fn activity_resubscribe_needed(current_pane_ids: &[String], next_panes: &[PaneInfo]) -> bool {
    sorted_pane_ids(next_panes) != current_pane_ids
}

fn wait_for_resubscribe_signal(resubscribe_rx: &mpsc::Receiver<()>) -> Result<(), BridgeError> {
    resubscribe_rx
        .recv()
        .map(|_| ())
        .map_err(|_| BridgeError::Protocol("activity resubscribe channel closed".to_string()))
}

fn activity_subscriptions(pane_ids: &[String]) -> Vec<Subscription> {
    let mut pane_ids = pane_ids.to_vec();
    pane_ids.sort();
    pane_ids.dedup();
    pane_ids
        .into_iter()
        .map(|pane_id| Subscription::PaneAgentStatusChanged {
            pane_id,
            agent_status: None,
        })
        .collect()
}

fn structural_event_subscriptions() -> Vec<Subscription> {
    vec![
        Subscription::WorkspaceCreated {},
        Subscription::WorkspaceUpdated {},
        Subscription::WorkspaceRenamed {},
        Subscription::WorkspaceMoved {},
        Subscription::WorkspaceReordered {},
        Subscription::WorkspaceClosed {},
        Subscription::WorkspaceFocused {},
        Subscription::WorktreeCreated {},
        Subscription::WorktreeOpened {},
        Subscription::WorktreeRemoved {},
        Subscription::TabCreated {},
        Subscription::TabClosed {},
        Subscription::TabFocused {},
        Subscription::TabRenamed {},
        Subscription::TabMoved {},
        Subscription::PaneCreated {},
        Subscription::PaneClosed {},
        Subscription::PaneFocused {},
        Subscription::PaneMoved {},
        Subscription::PaneExited {},
        Subscription::PaneAgentDetected {},
        Subscription::LayoutUpdated {},
    ]
}

fn activity_message_from_subscription_value(value: serde_json::Value) -> Option<ActivityMessage> {
    let envelope: SubscriptionEventEnvelope = serde_json::from_value(value).ok()?;
    if envelope.event != SubscriptionEventKind::PaneAgentStatusChanged {
        return None;
    }
    let SubscriptionEventData::PaneAgentStatusChanged(event) = envelope.data else {
        return None;
    };
    Some(ActivityMessage::PaneAgentStatusChanged {
        pane_id: event.pane_id,
        workspace_id: event.workspace_id,
        agent_status: event.agent_status,
        agent: event.agent,
        title: event.title,
        display_agent: event.display_agent,
        state_labels: event.state_labels,
    })
}

fn is_structural_event_value(value: &serde_json::Value) -> bool {
    value
        .get("event")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|event| event != "pane.agent_status_changed")
}

fn drain_resubscribe_signals(resubscribe_rx: &mpsc::Receiver<()>) -> bool {
    let mut received = false;
    while resubscribe_rx.try_recv().is_ok() {
        received = true;
    }
    received
}

fn is_timeout_error(err: &ApiClientError) -> bool {
    matches!(
        err,
        ApiClientError::Io(err)
            if matches!(err.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock)
    )
}

fn open_event_subscription(
    api: ApiClient,
) -> Result<tokio::sync::mpsc::UnboundedReceiver<String>, BridgeError> {
    let request = Request {
        id: "herdr-web:events".to_string(),
        method: Method::EventsSubscribe(EventsSubscribeParams {
            subscriptions: structural_event_subscriptions(),
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TerminalInputChunkStats {
    chunks: usize,
    max_chunk_bytes: usize,
}

fn send_terminal_input_chunks(
    write_tx: &TerminalWriter,
    data: &[u8],
) -> Result<TerminalInputChunkStats, String> {
    write_tx.reserve_input_bytes(data.len())?;
    if data.is_empty() {
        if write_tx
            .send(ClientMessage::Input { data: Vec::new() })
            .is_err()
        {
            return Err("terminal writer closed".to_string());
        }
        return Ok(TerminalInputChunkStats {
            chunks: 1,
            max_chunk_bytes: 0,
        });
    }

    let mut stats = TerminalInputChunkStats {
        chunks: 0,
        max_chunk_bytes: 0,
    };
    let mut sent_bytes = 0usize;
    for chunk in data.chunks(MAX_TERMINAL_INPUT_CHUNK_BYTES) {
        stats.chunks += 1;
        stats.max_chunk_bytes = stats.max_chunk_bytes.max(chunk.len());
        if write_tx
            .send(ClientMessage::Input {
                data: chunk.to_vec(),
            })
            .is_err()
        {
            write_tx.release_input_bytes(data.len() - sent_bytes);
            return Err("terminal writer closed".to_string());
        }
        sent_bytes += chunk.len();
    }
    Ok(stats)
}

fn handle_terminal_text_frame(write_tx: &TerminalWriter, text: &str) -> Result<(), String> {
    let frame = parse_terminal_client_frame(text)?;
    match frame {
        TerminalClientFrame::Input { data } => {
            send_terminal_input_chunks(write_tx, data.as_bytes())?;
            Ok(())
        }
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
            .map(|_| ())
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
            .map(|_| ())
            .map_err(|_| "terminal writer closed".to_string()),
    }
}

fn parse_terminal_client_frame(text: &str) -> Result<TerminalClientFrame, String> {
    serde_json::from_str(text).map_err(|err| format!("invalid terminal frame: {err}"))
}

struct TerminalAttach {
    write_tx: TerminalWriter,
    connection_closed: Arc<ConnectionClosed>,
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
            terminal_id: terminal_id.clone(),
            takeover,
        },
    )
    .map_err(|err| BridgeError::Protocol(err.to_string()))?;

    let mut read_stream = stream.try_clone()?;
    let (write_tx, write_rx) = mpsc::channel::<ClientMessage>();
    let queued_input_bytes = Arc::new(AtomicUsize::new(0));
    let writer_queued_input_bytes = queued_input_bytes.clone();
    let connection_closed = Arc::new(ConnectionClosed::default());
    let reader_connection_closed = connection_closed.clone();

    thread::spawn(move || {
        let mut write_stream = stream;
        for message in write_rx {
            let is_detach = matches!(message, ClientMessage::Detach);
            let input_len = match &message {
                ClientMessage::Input { data } => data.len(),
                _ => 0,
            };
            let result = protocol::write_message(&mut write_stream, &message);
            if input_len > 0 {
                writer_queued_input_bytes.fetch_sub(input_len, Ordering::AcqRel);
            }
            if result.is_err() {
                break;
            }
            let _ = write_stream.flush();
            if is_detach {
                // The daemon unregisters the client when it processes Detach
                // but never closes the socket. Without a local shutdown both
                // read sides stay blocked forever: this bridge's read thread
                // (whose exit resolves the draining marker) and the daemon's
                // reader thread. Shutting down delivers EOF to both.
                shutdown_terminal_attach_stream(&write_stream);
                break;
            }
        }
    });

    thread::spawn(move || {
        loop {
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
                    let _ = output_tx.send(TerminalOutput::Bytes(Bytes::from(frame.bytes)));
                }
                ServerMessage::ServerShutdown { reason } => {
                    let reason = reason.unwrap_or_else(|| "server shutdown".to_string());
                    // The daemon does not log these (attach rejections in
                    // particular), so this is the only record of why an
                    // attach connection was closed from the daemon side.
                    warn!(
                        terminal_id = %terminal_id,
                        reason = %reason,
                        "terminal attach connection closed by daemon"
                    );
                    let _ = output_tx.send(TerminalOutput::Close(reason));
                    break;
                }
                ServerMessage::Welcome { .. } => {}
                ServerMessage::Notify { .. }
                | ServerMessage::Clipboard { .. }
                | ServerMessage::WindowTitle { .. }
                | ServerMessage::ReloadSoundConfig
                | ServerMessage::MouseCapture { .. }
                | ServerMessage::KittyKeyboardReportAll { .. }
                | ServerMessage::PrefixInputSource { .. }
                | ServerMessage::Frame(_)
                | ServerMessage::Graphics { .. } => {}
            }
        }
        // By this point the Detach (if any) has been flushed and the socket
        // shut down, so a reattach waiter that proceeds now can no longer
        // beat the queued Detach to the daemon.
        reader_connection_closed.mark_closed();
    });

    Ok(TerminalAttach {
        write_tx: TerminalWriter {
            tx: write_tx,
            queued_input_bytes,
        },
        connection_closed,
    })
}

/// Shuts down a terminal attach socket so both its blocked readers (the
/// bridge's and the daemon's) observe EOF; the daemon does not close attach
/// connections on its own after a `Detach`.
fn shutdown_terminal_attach_stream(stream: &herdr_compat::ipc::LocalStream) {
    #[cfg(unix)]
    match stream {
        herdr_compat::ipc::LocalStream::UdSocket(inner) => {
            let _ = inner.inner().shutdown(std::net::Shutdown::Both);
        }
    }
    #[cfg(not(unix))]
    let _ = stream; // Named pipes tear down once both processes drop handles.
}

fn terminal_attach_protocol(api: &ApiClient) -> Result<u32, BridgeError> {
    validated_daemon_protocol(api.status_with_timeout(DAEMON_STATUS_TIMEOUT)?)
}

fn startup_daemon_status(api: &ApiClient) -> io::Result<herdr_compat::api::RuntimeStatus> {
    let status = api
        .status_with_timeout(DAEMON_STATUS_TIMEOUT)
        .map_err(BridgeError::from)
        .map_err(startup_daemon_error)?;
    validated_daemon_protocol(status.clone()).map_err(startup_daemon_error)?;
    Ok(status)
}

fn validated_daemon_protocol(status: herdr_compat::api::RuntimeStatus) -> Result<u32, BridgeError> {
    let version = status.version.as_deref().ok_or_else(|| {
        BridgeError::Protocol("Herdr daemon status did not include a version".to_string())
    })?;
    let version_triplet = parse_version_triplet(version).ok_or_else(|| {
        BridgeError::Protocol(format!(
            "Herdr daemon reported an invalid version {version:?}; need Herdr {MIN_HERDR_VERSION_LABEL} or newer with protocol {PROTOCOL_VERSION}"
        ))
    })?;
    if version_triplet < MIN_HERDR_VERSION {
        return Err(BridgeError::Protocol(format!(
            "Herdr daemon {version} is too old for herdr-web; need Herdr {MIN_HERDR_VERSION_LABEL} or newer with protocol {PROTOCOL_VERSION}"
        )));
    }

    let protocol = status.protocol.ok_or_else(|| {
        BridgeError::Protocol("Herdr daemon status did not include a protocol".to_string())
    })?;
    if protocol == PROTOCOL_VERSION {
        Ok(protocol)
    } else {
        Err(BridgeError::Protocol(format!(
            "Herdr daemon protocol {protocol} is incompatible with herdr-web; need protocol {PROTOCOL_VERSION}"
        )))
    }
}

fn parse_version_triplet(version: &str) -> Option<(u64, u64, u64)> {
    let version = version.trim();
    let version = version.strip_prefix('v').unwrap_or(version);
    let (release, build_metadata) = match version.split_once('+') {
        Some((release, metadata)) => (release, Some(metadata)),
        None => (version, None),
    };
    if release.contains('-')
        || build_metadata.is_some_and(|metadata| {
            metadata.is_empty()
                || metadata.split('.').any(|identifier| {
                    identifier.is_empty()
                        || !identifier
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                })
        })
    {
        return None;
    }
    let mut parts = release.split('.');
    let parse_number = |part: Option<&str>| {
        let part = part?;
        if part.is_empty()
            || !part.bytes().all(|byte| byte.is_ascii_digit())
            || (part.len() > 1 && part.starts_with('0'))
        {
            return None;
        }
        part.parse().ok()
    };
    let major = parse_number(parts.next())?;
    let minor = parse_number(parts.next())?;
    let patch = parse_number(parts.next())?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

fn startup_daemon_error(err: BridgeError) -> io::Error {
    io::Error::new(
        ErrorKind::ConnectionRefused,
        format!(
            "unable to start herdr-web bridge: {err}. Start or update Herdr, then restart herdr-web-bridge."
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::GzDecoder;
    use std::io::Read;

    #[test]
    fn gzip_terminal_output_frame_round_trips_and_reduces_repeated_output() {
        let payload = Bytes::from(vec![b'x'; 4096]);

        let frame = encode_terminal_output_frame(payload.clone(), TerminalOutputWireEncoding::Gzip);

        assert_eq!(frame[0], TERMINAL_OUTPUT_FRAME_GZIP);
        let mut decoded = Vec::new();
        GzDecoder::new(&frame[1..])
            .read_to_end(&mut decoded)
            .expect("gzip terminal output should decode");
        assert_eq!(decoded, payload);
        assert!(frame.len() < payload.len() / 4);
    }

    #[test]
    fn identity_terminal_output_encoding_preserves_legacy_frames() {
        let payload = Bytes::from_static(b"legacy terminal bytes");

        let frame =
            encode_terminal_output_frame(payload.clone(), TerminalOutputWireEncoding::Identity);

        assert_eq!(frame, payload);
    }

    #[test]
    fn gzip_terminal_output_frame_keeps_small_output_raw() {
        let payload = Bytes::from_static(b"ready> ");

        let frame = encode_terminal_output_frame(payload.clone(), TerminalOutputWireEncoding::Gzip);

        assert_eq!(frame[0], TERMINAL_OUTPUT_FRAME_RAW);
        assert_eq!(&frame[1..], payload);
    }

    #[test]
    fn static_cache_headers_revalidate_entrypoints_and_public_files() {
        for path in ["/", "/index.html", "/manifest.json", "/herdr-logo.svg"] {
            let mut headers = HeaderMap::new();
            insert_static_cache_header(&mut headers, path, StatusCode::OK);
            assert_eq!(headers.get(CACHE_CONTROL).unwrap(), "no-cache", "{path}");
        }
    }

    #[test]
    fn static_cache_headers_make_successful_vite_assets_immutable() {
        let mut headers = HeaderMap::new();
        insert_static_cache_header(&mut headers, "/assets/index-AbCd1234.js", StatusCode::OK);
        assert_eq!(
            headers.get(CACHE_CONTROL).unwrap(),
            "public, max-age=31536000, immutable"
        );
    }

    #[test]
    fn static_cache_headers_do_not_cache_missing_assets() {
        let mut headers = HeaderMap::new();
        insert_static_cache_header(&mut headers, "/assets/missing.js", StatusCode::NOT_FOUND);
        assert!(!headers.contains_key(CACHE_CONTROL));
    }

    #[test]
    fn static_cache_headers_preserve_service_policy() {
        let mut headers = HeaderMap::new();
        headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
        insert_static_cache_header(&mut headers, "/index.html", StatusCode::OK);
        assert_eq!(headers.get(CACHE_CONTROL).unwrap(), "no-store");
    }

    #[test]
    fn coalescer_sends_first_output_immediately() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));

        assert_eq!(
            coalescer.push_bytes(Bytes::from_static(b"first"), now),
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"first"))
        );
        assert_eq!(
            coalescer.deadline(),
            Some(now + terminal_output_coalesce_window(None))
        );
        assert_eq!(coalescer.lifetime_stats.source_frames, 1);
        assert_eq!(coalescer.lifetime_stats.sent_frames, 1);
        assert_eq!(coalescer.lifetime_stats.immediate_frames, 1);
    }

    #[test]
    fn coalescer_can_disable_output_coalescing() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(Duration::ZERO);

        assert_eq!(
            coalescer.push_bytes(Bytes::from_static(b"first"), now),
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"first"))
        );
        assert_eq!(
            coalescer.push_bytes(Bytes::from_static(b"second"), now),
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"second"))
        );
        assert_eq!(coalescer.deadline(), None);
        assert_eq!(coalescer.lifetime_stats.source_frames, 2);
        assert_eq!(coalescer.lifetime_stats.sent_frames, 2);
        assert_eq!(coalescer.lifetime_stats.coalesced_sent_frames, 0);
    }

    #[test]
    fn terminal_output_coalesce_window_defaults_and_clamps() {
        assert_eq!(
            terminal_output_coalesce_window(None),
            Duration::from_millis(DEFAULT_TERMINAL_OUTPUT_COALESCE_MS)
        );
        assert_eq!(terminal_output_coalesce_window(Some(0)), Duration::ZERO);
        assert_eq!(
            terminal_output_coalesce_window(Some(128)),
            Duration::from_millis(128)
        );
        assert_eq!(
            terminal_output_coalesce_window(Some(999)),
            Duration::from_millis(MAX_TERMINAL_OUTPUT_COALESCE_MS)
        );
    }

    #[test]
    fn coalescer_pends_output_inside_active_window() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));
        let _ = coalescer.push_bytes(Bytes::from_static(b"first"), now);

        assert_eq!(
            coalescer.push_bytes(Bytes::from_static(b"second"), now),
            TerminalOutputCoalescingDecision::Pending
        );
        assert_eq!(coalescer.pending_bytes, 6);
        assert_eq!(coalescer.pending.len(), 1);
        assert_eq!(coalescer.lifetime_stats.max_pending_bytes, 6);
        assert_eq!(coalescer.lifetime_stats.max_pending_chunks, 1);
    }

    #[test]
    fn coalescer_flushes_when_byte_threshold_is_reached() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));
        let _ = coalescer.push_bytes(Bytes::from_static(b"first"), now);

        let decision = coalescer.push_bytes(
            Bytes::from(vec![b'x'; TERMINAL_OUTPUT_COALESCE_MAX_BYTES]),
            now,
        );

        assert_eq!(
            decision,
            TerminalOutputCoalescingDecision::FlushPending(
                TerminalOutputFlushReason::ByteThreshold
            )
        );
        let flushed = coalescer
            .flush_pending(TerminalOutputFlushReason::ByteThreshold, now)
            .unwrap();
        assert_eq!(flushed.len(), TERMINAL_OUTPUT_COALESCE_MAX_BYTES);
        assert_eq!(coalescer.pending_bytes, 0);
        assert_eq!(coalescer.pending.len(), 0);
        assert_eq!(coalescer.lifetime_stats.byte_flushes, 1);
        assert_eq!(coalescer.lifetime_stats.coalesced_sent_frames, 1);
    }

    #[test]
    fn coalescer_deadline_returns_to_idle_when_nothing_pending() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));
        let _ = coalescer.push_bytes(Bytes::from_static(b"first"), now);

        assert_eq!(coalescer.handle_deadline(), None);
        assert_eq!(coalescer.deadline(), None);
    }

    #[test]
    fn coalescer_deadline_flushes_pending_and_rearms_window() {
        let now = Instant::now();
        let flush_at = now + terminal_output_coalesce_window(None);
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));
        let _ = coalescer.push_bytes(Bytes::from_static(b"first"), now);
        let _ = coalescer.push_bytes(Bytes::from_static(b"second"), now);

        assert_eq!(
            coalescer.handle_deadline(),
            Some(TerminalOutputFlushReason::Timer)
        );
        assert_eq!(
            coalescer.flush_pending(TerminalOutputFlushReason::Timer, flush_at),
            Some(Bytes::from_static(b"second"))
        );
        assert_eq!(
            coalescer.deadline(),
            Some(flush_at + terminal_output_coalesce_window(None))
        );
        assert_eq!(coalescer.lifetime_stats.timer_flushes, 1);
    }

    #[test]
    fn coalescer_keeps_spaced_output_immediate() {
        let now = Instant::now();
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));

        assert_eq!(
            coalescer.push_bytes(Bytes::from_static(b"one"), now),
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"one"))
        );
        assert_eq!(coalescer.handle_deadline(), None);
        assert_eq!(
            coalescer.push_bytes(
                Bytes::from_static(b"two"),
                now + terminal_output_coalesce_window(None) + Duration::from_millis(1),
            ),
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"two"))
        );
        assert_eq!(coalescer.handle_deadline(), None);
        assert_eq!(
            coalescer.push_bytes(
                Bytes::from_static(b"three"),
                now + terminal_output_coalesce_window(None) * 2 + Duration::from_millis(2),
            ),
            TerminalOutputCoalescingDecision::SendNow(Bytes::from_static(b"three"))
        );

        assert_eq!(coalescer.lifetime_stats.source_frames, 3);
        assert_eq!(coalescer.lifetime_stats.sent_frames, 3);
        assert_eq!(coalescer.lifetime_stats.immediate_frames, 3);
        assert_eq!(coalescer.lifetime_stats.coalesced_source_frames, 0);
        assert_eq!(coalescer.lifetime_stats.coalesced_sent_frames, 0);
        assert_eq!(coalescer.lifetime_stats.merged_flushes, 0);
    }

    #[test]
    fn coalescer_keeps_continuous_stream_in_active_window() {
        let now = Instant::now();
        let first_flush = now + terminal_output_coalesce_window(None);
        let second_flush = first_flush + terminal_output_coalesce_window(None);
        let mut coalescer = TerminalOutputCoalescer::new(terminal_output_coalesce_window(None));

        let _ = coalescer.push_bytes(Bytes::from_static(b"one"), now);
        let _ = coalescer.push_bytes(Bytes::from_static(b"two"), now + Duration::from_millis(1));
        let _ = coalescer.push_bytes(Bytes::from_static(b"three"), now + Duration::from_millis(2));
        assert_eq!(
            coalescer.handle_deadline(),
            Some(TerminalOutputFlushReason::Timer)
        );
        assert_eq!(
            coalescer.flush_pending(TerminalOutputFlushReason::Timer, first_flush),
            Some(Bytes::from_static(b"twothree"))
        );

        let _ = coalescer.push_bytes(
            Bytes::from_static(b"four"),
            first_flush + Duration::from_millis(1),
        );
        let _ = coalescer.push_bytes(
            Bytes::from_static(b"five"),
            first_flush + Duration::from_millis(2),
        );
        assert_eq!(
            coalescer.handle_deadline(),
            Some(TerminalOutputFlushReason::Timer)
        );
        assert_eq!(
            coalescer.flush_pending(TerminalOutputFlushReason::Timer, second_flush),
            Some(Bytes::from_static(b"fourfive"))
        );

        assert_eq!(coalescer.lifetime_stats.source_frames, 5);
        assert_eq!(coalescer.lifetime_stats.sent_frames, 3);
        assert_eq!(coalescer.lifetime_stats.immediate_frames, 1);
        assert_eq!(coalescer.lifetime_stats.coalesced_source_frames, 4);
        assert_eq!(coalescer.lifetime_stats.coalesced_sent_frames, 2);
        assert_eq!(coalescer.lifetime_stats.merged_flushes, 2);
    }

    #[test]
    fn draining_terminal_output_pending_preserves_order() {
        let mut pending = vec![
            Bytes::from_static(b"abc"),
            Bytes::from_static(b"def"),
            Bytes::from_static(b"ghi"),
        ];
        let mut pending_bytes = 9;

        assert_eq!(
            drain_terminal_output_pending(&mut pending, &mut pending_bytes),
            Some(Bytes::from_static(b"abcdefghi"))
        );
        assert!(pending.is_empty());
        assert_eq!(pending_bytes, 0);
    }

    #[test]
    fn coalescing_stats_derived_values_are_zero_safe() {
        let stats = TerminalOutputCoalescingStats::default();

        assert_eq!(stats.frames_saved(), 0);
        assert_eq!(stats.coalescing_ratio(), 0.0);
        assert_eq!(stats.avg_source_frame_bytes(), 0.0);
        assert_eq!(stats.avg_sent_frame_bytes(), 0.0);
        assert_eq!(stats.avg_flush_latency_us(), 0.0);
    }

    #[test]
    fn coalescing_stats_track_saved_frames_and_latency() {
        let mut stats = TerminalOutputCoalescingStats::default();

        stats.record_source(4);
        stats.record_source(6);
        stats.record_source(10);
        stats.record_immediate_send(4);
        stats.record_flush_reason(TerminalOutputFlushReason::Timer);
        stats.record_coalesced_send(2, 16, Duration::from_micros(800));

        assert_eq!(stats.sent_frames, 2);
        assert_eq!(stats.frames_saved(), 1);
        assert_eq!(stats.coalesced_source_frames, 2);
        assert_eq!(stats.merged_flushes, 1);
        assert_eq!(
            stats.sent_frames,
            stats.immediate_frames + stats.coalesced_sent_frames
        );
        assert_eq!(
            stats.source_frames,
            stats.immediate_frames + stats.coalesced_source_frames
        );
        assert_eq!(stats.coalescing_ratio(), 1.5);
        assert_eq!(stats.avg_flush_latency_us(), 800.0);
        assert_eq!(stats.avg_source_frame_bytes(), 20.0 / 3.0);
        assert_eq!(stats.avg_sent_frame_bytes(), 10.0);
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

    fn test_terminal_writer() -> (TerminalWriter, mpsc::Receiver<ClientMessage>) {
        let (tx, rx) = mpsc::channel();
        (
            TerminalWriter {
                tx,
                queued_input_bytes: Arc::new(AtomicUsize::new(0)),
            },
            rx,
        )
    }

    #[test]
    fn chunks_terminal_input_below_daemon_limit() {
        let (tx, rx) = test_terminal_writer();
        let data = vec![b'x'; MAX_TERMINAL_INPUT_CHUNK_BYTES * 2 + 17];

        let stats = send_terminal_input_chunks(&tx, &data).unwrap();

        assert_eq!(
            stats,
            TerminalInputChunkStats {
                chunks: 3,
                max_chunk_bytes: MAX_TERMINAL_INPUT_CHUNK_BYTES
            }
        );
        let chunks: Vec<Vec<u8>> = rx
            .try_iter()
            .map(|message| match message {
                ClientMessage::Input { data } => data,
                other => panic!("unexpected terminal message: {other:?}"),
            })
            .collect();
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].len(), MAX_TERMINAL_INPUT_CHUNK_BYTES);
        assert_eq!(chunks[1].len(), MAX_TERMINAL_INPUT_CHUNK_BYTES);
        assert_eq!(chunks[2].len(), 17);
        assert_eq!(chunks.concat(), data);
    }

    #[test]
    fn forwards_empty_terminal_input_as_one_message() {
        let (tx, rx) = test_terminal_writer();

        let stats = send_terminal_input_chunks(&tx, &[]).unwrap();

        assert_eq!(
            stats,
            TerminalInputChunkStats {
                chunks: 1,
                max_chunk_bytes: 0
            }
        );
        assert_eq!(
            rx.recv().unwrap(),
            ClientMessage::Input { data: Vec::new() }
        );
    }

    fn test_shared_terminal_session() -> (SharedTerminalSession, mpsc::Receiver<ClientMessage>) {
        let (write_tx, rx) = test_terminal_writer();
        let (output_tx, _) = tokio::sync::broadcast::channel(8);
        (
            SharedTerminalSession {
                write_tx,
                output_tx,
                client_count: Arc::new(AtomicUsize::new(1)),
                connection_closed: Arc::new(ConnectionClosed::default()),
            },
            rx,
        )
    }

    #[test]
    fn releasing_last_client_detaches_and_records_draining_connection() {
        let (session, rx) = test_shared_terminal_session();
        let sessions = Mutex::new(TerminalSessions::default());
        sessions
            .lock()
            .unwrap()
            .active
            .insert("term-1".to_string(), session.clone());

        release_terminal_session(&sessions, "term-1", &session);

        let map = sessions.lock().unwrap();
        assert!(map.active.is_empty());
        assert!(Arc::ptr_eq(
            map.draining.get("term-1").unwrap(),
            &session.connection_closed
        ));
        assert_eq!(rx.try_iter().count(), 1);
    }

    #[test]
    fn releasing_non_last_client_keeps_session_attached() {
        let (session, rx) = test_shared_terminal_session();
        session.client_count.store(2, Ordering::SeqCst);
        let sessions = Mutex::new(TerminalSessions::default());
        sessions
            .lock()
            .unwrap()
            .active
            .insert("term-1".to_string(), session.clone());

        release_terminal_session(&sessions, "term-1", &session);

        let map = sessions.lock().unwrap();
        assert!(map.active.contains_key("term-1"));
        assert!(map.draining.is_empty());
        assert_eq!(rx.try_iter().count(), 0);
    }

    #[test]
    fn does_not_record_already_closed_connection_as_draining() {
        let (session, _rx) = test_shared_terminal_session();
        session.connection_closed.mark_closed();
        let sessions = Mutex::new(TerminalSessions::default());
        sessions
            .lock()
            .unwrap()
            .active
            .insert("term-1".to_string(), session.clone());

        release_terminal_session(&sessions, "term-1", &session);

        let map = sessions.lock().unwrap();
        assert!(map.active.is_empty());
        assert!(map.draining.is_empty());
    }

    #[test]
    fn attach_gate_release_removes_only_matching_gate_and_wakes_waiters() {
        let sessions = Mutex::new(TerminalSessions::default());
        let gate = Arc::new(ConnectionClosed::default());
        let other = Arc::new(ConnectionClosed::default());
        sessions
            .lock()
            .unwrap()
            .attaching
            .insert("term-1".to_string(), gate.clone());

        // Releasing a non-matching gate signals it but leaves the entry.
        release_attach_gate(&sessions, "term-1", &other);
        assert!(other.is_closed());
        assert!(sessions.lock().unwrap().attaching.contains_key("term-1"));

        release_attach_gate(&sessions, "term-1", &gate);
        assert!(gate.is_closed());
        assert!(sessions.lock().unwrap().attaching.is_empty());
    }

    #[test]
    fn connection_closed_wait_times_out_while_open() {
        let connection = ConnectionClosed::default();
        assert!(!connection.wait_closed(Duration::from_millis(10)));
    }

    #[test]
    fn connection_closed_wait_wakes_on_mark_closed() {
        let connection = Arc::new(ConnectionClosed::default());
        let waiter = connection.clone();
        let handle = thread::spawn(move || waiter.wait_closed(Duration::from_secs(5)));
        thread::sleep(Duration::from_millis(20));
        connection.mark_closed();
        assert!(handle.join().unwrap());
        assert!(connection.is_closed());
    }

    /// The daemon unregisters a client on `Detach` but keeps the socket open,
    /// so the bridge must shut the connection down itself or the draining
    /// marker would only ever resolve by timeout (a 2s stall on reattach).
    #[cfg(unix)]
    #[test]
    fn detach_tears_down_attach_connection_without_daemon_close() {
        let dir = std::env::temp_dir();
        let dir = if dir.as_os_str().len() <= 40 {
            dir
        } else {
            PathBuf::from("/tmp")
        };
        let socket_path = dir.join(format!("herdr-web-detach-test-{}.sock", std::process::id()));
        let _ = std::fs::remove_file(&socket_path);
        let listener = std::os::unix::net::UnixListener::bind(&socket_path).unwrap();

        let (daemon_tx, daemon_rx) = mpsc::channel();
        let daemon = thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            sock.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let hello: ClientMessage = protocol::read_message(&mut sock, MAX_FRAME_SIZE).unwrap();
            assert!(matches!(hello, ClientMessage::Hello { .. }));
            protocol::write_message(
                &mut sock,
                &ServerMessage::Welcome {
                    version: PROTOCOL_VERSION,
                    encoding: RenderEncoding::TerminalAnsi,
                    error: None,
                },
            )
            .unwrap();
            let attach: ClientMessage = protocol::read_message(&mut sock, MAX_FRAME_SIZE).unwrap();
            assert!(matches!(attach, ClientMessage::AttachTerminal { .. }));
            let detach: ClientMessage = protocol::read_message(&mut sock, MAX_FRAME_SIZE).unwrap();
            assert!(matches!(detach, ClientMessage::Detach));
            // Like the real daemon: keep the socket open after Detach and
            // just keep reading. Only the bridge's shutdown ends this read.
            let bridge_shut_down =
                protocol::read_message::<_, ClientMessage>(&mut sock, MAX_FRAME_SIZE).is_err();
            daemon_tx.send(bridge_shut_down).unwrap();
        });

        let (output_tx, _) = tokio::sync::broadcast::channel(8);
        let attach = open_terminal_attach(
            socket_path.clone(),
            "term-test".to_string(),
            80,
            24,
            false,
            PROTOCOL_VERSION,
            output_tx,
        )
        .unwrap();

        attach.write_tx.send(ClientMessage::Detach).unwrap();

        // The bridge's own post-Detach shutdown must resolve the close signal
        // quickly; before the fix this only resolved by drain timeout.
        assert!(attach.connection_closed.wait_closed(Duration::from_secs(2)));
        assert!(daemon_rx.recv_timeout(Duration::from_secs(2)).unwrap());
        daemon.join().unwrap();
        let _ = std::fs::remove_file(&socket_path);
    }

    #[test]
    fn rejects_oversized_terminal_input_frame_atomically() {
        let (tx, rx) = test_terminal_writer();
        let data = vec![b'x'; MAX_QUEUED_TERMINAL_INPUT_BYTES + 1];

        // The frame exceeds the whole budget: no chunk may reach the pty.
        assert!(send_terminal_input_chunks(&tx, &data).is_err());
        assert_eq!(rx.try_iter().count(), 0);
    }

    #[test]
    fn rejects_terminal_input_frame_exceeding_remaining_budget_atomically() {
        let (tx, rx) = test_terminal_writer();
        let first = vec![b'x'; MAX_QUEUED_TERMINAL_INPUT_BYTES - 1024];
        let second = vec![b'y'; 4096];

        // Nothing drains the queue, so the second frame must be refused
        // whole even though part of it would still fit.
        assert!(send_terminal_input_chunks(&tx, &first).is_ok());
        assert!(send_terminal_input_chunks(&tx, &second).is_err());
        let queued: usize = rx
            .try_iter()
            .map(|message| match message {
                ClientMessage::Input { data } => data.len(),
                other => panic!("unexpected terminal message: {other:?}"),
            })
            .sum();
        assert_eq!(queued, first.len());
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
        assert!(!ALLOWED_COMMANDS.contains(&"pane.send_input"));
        assert!(ALLOWED_COMMANDS.contains(&"workspace.move_block"));
        // pane.split is intentionally allowed so the web client can create splits.
        assert!(ALLOWED_COMMANDS.contains(&"pane.split"));
        assert!(ALLOWED_COMMANDS.contains(&"pane.focus_direction"));
        assert!(ALLOWED_COMMANDS.contains(&"pane.move"));
        assert!(!ALLOWED_COMMANDS.contains(&"agent.start"));
    }

    #[test]
    fn activity_subscriptions_include_only_deduped_pane_activity() {
        let subscriptions = activity_subscriptions(&[
            "pane-2".to_string(),
            "pane-1".to_string(),
            "pane-2".to_string(),
        ]);

        let pane_subscriptions = subscriptions
            .iter()
            .filter_map(|subscription| match subscription {
                Subscription::PaneAgentStatusChanged {
                    pane_id,
                    agent_status,
                } => {
                    assert_eq!(*agent_status, None);
                    Some(pane_id.as_str())
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(pane_subscriptions, vec!["pane-1", "pane-2"]);
        assert_eq!(subscriptions.len(), pane_subscriptions.len());
    }

    #[test]
    fn activity_resubscribe_needed_compares_sorted_pane_sets() {
        let current = vec!["pane-1".to_string(), "pane-2".to_string()];

        assert!(!activity_resubscribe_needed(
            &current,
            &[test_pane("pane-2"), test_pane("pane-1")]
        ));
        assert!(activity_resubscribe_needed(
            &current,
            &[test_pane("pane-1"), test_pane("pane-3")]
        ));
        assert!(activity_resubscribe_needed(&current, &[]));
    }

    #[test]
    fn web_snapshot_adapter_preserves_web_shape_and_clear_name_flags() {
        let snapshot =
            web_snapshot_from_session_snapshot(test_session_snapshot(), Some("pane-2".to_string()));

        assert_eq!(snapshot.selected_pane_id.as_deref(), Some("pane-2"));
        assert_eq!(snapshot.workspaces.len(), 2);
        assert_eq!(snapshot.tabs.len(), 3);
        assert_eq!(snapshot.panes.len(), 4);
        assert_eq!(snapshot.layouts.len(), 3);

        let default_workspace = snapshot
            .workspaces
            .iter()
            .find(|workspace| workspace.info.workspace_id == "workspace-1")
            .unwrap();
        assert!(!default_workspace.can_clear_name);

        let renamed_workspace = snapshot
            .workspaces
            .iter()
            .find(|workspace| workspace.info.workspace_id == "workspace-2")
            .unwrap();
        assert!(renamed_workspace.can_clear_name);

        let default_tab = snapshot
            .tabs
            .iter()
            .find(|tab| tab.info.tab_id == "tab-1")
            .unwrap();
        assert!(!default_tab.can_clear_name);

        let renamed_tab = snapshot
            .tabs
            .iter()
            .find(|tab| tab.info.tab_id == "tab-2")
            .unwrap();
        assert!(renamed_tab.can_clear_name);

        let non_focused_split_layout = snapshot
            .layouts
            .iter()
            .find(|layout| layout.tab_id == "tab-2")
            .unwrap();
        assert_eq!(non_focused_split_layout.panes.len(), 2);
        assert_eq!(non_focused_split_layout.splits.len(), 1);
    }

    #[test]
    fn web_snapshot_adapter_falls_back_to_focused_pane_for_stale_selection() {
        let snapshot = web_snapshot_from_session_snapshot(
            test_session_snapshot(),
            Some("missing".to_string()),
        );

        assert_eq!(snapshot.selected_pane_id.as_deref(), Some("pane-1"));
    }

    #[test]
    fn web_snapshot_adapter_uses_focused_pane_before_shared_selection_exists() {
        let snapshot = web_snapshot_from_session_snapshot(test_session_snapshot(), None);

        assert_eq!(snapshot.selected_pane_id.as_deref(), Some("pane-1"));
    }

    #[test]
    fn structural_subscriptions_are_separate_from_activity_subscriptions() {
        let subscriptions = structural_event_subscriptions();

        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::WorkspaceCreated {})));
        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::PaneMoved {})));
        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::LayoutUpdated {})));
        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::WorkspaceMoved {})));
        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::WorkspaceReordered {})));
        assert!(subscriptions
            .iter()
            .any(|subscription| matches!(subscription, Subscription::TabMoved {})));
        assert!(!subscriptions.iter().any(|subscription| matches!(
            subscription,
            Subscription::PaneAgentStatusChanged { .. }
        )));
    }

    #[test]
    fn activity_message_decodes_and_serializes_explicit_nulls() {
        let message = activity_message_from_subscription_value(serde_json::json!({
            "event": "pane.agent_status_changed",
            "data": {
                "pane_id": "pane-1",
                "workspace_id": "workspace-1",
                "agent_status": "working",
                "agent": "codex",
                "state_labels": {}
            }
        }))
        .unwrap();

        assert_eq!(
            message,
            ActivityMessage::PaneAgentStatusChanged {
                pane_id: "pane-1".to_string(),
                workspace_id: "workspace-1".to_string(),
                agent_status: AgentStatus::Working,
                agent: Some("codex".to_string()),
                title: None,
                display_agent: None,
                state_labels: HashMap::new(),
            }
        );

        let json = serde_json::to_value(&message).unwrap();
        assert_eq!(json["title"], serde_json::Value::Null);
        assert_eq!(json["display_agent"], serde_json::Value::Null);
        assert_eq!(json["state_labels"], serde_json::json!({}));
        assert!(json.get("custom_status").is_none());
    }

    #[test]
    fn structural_event_values_trigger_activity_resubscribe() {
        assert!(is_structural_event_value(&serde_json::json!({
            "event": "pane.created",
            "data": { "pane_id": "pane-1" }
        })));
        assert!(!is_structural_event_value(&serde_json::json!({
            "event": "pane.agent_status_changed",
            "data": { "pane_id": "pane-1" }
        })));
    }

    fn test_session_snapshot() -> SessionSnapshot {
        SessionSnapshot {
            version: "0.8.0".to_string(),
            protocol: PROTOCOL_VERSION,
            focused_workspace_id: Some("workspace-1".to_string()),
            focused_tab_id: Some("tab-1".to_string()),
            focused_pane_id: Some("pane-1".to_string()),
            workspaces: vec![
                test_workspace("workspace-1", 1, "repo", true, "tab-1", 3, 2),
                test_workspace("workspace-2", 2, "Custom", false, "tab-3", 1, 1),
            ],
            tabs: vec![
                test_tab("tab-1", "workspace-1", 1, "1", true, 1),
                test_tab("tab-2", "workspace-1", 2, "Review", false, 2),
                test_tab("tab-3", "workspace-2", 1, "1", false, 1),
            ],
            panes: vec![
                test_pane_in("pane-1", "workspace-1", "tab-1", "/tmp/repo", true),
                test_pane_in("pane-2", "workspace-1", "tab-2", "/tmp/repo", false),
                test_pane_in("pane-3", "workspace-2", "tab-3", "/tmp/space", false),
                test_pane_in("pane-4", "workspace-1", "tab-2", "/tmp/repo", false),
            ],
            layouts: vec![
                test_layout("workspace-1", "tab-1", &["pane-1"]),
                test_layout("workspace-1", "tab-2", &["pane-2", "pane-4"]),
                test_layout("workspace-2", "tab-3", &["pane-3"]),
            ],
            agents: Vec::new(),
        }
    }

    fn test_workspace(
        workspace_id: &str,
        number: usize,
        label: &str,
        focused: bool,
        active_tab_id: &str,
        pane_count: usize,
        tab_count: usize,
    ) -> WorkspaceInfo {
        WorkspaceInfo {
            workspace_id: workspace_id.to_string(),
            number,
            label: label.to_string(),
            focused,
            pane_count,
            tab_count,
            active_tab_id: active_tab_id.to_string(),
            agent_status: AgentStatus::Idle,
            tokens: HashMap::new(),
            worktree: None,
        }
    }

    fn test_tab(
        tab_id: &str,
        workspace_id: &str,
        number: usize,
        label: &str,
        focused: bool,
        pane_count: usize,
    ) -> TabInfo {
        TabInfo {
            tab_id: tab_id.to_string(),
            workspace_id: workspace_id.to_string(),
            number,
            label: label.to_string(),
            focused,
            pane_count,
            agent_status: AgentStatus::Idle,
        }
    }

    fn test_layout(workspace_id: &str, tab_id: &str, pane_ids: &[&str]) -> PaneLayoutSnapshot {
        let area = herdr_compat::api::schema::PaneLayoutRect {
            x: 0,
            y: 0,
            width: 120,
            height: 40,
        };
        PaneLayoutSnapshot {
            workspace_id: workspace_id.to_string(),
            tab_id: tab_id.to_string(),
            zoomed: false,
            area,
            focused_pane_id: pane_ids.first().unwrap_or(&"").to_string(),
            panes: pane_ids
                .iter()
                .enumerate()
                .map(
                    |(index, pane_id)| herdr_compat::api::schema::PaneLayoutPane {
                        pane_id: (*pane_id).to_string(),
                        focused: index == 0,
                        rect: herdr_compat::api::schema::PaneLayoutRect {
                            x: (index as u16) * 60,
                            y: 0,
                            width: 60,
                            height: 40,
                        },
                    },
                )
                .collect(),
            splits: if pane_ids.len() > 1 {
                vec![herdr_compat::api::schema::PaneLayoutSplit {
                    id: "root".to_string(),
                    direction: SplitDirection::Right,
                    ratio: 0.5,
                    rect: area,
                }]
            } else {
                Vec::new()
            },
        }
    }

    fn test_pane(pane_id: &str) -> PaneInfo {
        test_pane_in(pane_id, "workspace-1", "tab-1", "/tmp/repo", false)
    }

    fn test_pane_in(
        pane_id: &str,
        workspace_id: &str,
        tab_id: &str,
        cwd: &str,
        focused: bool,
    ) -> PaneInfo {
        PaneInfo {
            pane_id: pane_id.to_string(),
            terminal_id: format!("terminal-{pane_id}"),
            workspace_id: workspace_id.to_string(),
            tab_id: tab_id.to_string(),
            focused,
            cwd: Some(cwd.to_string()),
            foreground_cwd: Some(cwd.to_string()),
            label: None,
            agent: None,
            title: None,
            terminal_title: None,
            terminal_title_stripped: None,
            display_agent: None,
            agent_status: AgentStatus::Idle,
            state_labels: HashMap::new(),
            tokens: HashMap::new(),
            agent_session: None,
            scroll: None,
            revision: 1,
        }
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
            public_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
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
            public_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
        };
        assert!(host_authority_allowed("herdr-host.local:4000", &policy));
        assert!(host_authority_allowed("HERDR-HOST.LOCAL:4000", &policy));
        assert!(!host_authority_allowed("herdr-host.local:8787", &policy));
        assert!(!host_authority_allowed("evil.example:4000", &policy));
    }

    #[test]
    fn public_origin_allows_only_its_reverse_proxy_authority() {
        let mut policy = test_policy("100.92.238.117", 4000);
        policy.public_origins = vec!["https://server60.greyhound-chinstrap.ts.net".to_string()];

        assert!(request_allowed(
            &origin_headers(
                "server60.greyhound-chinstrap.ts.net",
                Some("https://server60.greyhound-chinstrap.ts.net")
            ),
            &policy
        ));
        assert!(request_allowed(
            &origin_headers(
                "100.92.238.117:4000",
                Some("https://server60.greyhound-chinstrap.ts.net")
            ),
            &policy
        ));
        assert!(!request_allowed(
            &origin_headers(
                "server60.greyhound-chinstrap.ts.net.evil.example",
                Some("https://server60.greyhound-chinstrap.ts.net")
            ),
            &policy
        ));
        assert!(!request_allowed(
            &origin_headers(
                "server60.greyhound-chinstrap.ts.net",
                Some("https://evil.example")
            ),
            &policy
        ));
    }

    #[test]
    fn cors_headers_reflect_only_allowed_origins() {
        let policy = RequestPolicy {
            bind_host: "0.0.0.0".to_string(),
            bind_port: 4000,
            allowed_hosts: Vec::new(),
            allowed_origins: vec!["http://localhost".to_string()],
            public_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
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
    fn connect_origins_expand_to_http_and_websocket_csp_sources() {
        assert_eq!(
            connect_sources_for_origin("HTTP://SRV:8787").unwrap(),
            vec!["http://srv:8787".to_string(), "ws://srv:8787".to_string()]
        );
        assert_eq!(
            connect_sources_for_origin("https://srv.example:9443").unwrap(),
            vec![
                "https://srv.example:9443".to_string(),
                "wss://srv.example:9443".to_string()
            ]
        );
        assert!(connect_sources_for_origin("ws://srv:8787").is_err());
        assert!(connect_sources_for_origin("http://srv:8787/path").is_err());
    }

    #[test]
    fn content_security_policy_includes_configured_connect_sources() {
        let mut policy = test_policy("0.0.0.0", 8787);
        policy.allowed_connect_sources = connect_sources_for_origin("http://srv:8787").unwrap();

        let header = content_security_policy(&policy);
        let value = header.to_str().unwrap();

        assert!(value.contains("connect-src 'self' data: http://srv:8787 ws://srv:8787;"));
        assert!(value.contains("img-src 'self' data: blob:;"));
        assert!(value.contains("frame-ancestors 'none'"));
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
    fn validates_atomic_workspace_reorder_commands() {
        let valid: Request = serde_json::from_value(serde_json::json!({
            "id": "test",
            "method": "workspace.move_block",
            "params": {
                "workspace_ids": ["w1", "w1-child"],
                "before_workspace_id": "w3"
            }
        }))
        .unwrap();
        assert!(validate_web_command(&valid.method).is_ok());

        for params in [
            serde_json::json!({ "workspace_ids": [] }),
            serde_json::json!({ "workspace_ids": ["w1", "w1"] }),
            serde_json::json!({ "workspace_ids": [""] }),
            serde_json::json!({
                "workspace_ids": ["w1"],
                "before_workspace_id": "w1"
            }),
        ] {
            let invalid: Request = serde_json::from_value(serde_json::json!({
                "id": "test",
                "method": "workspace.move_block",
                "params": params
            }))
            .unwrap();
            assert!(validate_web_command(&invalid.method).is_err());
        }
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
    fn clear_name_rename_substitution_uses_default_labels() {
        let panes = [test_pane_in(
            "pane-1",
            "workspace-1",
            "tab-1",
            "/tmp/herdr",
            true,
        )];
        let tabs = [test_tab("tab-2", "workspace-1", 2, "Review", false, 1)];

        let mut workspace_method =
            Method::WorkspaceRename(herdr_compat::api::schema::WorkspaceRenameParams {
                workspace_id: "workspace-1".to_string(),
                label: None,
            });
        fill_clear_rename_labels_with(
            &mut workspace_method,
            |workspace_id| {
                Ok(default_workspace_label_from_panes(
                    workspace_id,
                    panes.iter(),
                ))
            },
            |tab_id| default_tab_label_from_tabs(tab_id, tabs.iter()),
        )
        .unwrap();
        let Method::WorkspaceRename(workspace_params) = workspace_method else {
            panic!("expected workspace rename");
        };
        assert_eq!(workspace_params.label.as_deref(), Some("herdr"));

        let mut tab_method = Method::TabRename(herdr_compat::api::schema::TabRenameParams {
            tab_id: "tab-2".to_string(),
            label: None,
        });
        fill_clear_rename_labels_with(
            &mut tab_method,
            |workspace_id| {
                Ok(default_workspace_label_from_panes(
                    workspace_id,
                    panes.iter(),
                ))
            },
            |tab_id| default_tab_label_from_tabs(tab_id, tabs.iter()),
        )
        .unwrap();
        let Method::TabRename(tab_params) = tab_method else {
            panic!("expected tab rename");
        };
        assert_eq!(tab_params.label.as_deref(), Some("2"));

        let mut named_method = Method::TabRename(herdr_compat::api::schema::TabRenameParams {
            tab_id: "tab-2".to_string(),
            label: Some("Keep".to_string()),
        });
        fill_clear_rename_labels_with(
            &mut named_method,
            |_| panic!("workspace default should not be requested"),
            |_| panic!("tab default should not be requested"),
        )
        .unwrap();
        let Method::TabRename(named_params) = named_method else {
            panic!("expected tab rename");
        };
        assert_eq!(named_params.label.as_deref(), Some("Keep"));
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
    fn daemon_status_accepts_minimum_version_and_exact_protocol() {
        assert_eq!(
            validated_daemon_protocol(runtime_status("0.8.0", PROTOCOL_VERSION)).unwrap(),
            PROTOCOL_VERSION
        );
        assert_eq!(
            validated_daemon_protocol(runtime_status("1.0.0", PROTOCOL_VERSION)).unwrap(),
            PROTOCOL_VERSION
        );
    }

    #[test]
    fn daemon_status_accepts_herdr_0_8_protocol_19() {
        assert_eq!(
            validated_daemon_protocol(runtime_status("0.8.0", 19)).unwrap(),
            19
        );
    }

    #[test]
    fn daemon_status_rejects_missing_or_invalid_version() {
        let missing = herdr_compat::api::RuntimeStatus {
            version: None,
            protocol: Some(PROTOCOL_VERSION),
            capabilities: None,
        };
        assert!(validated_daemon_protocol(missing)
            .unwrap_err()
            .to_string()
            .contains("did not include a version"));

        let invalid = runtime_status("not-a-version", PROTOCOL_VERSION);
        assert!(validated_daemon_protocol(invalid)
            .unwrap_err()
            .to_string()
            .contains("invalid version"));

        for version in [
            "0.8.0-preview",
            "0.8.0.1",
            "0.8.0+",
            "0.8.0+bad_meta",
            "0.08.0",
        ] {
            let error = validated_daemon_protocol(runtime_status(version, PROTOCOL_VERSION))
                .unwrap_err()
                .to_string();
            assert!(
                error.contains("invalid version"),
                "{version:?} should be rejected as invalid: {error}"
            );
        }
    }

    #[test]
    fn daemon_status_accepts_version_prefix_and_build_metadata() {
        for version in ["v0.8.0", "0.8.0+linux-x86-64"] {
            assert_eq!(
                validated_daemon_protocol(runtime_status(version, PROTOCOL_VERSION)).unwrap(),
                PROTOCOL_VERSION
            );
        }
    }

    #[test]
    fn daemon_status_rejects_version_before_0_8_0() {
        let error = validated_daemon_protocol(runtime_status("0.7.5", PROTOCOL_VERSION))
            .unwrap_err()
            .to_string();
        assert!(error.contains("too old"));
        assert!(error.contains(MIN_HERDR_VERSION_LABEL));
    }

    #[test]
    fn daemon_status_rejects_missing_protocol() {
        let missing = herdr_compat::api::RuntimeStatus {
            version: Some(MIN_HERDR_VERSION_LABEL.to_string()),
            protocol: None,
            capabilities: None,
        };
        assert!(validated_daemon_protocol(missing)
            .unwrap_err()
            .to_string()
            .contains("did not include a protocol"));
    }

    #[test]
    fn daemon_status_rejects_any_other_protocol() {
        let older = validated_daemon_protocol(runtime_status("0.8.0", PROTOCOL_VERSION - 1))
            .unwrap_err()
            .to_string();
        assert!(older.contains("incompatible"));
        assert!(older.contains(&PROTOCOL_VERSION.to_string()));

        assert!(
            validated_daemon_protocol(runtime_status("0.8.0", PROTOCOL_VERSION + 1))
                .unwrap_err()
                .to_string()
                .contains("incompatible")
        );
    }

    #[test]
    fn validates_launcher_preset_titles() {
        assert_eq!(
            resolve_launch_title(Some("  Custom  "), "Fallback").unwrap(),
            "Custom"
        );
        assert_eq!(
            resolve_launch_title(Some("   "), "Fallback").unwrap(),
            "Fallback"
        );
        assert!(resolve_launch_title(Some("bad\0title"), "Fallback").is_err());
        assert!(resolve_launch_title(Some(&"x".repeat(MAX_LABEL_BYTES + 1)), "Fallback").is_err());
    }

    #[test]
    fn malformed_launcher_preset_launch_payloads_are_invalid_preset_launch() {
        let err = parse_launcher_preset_launch_request(
            br#"{"preset_id":"remote","target":{"mode":"unknown"}}"#,
        )
        .unwrap_err();
        assert_eq!(err.status, StatusCode::BAD_REQUEST);
        assert_eq!(err.code, "invalid_preset_launch");
    }

    #[test]
    fn managed_agent_launch_calls_create_rename_then_start() {
        let pane = launcher_test_pane("pane-new", "workspace-1", "tab-new");
        let tab = launcher_test_tab("tab-new", "workspace-1");
        let name = managed_agent_name(ManagedAgentKind::Codex, "pane-new");
        let mut pending = launcher_test_agent("pane-new", "workspace-1", "tab-new");
        pending.name = Some(name.clone());
        pending.agent = None;
        let mut ready = pending.clone();
        ready.agent = Some("codex".into());
        ready.launch_pending = false;
        ready.interactive_ready = true;
        let mut api = MockLauncherApi::new([
            Ok(ResponseResult::TabCreated {
                tab,
                root_pane: pane,
            }),
            Ok(ResponseResult::Ok {}),
            Ok(ResponseResult::AgentStarted {
                agent: pending,
                argv: vec!["codex".into()],
            }),
            Ok(ResponseResult::AgentInfo { agent: ready }),
        ]);
        let preset = launcher_test_managed_preset(ManagedAgentKind::Codex);

        let response = launch_preset_with(
            &mut api,
            &preset,
            "Review",
            LauncherPresetLaunchTarget::Tab {
                workspace_id: "workspace-1".into(),
            },
        )
        .unwrap();

        assert_eq!(response.pane_id, "pane-new");
        assert!(matches!(api.requests[0], Method::TabCreate(_)));
        assert!(matches!(api.requests[1], Method::PaneRename(_)));
        let Method::AgentStart(params) = &api.requests[2] else {
            panic!("expected agent.start");
        };
        assert_eq!(params.kind, "codex");
        assert_eq!(params.pane_id, "pane-new");
        assert!(params.args.is_empty());
        assert_eq!(params.timeout_ms, None);
        assert!(valid_managed_agent_name(&params.name));
        let Method::AgentGet(params) = &api.requests[3] else {
            panic!("expected readiness poll");
        };
        assert_eq!(params.target, name);
        assert_eq!(api.requests.len(), 4);
        assert_eq!(api.waits, vec![MANAGED_AGENT_SHELL_SETTLE_DELAY]);
    }

    #[test]
    fn managed_agent_launch_waits_for_new_shell_before_retrying_start() {
        let pane = launcher_test_pane("pane-new", "workspace-1", "tab-new");
        let tab = launcher_test_tab("tab-new", "workspace-1");
        let name = managed_agent_name(ManagedAgentKind::Claude, "pane-new");
        let mut pending = launcher_test_agent("pane-new", "workspace-1", "tab-new");
        pending.name = Some(name);
        pending.agent = None;
        let mut ready = pending.clone();
        ready.agent = Some("claude".into());
        ready.launch_pending = false;
        ready.interactive_ready = true;
        let mut api = MockLauncherApi::new([
            Ok(ResponseResult::TabCreated {
                tab,
                root_pane: pane,
            }),
            Ok(ResponseResult::Ok {}),
            Err(LauncherPresetError::from_herdr_error(
                "agent_pane_busy".into(),
                "agent target pane pane-new is not an available shell".into(),
            )),
            Err(LauncherPresetError::from_herdr_error(
                "agent_pane_busy".into(),
                "agent target pane pane-new is not an available shell".into(),
            )),
            Err(LauncherPresetError::from_herdr_error(
                "agent_pane_busy".into(),
                "agent target pane pane-new is not an available shell".into(),
            )),
            Ok(ResponseResult::AgentStarted {
                agent: pending,
                argv: vec!["claude".into()],
            }),
            Ok(ResponseResult::AgentInfo { agent: ready }),
        ]);
        let preset = launcher_test_managed_preset(ManagedAgentKind::Claude);

        let response = launch_preset_with(
            &mut api,
            &preset,
            "Claude",
            LauncherPresetLaunchTarget::Tab {
                workspace_id: "workspace-1".into(),
            },
        )
        .unwrap();

        assert_eq!(response.pane_id, "pane-new");
        assert_eq!(
            api.requests
                .iter()
                .filter(|request| matches!(request, Method::AgentStart(_)))
                .count(),
            4
        );
        assert_eq!(
            api.waits,
            vec![
                MANAGED_AGENT_SHELL_SETTLE_DELAY,
                MANAGED_AGENT_SHELL_RETRY_INITIAL_DELAY,
                Duration::from_millis(900),
                Duration::from_millis(1700),
            ]
        );
    }

    #[test]
    fn generated_managed_agent_names_are_safe_bounded_and_pane_specific() {
        let first = managed_agent_name(ManagedAgentKind::OpenCode, "pane/ONE:🔥");
        let second = managed_agent_name(ManagedAgentKind::OpenCode, "pane/TWO:🔥");

        assert!(valid_managed_agent_name(&first));
        assert!(valid_managed_agent_name(&second));
        assert_ne!(first, second);
        assert!(first.starts_with("web-opencode-"));
    }

    #[test]
    fn failed_rename_rolls_back_the_created_tab() {
        let pane = launcher_test_pane("pane-new", "workspace-1", "tab-new");
        let tab = launcher_test_tab("tab-new", "workspace-1");
        let mut api = MockLauncherApi::new([
            Ok(ResponseResult::TabCreated {
                tab,
                root_pane: pane,
            }),
            Err(LauncherPresetError::launch_failed("rename failed")),
            Ok(ResponseResult::Ok {}),
        ]);
        let preset = launcher_test_managed_preset(ManagedAgentKind::Claude);

        let error = launch_preset_with(
            &mut api,
            &preset,
            "Claude",
            LauncherPresetLaunchTarget::Tab {
                workspace_id: "workspace-1".into(),
            },
        )
        .unwrap_err();

        assert_eq!(error.message, "rename failed");
        assert!(matches!(api.requests[0], Method::TabCreate(_)));
        assert!(matches!(api.requests[1], Method::PaneRename(_)));
        let Method::TabClose(params) = &api.requests[2] else {
            panic!("expected tab.close rollback");
        };
        assert_eq!(params.tab_id, "tab-new");
    }

    #[test]
    fn failed_agent_start_rolls_back_split_and_preserves_error_if_cleanup_fails() {
        let pane = launcher_test_pane("pane-new", "workspace-1", "tab-1");
        let mut api = MockLauncherApi::new([
            Ok(ResponseResult::PaneInfo { pane }),
            Ok(ResponseResult::Ok {}),
            Err(LauncherPresetError::launch_failed("agent start failed")),
            Err(LauncherPresetError::launch_failed("cleanup failed")),
        ]);
        let preset = launcher_test_managed_preset(ManagedAgentKind::Pi);

        let error = launch_preset_with(
            &mut api,
            &preset,
            "pi",
            LauncherPresetLaunchTarget::Split {
                tab_id: "tab-1".into(),
                target_pane_id: "pane-old".into(),
                direction: SplitDirection::Right,
            },
        )
        .unwrap_err();

        assert_eq!(error.message, "agent start failed");
        assert!(matches!(api.requests[0], Method::PaneSplit(_)));
        assert!(matches!(api.requests[1], Method::PaneRename(_)));
        assert!(matches!(api.requests[2], Method::AgentStart(_)));
        let Method::PaneClose(params) = &api.requests[3] else {
            panic!("expected pane.close rollback");
        };
        assert_eq!(params.pane_id, "pane-new");
    }

    #[test]
    fn managed_agent_process_exit_rolls_back_after_start_acknowledgement() {
        let pane = launcher_test_pane("pane-new", "workspace-1", "tab-new");
        let tab = launcher_test_tab("tab-new", "workspace-1");
        let name = managed_agent_name(ManagedAgentKind::Claude, "pane-new");
        let mut pending = launcher_test_agent("pane-new", "workspace-1", "tab-new");
        pending.name = Some(name);
        pending.agent = None;
        let mut failed = pending.clone();
        failed.launch_pending = false;
        let mut api = MockLauncherApi::new([
            Ok(ResponseResult::TabCreated {
                tab,
                root_pane: pane,
            }),
            Ok(ResponseResult::Ok {}),
            Ok(ResponseResult::AgentStarted {
                agent: pending,
                argv: vec!["claude".into()],
            }),
            Ok(ResponseResult::AgentInfo { agent: failed }),
            Ok(ResponseResult::Ok {}),
        ]);
        let preset = launcher_test_managed_preset(ManagedAgentKind::Claude);

        let error = launch_preset_with(
            &mut api,
            &preset,
            "Claude",
            LauncherPresetLaunchTarget::Tab {
                workspace_id: "workspace-1".into(),
            },
        )
        .unwrap_err();

        assert!(error.message.contains("exited before becoming interactive"));
        assert!(matches!(api.requests[3], Method::AgentGet(_)));
        let Method::TabClose(params) = &api.requests[4] else {
            panic!("expected tab.close rollback");
        };
        assert_eq!(params.tab_id, "tab-new");
    }

    struct MockLauncherApi {
        results: std::collections::VecDeque<Result<ResponseResult, LauncherPresetError>>,
        requests: Vec<Method>,
        waits: Vec<Duration>,
        clock: std::time::Instant,
    }

    impl MockLauncherApi {
        fn new(
            results: impl IntoIterator<Item = Result<ResponseResult, LauncherPresetError>>,
        ) -> Self {
            Self {
                results: results.into_iter().collect(),
                requests: Vec::new(),
                waits: Vec::new(),
                clock: std::time::Instant::now(),
            }
        }
    }

    impl LauncherApiRequest for MockLauncherApi {
        fn request(
            &mut self,
            _id: &str,
            method: Method,
        ) -> Result<ResponseResult, LauncherPresetError> {
            self.requests.push(method);
            self.results
                .pop_front()
                .expect("mock launcher response missing")
        }

        fn now(&self) -> std::time::Instant {
            self.clock
        }

        fn wait(&mut self, duration: Duration) {
            self.waits.push(duration);
            self.clock += duration;
        }
    }

    fn launcher_test_managed_preset(kind: ManagedAgentKind) -> ResolvedLauncherPreset {
        ResolvedLauncherPreset {
            id: format!("builtin:{}", kind.as_str()),
            label: kind.as_str().to_string(),
            launch: LauncherPresetLaunch::ManagedAgent {
                kind,
                args: Vec::new(),
            },
            built_in: true,
        }
    }

    fn launcher_test_tab(tab_id: &str, workspace_id: &str) -> TabInfo {
        TabInfo {
            tab_id: tab_id.into(),
            workspace_id: workspace_id.into(),
            number: 1,
            label: "Tab".into(),
            focused: true,
            pane_count: 1,
            agent_status: AgentStatus::Idle,
        }
    }

    fn launcher_test_pane(pane_id: &str, workspace_id: &str, tab_id: &str) -> PaneInfo {
        PaneInfo {
            pane_id: pane_id.into(),
            terminal_id: format!("terminal-{pane_id}"),
            workspace_id: workspace_id.into(),
            tab_id: tab_id.into(),
            focused: true,
            cwd: None,
            foreground_cwd: None,
            label: None,
            agent: None,
            title: None,
            terminal_title: None,
            terminal_title_stripped: None,
            display_agent: None,
            agent_status: AgentStatus::Idle,
            state_labels: HashMap::new(),
            tokens: HashMap::new(),
            agent_session: None,
            scroll: None,
            revision: 1,
        }
    }

    fn launcher_test_agent(
        pane_id: &str,
        workspace_id: &str,
        tab_id: &str,
    ) -> herdr_compat::api::schema::AgentInfo {
        herdr_compat::api::schema::AgentInfo {
            terminal_id: format!("terminal-{pane_id}"),
            name: None,
            agent: Some("codex".into()),
            title: None,
            terminal_title: None,
            terminal_title_stripped: None,
            display_agent: None,
            agent_status: AgentStatus::Working,
            screen_detection_skipped: false,
            state_labels: HashMap::new(),
            tokens: HashMap::new(),
            agent_session: None,
            workspace_id: workspace_id.into(),
            tab_id: tab_id.into(),
            pane_id: pane_id.into(),
            focused: true,
            launch_pending: true,
            interactive_ready: false,
            state_change_seq: 1,
            cwd: None,
            foreground_cwd: None,
            revision: 1,
        }
    }

    fn valid_managed_agent_name(name: &str) -> bool {
        let mut chars = name.chars();
        matches!(chars.next(), Some('a'..='z'))
            && name.len() <= 32
            && chars
                .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '-' | '_'))
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
    fn parse_options_accepts_public_reverse_proxy_origin() {
        let args = vec![
            "--public-origin".to_string(),
            "HTTPS://SERVER60.GREYHOUND-CHINSTRAP.TS.NET".to_string(),
        ];

        let options = parse_options(&args).unwrap().unwrap();
        assert_eq!(
            options.public_origins,
            vec!["https://server60.greyhound-chinstrap.ts.net".to_string()]
        );
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

    fn runtime_status(version: &str, protocol: u32) -> herdr_compat::api::RuntimeStatus {
        herdr_compat::api::RuntimeStatus {
            version: Some(version.to_string()),
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
            public_origins: Vec::new(),
            allowed_connect_sources: Vec::new(),
        }
    }
}
