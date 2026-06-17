import type { LayoutSnapshot, Snapshot, StateMessage } from "./types";

export type StateStreamModel = {
  snapshot: Snapshot | null;
  generation: number | null;
  nextSequence: number | null;
};

export type StateStreamApplyResult =
  | { status: "applied"; model: StateStreamModel; selectedPaneId?: string | null }
  | { status: "resync"; reason: string; model: StateStreamModel };

export const emptyStateStreamModel: StateStreamModel = {
  snapshot: null,
  generation: null,
  nextSequence: null,
};

export function applyStateMessage(
  model: StateStreamModel,
  message: StateMessage,
): StateStreamApplyResult {
  if (message.type === "snapshot") {
    return {
      status: "applied",
      model: {
        snapshot: message.snapshot,
        generation: message.generation,
        nextSequence: message.sequence + 1,
      },
      selectedPaneId: message.snapshot.selected_pane_id ?? null,
    };
  }

  if (message.type === "resync_required" || message.type === "error") {
    const reason = message.type === "resync_required" ? message.reason : message.message;
    if (!model.snapshot || model.generation === null || model.nextSequence === null) {
      return { status: "resync", reason, model };
    }
    if (message.sequence !== model.nextSequence) {
      return { status: "resync", reason: "state stream sequence gap", model };
    }
    if (message.generation !== model.generation) {
      return { status: "resync", reason: "state stream generation mismatch", model };
    }
    return {
      status: "resync",
      reason,
      model: { ...model, nextSequence: message.sequence + 1 },
    };
  }

  if (!model.snapshot || model.generation === null || model.nextSequence === null) {
    return { status: "resync", reason: "delta before snapshot", model };
  }
  if (message.sequence !== model.nextSequence) {
    return { status: "resync", reason: "state stream sequence gap", model };
  }
  if (message.generation !== model.generation) {
    return { status: "resync", reason: "state stream generation mismatch", model };
  }

  const snapshot = cloneSnapshot(model.snapshot);
  let selectedPaneId: string | null | undefined;
  switch (message.type) {
    case "pane.agent_status_changed":
    case "pane.agent_detected":
    case "pane.upserted":
      upsert(snapshot.panes, message.pane, (pane) => pane.pane_id);
      upsert(snapshot.workspaces, message.workspace, (workspace) => workspace.workspace_id);
      upsert(snapshot.tabs, message.tab, (tab) => tab.tab_id);
      if (message.layout) {
        upsertLayout(snapshot.layouts, message.layout);
      }
      break;
    case "selection.changed":
      snapshot.selected_pane_id = message.pane_id;
      selectedPaneId = message.pane_id;
      break;
    case "workspace.upserted":
      upsert(snapshot.workspaces, message.workspace, (workspace) => workspace.workspace_id);
      break;
    case "workspace.removed":
      snapshot.workspaces = snapshot.workspaces.filter(
        (workspace) => workspace.workspace_id !== message.workspace_id,
      );
      snapshot.tabs = snapshot.tabs.filter((tab) => tab.workspace_id !== message.workspace_id);
      snapshot.panes = snapshot.panes.filter((pane) => pane.workspace_id !== message.workspace_id);
      snapshot.layouts = snapshot.layouts.filter(
        (layout) => layout.workspace_id !== message.workspace_id,
      );
      break;
    case "tab.upserted":
      upsert(snapshot.tabs, message.tab, (tab) => tab.tab_id);
      if (message.layout) {
        upsertLayout(snapshot.layouts, message.layout);
      }
      break;
    case "tab.removed":
      snapshot.tabs = snapshot.tabs.filter((tab) => tab.tab_id !== message.tab_id);
      snapshot.panes = snapshot.panes.filter((pane) => pane.tab_id !== message.tab_id);
      snapshot.layouts = snapshot.layouts.filter((layout) => layout.tab_id !== message.tab_id);
      break;
    case "pane.removed":
      snapshot.panes = snapshot.panes.filter((pane) => pane.pane_id !== message.pane_id);
      if (message.workspace) {
        upsert(snapshot.workspaces, message.workspace, (workspace) => workspace.workspace_id);
      }
      if (message.tab) {
        upsert(snapshot.tabs, message.tab, (tab) => tab.tab_id);
      }
      if (message.layout) {
        upsertLayout(snapshot.layouts, message.layout);
      }
      break;
  }

  if (
    snapshot.selected_pane_id &&
    !snapshot.panes.some((pane) => pane.pane_id === snapshot.selected_pane_id)
  ) {
    snapshot.selected_pane_id = null;
    selectedPaneId = null;
  }

  return {
    status: "applied",
    model: { ...model, snapshot, nextSequence: message.sequence + 1 },
    selectedPaneId,
  };
}

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return {
    workspaces: [...snapshot.workspaces],
    tabs: [...snapshot.tabs],
    panes: [...snapshot.panes],
    layouts: [...snapshot.layouts],
    selected_pane_id: snapshot.selected_pane_id ?? null,
  };
}

function upsert<T>(items: T[], item: T, id: (item: T) => string) {
  const itemId = id(item);
  const index = items.findIndex((candidate) => id(candidate) === itemId);
  if (index === -1) {
    items.push(item);
  } else {
    items[index] = item;
  }
}

function upsertLayout(layouts: LayoutSnapshot[], layout: LayoutSnapshot) {
  upsert(layouts, layout, (item) => item.tab_id);
}

export function isStateMessage(value: unknown): value is StateMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  return typeof value.generation === "number" && typeof value.sequence === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
