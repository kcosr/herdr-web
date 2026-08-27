/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the desktop typing hitch: snapshot updates used to be
 * plain (blocking-lane) `setConnectionStates` calls, so reconciling the whole
 * pane/sidebar tree ran as one uninterruptible render and any keystroke that
 * arrived mid-render was stuck behind it. Wrapping the snapshot applies in
 * `startTransition` puts them on a transition lane, which React time-slices, so
 * an incoming keystroke is handled between slices.
 *
 * Each test drives the real `BridgeConnectionController` through one of its three
 * snapshot-applying paths, renders a deliberately expensive snapshot consumer
 * (standing in for the un-memoized pane/sidebar tree), fires a real `input` event
 * while that reconciliation is in flight, and asserts the keystroke reaches the
 * DOM without waiting for the snapshot render to finish.
 *
 * These tests run outside `act()` on purpose: `act` flushes work synchronously
 * and would erase the scheduling difference under test.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeConnectionController } from "./App";
import type { BridgeConnectionRef, BridgeConnectionState } from "./App";
import type { BridgeId, BridgeRuntime } from "./bridge";
import type { PaneInfo, Snapshot } from "./types";

const BRIDGE_ID: BridgeId = "bridge-under-test";
const CONNECTION_KEY = "bridge-under-test:1";
/** Mirrors the controller's SNAPSHOT_REFRESH_INTERVAL_MS (module-private in App.tsx). */
const SNAPSHOT_REFRESH_INTERVAL_MS = 10000;
const PANE_COUNT = 220;
/** Simulated per-row reconciliation cost, in ms. 220 rows ≈ 220ms of render work. */
const ROW_RENDER_COST_MS = 1;
/** How long after the snapshot update the simulated keystroke arrives. */
const KEYSTROKE_DELAY_MS = 20;
/**
 * Upper bound for handling the keystroke, measured from the moment it was due to
 * arrive to the moment it hit the DOM. Blocking-lane reconciliation of the tree
 * above costs 250ms+, so anything near that means typing was stalled.
 */
const KEYSTROKE_BUDGET_MS = 100;

type Timing = {
  keystrokeDueAt: number;
  keystrokeDispatchedAt: number;
  keystrokeCommittedAt: number;
  snapshotCommittedAt: number;
  /** Wall-clock span of the snapshot reconciliation triggered by the update. */
  snapshotRenderMs: number;
  rowsRenderedBeforeKeystroke: number;
  rowsRenderedAfterKeystroke: number;
};

const roots: Root[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  for (const container of containers.splice(0)) container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function makePane(index: number, revision = 1): PaneInfo {
  return {
    pane_id: `pane-${index}`,
    terminal_id: `term-${index}`,
    workspace_id: "ws-1",
    tab_id: "tab-1",
    focused: index === 0,
    agent: "claude",
    title: `pane ${index}`,
    display_agent: "claude",
    agent_status: "idle",
    state_labels: {},
    revision,
  };
}

function makeSnapshot(revision = 1): Snapshot {
  return {
    workspaces: [
      {
        workspace_id: "ws-1",
        number: 1,
        label: "workspace",
        focused: true,
        pane_count: PANE_COUNT,
        tab_count: 1,
        active_tab_id: "tab-1",
        agent_status: "idle",
      },
    ],
    tabs: [
      {
        tab_id: "tab-1",
        workspace_id: "ws-1",
        number: 1,
        label: "tab",
        focused: true,
        pane_count: PANE_COUNT,
        agent_status: "idle",
      },
    ],
    panes: Array.from({ length: PANE_COUNT }, (_, index) => makePane(index, revision)),
    layouts: [],
    selected_pane_id: "pane-0",
  };
}

function makeRuntime(): BridgeRuntime {
  return {
    id: BRIDGE_ID,
    mode: "same-origin",
    label: "bridge",
    color: "#fff",
    backend: null,
    connectionKey: CONNECTION_KEY,
    resumeToken: 0,
    capabilities: null,
    capabilityState: "ready",
    capabilityError: null,
    canConnect: true,
    proxied: false,
    httpUrl: (path: string) => `http://bridge.test${path}`,
    wsUrl: (path: string) => `ws://bridge.test${path}`,
  };
}

class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = [];
  readyState = 1;
  constructor(readonly url: string) {
    super();
    FakeSocket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
  }
  static bySuffix(suffix: string) {
    const socket = FakeSocket.instances.find((item) => item.url.endsWith(suffix));
    if (!socket) throw new Error(`no socket opened for ${suffix}`);
    return socket;
  }
  emit(data: string) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

/** Timestamp of every pane-row render, so reconciliation can be located in time. */
const rowRenderLog: number[] = [];

function busyWait(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Stand in for real reconciliation work so render cost is observable.
  }
}

function PaneRow({ pane }: { pane: PaneInfo }) {
  rowRenderLog.push(performance.now());
  busyWait(ROW_RENDER_COST_MS);
  return <li>{`${pane.pane_id}:${pane.agent_status}`}</li>;
}

/** Stands in for the app's un-memoized pane/sidebar tree. */
function SnapshotPanel({
  snapshot,
  onCommit,
}: {
  snapshot: Snapshot | null;
  onCommit: (info: { at: number }) => void;
}) {
  const rows = snapshot ? snapshot.panes.map((pane) => <PaneRow key={pane.pane_id} pane={pane} />) : [];
  useLayoutEffect(() => {
    onCommit({ at: performance.now() });
  }, [snapshot, onCommit]);
  return (
    <div>
      <span data-testid="selected">{snapshot?.selected_pane_id ?? "none"}</span>
      <span data-testid="pane-0-status">
        {snapshot?.panes.find((pane) => pane.pane_id === "pane-0")?.agent_status ?? "none"}
      </span>
      <ul>{rows}</ul>
    </div>
  );
}

/** Stands in for the terminal input: local state, updated by a real DOM event. */
function KeystrokeInput({ onCommit }: { onCommit: (at: number) => void }) {
  const [value, setValue] = useState("");
  useLayoutEffect(() => {
    if (value) onCommit(performance.now());
  }, [value, onCommit]);
  return (
    <input
      data-testid="keystroke"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

function Harness({
  runtime,
  onSnapshotCommit,
  onKeystrokeCommit,
  onSelection,
}: {
  runtime: BridgeRuntime;
  onSnapshotCommit: (info: { at: number }) => void;
  onKeystrokeCommit: (at: number) => void;
  onSelection: (paneId: string) => void;
}) {
  const [connectionStates, setConnectionStates] = useState<Record<string, BridgeConnectionState>>(
    {},
  );
  const connectionRefs = useRef<Record<string, BridgeConnectionRef>>({});
  const snapshot = connectionStates[runtime.id]?.snapshot ?? null;
  // The controller re-subscribes when these identities change, exactly as in App.tsx.
  const selectionRef = useRef(onSelection);
  selectionRef.current = onSelection;
  const handlePaneSelection = useCallback((_bridgeId: BridgeId, paneId: string) => {
    selectionRef.current(paneId);
  }, []);
  const noop = useCallback(() => {}, []);
  return (
    <>
      <BridgeConnectionController
        runtime={runtime}
        followSharedSelection
        connectionRefs={connectionRefs}
        setConnectionStates={setConnectionStates}
        onPaneSelection={handlePaneSelection}
        onAgentActivityChanged={noop}
        onAgentPinsChanged={noop}
        onNotesChanged={noop}
      />
      <SnapshotPanel snapshot={snapshot} onCommit={onSnapshotCommit} />
      <KeystrokeInput onCommit={onKeystrokeCommit} />
      <MountSignal />
    </>
  );
}

function MountSignal() {
  const [, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return null;
}

/** Captured before any fake-timer install so polling waits keep working. */
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const sleep = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 15000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error("waitFor timed out");
}

function typeKeystroke(container: HTMLElement, char: string) {
  const input = container.querySelector<HTMLInputElement>('[data-testid="keystroke"]');
  if (!input) throw new Error("keystroke input missing");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, char);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

type Scenario = {
  container: HTMLElement;
  timings: { snapshot: Array<{ at: number }>; keystroke: number[] };
  selections: string[];
  fetchCalls: () => number;
  setNextSnapshot: (snapshot: Snapshot) => void;
  deferNextFetch: () => { resolve: () => void };
};

/** Mounts the harness and waits for the controller's initial snapshot to render. */
async function mountScenario(options: { awaitSnapshot?: boolean } = {}): Promise<Scenario> {
  const awaitSnapshot = options.awaitSnapshot ?? true;
  FakeSocket.instances = [];
  const timings: Scenario["timings"] = { snapshot: [], keystroke: [] };
  const selections: string[] = [];
  let nextSnapshot = makeSnapshot(1);
  let calls = 0;
  let deferred: { promise: Promise<void>; resolve: () => void } | null = null;

  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    calls += 1;
    const url = String(input);
    if (!url.endsWith("/api/snapshot")) throw new Error(`unexpected fetch: ${url}`);
    if (deferred) {
      const pending = deferred;
      deferred = null;
      await pending.promise;
    }
    return new Response(JSON.stringify(nextSnapshot), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  root.render(
    <Harness
      runtime={makeRuntime()}
      onSnapshotCommit={(info) => timings.snapshot.push(info)}
      onKeystrokeCommit={(at) => timings.keystroke.push(at)}
      onSelection={(paneId) => selections.push(paneId)}
    />,
  );

  if (awaitSnapshot) {
    await waitFor(
      () =>
        container.querySelector('[data-testid="selected"]')?.textContent === "pane-0" &&
        container.querySelectorAll("li").length === PANE_COUNT,
    );
  } else {
    await waitFor(
      () =>
        container.querySelector('[data-testid="selected"]') !== null &&
        FakeSocket.instances.some((socket) => socket.url.endsWith("/ws/ui-events")),
    );
  }

  return {
    container,
    timings,
    selections,
    fetchCalls: () => calls,
    setNextSnapshot: (snapshot) => {
      nextSnapshot = snapshot;
    },
    deferNextFetch: () => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      deferred = { promise, resolve };
      return { resolve };
    },
  };
}

/**
 * Arms a keystroke to arrive `KEYSTROKE_DELAY_MS` after `trigger()` starts the
 * snapshot update, then reports when the keystroke was actually handled.
 */
async function raceKeystrokeAgainst(
  scenario: Scenario,
  trigger: () => void,
  expectSnapshot: () => boolean,
): Promise<Timing> {
  const snapshotCommitsBefore = scenario.timings.snapshot.length;
  rowRenderLog.length = 0;
  let keystrokeDispatchedAt = 0;
  const keystrokeDueAt = performance.now() + KEYSTROKE_DELAY_MS;
  setTimeout(() => {
    keystrokeDispatchedAt = performance.now();
    typeKeystroke(scenario.container, "a");
  }, KEYSTROKE_DELAY_MS);

  trigger();

  await waitFor(() => scenario.timings.keystroke.length > 0 && expectSnapshot());
  const snapshotCommit = scenario.timings.snapshot[snapshotCommitsBefore];
  const keystrokeCommittedAt = scenario.timings.keystroke[0];
  const firstRowRenderAt = rowRenderLog[0] ?? 0;
  const snapshotCommittedAt = snapshotCommit?.at ?? 0;
  return {
    keystrokeDueAt,
    keystrokeDispatchedAt,
    keystrokeCommittedAt,
    snapshotCommittedAt,
    snapshotRenderMs: snapshotCommittedAt - firstRowRenderAt,
    rowsRenderedBeforeKeystroke: rowRenderLog.filter((at) => at < keystrokeCommittedAt).length,
    rowsRenderedAfterKeystroke: rowRenderLog.filter((at) => at > keystrokeCommittedAt).length,
  };
}

function report(label: string, timing: Timing) {
  const handledMs = timing.keystrokeCommittedAt - timing.keystrokeDueAt;
  // Printed so the measurement itself is reviewable evidence, not just a boolean.
  console.log(
    `[${label}] keystroke reached the DOM ${handledMs.toFixed(1)}ms after it was typed; ` +
      `snapshot reconciliation of ${PANE_COUNT} panes spanned ${timing.snapshotRenderMs.toFixed(1)}ms ` +
      `(${timing.rowsRenderedBeforeKeystroke} pane rows rendered before the keystroke, ` +
      `${timing.rowsRenderedAfterKeystroke} after)`,
  );
  return handledMs;
}

function assertKeystrokeWasNotBlocked(label: string, timing: Timing) {
  const handledMs = report(label, timing);
  // The reconciliation must actually be expensive, or the race proves nothing.
  expect(timing.snapshotRenderMs).toBeGreaterThan(KEYSTROKE_BUDGET_MS * 2);
  // Blocking-lane reconciliation makes these two numbers equal (the keystroke waits
  // for the whole render); a transition keeps the keystroke far ahead of it. The
  // ratio, rather than a fixed millisecond budget, keeps this stable on slow hosts.
  expect(handledMs * 3).toBeLessThan(timing.snapshotRenderMs);
  expect(handledMs).toBeLessThan(KEYSTROKE_BUDGET_MS);
  // Typing reached the screen before snapshot reconciliation committed...
  expect(timing.keystrokeCommittedAt).toBeLessThan(timing.snapshotCommittedAt);
  // ...with most of the pane tree still left to reconcile at that point.
  expect(timing.rowsRenderedAfterKeystroke).toBeGreaterThan(PANE_COUNT / 2);
}

// Each test renders a deliberately expensive tree several times, so allow well
// more than vitest's 5s default on a loaded machine.
const TEST_TIMEOUT_MS = 30000;

describe("snapshot updates do not block keystrokes", () => {
  it("keeps typing responsive while a polled snapshot refresh reconciles", async () => {
    // Fake timers are installed before mount so the controller's own 10s poll
    // timer is the thing that fires; real timers come back for the render race.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const scenario = await mountScenario();
    const fetchesAfterMount = scenario.fetchCalls();
    const gate = scenario.deferNextFetch();
    scenario.setNextSnapshot({ ...makeSnapshot(2), selected_pane_id: "pane-7" });

    vi.advanceTimersByTime(SNAPSHOT_REFRESH_INTERVAL_MS * 2 + 50);
    await Promise.resolve();
    vi.useRealTimers();
    expect(scenario.fetchCalls()).toBeGreaterThan(fetchesAfterMount);

    const timing = await raceKeystrokeAgainst(
      scenario,
      () => gate.resolve(),
      () =>
        scenario.container.querySelector('[data-testid="selected"]')?.textContent === "pane-7",
    );

    assertKeystrokeWasNotBlocked("poll", timing);
    expect(
      scenario.container.querySelector<HTMLInputElement>('[data-testid="keystroke"]')?.value,
    ).toBe("a");
  }, TEST_TIMEOUT_MS);

  it("keeps typing responsive while an agent-status activity burst reconciles", async () => {
    const scenario = await mountScenario();
    const activity = FakeSocket.bySuffix("/ws/activity");

    const timing = await raceKeystrokeAgainst(
      scenario,
      () =>
        activity.emit(
          JSON.stringify({
            type: "pane.agent_status_changed",
            pane_id: "pane-0",
            workspace_id: "ws-1",
            agent_status: "working",
            agent: "claude",
            title: "pane 0",
            display_agent: "claude",
            state_labels: {},
          }),
        ),
      () =>
        scenario.container.querySelector('[data-testid="pane-0-status"]')?.textContent ===
        "working",
    );

    assertKeystrokeWasNotBlocked("activity", timing);
  }, TEST_TIMEOUT_MS);

  it("keeps typing responsive while a shared selection event reconciles", async () => {
    const scenario = await mountScenario();
    const uiEvents = FakeSocket.bySuffix("/ws/ui-events");

    const timing = await raceKeystrokeAgainst(
      scenario,
      () =>
        uiEvents.emit(
          JSON.stringify({ type: "herdr_web.selection_changed", pane_id: "pane-9" }),
        ),
      () =>
        scenario.container.querySelector('[data-testid="selected"]')?.textContent === "pane-9",
    );

    assertKeystrokeWasNotBlocked("selection", timing);
    // The follow-selection callback still runs with the snapshot it was paired with.
    expect(scenario.selections).toEqual(["pane-9"]);
  }, TEST_TIMEOUT_MS);

  it("still follows a shared selection that arrives before the first snapshot", async () => {
    const scenario = await mountScenario({ awaitSnapshot: false });
    scenario.deferNextFetch();
    const uiEvents = FakeSocket.bySuffix("/ws/ui-events");

    uiEvents.emit(JSON.stringify({ type: "herdr_web.selection_changed", pane_id: "pane-3" }));

    await waitFor(() => scenario.selections.length > 0);
    expect(scenario.selections).toEqual(["pane-3"]);
    expect(scenario.container.querySelector('[data-testid="selected"]')?.textContent).toBe("none");
  }, TEST_TIMEOUT_MS);
});
