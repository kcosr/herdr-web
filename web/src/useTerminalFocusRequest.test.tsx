/** @vitest-environment jsdom */
import { act, useCallback, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalFocusRequest } from "./useTerminalFocusRequest";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function FocusHarness({ token, retry }: { token: number; retry: boolean }) {
  const composer = useRef<HTMLTextAreaElement>(null);
  const focus = useCallback(() => composer.current?.focus(), []);
  useTerminalFocusRequest(token, focus, retry);
  return <><textarea ref={composer} /><input aria-label="Terminal input" /></>;
}

async function render(token: number, retry: boolean) {
  await act(async () => root.render(<FocusHarness token={token} retry={retry} />));
}

async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTime(ms));
}

describe("terminal focus requests", () => {
  it("lets a terminal click win after desktop composer default focus", async () => {
    await render(1, false);
    await advance(20);
    expect(document.activeElement).toBe(container.querySelector("textarea"));
    const terminal = container.querySelector("input")!;
    terminal.focus();
    await advance(250);
    expect(document.activeElement).toBe(terminal);
    // A settings rerender without a new focus request must not steal focus either.
    await render(1, false);
    await advance(250);
    expect(document.activeElement).toBe(terminal);
  });

  it("preserves the mobile keyboard retries", async () => {
    await render(1, true);
    const composer = container.querySelector("textarea")!;
    const terminal = container.querySelector("input")!;
    await advance(20);
    expect(document.activeElement).toBe(composer);
    terminal.focus();
    await advance(60);
    expect(document.activeElement).toBe(composer);
    terminal.focus();
    await advance(140);
    expect(document.activeElement).toBe(composer);
  });

  it("cancels pending focus when a pane loses the focus request", async () => {
    await render(1, true);
    await render(0, true);
    const terminal = container.querySelector("input")!;
    terminal.focus();
    await advance(250);
    expect(document.activeElement).toBe(terminal);
  });
});
