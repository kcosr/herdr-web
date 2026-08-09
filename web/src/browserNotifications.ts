import { isAttention } from "./state";
import type { AgentStatus, PaneAgentStatusChangedMessage, PaneInfo } from "./types";

export type BrowserNotificationPrefs = {
  enabled: boolean;
  notifyOnBlocked: boolean;
  notifyOnDone: boolean;
  documentBadge: boolean;
};

export type BrowserNotificationTarget = {
  bridgeId: string;
  paneId: string;
  workspaceId: string;
};

export const DEFAULT_BROWSER_NOTIFICATION_PREFS: BrowserNotificationPrefs = {
  enabled: false,
  notifyOnBlocked: true,
  notifyOnDone: true,
  documentBadge: true,
};

export const DEFAULT_DOCUMENT_TITLE = "herdr-web";

export function parseBrowserNotificationEnabled(
  value: unknown,
  fallback = DEFAULT_BROWSER_NOTIFICATION_PREFS.enabled,
) {
  return typeof value === "boolean" ? value : fallback;
}

export function parseBrowserNotifyOnBlocked(
  value: unknown,
  fallback = DEFAULT_BROWSER_NOTIFICATION_PREFS.notifyOnBlocked,
) {
  return typeof value === "boolean" ? value : fallback;
}

export function parseBrowserNotifyOnDone(
  value: unknown,
  fallback = DEFAULT_BROWSER_NOTIFICATION_PREFS.notifyOnDone,
) {
  return typeof value === "boolean" ? value : fallback;
}

export function parseBrowserDocumentBadge(
  value: unknown,
  fallback = DEFAULT_BROWSER_NOTIFICATION_PREFS.documentBadge,
) {
  return typeof value === "boolean" ? value : fallback;
}

export function parseBrowserNotificationPrefs(
  value: Partial<BrowserNotificationPrefs> | null | undefined,
  fallback: BrowserNotificationPrefs = DEFAULT_BROWSER_NOTIFICATION_PREFS,
): BrowserNotificationPrefs {
  return {
    enabled: parseBrowserNotificationEnabled(value?.enabled, fallback.enabled),
    notifyOnBlocked: parseBrowserNotifyOnBlocked(value?.notifyOnBlocked, fallback.notifyOnBlocked),
    notifyOnDone: parseBrowserNotifyOnDone(value?.notifyOnDone, fallback.notifyOnDone),
    documentBadge: parseBrowserDocumentBadge(value?.documentBadge, fallback.documentBadge),
  };
}

/** Statuses that can raise a browser notification when prefs allow. */
export function shouldNotifyAgentStatus(
  status: AgentStatus,
  prefs: Pick<BrowserNotificationPrefs, "enabled" | "notifyOnBlocked" | "notifyOnDone">,
): boolean {
  if (!prefs.enabled) {
    return false;
  }
  if (status === "blocked") {
    return prefs.notifyOnBlocked;
  }
  if (status === "done") {
    return prefs.notifyOnDone;
  }
  return false;
}

export function browserNotificationTag(bridgeId: string, paneId: string) {
  return `herdr-web:agent:${bridgeId}:${paneId}`;
}

export function browserNotificationTitle(message: PaneAgentStatusChangedMessage): string {
  const agent =
    message.display_agent?.trim() ||
    message.agent?.trim() ||
    message.title?.trim() ||
    "Agent";
  if (message.agent_status === "blocked") {
    return `${agent} needs you`;
  }
  if (message.agent_status === "done") {
    return `${agent} is done`;
  }
  return agent;
}

export function browserNotificationBody(
  message: PaneAgentStatusChangedMessage,
  bridgeLabel?: string | null,
): string {
  const parts: string[] = [];
  if (bridgeLabel?.trim()) {
    parts.push(bridgeLabel.trim());
  }
  const title = message.title?.trim();
  if (title && title !== message.display_agent?.trim() && title !== message.agent?.trim()) {
    parts.push(title);
  }
  parts.push(message.pane_id);
  return parts.join(" · ");
}

export function browserNotificationTarget(
  bridgeId: string,
  message: Pick<PaneAgentStatusChangedMessage, "pane_id" | "workspace_id">,
): BrowserNotificationTarget {
  return {
    bridgeId,
    paneId: message.pane_id,
    workspaceId: message.workspace_id,
  };
}

export function parseBrowserNotificationTarget(value: unknown): BrowserNotificationTarget | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.bridgeId !== "string" ||
    typeof value.paneId !== "string" ||
    typeof value.workspaceId !== "string"
  ) {
    return null;
  }
  return {
    bridgeId: value.bridgeId,
    paneId: value.paneId,
    workspaceId: value.workspaceId,
  };
}

export function countAttentionPanes(panes: readonly PaneInfo[]) {
  return panes.reduce((total, pane) => (isAttention(pane.agent_status) ? total + 1 : total), 0);
}

export function documentTitleWithBadge(
  baseTitle: string,
  attentionCount: number,
  badgeEnabled: boolean,
): string {
  if (!badgeEnabled || attentionCount <= 0) {
    return baseTitle;
  }
  return `(${attentionCount}) ${baseTitle}`;
}

type NotificationApi = {
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  new (title: string, options?: NotificationOptions): Notification;
};

export function isBrowserNotificationApiSupported(
  notificationCtor: NotificationApi | typeof Notification | undefined = globalNotification(),
): boolean {
  return (
    typeof notificationCtor === "function" &&
    typeof (notificationCtor as NotificationApi).permission === "string"
  );
}

export function browserNotificationPermission(
  notificationCtor: NotificationApi | typeof Notification | undefined = globalNotification(),
): NotificationPermission | "unsupported" {
  if (!isBrowserNotificationApiSupported(notificationCtor)) {
    return "unsupported";
  }
  return (notificationCtor as NotificationApi).permission;
}

/**
 * Request browser permission when enabling notifications.
 * Returns the resulting permission; does not change prefs.
 */
export async function requestBrowserNotificationPermission(
  notificationCtor: NotificationApi | typeof Notification | undefined = globalNotification(),
): Promise<NotificationPermission | "unsupported"> {
  if (!isBrowserNotificationApiSupported(notificationCtor)) {
    return "unsupported";
  }
  const api = notificationCtor as NotificationApi;
  if (api.permission === "granted" || api.permission === "denied") {
    return api.permission;
  }
  try {
    return await api.requestPermission();
  } catch {
    return "denied";
  }
}

export type ShowAgentStatusNotificationOptions = {
  bridgeId: string;
  message: PaneAgentStatusChangedMessage;
  prefs: BrowserNotificationPrefs;
  bridgeLabel?: string | null;
  permission?: NotificationPermission | "unsupported";
  NotificationCtor?: typeof Notification | undefined;
  onClick?: (target: BrowserNotificationTarget) => void;
};

/**
 * Show a desktop Notification for an agent status transition when prefs/permission allow.
 * Returns true when a notification was created.
 */
export function showAgentStatusNotification(options: ShowAgentStatusNotificationOptions): boolean {
  const {
    bridgeId,
    message,
    prefs,
    bridgeLabel,
    onClick,
  } = options;
  if (!shouldNotifyAgentStatus(message.agent_status, prefs)) {
    return false;
  }
  const NotificationCtor = options.NotificationCtor ?? globalNotification();
  if (!isBrowserNotificationApiSupported(NotificationCtor)) {
    return false;
  }
  const permission = options.permission ?? NotificationCtor!.permission;
  if (permission !== "granted") {
    return false;
  }

  const target = browserNotificationTarget(bridgeId, message);
  const notificationOptions: NotificationOptions & { renotify?: boolean } = {
    body: browserNotificationBody(message, bridgeLabel),
    tag: browserNotificationTag(bridgeId, message.pane_id),
    // Re-alert when the same pane transitions again (same tag).
    renotify: true,
    data: target,
  };
  const notification = new NotificationCtor!(
    browserNotificationTitle(message),
    notificationOptions,
  );

  if (onClick) {
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // Some environments restrict focus from notification handlers.
      }
      onClick(target);
      notification.close();
    };
  }
  return true;
}

function globalNotification(): typeof Notification | undefined {
  if (typeof Notification === "undefined") {
    return undefined;
  }
  return Notification;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
