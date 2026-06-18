import type { Snapshot } from "./types";

export const MAX_CACHED_TERMINALS = 8;

export function pruneCachedPaneIds(cache: string[], snapshot: Snapshot | null): string[] {
  if (!snapshot) {
    return [];
  }
  const livePaneIds = new Set(snapshot.panes.map((pane) => pane.pane_id));
  const next = cache.filter((paneId) => livePaneIds.has(paneId));
  return sameStringArray(cache, next) ? cache : next;
}

export function promoteCachedPaneId(
  cache: string[],
  activePaneId: string | null,
  snapshot: Snapshot | null,
): string[] {
  if (!activePaneId || !snapshot?.panes.some((pane) => pane.pane_id === activePaneId)) {
    return cache;
  }
  const next = [activePaneId, ...cache.filter((id) => id !== activePaneId)].slice(
    0,
    MAX_CACHED_TERMINALS,
  );
  return sameStringArray(cache, next) ? cache : next;
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
