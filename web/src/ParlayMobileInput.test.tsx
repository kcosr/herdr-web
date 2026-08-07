/**
 * @vitest-environment jsdom
 *
 * Regression test for the mobile "next agent" / "previous agent" trigger.
 *
 * The parlay command dispatcher maps the phrases "next agent"/"next tab" to
 * `ctx.tabs.next()` and "previous agent" to `ctx.tabs.prev()` (see
 * `@parlay/client` builtins). Those context hooks used to be no-op stubs
 * (`next: () => {}`), so typing/saying "next agent" in the mobile input did
 * nothing — the exact bug the captain hit on iPhone. They are now wired to the
 * `onNextAgent`/`onPrevAgent` props, which App routes into the same tested
 * `nextVisibleAgentPaneEntry` + `focusPane` navigation the desktop keyboard uses.
 *
 * This test captures the dispatcher context the component installs and invokes
 * `ctx.tabs.next()` / `ctx.tabs.prev()` directly, asserting they now reach the
 * navigation callbacks. On the pre-fix code the stubs never call the props, so
 * this fails; with the wiring it passes.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the optional local-only parlay client so we can capture the dispatcher
// context the component builds without needing the real voice/eval pipeline.
type CapturedContext = { tabs: { next: () => void; prev: () => void } };
let capturedCtx: CapturedContext | null = null;
vi.mock("@parlay/client", () => ({
  setEvalServerBaseUrl: vi.fn(),
  setDispatcherContext: vi.fn((ctx: unknown) => {
    capturedCtx = ctx as CapturedContext;
  }),
  scheduleEval: vi.fn(),
  bumpInputVersion: vi.fn(),
  applyEnvelope: vi.fn(),
  PARLAY_SETTINGS_DEFAULTS: { voiceSettleMs: 300 },
}));

const { ParlayMobileInput } = await import("./ParlayMobileInput");

// jsdom has no EventSource; the component opens one for voice actions. Provide a
// minimal inert stub so rendering does not throw.
class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  capturedCtx = null;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function renderInput(props: {
  onNextAgent: () => void;
  onPrevAgent: () => void;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <ParlayMobileInput
        value=""
        onValueChange={vi.fn()}
        onVoiceSubmit={vi.fn()}
        onNextAgent={props.onNextAgent}
        onPrevAgent={props.onPrevAgent}
        disabled={false}
        expandingInput={false}
        enterNewline={false}
        controlsScalePercent={100}
        inputRef={vi.fn()}
      />,
    );
  });
}

describe("ParlayMobileInput next/prev agent wiring", () => {
  it("routes parlay ctx.tabs.next() to the onNextAgent callback", async () => {
    const onNextAgent = vi.fn();
    const onPrevAgent = vi.fn();
    await renderInput({ onNextAgent, onPrevAgent });

    const ctx = capturedCtx;
    if (!ctx) {
      throw new Error("parlay dispatcher context was never installed");
    }
    act(() => {
      ctx.tabs.next();
    });

    expect(onNextAgent).toHaveBeenCalledTimes(1);
    expect(onPrevAgent).not.toHaveBeenCalled();
  });

  it("routes parlay ctx.tabs.prev() to the onPrevAgent callback", async () => {
    const onNextAgent = vi.fn();
    const onPrevAgent = vi.fn();
    await renderInput({ onNextAgent, onPrevAgent });

    const ctx = capturedCtx;
    if (!ctx) {
      throw new Error("parlay dispatcher context was never installed");
    }
    act(() => {
      ctx.tabs.prev();
    });

    expect(onPrevAgent).toHaveBeenCalledTimes(1);
    expect(onNextAgent).not.toHaveBeenCalled();
  });
});
