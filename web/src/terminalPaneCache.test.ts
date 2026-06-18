import { describe, expect, it } from "vitest";
import {
  MAX_CACHED_TERMINALS,
  promoteCachedPaneId,
  pruneCachedPaneIds,
} from "./terminalPaneCache";
import type { PaneInfo, Snapshot } from "./types";

const pane = (pane_id: string) =>
  ({
    pane_id,
    terminal_id: `terminal-${pane_id}`,
    workspace_id: "workspace-1",
    tab_id: "tab-1",
    agent_status: "idle",
    focused: false,
    revision: 1,
  }) satisfies PaneInfo;

const snapshot = (paneIds: string[]): Snapshot => ({
  workspaces: [],
  tabs: [],
  panes: paneIds.map(pane),
  layouts: [],
});

describe("terminal pane cache", () => {
  it("promotes the active pane without changing identity when it is already first", () => {
    const cache = ["pane-2", "pane-1"];

    expect(promoteCachedPaneId(cache, "pane-2", snapshot(["pane-1", "pane-2"]))).toBe(cache);
  });

  it("promotes recently active panes and evicts the oldest entries", () => {
    const cache = Array.from({ length: MAX_CACHED_TERMINALS }, (_, index) => `pane-${index}`);
    const next = promoteCachedPaneId(
      cache,
      "pane-new",
      snapshot(["pane-new", ...cache]),
    );

    expect(next).toEqual(["pane-new", ...cache.slice(0, MAX_CACHED_TERMINALS - 1)]);
  });

  it("prunes panes that disappeared from the snapshot", () => {
    expect(pruneCachedPaneIds(["pane-1", "pane-2"], snapshot(["pane-2"]))).toEqual([
      "pane-2",
    ]);
  });

  it("clears the cache when there is no current snapshot", () => {
    expect(pruneCachedPaneIds(["pane-1"], null)).toEqual([]);
  });
});
