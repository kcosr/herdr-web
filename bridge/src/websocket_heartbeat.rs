//! WebSocket ping and peer-activity deadlines for removing dead browser connections.

use std::time::Duration;

use tokio::time::Instant;

pub(crate) const WEBSOCKET_PING_INTERVAL: Duration = Duration::from_secs(30);
pub(crate) const WEBSOCKET_PEER_TIMEOUT: Duration = Duration::from_secs(15);

/// The next action when a WebSocket ping or peer-reply deadline expires.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WebSocketHeartbeatAction {
    /// Send a protocol-level ping; peer grace starts only after dispatch succeeds.
    SendPing,
    /// Drop the socket because no peer frame arrived after the ping.
    Disconnect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WebSocketHeartbeatPhase {
    WaitingToPing,
    WaitingForPeer,
}

/// Tracks when a bridge WebSocket should ping its browser and when silence is fatal.
pub(crate) struct WebSocketHeartbeat {
    phase: WebSocketHeartbeatPhase,
    deadline: Instant,
}

impl WebSocketHeartbeat {
    /// Starts a heartbeat that sends its first ping after 30 silent seconds.
    pub(crate) fn new(now: Instant) -> Self {
        Self {
            phase: WebSocketHeartbeatPhase::WaitingToPing,
            deadline: now + WEBSOCKET_PING_INTERVAL,
        }
    }

    /// Returns the next ping or peer-reply deadline.
    pub(crate) fn deadline(&self) -> Instant {
        self.deadline
    }

    /// Returns the action for the current deadline without arming peer grace before dispatch.
    pub(crate) fn handle_deadline(&self) -> WebSocketHeartbeatAction {
        match self.phase {
            WebSocketHeartbeatPhase::WaitingToPing => WebSocketHeartbeatAction::SendPing,
            WebSocketHeartbeatPhase::WaitingForPeer => WebSocketHeartbeatAction::Disconnect,
        }
    }

    /// Records a successfully dispatched ping and starts the peer-reply timeout.
    pub(crate) fn record_ping_sent(&mut self, now: Instant) {
        self.phase = WebSocketHeartbeatPhase::WaitingForPeer;
        self.deadline = now + WEBSOCKET_PEER_TIMEOUT;
    }

    /// Records any inbound peer frame and schedules the next idle ping.
    pub(crate) fn record_peer_activity(&mut self, now: Instant) {
        self.phase = WebSocketHeartbeatPhase::WaitingToPing;
        self.deadline = now + WEBSOCKET_PING_INTERVAL;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn heartbeat_peer_grace_starts_after_ping_dispatch() {
        let started_at = Instant::now();
        let mut heartbeat = WebSocketHeartbeat::new(started_at);
        let ping_at = started_at + WEBSOCKET_PING_INTERVAL;

        tokio::time::advance(WEBSOCKET_PING_INTERVAL).await;
        assert_eq!(heartbeat.deadline(), ping_at);
        assert_eq!(
            heartbeat.handle_deadline(),
            WebSocketHeartbeatAction::SendPing
        );
        assert_eq!(heartbeat.deadline(), ping_at);

        let dispatch_delay = Duration::from_secs(7);
        tokio::time::advance(dispatch_delay).await;
        let dispatched_at = Instant::now();
        heartbeat.record_ping_sent(dispatched_at);

        let timeout_at = dispatched_at + WEBSOCKET_PEER_TIMEOUT;
        assert_eq!(heartbeat.deadline(), timeout_at);
        tokio::time::advance(WEBSOCKET_PEER_TIMEOUT).await;
        assert_eq!(
            heartbeat.handle_deadline(),
            WebSocketHeartbeatAction::Disconnect
        );
    }

    #[test]
    fn peer_activity_before_ping_restarts_the_idle_interval() {
        let started_at = Instant::now();
        let mut heartbeat = WebSocketHeartbeat::new(started_at);
        let activity_at = started_at + Duration::from_secs(10);

        heartbeat.record_peer_activity(activity_at);

        let next_ping_at = activity_at + WEBSOCKET_PING_INTERVAL;
        assert_eq!(heartbeat.deadline(), next_ping_at);
        assert_eq!(
            heartbeat.handle_deadline(),
            WebSocketHeartbeatAction::SendPing
        );
    }

    #[test]
    fn peer_activity_after_ping_arms_the_next_ping_instead_of_disconnect() {
        let started_at = Instant::now();
        let mut heartbeat = WebSocketHeartbeat::new(started_at);
        let ping_at = started_at + WEBSOCKET_PING_INTERVAL;
        assert_eq!(
            heartbeat.handle_deadline(),
            WebSocketHeartbeatAction::SendPing
        );
        heartbeat.record_ping_sent(ping_at);

        let activity_at = ping_at + Duration::from_secs(1);
        heartbeat.record_peer_activity(activity_at);
        let next_ping_at = activity_at + WEBSOCKET_PING_INTERVAL;

        assert_eq!(heartbeat.deadline(), next_ping_at);
        assert_eq!(
            heartbeat.handle_deadline(),
            WebSocketHeartbeatAction::SendPing
        );
    }
}
