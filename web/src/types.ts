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
  display_agent?: string;
  agent_status: AgentStatus;
  custom_status?: string;
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

export type Snapshot = {
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  layouts: LayoutSnapshot[];
  selected_pane_id?: string | null;
};

export type StateMessage =
  | {
      type: "snapshot";
      generation: number;
      sequence: number;
      snapshot: Snapshot;
      stream_id?: string;
      refresh_ids?: string[];
    }
  | {
      type: "pane.agent_status_changed" | "pane.agent_detected";
      generation: number;
      sequence: number;
      pane: PaneInfo;
      workspace: WorkspaceInfo;
      tab: TabInfo;
    }
  | {
      type: "selection.changed";
      generation: number;
      sequence: number;
      pane_id: string;
    }
  | {
      type: "resync_required";
      generation: number;
      sequence: number;
      reason: string;
      refresh_ids?: string[];
    }
  | {
      type: "error";
      generation: number;
      sequence: number;
      code: string;
      message: string;
    };
