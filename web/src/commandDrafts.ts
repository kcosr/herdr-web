import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

/** Owned by one App mount: drafts never leave this browser tab or survive a reload. */
export function createCommandDraftStore() {
  const drafts = new Map<string, Map<string, string>>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get(bridgeId: string, paneId: string) {
      return drafts.get(bridgeId)?.get(paneId) ?? "";
    },
    set(bridgeId: string, paneId: string, value: string) {
      const panes = drafts.get(bridgeId) ?? new Map<string, string>();
      if ((panes.get(paneId) ?? "") === value) return;
      if (value) panes.set(paneId, value);
      else panes.delete(paneId);
      if (panes.size) drafts.set(bridgeId, panes);
      else drafts.delete(bridgeId);
      notify();
    },
    /** Call only with a successful, current, complete bridge snapshot. */
    retainPanes(bridgeId: string, paneIds: readonly string[]) {
      const panes = drafts.get(bridgeId);
      if (!panes) return;
      const live = new Set(paneIds);
      let changed = false;
      for (const paneId of panes.keys()) {
        if (!live.has(paneId)) {
          panes.delete(paneId);
          changed = true;
        }
      }
      if (!panes.size) drafts.delete(bridgeId);
      if (changed) notify();
    },
  };
}

export const CommandDraftContext = createContext<ReturnType<typeof createCommandDraftStore> | null>(null);

export function useCommandDraft(bridgeId: string, paneId: string) {
  const store = useContext(CommandDraftContext);
  if (!store) throw new Error("Command composer requires an app draft store");
  const getSnapshot = useCallback(() => store.get(bridgeId, paneId), [store, bridgeId, paneId]);
  const value = useSyncExternalStore(store.subscribe, getSnapshot);
  const setValue = (next: string) => store.set(bridgeId, paneId, next);
  return [value, setValue] as const;
}
