import { describe, expect, it } from "vitest";
import { searchPanes } from "./paneSearch";
import type { PaneSearchEntry } from "./paneSearch";
import type { PaneInfo } from "./types";

function makePane(overrides: Partial<PaneInfo> = {}): PaneInfo {
  return {
    pane_id: "p1",
    terminal_id: "t1",
    workspace_id: "w1",
    tab_id: "tab1",
    focused: false,
    agent_status: "idle",
    revision: 1,
    ...overrides,
  };
}

function entry(overrides: Partial<PaneSearchEntry> = {}): PaneSearchEntry {
  return {
    bridgeId: "bridge-a",
    bridgeLabel: "Bridge A",
    pane: makePane(),
    path: "space/tab",
    ...overrides,
  };
}

describe("searchPanes", () => {
  it("returns every entry, unscored, for a blank query", () => {
    const entries = [entry(), entry({ bridgeId: "bridge-b" })];
    const results = searchPanes("  ", entries);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.score === 0)).toBe(true);
  });

  it("matches on pane label as an ordered subsequence", () => {
    const entries = [entry({ pane: makePane({ label: "deploy-worker" }) })];
    expect(searchPanes("dwkr", entries)).toHaveLength(1);
    expect(searchPanes("wdkr", entries)).toHaveLength(0);
  });

  it("matches on cwd, title, agent, and the workspace/tab path", () => {
    const cwdEntry = entry({ pane: makePane({ cwd: "/Users/trillium/code/herdr-web" }) });
    const titleEntry = entry({ pane: makePane({ title: "npm run test:web" }) });
    const agentEntry = entry({ pane: makePane({ agent: "claude" }) });
    const pathEntry = entry({ path: "main-space/release-tab" });
    expect(searchPanes("herdr", [cwdEntry])).toHaveLength(1);
    expect(searchPanes("testweb", [titleEntry])).toHaveLength(1);
    expect(searchPanes("claude", [agentEntry])).toHaveLength(1);
    expect(searchPanes("release", [pathEntry])).toHaveLength(1);
  });

  it("ranks consecutive and word-boundary matches above scattered ones", () => {
    const scattered = entry({
      bridgeId: "scattered",
      pane: makePane({ label: "x-b-r-i-d-g-e-x" }),
    });
    const boundary = entry({ bridgeId: "boundary", pane: makePane({ label: "bridge-two" }) });
    const results = searchPanes("bridge", [scattered, boundary]);
    expect(results.map((result) => result.bridgeId)).toEqual(["boundary", "scattered"]);
  });

  it("excludes entries with no match for the query", () => {
    const entries = [entry({ pane: makePane({ label: "alpha" }) })];
    expect(searchPanes("zzz", entries)).toHaveLength(0);
  });
});
