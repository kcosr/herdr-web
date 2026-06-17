import { isSequencedStateEnvelope, isStateMessage } from "./stateStream";
import type { StateMessage } from "./types";

export type StateSocketAction = "continue" | "ignore" | "reconnect";

export function openStateSocket(
  wsUrl: (path: string, query?: URLSearchParams) => string,
  onMessage: (message: StateMessage) => StateSocketAction,
) {
  const url = wsUrl("/ws/state");
  let socket: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: number | null = null;
  let stableTimer: number | null = null;
  let attempts = 0;

  const clearStableTimer = () => {
    if (stableTimer !== null) {
      window.clearTimeout(stableTimer);
      stableTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== null) {
      return;
    }
    const delay = Math.min(500 * 2 ** attempts, 5000);
    attempts += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const requestReconnect = () => {
    if (closed) {
      return;
    }
    clearStableTimer();
    const current = socket;
    socket = null;
    current?.close();
    scheduleReconnect();
  };

  const handleParsedMessage = (parsed: unknown) => {
    if (!isStateMessage(parsed)) {
      if (isSequencedStateEnvelope(parsed)) {
        const action = onMessage({
          type: "resync_required",
          generation: parsed.generation,
          sequence: parsed.sequence,
          reason: `unknown state message: ${parsed.type}`,
        });
        if (action === "reconnect") {
          requestReconnect();
        }
      }
      return;
    }
    if (parsed.type === "snapshot") {
      clearStableTimer();
      const current = socket;
      stableTimer = window.setTimeout(() => {
        if (!closed && socket === current) {
          attempts = 0;
        }
      }, 1500);
    }
    if (onMessage(parsed) === "reconnect") {
      requestReconnect();
    }
  };

  const connect = () => {
    if (closed) {
      return;
    }
    const next = new WebSocket(url);
    socket = next;
    next.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || socket !== next) {
        return;
      }
      try {
        handleParsedMessage(JSON.parse(event.data) as unknown);
      } catch {
        requestReconnect();
      }
    });
    next.addEventListener("close", () => {
      clearStableTimer();
      if (closed || socket !== next) {
        return;
      }
      scheduleReconnect();
    });
  };

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearStableTimer();
      socket?.close();
      socket = null;
    },
    reconnect: requestReconnect,
  };
}
