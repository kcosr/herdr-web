// Mutating commands proxied through the bridge's allow-listed /api/command.

import type { BridgeHttpUrl } from "./bridgeApi";
import type { LaunchSpec, SplitDirection } from "./launch";

export type CommandResult = { type?: string; [key: string]: unknown };
export type LaunchPresetResult = {
  preset_id: string;
  title: string;
  workspace_id: string;
  tab_id: string;
  pane_id: string;
  [key: string]: unknown;
};
export type PaneFocusDirection = "left" | "right" | "up" | "down";
export type { LaunchSpec, SplitDirection };
export type { BridgeHttpUrl } from "./bridgeApi";

const sameOriginHttpUrl: BridgeHttpUrl = (path, query) => {
  const suffix = query && query.toString() ? `?${query.toString()}` : "";
  return `${path}${suffix}`;
};

async function runCommand(
  httpUrl: BridgeHttpUrl,
  method: string,
  params: Record<string, unknown>,
): Promise<CommandResult> {
  const response = await fetch(httpUrl("/api/command"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  if (!response.ok) {
    let message = `command failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) {
        message = body.error;
      }
    } catch {
      // keep the default message
    }
    throw new Error(message);
  }
  return (await response.json()) as CommandResult;
}

async function runLaunchPreset(
  httpUrl: BridgeHttpUrl,
  body: Record<string, unknown>,
): Promise<LaunchPresetResult> {
  const response = await fetch(httpUrl("/api/launcher-presets/launch"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `launcher preset failed (${response.status})`;
    try {
      const parsed = (await response.json()) as { error?: string };
      if (parsed?.error) {
        message = parsed.error;
      }
    } catch {
      // keep the default message
    }
    throw new Error(message);
  }
  return (await response.json()) as LaunchPresetResult;
}

/** Pull a pane id out of a {workspace,tab}_created result so the UI can jump to it. */
export function createdPaneId(result: CommandResult): string | null {
  const paneId = typeof result.pane_id === "string" ? result.pane_id : null;
  const rootPane = result.root_pane as { pane_id?: string } | undefined;
  const pane = result.pane as { pane_id?: string } | undefined;
  const agent = result.agent as { pane_id?: string } | undefined;
  const moveResult = result.move_result as { pane?: { pane_id?: string } } | undefined;
  const focus = result.focus as { focused_pane_id?: string | null } | undefined;
  return (
    paneId ??
    rootPane?.pane_id ??
    pane?.pane_id ??
    agent?.pane_id ??
    moveResult?.pane?.pane_id ??
    focus?.focused_pane_id ??
    null
  );
}

export function createCommands(httpUrl: BridgeHttpUrl = sameOriginHttpUrl) {
  const api = {
    createWorkspace: () => runCommand(httpUrl, "workspace.create", { focus: true }),
    renameWorkspace: (workspaceId: string, label: string | null) =>
      runCommand(httpUrl, "workspace.rename", { workspace_id: workspaceId, label }),
    closeWorkspace: (workspaceId: string) =>
      runCommand(httpUrl, "workspace.close", { workspace_id: workspaceId }),
    focusWorkspace: (workspaceId: string) =>
      runCommand(httpUrl, "workspace.focus", { workspace_id: workspaceId }),
    moveWorkspaceBlock: (workspaceIds: string[], beforeWorkspaceId: string | null) =>
      runCommand(httpUrl, "workspace.move_block", {
        workspace_ids: workspaceIds,
        before_workspace_id: beforeWorkspaceId,
      }),

    createTab: (workspaceId: string, label?: string) =>
      runCommand(httpUrl, "tab.create", { workspace_id: workspaceId, focus: true, label }),
    renameTab: (tabId: string, label: string | null) =>
      runCommand(httpUrl, "tab.rename", { tab_id: tabId, label }),
    closeTab: (tabId: string) => runCommand(httpUrl, "tab.close", { tab_id: tabId }),
    focusTab: (tabId: string) => runCommand(httpUrl, "tab.focus", { tab_id: tabId }),

    renamePane: (paneId: string, label: string) =>
      runCommand(httpUrl, "pane.rename", { pane_id: paneId, label }),
    closePane: (paneId: string) => runCommand(httpUrl, "pane.close", { pane_id: paneId }),
    // Layout-mutating: requires the bridge allow-list to include `pane.split`.
    splitPane: (targetPaneId: string, direction: SplitDirection) =>
      runCommand(httpUrl, "pane.split", { target_pane_id: targetPaneId, direction, focus: true }),
    focusPaneDirection: (paneId: string, direction: PaneFocusDirection) =>
      runCommand(httpUrl, "pane.focus_direction", { pane_id: paneId, direction }),
    movePaneToNewTab: (paneId: string, workspaceId: string, label?: string) =>
      runCommand(httpUrl, "pane.move", {
        pane_id: paneId,
        destination: { type: "new_tab", workspace_id: workspaceId, label },
        focus: true,
      }),
    movePaneToNewWorkspace: (paneId: string, label?: string) =>
      runCommand(httpUrl, "pane.move", {
        pane_id: paneId,
        destination: { type: "new_workspace", label },
        focus: true,
      }),

    launchPresetTab: (workspaceId: string, spec: LaunchSpec) =>
      runLaunchPreset(httpUrl, {
        preset_id: spec.presetId,
        title: spec.title,
        target: { mode: "tab", workspace_id: workspaceId },
      }),

    launchPresetSplit: (
      targetPaneId: string,
      tabId: string,
      direction: SplitDirection,
      spec: LaunchSpec,
    ) =>
      runLaunchPreset(httpUrl, {
        preset_id: spec.presetId,
        title: spec.title,
        target: { mode: "split", target_pane_id: targetPaneId, tab_id: tabId, direction },
      }),
  };
  return api;
}

export const commands = createCommands();
