import type { AgentStatus, PaneInfo, Snapshot, TabInfo, WorkspaceInfo } from "./types";

const statusRank: Record<AgentStatus, number> = {
  blocked: 0,
  working: 1,
  done: 2,
  idle: 3,
  unknown: 4,
};

export function chooseSelectedPane(snapshot: Snapshot | null, currentPaneId: string | null) {
  if (!snapshot || snapshot.panes.length === 0) {
    return null;
  }
  if (currentPaneId && snapshot.panes.some((pane) => pane.pane_id === currentPaneId)) {
    return currentPaneId;
  }
  if (
    snapshot.selected_pane_id &&
    snapshot.panes.some((pane) => pane.pane_id === snapshot.selected_pane_id)
  ) {
    return snapshot.selected_pane_id;
  }
  return snapshot.panes.find((pane) => pane.focused)?.pane_id ?? snapshot.panes[0].pane_id;
}

export function choosePaneForWorkspace(snapshot: Snapshot, workspaceId: string) {
  const workspace = snapshot.workspaces.find((item) => item.workspace_id === workspaceId);
  const preferredTabId =
    workspace?.active_tab_id ??
    snapshot.tabs.find((tab) => tab.workspace_id === workspaceId)?.tab_id ??
    null;
  if (preferredTabId) {
    return choosePaneForTab(snapshot, preferredTabId);
  }
  return snapshot.panes.find((pane) => pane.workspace_id === workspaceId)?.pane_id ?? null;
}

export function choosePaneForTab(snapshot: Snapshot, tabId: string) {
  const tabPanes = snapshot.panes.filter((pane) => pane.tab_id === tabId);
  return tabPanes.find((pane) => pane.focused)?.pane_id ?? tabPanes[0]?.pane_id ?? null;
}

export function paneTitle(pane: PaneInfo) {
  return (
    pane.label ||
    pane.title ||
    pane.display_agent ||
    pane.agent ||
    basename(pane.foreground_cwd || pane.cwd) ||
    "Terminal"
  );
}

export function canClearTabName(tab: TabInfo) {
  if (typeof tab.can_clear_name === "boolean") {
    return tab.can_clear_name;
  }
  return !isDefaultTabLabel(tab);
}

export function canClearWorkspaceName(workspace: WorkspaceInfo, panes: readonly PaneInfo[]) {
  if (typeof workspace.can_clear_name === "boolean") {
    return workspace.can_clear_name;
  }
  return workspace.label !== inferredWorkspaceDefaultLabel(workspace, panes);
}

export function displayTabLabel(tab: TabInfo, panes: readonly PaneInfo[]) {
  if (!isDefaultTabLabel(tab)) {
    return tab.label;
  }
  const tabPanes = panes.filter((pane) => pane.tab_id === tab.tab_id);
  if (tabPanes.length !== 1) {
    return tab.label;
  }
  return paneTitle(tabPanes[0]);
}

function isDefaultTabLabel(tab: TabInfo) {
  return /^\d+$/u.test(tab.label.trim());
}

function inferredWorkspaceDefaultLabel(workspace: WorkspaceInfo, panes: readonly PaneInfo[]) {
  const cwd = panes
    .filter((pane) => pane.workspace_id === workspace.workspace_id)
    .map((pane) => pane.foreground_cwd || pane.cwd)
    .filter((path): path is string => Boolean(path))
    .sort()[0];
  return basename(cwd) || "workspace";
}

export function paneSubtitle(pane: PaneInfo, workspace?: WorkspaceInfo, tab?: TabInfo) {
  const parts = [
    workspace?.label,
    tab?.label,
    pane.custom_status || pane.display_agent || pane.agent,
    pane.foreground_cwd || pane.cwd,
  ].filter(Boolean);
  return parts.join(" / ");
}

/**
 * Compact secondary line for a pane row: agent + directory, with anything that
 * already appears in the title removed so the two lines never echo each other.
 */
export function paneMeta(pane: PaneInfo) {
  const title = paneTitle(pane);
  const agent = pane.display_agent || pane.agent;
  const dir = basename(pane.foreground_cwd || pane.cwd);
  const parts: string[] = [];
  if (agent && agent !== title) {
    parts.push(agent);
  }
  if (dir && dir !== title) {
    parts.push(dir);
  }
  return parts.join(" · ");
}

export function spaceSubtitle(workspace: WorkspaceInfo) {
  const tabs = `${workspace.tab_count} tab${workspace.tab_count === 1 ? "" : "s"}`;
  const panes = `${workspace.pane_count} pane${workspace.pane_count === 1 ? "" : "s"}`;
  return `${tabs} · ${panes}`;
}

export function sortTabsForWorkspace(tabs: TabInfo[], workspaceId: string) {
  return tabs
    .filter((tab) => tab.workspace_id === workspaceId)
    .sort((a, b) => a.number - b.number);
}

export function sortPanesForTab(panes: PaneInfo[], tabId: string) {
  return panes
    .filter((pane) => pane.tab_id === tabId)
    .sort((a, b) => a.pane_id.localeCompare(b.pane_id, undefined, { numeric: true }));
}

export function sortPanesForPicker(panes: PaneInfo[]) {
  return [...panes].sort((a, b) => {
    const status = statusRank[a.agent_status] - statusRank[b.agent_status];
    if (status !== 0) {
      return status;
    }
    return a.pane_id.localeCompare(b.pane_id, undefined, { numeric: true });
  });
}

export function statusLabel(status: AgentStatus) {
  if (status === "unknown") {
    return "idle";
  }
  return status;
}

/** Blocked and done are the states that want the user's attention. */
export function isAttention(status: AgentStatus) {
  return status === "blocked" || status === "done";
}

/** Loud states earn an explicit word in the UI; idle/unknown stay quiet. */
export function isLoud(status: AgentStatus) {
  return status === "blocked" || status === "working" || status === "done";
}

export function countAttention(panes: PaneInfo[]) {
  return panes.reduce((total, pane) => (isAttention(pane.agent_status) ? total + 1 : total), 0);
}

/** The most urgent status present, used for ambient roll-up indicators. */
export function aggregateStatus(panes: PaneInfo[]): AgentStatus {
  const order: AgentStatus[] = ["blocked", "working", "done", "idle", "unknown"];
  for (const status of order) {
    if (panes.some((pane) => pane.agent_status === status)) {
      return status;
    }
  }
  return "unknown";
}

function basename(path?: string) {
  if (!path) {
    return "";
  }
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return trimmed.split("/").pop() ?? "";
}
