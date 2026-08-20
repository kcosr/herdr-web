import type {
  AgentStatus,
  LayoutRect,
  PaneInfo,
  Snapshot,
  TabInfo,
  WorkspaceInfo,
} from "./types";
import type { PaneFocusDirection } from "./commands";

const statusRank: Record<AgentStatus, number> = {
  blocked: 0,
  working: 1,
  done: 2,
  idle: 3,
  unknown: 4,
};

export function chooseSelectedPane(
  snapshot: Snapshot | null,
  currentPaneId: string | null,
  useSharedSelection = true,
  preferSharedSelection = false,
) {
  if (!snapshot || snapshot.panes.length === 0) {
    return null;
  }
  const sharedPaneId =
    useSharedSelection &&
    snapshot.selected_pane_id &&
    snapshot.panes.some((pane) => pane.pane_id === snapshot.selected_pane_id)
      ? snapshot.selected_pane_id
      : null;
  if (preferSharedSelection && sharedPaneId) {
    return sharedPaneId;
  }
  if (currentPaneId && snapshot.panes.some((pane) => pane.pane_id === currentPaneId)) {
    return currentPaneId;
  }
  if (sharedPaneId) {
    return sharedPaneId;
  }
  return snapshot.panes.find((pane) => pane.focused)?.pane_id ?? snapshot.panes[0].pane_id;
}

export function chooseSelectedPaneForActiveWorkspace(
  snapshot: Snapshot | null,
  currentPaneId: string | null,
  activeWorkspaceId: string | null,
  useSharedSelection = true,
  preferSharedSelection = false,
) {
  if (
    preferSharedSelection &&
    snapshot?.selected_pane_id &&
    snapshot.panes.some((pane) => pane.pane_id === snapshot.selected_pane_id)
  ) {
    return snapshot.selected_pane_id;
  }
  if (!snapshot || !activeWorkspaceId) {
    return chooseSelectedPane(
      snapshot,
      currentPaneId,
      useSharedSelection,
      preferSharedSelection,
    );
  }
  if (!snapshot.workspaces.some((workspace) => workspace.workspace_id === activeWorkspaceId)) {
    return chooseSelectedPane(
      snapshot,
      currentPaneId,
      useSharedSelection,
      preferSharedSelection,
    );
  }
  const currentPane = currentPaneId
    ? snapshot.panes.find((pane) => pane.pane_id === currentPaneId)
    : null;
  if (currentPane?.workspace_id === activeWorkspaceId) {
    return chooseSelectedPane(
      snapshot,
      currentPaneId,
      useSharedSelection,
      preferSharedSelection,
    );
  }
  return choosePaneForWorkspace(snapshot, activeWorkspaceId);
}

export function chooseDirectionalPane(
  snapshot: Snapshot,
  currentPaneId: string,
  direction: PaneFocusDirection,
) {
  const layout = snapshot.layouts.find((candidate) =>
    candidate.panes.some((pane) => pane.pane_id === currentPaneId),
  );
  const current = layout?.panes.find((pane) => pane.pane_id === currentPaneId);
  if (!layout || !current) {
    return null;
  }

  const candidates = layout.panes
    .filter((pane) => pane.pane_id !== currentPaneId)
    .map((pane) => ({
      pane,
      score: directionalPaneScore(current.rect, pane.rect, direction),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        pane: (typeof layout.panes)[number];
        score: [number, number, number];
      } => candidate.score !== null,
    )
    .sort((left, right) => compareDirectionScores(left.score, right.score));

  const paneId = candidates[0]?.pane.pane_id;
  return paneId ? snapshot.panes.find((pane) => pane.pane_id === paneId) ?? null : null;
}

function directionalPaneScore(
  current: LayoutRect,
  candidate: LayoutRect,
  direction: PaneFocusDirection,
): [number, number, number] | null {
  const currentRight = current.x + current.width;
  const currentBottom = current.y + current.height;
  const candidateRight = candidate.x + candidate.width;
  const candidateBottom = candidate.y + candidate.height;
  const horizontal = direction === "left" || direction === "right";
  const primaryGap =
    direction === "left"
      ? current.x - candidateRight
      : direction === "right"
        ? candidate.x - currentRight
        : direction === "up"
          ? current.y - candidateBottom
          : candidate.y - currentBottom;
  if (primaryGap < -Number.EPSILON) {
    return null;
  }

  const currentOrthogonalStart = horizontal ? current.y : current.x;
  const currentOrthogonalEnd = horizontal ? currentBottom : currentRight;
  const candidateOrthogonalStart = horizontal ? candidate.y : candidate.x;
  const candidateOrthogonalEnd = horizontal ? candidateBottom : candidateRight;
  const orthogonalGap = Math.max(
    0,
    currentOrthogonalStart - candidateOrthogonalEnd,
    candidateOrthogonalStart - currentOrthogonalEnd,
  );
  const currentOrthogonalCenter = (currentOrthogonalStart + currentOrthogonalEnd) / 2;
  const candidateOrthogonalCenter =
    (candidateOrthogonalStart + candidateOrthogonalEnd) / 2;

  return [
    orthogonalGap > 0 ? 1 : 0,
    Math.max(0, primaryGap),
    Math.abs(candidateOrthogonalCenter - currentOrthogonalCenter),
  ];
}

function compareDirectionScores(
  left: [number, number, number],
  right: [number, number, number],
) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
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
  const stateLabel = pane.state_labels?.[pane.agent_status];
  const parts = [
    workspace?.label,
    tab?.label,
    stateLabel || pane.display_agent || pane.agent,
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

export function paneListSubtitle(
  pane: PaneInfo,
  workspaceLabel?: string,
  tabLabel?: string,
  bridgeLabel?: string,
) {
  const title = paneTitle(pane);
  const parts = [bridgeLabel, workspaceLabel, tabLabel, ...paneMeta(pane).split(" · ")];
  return parts
    .filter((part): part is string => Boolean(part) && part !== title)
    .filter((part, index, items) => items.indexOf(part) === index)
    .join(" · ");
}

export function spaceSubtitle(
  workspace: WorkspaceInfo,
  bridgeLabel?: string,
  agentCount = 0,
) {
  const tabs = `${workspace.tab_count} tab${workspace.tab_count === 1 ? "" : "s"}`;
  const panes = `${workspace.pane_count} pane${workspace.pane_count === 1 ? "" : "s"}`;
  const agents =
    agentCount > 0 ? `${agentCount} agent${agentCount === 1 ? "" : "s"}` : undefined;
  return [bridgeLabel, tabs, panes, agents].filter(Boolean).join(" · ");
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

export function basename(path?: string) {
  if (!path) {
    return "";
  }
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return trimmed.split("/").pop() ?? "";
}
