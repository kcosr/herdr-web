import { describe, expect, it } from "vitest";
import { applyStateMessage, emptyStateStreamModel } from "./stateStream";
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
      snapshot: snapshot(),
    });

    expect(result.status).toBe("applied");
    expect(result.model.generation).toBe(7);
    expect(result.model.nextSequence).toBe(13);
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

  it("removes dependent records when a workspace is removed", () => {
    const initial = applyStateMessage(emptyStateStreamModel, {
      type: "snapshot",
      generation: 1,
      sequence: 1,
      snapshot: snapshot(),
    });
    const result = applyStateMessage(initial.model, {
      type: "workspace.removed",
      generation: 1,
      sequence: 2,
      workspace_id: "w1",
    });

    expect(result.model.snapshot?.workspaces).toEqual([]);
    expect(result.model.snapshot?.tabs).toEqual([]);
    expect(result.model.snapshot?.panes).toEqual([]);
    expect(result.model.snapshot?.selected_pane_id).toBeNull();
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
    expect(result.model.snapshot?.panes).toHaveLength(1);
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
