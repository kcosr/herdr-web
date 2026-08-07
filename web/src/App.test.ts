import { describe, expect, it } from "vitest";
import {
  buildVisibleAgentPaneEntries,
  buildVisibleScopedNotes,
  canAddNoteFromPaneMenu,
  mergeCreatedPaneNoteList,
  mergePendingPaneNotesIntoList,
  noteDraftStorageKey,
  buildVisibleScopedWorkspaces,
  buildVisibleTabEntries,
  isInFlightNoteSaveVisible,
  menuItems,
  nextVisibleAgentPaneEntry,
  nextVisibleTabEntry,
  resolveInitialSelectedBridgeId,
  resolveCreatedPaneNoteForTarget,
  paneNoteListContains,
  shouldBlockDirtyNoteAutosave,
  shouldCollapseHostScope,
  shouldShowLastStatusChangeSort,
  sortScopedAgentPanes,
  stableBridgeRefreshOffsetMs,
} from "./App";
import type { BridgeConnectionView } from "./App";
import type { BridgeRuntime } from "./bridge";
import { agentActivityKey } from "./agentActivity";
import {
  currentConnectionSnapshot,
  isConnectionResultCurrent,
} from "./connectionState";
import type { AgentStatus, PaneInfo, Snapshot, TabInfo, WorkspaceInfo } from "./types";
import { notesForPane } from "./notes";
import type { PaneNote } from "./notes";

describe("App connection guards", () => {
  it("hides snapshots from stale backend connections", () => {
    const snapshot = { panes: ["pane-a"] };

    expect(currentConnectionSnapshot(snapshot, "same-origin", "same-origin")).toBe(snapshot);
    expect(currentConnectionSnapshot(snapshot, "configured:a", "configured:b")).toBeNull();
  });

  it("rejects async results from stale backend connections", () => {
    expect(isConnectionResultCurrent("configured:a", "configured:a")).toBe(true);
    expect(isConnectionResultCurrent("configured:b", "configured:a")).toBe(false);
  });
});

describe("App multi-bridge helpers", () => {
  it("uses display preference selection before store fallback", () => {
    expect(resolveInitialSelectedBridgeId("bridge-b", ["bridge-a", "bridge-b"], "bridge-a")).toBe(
      "bridge-b",
    );
    expect(resolveInitialSelectedBridgeId("missing", ["bridge-a", "bridge-b"], "bridge-b")).toBe(
      "bridge-b",
    );
    expect(resolveInitialSelectedBridgeId(null, ["bridge-a", "bridge-b"], "missing")).toBe(
      "bridge-a",
    );
    expect(resolveInitialSelectedBridgeId(null, [], "bridge-a")).toBeNull();
  });

  it("does not collapse all-host scope before enabled bridges are loaded", () => {
    expect(shouldCollapseHostScope("all", 1, false)).toBe(false);
    expect(shouldCollapseHostScope("all", 1, true)).toBe(true);
    expect(shouldCollapseHostScope("all", 2, true)).toBe(false);
    expect(shouldCollapseHostScope("selected", 1, true)).toBe(false);
  });

  it("keeps bridge refresh offsets deterministic and inside the fallback interval", () => {
    const first = stableBridgeRefreshOffsetMs("bridge-a");
    expect(stableBridgeRefreshOffsetMs("bridge-a")).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(10000);
    expect(stableBridgeRefreshOffsetMs("bridge-b")).toBeLessThan(10000);
  });

  it("sorts scoped agents by bridge display order, workspace, tab, then scoped pane id", () => {
    const workspaceA = workspace("workspace-a", 2);
    const workspaceB = workspace("workspace-b", 1);
    const entries = [
      entry("bridge-b", 1, workspaceA, pane("pane-1", "workspace-a", "tab-2"), 2),
      entry("bridge-a", 0, workspaceA, pane("pane-1", "workspace-a", "tab-2"), 2),
      entry("bridge-a", 0, workspaceB, pane("pane-9", "workspace-b", "tab-1"), 1),
      entry("bridge-a", 0, workspaceA, pane("pane-2", "workspace-a", "tab-1"), 1),
    ];

    expect(
      sortScopedAgentPanes(entries, "workspace").map(
        (item) => `${item.bridgeId}:${item.pane.workspace_id}:${item.tabNumber}:${item.pane.pane_id}`,
      ),
    ).toEqual([
      "bridge-a:workspace-b:1:pane-9",
      "bridge-a:workspace-a:1:pane-2",
      "bridge-a:workspace-a:2:pane-1",
      "bridge-b:workspace-a:2:pane-1",
    ]);
  });

  it("builds visible agent entries across hosts for all-host shortcut navigation", () => {
    const bridgeViews = [
      bridgeView(
        "bridge-a",
        bridgeSnapshot("workspace-a", "tab-a", pane("pane-a", "workspace-a", "tab-a")),
      ),
      bridgeView(
        "bridge-b",
        bridgeSnapshot("workspace-b", "tab-b", pane("pane-b", "workspace-b", "tab-b")),
      ),
    ];

    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "all",
      "space",
      null,
      { "bridge-a": "workspace-a", "bridge-b": "workspace-b" },
    );

    expect(
      buildVisibleAgentPaneEntries(scopedWorkspaces, bridgeViews, "all", "none", "workspace").map(
        (item) => `${item.bridgeId}:${item.pane.pane_id}`,
      ),
    ).toEqual(["bridge-a:pane-a", "bridge-b:pane-b"]);
  });

  it("limits visible shortcut entries to the selected host in selected-host scope", () => {
    const bridgeViews = [
      bridgeView(
        "bridge-a",
        bridgeSnapshot("workspace-a", "tab-a", pane("pane-a", "workspace-a", "tab-a")),
      ),
      bridgeView(
        "bridge-b",
        bridgeSnapshot("workspace-b", "tab-b", pane("pane-b", "workspace-b", "tab-b")),
      ),
    ];

    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-b",
      "selected",
      "space",
      null,
      { "bridge-a": "workspace-a", "bridge-b": "workspace-b" },
    );

    expect(
      buildVisibleAgentPaneEntries(scopedWorkspaces, bridgeViews, "selected", "none", "workspace").map(
        (item) => `${item.bridgeId}:${item.pane.pane_id}`,
      ),
    ).toEqual(["bridge-b:pane-b"]);
  });

  it("keeps host/workspace grouped shortcut order aligned with the rendered sidebar", () => {
    const bridgeViews = [
      bridgeView(
        "bridge-a",
        bridgeSnapshot("workspace-a", "tab-a", pane("pane-a", "workspace-a", "tab-a", "idle")),
      ),
      bridgeView(
        "bridge-b",
        bridgeSnapshot("workspace-b", "tab-b", pane("pane-b", "workspace-b", "tab-b", "blocked")),
      ),
    ];

    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "all",
      "space",
      null,
      { "bridge-a": "workspace-a", "bridge-b": "workspace-b" },
    );

    expect(
      buildVisibleAgentPaneEntries(
        scopedWorkspaces,
        bridgeViews,
        "all",
        "hostWorkspace",
        "attention",
      ).map((item) => `${item.bridgeId}:${item.pane.pane_id}`),
    ).toEqual(["bridge-a:pane-a", "bridge-b:pane-b"]);
  });

  it("allows flat all-host agent shortcuts to follow attention priority across hosts", () => {
    const bridgeViews = [
      bridgeView(
        "bridge-a",
        bridgeSnapshot("workspace-a", "tab-a", pane("pane-a", "workspace-a", "tab-a", "idle")),
      ),
      bridgeView(
        "bridge-b",
        bridgeSnapshot("workspace-b", "tab-b", pane("pane-b", "workspace-b", "tab-b", "blocked")),
      ),
    ];

    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "all",
      "space",
      null,
      { "bridge-a": "workspace-a", "bridge-b": "workspace-b" },
    );

    expect(
      buildVisibleAgentPaneEntries(scopedWorkspaces, bridgeViews, "all", "none", "attention").map(
        (item) => `${item.bridgeId}:${item.pane.pane_id}`,
      ),
    ).toEqual(["bridge-b:pane-b", "bridge-a:pane-a"]);
  });

  it("promotes pinned agents within their current group", () => {
    const snapshot = multiPaneSnapshot(
      [workspace("workspace-a", 1)],
      [
        pane("pane-a", "workspace-a", "tab-a", "idle"),
        pane("pane-b", "workspace-a", "tab-a", "idle"),
      ],
    );
    const bridgeViews = [bridgeView("bridge-a", snapshot)];
    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "selected",
      "all",
      null,
      {},
    );

    expect(
      buildVisibleAgentPaneEntries(
        scopedWorkspaces,
        bridgeViews,
        "selected",
        "workspace",
        "workspace",
        new Set(["bridge-a:pane-b"]),
      ).map((item) => item.pane.pane_id),
    ).toEqual(["pane-b", "pane-a"]);
  });

  it("sorts agents by last status change", () => {
    const snapshot = multiPaneSnapshot(
      [workspace("workspace-a", 1)],
      [
        pane("pane-a", "workspace-a", "tab-a", "idle"),
        pane("pane-b", "workspace-a", "tab-a", "idle"),
        pane("pane-c", "workspace-a", "tab-a", "idle"),
      ],
    );
    const bridgeViews = [bridgeView("bridge-a", snapshot)];
    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "selected",
      "all",
      null,
      {},
    );
    const activity = new Map([
      [agentActivityKey("bridge-a", "pane-a", "pane-a-terminal"), 100],
      [agentActivityKey("bridge-a", "pane-b", "pane-b-terminal"), 300],
    ]);

    expect(
      buildVisibleAgentPaneEntries(
        scopedWorkspaces,
        bridgeViews,
        "selected",
        "none",
        "lastStatusChange",
        new Set(),
        false,
        activity,
      ).map((item) => item.pane.pane_id),
    ).toEqual(["pane-b", "pane-a", "pane-c"]);
  });

  it("keeps pinned agents before last-status-change sorting", () => {
    const snapshot = multiPaneSnapshot(
      [workspace("workspace-a", 1)],
      [
        pane("pane-a", "workspace-a", "tab-a", "idle"),
        pane("pane-b", "workspace-a", "tab-a", "idle"),
      ],
    );
    const bridgeViews = [bridgeView("bridge-a", snapshot)];
    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "selected",
      "all",
      null,
      {},
    );
    const activity = new Map([
      [agentActivityKey("bridge-a", "pane-a", "pane-a-terminal"), 100],
      [agentActivityKey("bridge-a", "pane-b", "pane-b-terminal"), 300],
    ]);

    expect(
      buildVisibleAgentPaneEntries(
        scopedWorkspaces,
        bridgeViews,
        "selected",
        "none",
        "lastStatusChange",
        new Set(["bridge-a:pane-a"]),
        false,
        activity,
      ).map((item) => item.pane.pane_id),
    ).toEqual(["pane-a", "pane-b"]);
  });

  it("does not reorder workspace groups for last status change", () => {
    const snapshot = multiPaneSnapshot(
      [workspace("workspace-a", 1), workspace("workspace-b", 2)],
      [
        pane("pane-a", "workspace-a", "tab-a", "idle"),
        pane("pane-b", "workspace-b", "tab-b", "idle"),
      ],
    );
    const bridgeViews = [bridgeView("bridge-a", snapshot)];
    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "selected",
      "all",
      null,
      {},
    );
    const activity = new Map([
      [agentActivityKey("bridge-a", "pane-a", "pane-a-terminal"), 100],
      [agentActivityKey("bridge-a", "pane-b", "pane-b-terminal"), 500],
    ]);

    expect(
      buildVisibleAgentPaneEntries(
        scopedWorkspaces,
        bridgeViews,
        "selected",
        "workspace",
        "lastStatusChange",
        new Set(),
        false,
        activity,
      ).map((item) => `${item.workspace?.workspace_id}:${item.pane.pane_id}`),
    ).toEqual(["workspace-a:pane-a", "workspace-b:pane-b"]);
  });

  it("gates the last-status sort option on capability or persisted selection", () => {
    expect(shouldShowLastStatusChangeSort(true, "attention")).toBe(true);
    expect(shouldShowLastStatusChangeSort(false, "attention")).toBe(false);
    expect(shouldShowLastStatusChangeSort(false, "lastStatusChange")).toBe(true);
  });

  it("keeps existing sort row order stable across agent grouping modes and host scopes", () => {
    const bridgeViews = agentParityBridgeViews();

    for (const hostScope of ["selected", "all"] as const) {
      const scopedWorkspaces = buildVisibleScopedWorkspaces(
        bridgeViews,
        "bridge-a",
        hostScope,
        "all",
        null,
        {},
      );
      for (const sort of ["attention", "status", "workspace"] as const) {
        const expected = visibleAgentPaneOrder(
          scopedWorkspaces,
          bridgeViews,
          hostScope,
          "none",
          sort,
        );
        for (const group of ["none", "host", "workspace", "hostWorkspace"] as const) {
          expect(
            visibleAgentPaneOrder(scopedWorkspaces, bridgeViews, hostScope, group, sort),
          ).toEqual(expected);
        }
      }
    }
  });

  it("filters agents to pinned rows without reordering groups", () => {
    const snapshot = multiPaneSnapshot(
      [workspace("workspace-a", 1), workspace("workspace-b", 2)],
      [
        pane("pane-a", "workspace-a", "tab-a", "idle"),
        pane("pane-b", "workspace-b", "tab-b", "idle"),
      ],
    );
    const bridgeViews = [bridgeView("bridge-a", snapshot)];
    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "selected",
      "all",
      null,
      {},
    );

    expect(
      buildVisibleAgentPaneEntries(
        scopedWorkspaces,
        bridgeViews,
        "selected",
        "workspace",
        "workspace",
        new Set(["bridge-a:pane-a", "bridge-a:pane-b"]),
        true,
      ).map((item) => `${item.workspace?.workspace_id}:${item.pane.pane_id}`),
    ).toEqual(["workspace-a:pane-a", "workspace-b:pane-b"]);
  });

  it("filters agents to active statuses before workspace grouping", () => {
    const snapshot = multiPaneSnapshot(
      [workspace("workspace-a", 1), workspace("workspace-b", 2), workspace("workspace-c", 3)],
      [
        pane("pane-a", "workspace-a", "tab-a", "idle"),
        pane("pane-b", "workspace-b", "tab-b", "working"),
        pane("pane-c", "workspace-c", "tab-c", "done"),
      ],
    );
    const bridgeViews = [bridgeView("bridge-a", snapshot)];
    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "selected",
      "all",
      null,
      {},
    );

    expect(
      buildVisibleAgentPaneEntries(
        scopedWorkspaces,
        bridgeViews,
        "selected",
        "workspace",
        "workspace",
        new Set(),
        false,
        new Map(),
        true,
      ).map((item) => `${item.workspace?.workspace_id}:${item.pane.pane_id}`),
    ).toEqual(["workspace-b:pane-b", "workspace-c:pane-c"]);
  });

  it("combines pinned and active-status agent filters", () => {
    const snapshot = multiPaneSnapshot(
      [workspace("workspace-a", 1)],
      [
        pane("pane-a", "workspace-a", "tab-a", "idle"),
        pane("pane-b", "workspace-a", "tab-b", "working"),
        pane("pane-c", "workspace-a", "tab-c", "blocked"),
      ],
    );
    const bridgeViews = [bridgeView("bridge-a", snapshot)];
    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "selected",
      "all",
      null,
      {},
    );

    expect(
      buildVisibleAgentPaneEntries(
        scopedWorkspaces,
        bridgeViews,
        "selected",
        "none",
        "workspace",
        new Set(["bridge-a:pane-a", "bridge-a:pane-c"]),
        true,
        new Map(),
        true,
      ).map((item) => item.pane.pane_id),
    ).toEqual(["pane-c"]);
  });

  it("shows pin actions even when pane commands are not ready", () => {
    expect(menuItems("pane", false, false, true, false)).toEqual([
      { key: "pin", label: "Pin pane" },
    ]);
    expect(menuItems("pane", false, false, true, true)).toEqual([
      { key: "unpin", label: "Unpin pane" },
    ]);
    expect(menuItems("pane", false, false, true, false, "agent")).toEqual([
      { key: "pin", label: "Pin agent" },
    ]);
    expect(menuItems("pane", false, false, true, true, "agent")).toEqual([
      { key: "unpin", label: "Unpin agent" },
    ]);
  });

  it("shows add-note actions only for eligible pane menus", () => {
    expect(menuItems("pane", false, false, false, false, "pane", true)).toEqual([
      { key: "add_note", label: "Add note" },
    ]);
    expect(menuItems("pane", false, false, true, false, "agent", true)).toEqual([
      { key: "pin", label: "Pin agent" },
      { key: "add_note", label: "Add note" },
    ]);
    expect(menuItems("space", false, false, false, false, "pane", true)).toEqual([]);
    expect(menuItems("tab", false, false, false, false, "pane", true)).toEqual([]);
  });

  it("requires a current note-capable pane before showing add-note", () => {
    const eligible = {
      kind: "pane" as const,
      notesEnabled: true,
      runtimeCanConnect: true,
      capabilityState: "ready" as const,
      notesSupported: true,
      runtimeConnectionKey: "configured:one",
      stateConnectionKey: "configured:one",
      paneExists: true,
    };

    expect(canAddNoteFromPaneMenu(eligible)).toBe(true);
    expect(canAddNoteFromPaneMenu({ ...eligible, kind: "tab" })).toBe(false);
    expect(canAddNoteFromPaneMenu({ ...eligible, notesEnabled: false })).toBe(false);
    expect(canAddNoteFromPaneMenu({ ...eligible, runtimeCanConnect: false })).toBe(false);
    expect(canAddNoteFromPaneMenu({ ...eligible, capabilityState: "probing" })).toBe(false);
    expect(canAddNoteFromPaneMenu({ ...eligible, notesSupported: false })).toBe(false);
    expect(
      canAddNoteFromPaneMenu({ ...eligible, stateConnectionKey: "configured:two" }),
    ).toBe(false);
    expect(canAddNoteFromPaneMenu({ ...eligible, paneExists: false })).toBe(false);
  });

  it("normalizes created notes so they are visible as pane notes", () => {
    const targetPane = pane("pane-a", "workspace-a", "tab-a");
    const rawNote: PaneNote = {
      ...note("new", "workspace-b", "unresolved"),
      attachment: null,
      link_state: "detached",
      updated_at: "300",
    };
    const olderPaneNote = {
      ...resolveCreatedPaneNoteForTarget(note("older", "workspace-a", "linked"), targetPane),
      updated_at: "100",
    };
    const staleServerNote = {
      ...rawNote,
      title: "Server title",
      updated_at: "400",
    };

    const resolved = resolveCreatedPaneNoteForTarget(rawNote, targetPane);
    const merged = mergeCreatedPaneNoteList([olderPaneNote], rawNote, targetPane);
    const mergedWithServerCopy = mergeCreatedPaneNoteList([staleServerNote, olderPaneNote], rawNote, targetPane);

    expect(resolved.link_state).toBe("linked");
    expect(resolved.attachment?.pane_id).toBe(targetPane.pane_id);
    expect(resolved.resolved_pane?.pane_id).toBe(targetPane.pane_id);
    expect(paneNoteListContains([resolved], targetPane, rawNote.note_id)).toBe(true);
    expect(paneNoteListContains([rawNote], targetPane, rawNote.note_id)).toBe(false);
    expect(notesForPane(merged, targetPane.pane_id).map((item) => item.note_id)).toEqual([
      "new",
      "older",
    ]);
    expect(notesForPane(mergedWithServerCopy, targetPane.pane_id)[0]).toMatchObject({
      note_id: "new",
      title: "Server title",
    });
  });

  it("keeps pending created pane notes through lagging refreshes", () => {
    const targetPane = pane("pane-a", "workspace-a", "tab-a");
    const rawNote: PaneNote = {
      ...note("new", "workspace-b", "unresolved"),
      attachment: null,
      link_state: "detached",
      updated_at: "300",
    };
    const olderPaneNote = {
      ...resolveCreatedPaneNoteForTarget(note("older", "workspace-a", "linked"), targetPane),
      updated_at: "100",
    };
    const serverLinkedNote = resolveCreatedPaneNoteForTarget(rawNote, targetPane);
    const serverDetachedNote = {
      ...rawNote,
      updated_at: "500",
    };
    const serverUnresolvedNote = {
      ...rawNote,
      link_state: "unresolved" as const,
      updated_at: "450",
    };

    const firstLaggingRefresh = mergePendingPaneNotesIntoList([], [
      { note: rawNote, pane: targetPane },
    ]);
    const secondLaggingRefresh = mergePendingPaneNotesIntoList([olderPaneNote], firstLaggingRefresh.pending);
    const serverDetachedRefresh = mergePendingPaneNotesIntoList(
      [serverDetachedNote, olderPaneNote],
      firstLaggingRefresh.pending,
    );
    const serverUnresolvedRefresh = mergePendingPaneNotesIntoList(
      [serverUnresolvedNote, olderPaneNote],
      firstLaggingRefresh.pending,
    );
    const serverCaughtUpRefresh = mergePendingPaneNotesIntoList(
      [serverLinkedNote, olderPaneNote],
      secondLaggingRefresh.pending,
    );

    expect(notesForPane(firstLaggingRefresh.notes, targetPane.pane_id).map((item) => item.note_id)).toEqual([
      "new",
    ]);
    expect(firstLaggingRefresh.pending).toHaveLength(1);
    expect(notesForPane(secondLaggingRefresh.notes, targetPane.pane_id).map((item) => item.note_id)).toEqual([
      "new",
      "older",
    ]);
    expect(secondLaggingRefresh.pending).toHaveLength(1);
    expect(notesForPane(serverDetachedRefresh.notes, targetPane.pane_id).map((item) => item.note_id)).toEqual([
      "older",
    ]);
    expect(serverDetachedRefresh.pending).toHaveLength(0);
    expect(notesForPane(serverUnresolvedRefresh.notes, targetPane.pane_id).map((item) => item.note_id)).toEqual([
      "older",
    ]);
    expect(serverUnresolvedRefresh.pending).toHaveLength(0);
    expect(notesForPane(serverCaughtUpRefresh.notes, targetPane.pane_id).map((item) => item.note_id)).toEqual([
      "new",
      "older",
    ]);
    expect(serverCaughtUpRefresh.pending).toHaveLength(0);
  });

  it("builds visible tab entries across hosts for all-host shortcut navigation", () => {
    const bridgeViews = [
      bridgeView(
        "bridge-a",
        bridgeSnapshot("workspace-a", "tab-a", pane("pane-a", "workspace-a", "tab-a")),
      ),
      bridgeView(
        "bridge-b",
        bridgeSnapshot("workspace-b", "tab-b", pane("pane-b", "workspace-b", "tab-b")),
      ),
    ];

    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "all",
      "space",
      null,
      { "bridge-a": "workspace-a", "bridge-b": "workspace-b" },
    );

    expect(
      buildVisibleTabEntries(scopedWorkspaces, bridgeViews, "all", "none").map(
        (item) => `${item.bridgeId}:${item.tab.tab_id}`,
      ),
    ).toEqual(["bridge-a:tab-a", "bridge-b:tab-b"]);
  });

  it("filters tab entries to pinned panes", () => {
    const snapshot = multiPaneSnapshot(
      [workspace("workspace-a", 1)],
      [
        pane("pane-a", "workspace-a", "tab-a"),
        pane("pane-b", "workspace-a", "tab-a"),
        pane("pane-c", "workspace-a", "tab-b"),
      ],
    );
    const bridgeViews = [bridgeView("bridge-a", snapshot)];
    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "selected",
      "all",
      null,
      {},
    );

    expect(
      buildVisibleTabEntries(
        scopedWorkspaces,
        bridgeViews,
        "selected",
        "none",
        new Set(["bridge-a:pane-b"]),
        true,
      ).map((entry) => ({
        tab: entry.tab.tab_id,
        panes: entry.panes.map((item) => item.pane_id),
      })),
    ).toEqual([{ tab: "tab-a", panes: ["pane-b"] }]);
  });

  it("navigates visible agent entries with fallback and wrap-around", () => {
    const bridgeViews = [
      bridgeView(
        "bridge-a",
        bridgeSnapshot("workspace-a", "tab-a", pane("pane-a", "workspace-a", "tab-a")),
      ),
      bridgeView(
        "bridge-b",
        bridgeSnapshot("workspace-b", "tab-b", pane("pane-b", "workspace-b", "tab-b")),
      ),
    ];
    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "all",
      "space",
      null,
      { "bridge-a": "workspace-a", "bridge-b": "workspace-b" },
    );
    const entries = buildVisibleAgentPaneEntries(
      scopedWorkspaces,
      bridgeViews,
      "all",
      "none",
      "workspace",
    );

    expect(nextVisibleAgentPaneEntry(entries, -1, 1).pane.pane_id).toBe("pane-a");
    expect(nextVisibleAgentPaneEntry(entries, -1, -1).pane.pane_id).toBe("pane-b");
    expect(nextVisibleAgentPaneEntry(entries, 0, -1).pane.pane_id).toBe("pane-b");
    expect(nextVisibleAgentPaneEntry(entries, 1, 1).pane.pane_id).toBe("pane-a");
  });

  it("navigates visible tab entries with fallback and wrap-around", () => {
    const bridgeViews = [
      bridgeView(
        "bridge-a",
        bridgeSnapshot("workspace-a", "tab-a", pane("pane-a", "workspace-a", "tab-a")),
      ),
      bridgeView(
        "bridge-b",
        bridgeSnapshot("workspace-b", "tab-b", pane("pane-b", "workspace-b", "tab-b")),
      ),
    ];
    const scopedWorkspaces = buildVisibleScopedWorkspaces(
      bridgeViews,
      "bridge-a",
      "all",
      "space",
      null,
      { "bridge-a": "workspace-a", "bridge-b": "workspace-b" },
    );
    const entries = buildVisibleTabEntries(scopedWorkspaces, bridgeViews, "all", "none");

    expect(nextVisibleTabEntry(entries, -1, 1).tab.tab_id).toBe("tab-a");
    expect(nextVisibleTabEntry(entries, -1, -1).tab.tab_id).toBe("tab-b");
    expect(nextVisibleTabEntry(entries, 0, -1).tab.tab_id).toBe("tab-b");
    expect(nextVisibleTabEntry(entries, 1, 1).tab.tab_id).toBe("tab-a");
  });

  it("keeps unresolved notes visible in space scope and filters archived/deleted notes explicitly", () => {
    const bridgeViews = [
      bridgeView(
        "bridge-a",
        bridgeSnapshot("workspace-a", "tab-a", pane("pane-a", "workspace-a", "tab-a")),
      ),
    ];
    const notes = [
      note("active-linked", "workspace-a", "linked"),
      note("unresolved-other-space", "workspace-b", "unresolved"),
      { ...note("archived", "workspace-a", "linked"), archived_at: "500" },
      { ...note("deleted", "workspace-a", "linked"), deleted_at: "600" },
    ];

    expect(
      buildVisibleScopedNotes(
        bridgeViews,
        notesState("bridge-a", "store-1", notes),
        "bridge-a",
        "selected",
        "space",
        bridgeViews[0].snapshot?.workspaces[0] ?? null,
        { "bridge-a": "workspace-a" },
        false,
        false,
      ).map((entry) => entry.note.note_id),
    ).toEqual(["unresolved-other-space", "active-linked"]);

    expect(
      buildVisibleScopedNotes(
        bridgeViews,
        notesState("bridge-a", "store-1", notes),
        "bridge-a",
        "selected",
        "space",
        bridgeViews[0].snapshot?.workspaces[0] ?? null,
        { "bridge-a": "workspace-a" },
        true,
        true,
      ).map((entry) => entry.note.note_id),
    ).toEqual(["deleted", "archived", "unresolved-other-space", "active-linked"]);
  });

  it("dedupes all-host notes by note identity when two bridge profiles point at the same store", () => {
    const bridgeViews = [
      bridgeView(
        "bridge-a",
        bridgeSnapshot("workspace-a", "tab-a", pane("pane-a", "workspace-a", "tab-a")),
      ),
      bridgeView(
        "bridge-b",
        bridgeSnapshot("workspace-a", "tab-a", pane("pane-a", "workspace-a", "tab-a")),
      ),
    ];
    const sharedFromOtherSession = {
      ...note("shared", "workspace-a", "linked"),
      session_key: "session:bridge-b",
    };
    const sharedFromOwningSession = {
      ...sharedFromOtherSession,
      resolved_pane: pane("workspace-a-pane", "workspace-a", "tab-a"),
    };

    expect(
      buildVisibleScopedNotes(
        bridgeViews,
        {
          ...notesState(
            "bridge-a",
            "shared-store",
            [note("a", "workspace-a", "linked"), sharedFromOtherSession],
            "session:bridge-a",
          ),
          ...notesState(
            "bridge-b",
            "shared-store",
            [note("b", "workspace-a", "linked"), sharedFromOwningSession],
            "session:bridge-b",
          ),
        },
        "bridge-a",
        "all",
        "all",
        null,
        {},
        false,
        false,
      ).map((entry) => `${entry.bridgeId}:${entry.note.session_key}:${entry.note.note_id}`),
    ).toEqual([
      "bridge-a:session:default:a",
      "bridge-b:session:default:b",
      "bridge-b:session:bridge-b:shared",
    ]);
  });

  it("scopes note drafts by bridge connection, store, session, and note id", () => {
    const bridgeViews = [
      bridgeView(
        "bridge-a",
        bridgeSnapshot("workspace-a", "tab-a", pane("pane-a", "workspace-a", "tab-a")),
      ),
    ];
    const [first] = buildVisibleScopedNotes(
      bridgeViews,
      notesState("bridge-a", "store-1", [note("n1", "workspace-a", "linked")]),
      "bridge-a",
      "selected",
      "all",
      null,
      {},
      false,
      false,
    );
    const changedSession = { ...first, sessionKey: "session:other" };

    expect(noteDraftStorageKey(first)).not.toBe(noteDraftStorageKey(changedSession));
    expect(noteDraftStorageKey(first)).toContain("store-1");
    expect(noteDraftStorageKey(first)).toContain("session%3Adefault");
  });

  it("scopes note drafts by the note owner session for other-session notes", () => {
    const bridgeViews = [
      bridgeView(
        "bridge-a",
        bridgeSnapshot("workspace-a", "tab-a", pane("pane-a", "workspace-a", "tab-a")),
      ),
    ];
    const [first] = buildVisibleScopedNotes(
      bridgeViews,
      notesState(
        "bridge-a",
        "store-1",
        [{ ...note("n1", "workspace-a", "linked"), session_key: "session:note-owner" }],
        "session:bridge-response",
      ),
      "bridge-a",
      "selected",
      "all",
      null,
      {},
      false,
      false,
    );

    expect(first.sessionKey).toBe("session:note-owner");
    expect(first.bridgeSessionKey).toBe("session:bridge-response");
    expect(noteDraftStorageKey(first)).toContain("session%3Anote-owner");
    expect(noteDraftStorageKey(first)).not.toContain("session%3Abridge-response");
  });

  it("blocks note autosave when the server revision advances under a dirty draft", () => {
    expect(
      shouldBlockDirtyNoteAutosave({
        dirty: true,
        title: "Local title",
        body: "Local draft",
        baseRevision: 1,
        serverTitle: "Remote title",
        serverBody: "Remote edit",
        serverRevision: 2,
      }),
    ).toBe(true);
    expect(
      shouldBlockDirtyNoteAutosave({
        dirty: true,
        title: "Remote title",
        body: "Remote edit",
        baseRevision: 1,
        serverTitle: "Remote title",
        serverBody: "Remote edit",
        serverRevision: 2,
      }),
    ).toBe(false);
    expect(
      shouldBlockDirtyNoteAutosave({
        dirty: true,
        title: "Local title",
        body: "Local draft",
        baseRevision: 1,
        serverTitle: "Original title",
        serverBody: "Original body",
        serverRevision: 1,
      }),
    ).toBe(false);
    expect(
      shouldBlockDirtyNoteAutosave({
        dirty: true,
        title: "Continued title",
        body: "Continued typing",
        baseRevision: 2,
        serverTitle: "Saved title",
        serverBody: "Saved body",
        serverRevision: 2,
      }),
    ).toBe(false);
  });

  it("recognizes the user's in-flight note save when a refetch exposes it", () => {
    const inFlight = {
      noteIdentity: "note-key",
      expectedRevision: 5,
      title: "Saved title",
      body: "Saved body",
    };

    expect(
      isInFlightNoteSaveVisible({
        inFlight,
        noteIdentity: "note-key",
        serverTitle: "Saved title",
        serverBody: "Saved body",
        serverRevision: 6,
      }),
    ).toBe(true);
    expect(
      isInFlightNoteSaveVisible({
        inFlight,
        noteIdentity: "note-key",
        serverTitle: "Remote title",
        serverBody: "Saved body",
        serverRevision: 6,
      }),
    ).toBe(false);
    expect(
      isInFlightNoteSaveVisible({
        inFlight,
        noteIdentity: "note-key",
        serverTitle: "Saved title",
        serverBody: "Saved body",
        serverRevision: 5,
      }),
    ).toBe(false);
  });
});

function entry(
  bridgeId: string,
  bridgeIndex: number,
  workspaceInfo: WorkspaceInfo,
  paneInfo: PaneInfo,
  tabNumber: number,
) {
  const snapshot: Snapshot = {
    workspaces: [workspaceInfo],
    tabs: [],
    panes: [paneInfo],
    layouts: [],
  };
  return {
    bridgeId,
    bridgeIndex,
    bridgeLabel: bridgeId,
    bridgeColor: "#89b4fa",
    pane: paneInfo,
    snapshot,
    workspace: workspaceInfo,
    tabNumber,
    tabLabel: `tab-${tabNumber}`,
  };
}

function workspace(workspaceId: string, number: number): WorkspaceInfo {
  return {
    workspace_id: workspaceId,
    number,
    label: workspaceId,
    focused: false,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: "tab-1",
    agent_status: "unknown",
  };
}

function pane(
  paneId: string,
  workspaceId: string,
  tabId: string,
  agentStatus: AgentStatus = "idle",
): PaneInfo {
  return {
    pane_id: paneId,
    terminal_id: `${paneId}-terminal`,
    workspace_id: workspaceId,
    tab_id: tabId,
    focused: false,
    agent_status: agentStatus,
    revision: 1,
  };
}

function bridgeView(bridgeId: string, snapshot: Snapshot): BridgeConnectionView {
  return {
    runtime: bridgeRuntime(bridgeId),
    snapshot,
    loadState: "ready",
  };
}

function agentParityBridgeViews(): BridgeConnectionView[] {
  return [
    bridgeView(
      "bridge-a",
      multiPaneSnapshot(
        [workspace("workspace-a", 1), workspace("workspace-b", 2)],
        [
          pane("pane-a", "workspace-a", "tab-a", "blocked"),
          pane("pane-b", "workspace-b", "tab-b", "working"),
        ],
      ),
    ),
    bridgeView(
      "bridge-b",
      multiPaneSnapshot(
        [workspace("workspace-a", 1)],
        [pane("pane-c", "workspace-a", "tab-c", "idle")],
      ),
    ),
  ];
}

function visibleAgentPaneOrder(
  scopedWorkspaces: ReturnType<typeof buildVisibleScopedWorkspaces>,
  bridgeViews: BridgeConnectionView[],
  hostScope: "selected" | "all",
  group: "none" | "host" | "workspace" | "hostWorkspace",
  sort: "attention" | "status" | "workspace",
) {
  return buildVisibleAgentPaneEntries(scopedWorkspaces, bridgeViews, hostScope, group, sort).map(
    (item) => `${item.bridgeId}:${item.pane.pane_id}`,
  );
}

function bridgeRuntime(bridgeId: string): BridgeRuntime {
  return {
    id: bridgeId,
    mode: "configured",
    proxied: false,
    label: bridgeId,
    color: "#89b4fa",
    backend: null,
    connectionKey: bridgeId,
    resumeToken: 0,
    capabilities: null,
    capabilityState: "ready",
    capabilityError: null,
    canConnect: true,
    httpUrl: (path) => `http://${bridgeId}${path}`,
    wsUrl: (path) => `ws://${bridgeId}${path}`,
  };
}

function bridgeSnapshot(workspaceId: string, tabId: string, paneInfo: PaneInfo): Snapshot {
  const workspaceInfo: WorkspaceInfo = {
    ...workspace(workspaceId, 1),
    active_tab_id: tabId,
    agent_status: paneInfo.agent_status,
  };
  const tabInfo: TabInfo = {
    tab_id: tabId,
    workspace_id: workspaceId,
    number: 1,
    label: tabId,
    focused: false,
    pane_count: 1,
    agent_status: paneInfo.agent_status,
  };
  return {
    workspaces: [workspaceInfo],
    tabs: [tabInfo],
    panes: [paneInfo],
    layouts: [],
  };
}

function multiPaneSnapshot(workspaces: WorkspaceInfo[], panes: PaneInfo[]): Snapshot {
  const tabsById = new Map<string, TabInfo>();
  for (const paneInfo of panes) {
    if (tabsById.has(paneInfo.tab_id)) {
      continue;
    }
    tabsById.set(paneInfo.tab_id, {
      tab_id: paneInfo.tab_id,
      workspace_id: paneInfo.workspace_id,
      number: tabsById.size + 1,
      label: paneInfo.tab_id,
      focused: false,
      pane_count: panes.filter((item) => item.tab_id === paneInfo.tab_id).length,
      agent_status: paneInfo.agent_status,
    });
  }
  return {
    workspaces: workspaces.map((workspaceInfo) => ({
      ...workspaceInfo,
      pane_count: panes.filter((item) => item.workspace_id === workspaceInfo.workspace_id).length,
      tab_count: [...tabsById.values()].filter(
        (tabInfo) => tabInfo.workspace_id === workspaceInfo.workspace_id,
      ).length,
    })),
    tabs: [...tabsById.values()],
    panes,
    layouts: [],
  };
}

function notesState(
  bridgeId: string,
  storeId: string,
  notes: PaneNote[],
  sessionKey = "session:default",
) {
  return {
    [bridgeId]: {
      connectionKey: bridgeId,
      response: {
        store_id: storeId,
        session_key: sessionKey,
        notes,
      },
      loadState: "ready" as const,
      error: null,
    },
  };
}

function note(
  noteId: string,
  workspaceId: string,
  linkState: PaneNote["link_state"],
): PaneNote {
  const paneId = `${workspaceId}-pane`;
  return {
    note_id: noteId,
    title: noteId,
    body: "",
    created_at: "100",
    updated_at:
      noteId === "deleted"
        ? "600"
        : noteId === "archived"
          ? "500"
          : noteId === "unresolved-other-space"
            ? "300"
            : "200",
    session_key: "session:default",
    attachment: {
      type: "pane",
      pane_id: paneId,
      workspace_id: workspaceId,
      tab_id: "tab-a",
      terminal_id: `${paneId}-terminal`,
      captured_at: "100",
      context: {},
    },
    attachment_history: [],
    revision: 1,
    link_state: linkState,
    resolved_pane:
      linkState === "linked"
        ? pane(paneId, workspaceId, "tab-a")
        : undefined,
  };
}
