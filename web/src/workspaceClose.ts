import type { WorkspaceInfo } from "./types";

/** Only a primary checkout can authorize closing its linked workspace group. */
export function linkedWorkspaceLabels(workspaces: readonly WorkspaceInfo[], workspaceId: string) {
  const workspace = workspaces.find((item) => item.workspace_id === workspaceId);
  const worktree = workspace?.worktree;
  if (!worktree || worktree.is_linked_worktree) return [];
  return workspaces
    .filter((item) => item.workspace_id !== workspaceId && item.worktree?.repo_key === worktree.repo_key)
    .map((item) => item.label);
}
