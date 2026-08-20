export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export type WorkspaceInfo = {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
  agent_status: AgentStatus;
  can_clear_name?: boolean;
  worktree?: {
    repo_key: string;
    repo_name: string;
    repo_root: string;
    checkout_path: string;
    is_linked_worktree: boolean;
  };
};

export type TabInfo = {
  tab_id: string;
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  agent_status: AgentStatus;
  can_clear_name?: boolean;
};

export type PaneInfo = {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  cwd?: string;
  foreground_cwd?: string;
  label?: string;
  agent?: string;
  title?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
  display_agent?: string;
  agent_status: AgentStatus;
  state_labels?: Record<string, string>;
  revision: number;
};

export type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutPane = {
  pane_id: string;
  focused: boolean;
  rect: LayoutRect;
};

export type LayoutSnapshot = {
  workspace_id: string;
  tab_id: string;
  zoomed: boolean;
  area: LayoutRect;
  focused_pane_id: string;
  panes: LayoutPane[];
  splits: Array<{
    id: string;
    direction: "right" | "down";
    ratio: number;
    rect: LayoutRect;
  }>;
};

export type SnapshotBridgeInfo = {
  id: string;
  label: string;
  url: string;
};

export type Snapshot = {
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  layouts: LayoutSnapshot[];
  selected_pane_id?: string | null;
  bridges?: SnapshotBridgeInfo[];
};

export type PaneAgentStatusChangedMessage = {
  type: "pane.agent_status_changed";
  pane_id: string;
  workspace_id: string;
  agent_status: AgentStatus;
  agent: string | null;
  title: string | null;
  display_agent: string | null;
  state_labels: Record<string, string>;
};

export type ActivityResyncRequiredMessage = {
  type: "resync_required";
  reason: string;
};

export type ActivityMessage = PaneAgentStatusChangedMessage | ActivityResyncRequiredMessage;
