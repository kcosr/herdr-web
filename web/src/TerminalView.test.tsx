// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalView } from "./TerminalView";
import type { TerminalSize } from "./terminalRenderer";
import type { PaneInfo } from "./types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mockTerminal = vi.hoisted(() => {
  const instances: MockGhosttyRenderer[] = [];

  class MockGhosttyRenderer {
    static instances = instances;

    inputCallback: ((data: string) => void) | null = null;
    blur = vi.fn();
    dispose = vi.fn();
    focus = vi.fn();
    focusTextInput = vi.fn();
    setMobileTouchSelection = vi.fn();
    setScrollSensitivity = vi.fn();
    setTapFocusHandler = vi.fn();

    constructor() {
      MockGhosttyRenderer.instances.push(this);
    }

    mount(_container: HTMLElement, signal?: AbortSignal): Promise<TerminalSize> {
      if (signal?.aborted) {
        return Promise.reject(new Error("aborted"));
      }
      return Promise.resolve({ cols: 80, rows: 24 });
    }

    write() {}

    onInput(callback: (data: string) => void) {
      this.inputCallback = callback;
      return () => {
        if (this.inputCallback === callback) {
          this.inputCallback = null;
        }
      };
    }

    onScroll() {
      return () => {};
    }

    fit() {
      return { cols: 80, rows: 24 };
    }

    refreshMetrics() {
      return { cols: 80, rows: 24 };
    }

    emitInput(data: string) {
      this.inputCallback?.(data);
    }
  }

  return { MockGhosttyRenderer };
});

vi.mock("./terminalRenderer", () => ({
  GhosttyRenderer: mockTerminal.MockGhosttyRenderer,
}));

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
}

class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  binaryType = "blob";
  closed = false;
  readyState = MockWebSocket.CONNECTING;
  sent: unknown[] = [];
  url: string;

  constructor(url: string) {
    super();
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close"));
  }
}

const pane = {
  pane_id: "pane-1",
  terminal_id: "terminal-1",
  workspace_id: "workspace-1",
  tab_id: "tab-1",
  agent_status: "idle",
  focused: true,
  revision: 1,
} satisfies PaneInfo;

const httpUrl = (path: string) => path;
const wsUrl = (path: string, query?: URLSearchParams) => `${path}?${query?.toString() ?? ""}`;

function props(overrides: Partial<Parameters<typeof TerminalView>[0]> = {}) {
  return {
    pane,
    connectionKey: "connection-1",
    resumeToken: 0,
    httpUrl,
    wsUrl,
    active: true,
    autoFocus: true,
    ...overrides,
  };
}

async function render(root: Root, nextProps: Parameters<typeof TerminalView>[0]) {
  await act(async () => {
    root.render(<TerminalView {...nextProps} />);
  });
  await act(async () => {});
}

describe("TerminalView lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockTerminal.MockGhosttyRenderer.instances.length = 0;
    MockWebSocket.instances.length = 0;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("blurs and suppresses terminal input while inactive", async () => {
    await render(root, props());
    const renderer = mockTerminal.MockGhosttyRenderer.instances[0];
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.open();
    });

    renderer.emitInput("a");
    expect(socket.sent).toHaveLength(2);
    expect(ArrayBuffer.isView(socket.sent[1])).toBe(true);

    await render(root, props({ active: false, autoFocus: false }));

    expect(renderer.blur).toHaveBeenCalled();
    renderer.emitInput("b");
    expect(socket.sent).toHaveLength(2);
  });

  it("reattaches the terminal socket when the resume token changes", async () => {
    await render(root, props({ resumeToken: 0 }));
    const firstSocket = MockWebSocket.instances[0];

    await render(root, props({ resumeToken: 1 }));

    expect(firstSocket.closed).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("defers inactive resume reconnects until the cached terminal becomes active", async () => {
    await render(root, props({ active: true, resumeToken: 0 }));
    const firstSocket = MockWebSocket.instances[0];

    await render(root, props({ active: false, autoFocus: false, resumeToken: 0 }));
    await render(root, props({ active: false, autoFocus: false, resumeToken: 1 }));

    expect(firstSocket.closed).toBe(false);
    expect(MockWebSocket.instances).toHaveLength(1);

    await render(root, props({ active: true, resumeToken: 1 }));
    await act(async () => {});

    expect(firstSocket.closed).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(2);
  });
});
