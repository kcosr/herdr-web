//! Herdr JSON API client compatibility surface.
//!
//! Source reference: upstream Herdr `src/api/client.rs`.

use std::fmt;
use std::io::{self, BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use interprocess::local_socket::traits::Stream as _;
use serde::de::DeserializeOwned;

use crate::api::schema::{
    ErrorResponse, EventsSubscribeParams, Method, PingParams, Request, ResponseResult,
    SuccessResponse,
};
use crate::ipc::LocalStream;

const MAX_PRECONNECTED_API_SOCKETS: usize = 8;

/// API connection target resolved by clients at the process edge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionTarget {
    SocketPath(PathBuf),
}

impl ConnectionTarget {
    fn socket_path(&self) -> PathBuf {
        match self {
            Self::SocketPath(path) => path.clone(),
        }
    }
}

/// Reusable client for Herdr's newline-delimited JSON API.
///
/// Clones share a small pool of preconnected, unused sockets. A socket is consumed by one
/// request and is not returned to the pool, so the client does not assume multi-request socket
/// semantics from the daemon.
#[derive(Debug, Clone)]
pub struct ApiClient {
    target: ConnectionTarget,
    pool: Arc<Mutex<Vec<LocalStream>>>,
}

impl ApiClient {
    pub fn for_socket_path(socket_path: PathBuf) -> Self {
        Self::for_target(ConnectionTarget::SocketPath(socket_path))
    }

    pub fn for_target(target: ConnectionTarget) -> Self {
        Self {
            target,
            pool: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn socket_path(&self) -> PathBuf {
        self.target.socket_path()
    }

    pub fn request(&self, request: Request) -> Result<SuccessResponse, ApiClientError> {
        let value = self.request_value(&request)?;
        parse_response_value(value)
    }

    pub fn request_value(&self, request: &Request) -> Result<serde_json::Value, ApiClientError> {
        let mut stream = self.connect()?;
        write_request(&mut stream, request)?;

        let mut reader = BufReader::new(stream);
        read_json_line(&mut reader)
    }

    pub fn request_value_with_timeout(
        &self,
        request: &Request,
        timeout: Duration,
    ) -> Result<serde_json::Value, ApiClientError> {
        let mut stream = self.connect()?;
        set_timeout_best_effort(&stream, TimeoutKind::Send, timeout)?;
        set_timeout_best_effort(&stream, TimeoutKind::Recv, timeout)?;
        write_request(&mut stream, request)?;

        let mut reader = BufReader::new(stream);
        read_json_line(&mut reader)
    }

    #[allow(dead_code)] // Kept as the typed subscription API; CLI wait paths use subscribe_value to preserve raw ack errors.
    pub fn subscribe(
        &self,
        id: impl Into<String>,
        params: EventsSubscribeParams,
        read_timeout: Option<Duration>,
    ) -> Result<(SuccessResponse, EventStream), ApiClientError> {
        let request = Request {
            id: id.into(),
            method: Method::EventsSubscribe(params),
        };
        let (ack, stream) = self.subscribe_value(&request, read_timeout)?;
        Ok((parse_response_value(ack)?, stream))
    }

    pub fn subscribe_value(
        &self,
        request: &Request,
        read_timeout: Option<Duration>,
    ) -> Result<(serde_json::Value, EventStream), ApiClientError> {
        let mut stream = self.connect()?;
        write_request(&mut stream, request)?;
        if let Some(timeout) = read_timeout {
            set_timeout_best_effort(&stream, TimeoutKind::Recv, timeout)?;
        }

        let mut reader = BufReader::new(stream);
        let ack = read_json_line(&mut reader)?;
        Ok((ack, EventStream { reader }))
    }

    pub fn status_with_timeout(
        &self,
        timeout: Duration,
    ) -> Result<crate::api::RuntimeStatus, ApiClientError> {
        self.status_with_request(|client, request| {
            let value = client.request_value_with_timeout(&request, timeout)?;
            parse_response_value(value)
        })
    }

    fn status_with_request(
        &self,
        request: impl FnOnce(&Self, Request) -> Result<SuccessResponse, ApiClientError>,
    ) -> Result<crate::api::RuntimeStatus, ApiClientError> {
        let response = request(
            self,
            Request {
                id: "api-client:status".into(),
                method: Method::Ping(PingParams::default()),
            },
        )?;
        match response.result {
            ResponseResult::Pong {
                version,
                protocol,
                capabilities,
            } => Ok(crate::api::RuntimeStatus {
                version: Some(version),
                protocol: Some(protocol),
                capabilities,
            }),
            result => Err(ApiClientError::UnexpectedResult(format!("{result:?}"))),
        }
    }

    fn connect(&self) -> io::Result<LocalStream> {
        if let Ok(mut pool) = self.pool.lock() {
            if let Some(stream) = pool.pop() {
                return Ok(stream);
            }
        }
        crate::ipc::connect_local_stream(&self.socket_path())
    }

    pub fn replenish_pool(&self, target_size: usize) {
        let target_size = target_size.min(MAX_PRECONNECTED_API_SOCKETS);
        let missing = match self.pool.lock() {
            Ok(pool) => target_size.saturating_sub(pool.len()),
            Err(_) => return,
        };
        if missing == 0 {
            return;
        }

        let socket_path = self.socket_path();
        let mut streams = Vec::with_capacity(missing);
        for _ in 0..missing {
            match crate::ipc::connect_local_stream(&socket_path) {
                Ok(stream) => streams.push(stream),
                Err(_) => break,
            }
        }
        if streams.is_empty() {
            return;
        }

        let Ok(mut pool) = self.pool.lock() else {
            return;
        };
        let remaining = target_size.saturating_sub(pool.len());
        pool.extend(streams.into_iter().take(remaining));
    }
}

enum TimeoutKind {
    Send,
    Recv,
}

fn set_timeout_best_effort(
    stream: &LocalStream,
    kind: TimeoutKind,
    timeout: Duration,
) -> io::Result<()> {
    let result = match kind {
        TimeoutKind::Send => stream.set_send_timeout(Some(timeout)),
        TimeoutKind::Recv => stream.set_recv_timeout(Some(timeout)),
    };
    match result {
        Ok(()) => Ok(()),
        #[cfg(windows)]
        Err(err) if err.kind() == io::ErrorKind::Unsupported => Ok(()),
        Err(err) => Err(err),
    }
}

pub struct EventStream {
    reader: BufReader<LocalStream>,
}

impl EventStream {
    pub fn next_value(&mut self) -> Result<Option<serde_json::Value>, ApiClientError> {
        read_optional_json_line(&mut self.reader)
    }
}

#[derive(Debug)]
pub enum ApiClientError {
    Io(io::Error),
    Json(serde_json::Error),
    ErrorResponse(ErrorResponse),
    EmptyResponse,
    UnexpectedResult(String),
}

impl fmt::Display for ApiClientError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(err) => write!(f, "{err}"),
            Self::Json(err) => write!(f, "{err}"),
            Self::ErrorResponse(response) => write!(f, "{}", response.error.message),
            Self::EmptyResponse => write!(f, "empty api response"),
            Self::UnexpectedResult(result) => write!(f, "unexpected api result: {result}"),
        }
    }
}

impl std::error::Error for ApiClientError {}

impl From<io::Error> for ApiClientError {
    fn from(err: io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<serde_json::Error> for ApiClientError {
    fn from(err: serde_json::Error) -> Self {
        Self::Json(err)
    }
}

fn write_request(stream: &mut LocalStream, request: &Request) -> Result<(), ApiClientError> {
    serde_json::to_writer(&mut *stream, request)?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    Ok(())
}

fn read_json_line<T: DeserializeOwned>(
    reader: &mut BufReader<LocalStream>,
) -> Result<T, ApiClientError> {
    let mut line = String::new();
    let read = reader.read_line(&mut line)?;
    if read == 0 || line.trim().is_empty() {
        return Err(ApiClientError::EmptyResponse);
    }
    serde_json::from_str(&line).map_err(ApiClientError::Json)
}

fn read_optional_json_line<T: DeserializeOwned>(
    reader: &mut BufReader<LocalStream>,
) -> Result<Option<T>, ApiClientError> {
    let mut line = String::new();
    let read = reader.read_line(&mut line)?;
    if read == 0 {
        return Ok(None);
    }
    if line.trim().is_empty() {
        return Err(ApiClientError::EmptyResponse);
    }
    serde_json::from_str(&line)
        .map(Some)
        .map_err(ApiClientError::Json)
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum WireResponse {
    Success(Box<SuccessResponse>),
    Error(ErrorResponse),
}

pub fn parse_response_value(value: serde_json::Value) -> Result<SuccessResponse, ApiClientError> {
    match serde_json::from_value(value)? {
        WireResponse::Success(response) => Ok(*response),
        WireResponse::Error(response) => Err(ApiClientError::ErrorResponse(response)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socket_path_target_uses_explicit_path() {
        let path = PathBuf::from("/tmp/herdr-test.sock");
        let client = ApiClient::for_socket_path(path.clone());
        assert_eq!(client.socket_path(), path);
    }
}
