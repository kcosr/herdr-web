// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { openStateSocket } from "./stateSocket";

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  closed = false;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.dispatchEvent(new CloseEvent("close"));
  }

  emitMessage(data: string) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

const snapshotMessage = JSON.stringify({
  type: "snapshot",
  generation: 1,
  sequence: 1,
  stream_id: "stream-1",
  snapshot: {},
});

describe("state socket", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  it("reconnects closed sockets with backoff", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    const socket = openStateSocket(() => "ws://bridge/ws/state", () => "continue");

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].close();
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    socket.close();
  });

  it("resets reconnect backoff after a stable snapshot", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    const socket = openStateSocket(() => "ws://bridge/ws/state", () => "continue");

    FakeWebSocket.instances[0].close();
    vi.advanceTimersByTime(500);
    FakeWebSocket.instances[1].emitMessage(snapshotMessage);
    vi.advanceTimersByTime(1500);
    FakeWebSocket.instances[1].close();
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    socket.close();
  });

  it("uses the same backoff path for requested reconnects", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    const socket = openStateSocket(() => "ws://bridge/ws/state", () => "continue");

    socket.reconnect();
    expect(FakeWebSocket.instances[0].closed).toBe(true);
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    socket.close();
  });
});
