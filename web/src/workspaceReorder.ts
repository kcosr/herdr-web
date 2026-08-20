import type { WorkspaceInfo } from "./types";

export type WorkspaceMoveBlockParams = {
  workspaceIds: string[];
  beforeWorkspaceId: string | null;
};

export type WorkspaceReorderDirection = "up" | "down" | "top" | "bottom";

export function workspaceReorderRoots(workspaces: readonly WorkspaceInfo[]) {
  return workspaces.filter((workspace) => !workspace.worktree?.is_linked_worktree);
}

export function workspaceReorderBlockIds(
  workspaces: readonly WorkspaceInfo[],
  sourceWorkspaceId: string,
) {
  const source = workspaces.find((workspace) => workspace.workspace_id === sourceWorkspaceId);
  if (!source || source.worktree?.is_linked_worktree) {
    return [];
  }
  if (!source.worktree) {
    return [source.workspace_id];
  }
  return workspaces
    .filter((workspace) => workspace.worktree?.repo_key === source.worktree?.repo_key)
    .map((workspace) => workspace.workspace_id);
}

export function workspaceReorderRootId(
  workspaces: readonly WorkspaceInfo[],
  workspaceId: string,
) {
  const workspace = workspaces.find((candidate) => candidate.workspace_id === workspaceId);
  if (!workspace) {
    return null;
  }
  if (!workspace.worktree?.is_linked_worktree) {
    return workspace.workspace_id;
  }
  return (
    workspaces.find(
      (candidate) =>
        !candidate.worktree?.is_linked_worktree &&
        candidate.worktree?.repo_key === workspace.worktree?.repo_key,
    )?.workspace_id ?? null
  );
}

export function workspaceMoveBlockParams(
  workspaces: readonly WorkspaceInfo[],
  sourceWorkspaceId: string,
  requestedBeforeWorkspaceId: string | null,
): WorkspaceMoveBlockParams | null {
  const workspaceIds = workspaceReorderBlockIds(workspaces, sourceWorkspaceId);
  if (workspaceIds.length === 0) {
    return null;
  }
  const sourceRootId = workspaceReorderRootId(workspaces, sourceWorkspaceId);
  const beforeWorkspaceId = requestedBeforeWorkspaceId
    ? workspaceReorderRootId(workspaces, requestedBeforeWorkspaceId)
    : null;
  if (!sourceRootId || (requestedBeforeWorkspaceId && !beforeWorkspaceId)) {
    return null;
  }
  if (beforeWorkspaceId && workspaceIds.includes(beforeWorkspaceId)) {
    return null;
  }

  const rootIds = workspaceReorderRoots(workspaces).map((workspace) => workspace.workspace_id);
  const sourcePosition = rootIds.indexOf(sourceRootId);
  const remainingRootIds = rootIds.filter((workspaceId) => workspaceId !== sourceRootId);
  const insertPosition = beforeWorkspaceId
    ? remainingRootIds.indexOf(beforeWorkspaceId)
    : remainingRootIds.length;
  if (sourcePosition < 0 || insertPosition < 0 || insertPosition === sourcePosition) {
    return null;
  }

  return { workspaceIds, beforeWorkspaceId };
}

export function workspaceReorderDestination(
  workspaces: readonly WorkspaceInfo[],
  sourceWorkspaceId: string,
  direction: WorkspaceReorderDirection,
) {
  const sourceRootId = workspaceReorderRootId(workspaces, sourceWorkspaceId);
  const rootIds = workspaceReorderRoots(workspaces).map((workspace) => workspace.workspace_id);
  const sourcePosition = sourceRootId ? rootIds.indexOf(sourceRootId) : -1;
  if (sourcePosition < 0) {
    return undefined;
  }
  if (direction === "up") {
    return sourcePosition > 0 ? rootIds[sourcePosition - 1] : undefined;
  }
  if (direction === "down") {
    return sourcePosition < rootIds.length - 1 ? (rootIds[sourcePosition + 2] ?? null) : undefined;
  }
  if (direction === "top") {
    return sourcePosition > 0 ? rootIds[0] : undefined;
  }
  return sourcePosition < rootIds.length - 1 ? null : undefined;
}
