import { describe, expect, it } from "vitest";
import { applyStateMessage, emptyStateStreamModel, isStateMessage } from "./stateStream";
import type { LayoutSnapshot, PaneInfo, Snapshot, TabInfo, WorkspaceInfo } from "./types";

const workspace = (overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo => ({
  workspace_id: "w1",
  number: 1,
  label: "repo",
  focused: true,
  pane_count: 1,
  tab_count: 1,
  active_tab_id: "t1",
  agent_status: "idle",
  can_clear_name: false,
  ...overrides,
});

const tab = (overrides: Partial<TabInfo> = {}): TabInfo => ({
  tab_id: "t1",
  workspace_id: "w1",
  number: 1,
  label: "main",
  focused: true,
  pane_count: 1,
  agent_status: "idle",
  can_clear_name: true,
  ...overrides,
});

const pane = (overrides: Partial<PaneInfo> = {}): PaneInfo => ({
  pane_id: "p1",
  terminal_id: "term-1",
  workspace_id: "w1",
  tab_id: "t1",
  focused: true,
  agent_status: "idle",
  revision: 1,
  ...overrides,
});

const layout = (overrides: Partial<LayoutSnapshot> = {}): LayoutSnapshot => ({
  workspace_id: "w1",
  tab_id: "t1",
  zoomed: false,
  area: { x: 0, y: 0, width: 80, height: 24 },
  focused_pane_id: "p1",
  panes: [{ pane_id: "p1", focused: true, rect: { x: 0, y: 0, width: 80, height: 24 } }],
  splits: [],
  ...overrides,
});

const snapshot = (): Snapshot => ({
  workspaces: [workspace()],
  tabs: [tab()],
  panes: [pane()],
  layouts: [layout()],
  selected_pane_id: "p1",
});

describe("state stream reducer", () => {
  it("replaces state on snapshot and rebases the expected sequence", () => {
    const result = applyStateMessage(emptyStateStreamModel, {
      type: "snapshot",
      generation: 7,
      sequence: 12,
      stream_id: "stream-1",
      snapshot: snapshot(),
    });

    expect(result.status).toBe("applied");
    expect(result.model.generation).toBe(7);
    expect(result.model.nextSequence).toBe(13);
    expect(result.model.streamId).toBe("stream-1");
  });

  it("patches pane status and preserves snapshot wrapper fields", () => {
    const initial = applyStateMessage(emptyStateStreamModel, {
      type: "snapshot",
      generation: 1,
      sequence: 1,
      snapshot: snapshot(),
    });
    const result = applyStateMessage(initial.model, {
      type: "pane.agent_status_changed",
      generation: 1,
      sequence: 2,
      pane: pane({ agent_status: "blocked" }),
      workspace: workspace({ agent_status: "blocked", can_clear_name: false }),
      tab: tab({ agent_status: "blocked", can_clear_name: true }),
    });

    expect(result.status).toBe("applied");
    expect(result.model.snapshot?.panes[0].agent_status).toBe("blocked");
    expect(result.model.snapshot?.workspaces[0].can_clear_name).toBe(false);
    expect(result.model.snapshot?.tabs[0].can_clear_name).toBe(true);
  });

  it("triggers resync instead of upserting unknown panes from agent deltas", () => {
    const initial = applyStateMessage(emptyStateStreamModel, {
      type: "snapshot",
      generation: 1,
      sequence: 1,
      snapshot: snapshot(),
    });
    const result = applyStateMessage(initial.model, {
      type: "pane.agent_detected",
      generation: 1,
      sequence: 2,
      pane: pane({ pane_id: "p2" }),
      workspace: workspace(),
      tab: tab(),
    });

    expect(result.status).toBe("resync");
    if (result.status === "resync") {
      expect(result.reason).toContain("unknown pane p2");
    }
    expect(result.model.snapshot?.panes).toHaveLength(1);
  });

  it("triggers resync on sequence gaps and generation mismatches", () => {
    const initial = applyStateMessage(emptyStateStreamModel, {
      type: "snapshot",
      generation: 1,
      sequence: 1,
      snapshot: snapshot(),
    });

    expect(
      applyStateMessage(initial.model, {
        type: "selection.changed",
        generation: 1,
        sequence: 3,
        pane_id: "p1",
      }).status,
    ).toBe("resync");
    expect(
      applyStateMessage(initial.model, {
        type: "selection.changed",
        generation: 2,
        sequence: 2,
        pane_id: "p1",
      }).status,
    ).toBe("resync");
  });

  it("applies valid selection changes and clears absent selected panes", () => {
    const initial = applyStateMessage(emptyStateStreamModel, {
      type: "snapshot",
      generation: 1,
      sequence: 1,
      snapshot: {
        ...snapshot(),
        panes: [pane(), pane({ pane_id: "p2", focused: false })],
        selected_pane_id: "p1",
      },
    });

    const selected = applyStateMessage(initial.model, {
      type: "selection.changed",
      generation: 1,
      sequence: 2,
      pane_id: "p2",
    });

    expect(selected.status).toBe("applied");
    if (selected.status !== "applied") {
      throw new Error("selection change should apply");
    }
    expect(selected.selectedPaneId).toBe("p2");
    expect(selected.model.snapshot?.selected_pane_id).toBe("p2");

    const missing = applyStateMessage(selected.model, {
      type: "selection.changed",
      generation: 1,
      sequence: 3,
      pane_id: "missing",
    });

    expect(missing.status).toBe("applied");
    if (missing.status !== "applied") {
      throw new Error("missing selection change should apply");
    }
    expect(missing.selectedPaneId).toBeNull();
    expect(missing.model.snapshot?.selected_pane_id).toBeNull();
  });

  it("triggers resync on bridge resync frames without applying partial state", () => {
    const initial = applyStateMessage(emptyStateStreamModel, {
      type: "snapshot",
      generation: 1,
      sequence: 1,
      snapshot: snapshot(),
    });

    const result = applyStateMessage(initial.model, {
      type: "resync_required",
      generation: 1,
      sequence: 2,
      reason: "subscription rebuild failed",
    });

    expect(result.status).toBe("resync");
    expect(result.model.nextSequence).toBe(3);
    expect(result.model.resyncPending).toBe(true);
    expect(result.model.snapshot?.panes).toHaveLength(1);
  });

  it("quarantines non-snapshot deltas while resync is pending", () => {
    const initial = applyStateMessage(emptyStateStreamModel, {
      type: "snapshot",
      generation: 1,
      sequence: 1,
      snapshot: snapshot(),
    });
    const resync = applyStateMessage(initial.model, {
      type: "resync_required",
      generation: 1,
      sequence: 2,
      reason: "refresh needed",
    });
    const result = applyStateMessage(resync.model, {
      type: "pane.agent_status_changed",
      generation: 1,
      sequence: 3,
      pane: pane({ agent_status: "working" }),
      workspace: workspace({ agent_status: "working" }),
      tab: tab({ agent_status: "working" }),
    });

    expect(result.status).toBe("resync");
    expect(result.model.snapshot?.panes[0].agent_status).toBe("idle");
  });

  it("rebases a resync-pending model when a follow-up snapshot arrives", () => {
    const initial = applyStateMessage(emptyStateStreamModel, {
      type: "snapshot",
      generation: 1,
      sequence: 1,
      stream_id: "stream-1",
      snapshot: snapshot(),
    });
    const resync = applyStateMessage(initial.model, {
      type: "resync_required",
      generation: 1,
      sequence: 2,
      reason: "rebuild failed",
      refresh_ids: ["refresh-1"],
    });

    expect(resync.status).toBe("resync");
    expect(resync.model.resyncPending).toBe(true);

    const recovered = applyStateMessage(resync.model, {
      type: "snapshot",
      generation: 2,
      sequence: 3,
      stream_id: "stream-1",
      refresh_ids: ["refresh-2"],
      snapshot: {
        ...snapshot(),
        panes: [pane({ agent_status: "working" })],
      },
    });

    expect(recovered.status).toBe("applied");
    expect(recovered.model.generation).toBe(2);
    expect(recovered.model.nextSequence).toBe(4);
    expect(recovered.model.resyncPending).toBe(false);
    expect(recovered.model.streamId).toBe("stream-1");
    expect(recovered.model.snapshot?.panes[0].agent_status).toBe("working");
  });

  it("rejects unknown sequenced message types at runtime", () => {
    expect(
      isStateMessage({
        type: "pane.removed",
        generation: 1,
        sequence: 2,
        pane_id: "p1",
      }),
    ).toBe(false);
  });

  it("triggers resync on bridge setup errors before the first snapshot", () => {
    const result = applyStateMessage(emptyStateStreamModel, {
      type: "error",
      generation: 0,
      sequence: 0,
      code: "state_setup_failed",
      message: "setup failed",
    });

    expect(result.status).toBe("resync");
    expect(result).toMatchObject({ reason: "setup failed" });
  });
});
