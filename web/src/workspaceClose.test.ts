import { describe, expect, it } from "vitest";
import { linkedWorkspaceLabels } from "./workspaceClose";
import type { WorkspaceInfo } from "./types";

function workspace(id: string, repoKey?: string, linked = false): WorkspaceInfo {
  return {
    workspace_id: id, label: id, number: 1, focused: false, pane_count: 1,
    tab_count: 1, active_tab_id: "tab", agent_status: "idle",
    worktree: repoKey ? {
      repo_key: repoKey, repo_name: repoKey, repo_root: "/repo", checkout_path: "/repo",
      is_linked_worktree: linked,
    } : undefined,
  };
}

describe("workspace group close confirmation", () => {
  const workspaces = [
    workspace("root", "repo"), workspace("child", "repo", true),
    workspace("other-root", "other"), workspace("other-child", "other", true),
    workspace("plain"), workspace("standalone", "standalone"),
  ];

  it("names only linked workspaces of the selected primary checkout", () => {
    expect(linkedWorkspaceLabels(workspaces, "root")).toEqual(["child"]);
  });

  it("does not authorize group closure for linked, plain, missing or standalone spaces", () => {
    for (const id of ["child", "plain", "missing", "standalone"]) {
      expect(linkedWorkspaceLabels(workspaces, id)).toEqual([]);
    }
  });

  it("includes every same-repository workspace that upstream would close", () => {
    expect(linkedWorkspaceLabels([
      ...workspaces, workspace("another-primary", "repo"),
    ], "root")).toEqual(["child", "another-primary"]);
  });
});
