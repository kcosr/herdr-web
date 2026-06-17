import type { Snapshot, StateMessage } from "./types";

export type StateStreamModel = {
  snapshot: Snapshot | null;
  generation: number | null;
  nextSequence: number | null;
  streamId: string | null;
  resyncPending: boolean;
};

export type StateStreamApplyResult =
  | { status: "applied"; model: StateStreamModel; selectedPaneId?: string | null }
  | { status: "resync"; reason: string; model: StateStreamModel };

export const emptyStateStreamModel: StateStreamModel = {
  snapshot: null,
  generation: null,
  nextSequence: null,
  streamId: null,
  resyncPending: false,
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
        streamId: message.stream_id ?? null,
        resyncPending: false,
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
      return {
        status: "resync",
        reason: "state stream sequence gap",
        model: { ...model, resyncPending: true },
      };
    }
    if (message.generation !== model.generation) {
      return {
        status: "resync",
        reason: "state stream generation mismatch",
        model: { ...model, resyncPending: true },
      };
    }
    return {
      status: "resync",
      reason,
      model: { ...model, nextSequence: message.sequence + 1, resyncPending: true },
    };
  }

  if (!model.snapshot || model.generation === null || model.nextSequence === null) {
    return { status: "resync", reason: "delta before snapshot", model };
  }
  if (model.resyncPending) {
    return { status: "resync", reason: "state refresh pending", model };
  }
  if (message.sequence !== model.nextSequence) {
    return {
      status: "resync",
      reason: "state stream sequence gap",
      model: { ...model, resyncPending: true },
    };
  }
  if (message.generation !== model.generation) {
    return {
      status: "resync",
      reason: "state stream generation mismatch",
      model: { ...model, resyncPending: true },
    };
  }

  const snapshot = cloneSnapshot(model.snapshot);
  let selectedPaneId: string | null | undefined;
  switch (message.type) {
    case "pane.agent_status_changed":
    case "pane.agent_detected":
      if (!snapshot.panes.some((pane) => pane.pane_id === message.pane.pane_id)) {
        return {
          status: "resync",
          reason: `unknown pane ${message.pane.pane_id}`,
          model: { ...model, resyncPending: true },
        };
      }
      upsert(snapshot.panes, message.pane, (pane) => pane.pane_id);
      upsert(snapshot.workspaces, message.workspace, (workspace) => workspace.workspace_id);
      upsert(snapshot.tabs, message.tab, (tab) => tab.tab_id);
      break;
    case "selection.changed":
      snapshot.selected_pane_id = message.pane_id;
      selectedPaneId = message.pane_id;
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

export function isStateMessage(value: unknown): value is StateMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  if (typeof value.generation !== "number" || typeof value.sequence !== "number") {
    return false;
  }
  switch (value.type) {
    case "snapshot":
      return isRecord(value.snapshot);
    case "pane.agent_status_changed":
    case "pane.agent_detected":
      return isRecord(value.pane) && isRecord(value.workspace) && isRecord(value.tab);
    case "selection.changed":
      return typeof value.pane_id === "string";
    case "resync_required":
      return typeof value.reason === "string";
    case "error":
      return typeof value.code === "string" && typeof value.message === "string";
    default:
      return false;
  }
}

export function isSequencedStateEnvelope(value: unknown): value is {
  type: string;
  generation: number;
  sequence: number;
} {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.generation === "number" &&
    typeof value.sequence === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
