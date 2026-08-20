import { describe, expect, it } from "vitest";
import type { WorkspaceInfo } from "./types";
import {
  workspaceMoveBlockParams,
  workspaceReorderBlockIds,
  workspaceReorderDestination,
  workspaceReorderRoots,
} from "./workspaceReorder";

describe("workspace reordering", () => {
  it("moves ordinary workspaces as single-item blocks", () => {
    const workspaces = [workspace("a", 1), workspace("b", 2), workspace("c", 3)];

    expect(workspaceMoveBlockParams(workspaces, "b", "a")).toEqual({
      workspaceIds: ["b"],
      beforeWorkspaceId: "a",
    });
    expect(workspaceMoveBlockParams(workspaces, "b", "c")).toBeNull();
    expect(workspaceMoveBlockParams(workspaces, "b", null)).toEqual({
      workspaceIds: ["b"],
      beforeWorkspaceId: null,
    });
  });

  it("moves a worktree root and its linked workspaces atomically", () => {
    const workspaces = [
      worktree("root", 1, "repo", false),
      worktree("child-a", 2, "repo", true),
      worktree("child-b", 3, "repo", true),
      workspace("other", 4),
    ];

    expect(workspaceReorderRoots(workspaces).map((entry) => entry.workspace_id)).toEqual([
      "root",
      "other",
    ]);
    expect(workspaceReorderBlockIds(workspaces, "root")).toEqual([
      "root",
      "child-a",
      "child-b",
    ]);
    expect(workspaceMoveBlockParams(workspaces, "root", null)).toEqual({
      workspaceIds: ["root", "child-a", "child-b"],
      beforeWorkspaceId: null,
    });
    expect(workspaceMoveBlockParams(workspaces, "child-a", null)).toBeNull();
  });

  it("maps keyboard movement to stable before-workspace anchors", () => {
    const workspaces = [workspace("a", 1), workspace("b", 2), workspace("c", 3)];

    expect(workspaceReorderDestination(workspaces, "b", "up")).toBe("a");
    expect(workspaceReorderDestination(workspaces, "b", "down")).toBeNull();
    expect(workspaceReorderDestination(workspaces, "c", "top")).toBe("a");
    expect(workspaceReorderDestination(workspaces, "a", "bottom")).toBeNull();
    expect(workspaceReorderDestination(workspaces, "a", "up")).toBeUndefined();
  });
});

function workspace(workspaceId: string, number: number): WorkspaceInfo {
  return {
    workspace_id: workspaceId,
    number,
    label: workspaceId,
    focused: false,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: `tab-${workspaceId}`,
    agent_status: "unknown",
  };
}

function worktree(
  workspaceId: string,
  number: number,
  repoKey: string,
  linked: boolean,
): WorkspaceInfo {
  return {
    ...workspace(workspaceId, number),
    worktree: {
      repo_key: repoKey,
      repo_name: "repo",
      repo_root: "/repo",
      checkout_path: `/repo/${workspaceId}`,
      is_linked_worktree: linked,
    },
  };
}
