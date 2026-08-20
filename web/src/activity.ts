import { aggregateStatus } from "./state";
import type { ActivityMessage, AgentStatus, PaneAgentStatusChangedMessage, Snapshot } from "./types";

export type ActivityLogEntry = {
  generation: number;
  message: ActivityMessage;
};

export type ActivityApplyResult =
  | { status: "ignored"; snapshot: Snapshot | null }
  | { status: "applied"; snapshot: Snapshot }
  | { status: "resync"; snapshot: Snapshot | null };

export type ActivityParseResult =
  | { status: "message"; message: ActivityMessage }
  | { status: "invalid_known" }
  | { status: "ignored" };

const agentStatuses: AgentStatus[] = ["idle", "working", "blocked", "done", "unknown"];

export function parseActivityMessage(data: unknown): ActivityMessage | null {
  const result = parseActivityEventData(data);
  return result.status === "message" ? result.message : null;
}

export function parseActivityEventData(data: unknown): ActivityParseResult {
  if (typeof data !== "string") {
    return { status: "ignored" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { status: "ignored" };
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return { status: "ignored" };
  }
  if (parsed.type === "resync_required") {
    return typeof parsed.reason === "string"
      ? { status: "message", message: { type: "resync_required", reason: parsed.reason } }
      : { status: "invalid_known" };
  }
  if (parsed.type !== "pane.agent_status_changed") {
    return { status: "ignored" };
  }
  if (
    typeof parsed.pane_id !== "string" ||
    typeof parsed.workspace_id !== "string" ||
    !isAgentStatus(parsed.agent_status) ||
    !isNullableString(parsed.agent) ||
    !isNullableString(parsed.title) ||
    !isNullableString(parsed.display_agent) ||
    !isStringRecord(parsed.state_labels)
  ) {
    return { status: "invalid_known" };
  }
  return {
    status: "message",
    message: {
      type: "pane.agent_status_changed",
      pane_id: parsed.pane_id,
      workspace_id: parsed.workspace_id,
      agent_status: parsed.agent_status,
      agent: parsed.agent,
      title: parsed.title,
      display_agent: parsed.display_agent,
      state_labels: parsed.state_labels,
    },
  };
}

export function applyActivityMessage(
  snapshot: Snapshot | null,
  message: ActivityMessage,
): ActivityApplyResult {
  if (!snapshot) {
    return { status: "ignored", snapshot };
  }
  if (message.type === "resync_required") {
    return { status: "resync", snapshot };
  }
  return applyPaneAgentStatusChanged(snapshot, message);
}

export function replayActivityMessages(
  snapshot: Snapshot,
  log: readonly ActivityLogEntry[],
  afterGeneration: number,
) {
  return log.reduce((current, entry) => {
    if (entry.generation <= afterGeneration) {
      return current;
    }
    const result = applyActivityMessage(current, entry.message);
    return result.status === "applied" ? result.snapshot : current;
  }, snapshot);
}

function applyPaneAgentStatusChanged(
  snapshot: Snapshot,
  message: PaneAgentStatusChangedMessage,
): ActivityApplyResult {
  const paneIndex = snapshot.panes.findIndex((pane) => pane.pane_id === message.pane_id);
  if (paneIndex < 0) {
    return { status: "resync", snapshot };
  }
  const currentPane = snapshot.panes[paneIndex];
  if (currentPane.workspace_id !== message.workspace_id) {
    return { status: "resync", snapshot };
  }
  const panes = snapshot.panes.map((pane, index) =>
    index === paneIndex
      ? {
          ...pane,
          agent_status: message.agent_status,
          agent: nullableToOptional(message.agent),
          title: nullableToOptional(message.title),
          display_agent: nullableToOptional(message.display_agent),
          state_labels: message.state_labels,
        }
      : pane,
  );
  const patchedPane = panes[paneIndex];
  const workspaces = snapshot.workspaces.map((workspace) =>
    workspace.workspace_id === patchedPane.workspace_id
      ? {
          ...workspace,
          agent_status: aggregateStatus(
            panes.filter((pane) => pane.workspace_id === workspace.workspace_id),
          ),
        }
      : workspace,
  );
  const tabs = snapshot.tabs.map((tab) =>
    tab.tab_id === patchedPane.tab_id
      ? {
          ...tab,
          agent_status: aggregateStatus(panes.filter((pane) => pane.tab_id === tab.tab_id)),
        }
      : tab,
  );
  return {
    status: "applied",
    snapshot: {
      ...snapshot,
      workspaces,
      tabs,
      panes,
    },
  };
}

function nullableToOptional(value: string | null) {
  return value ?? undefined;
}

function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === "string" && agentStatuses.includes(value as AgentStatus);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
