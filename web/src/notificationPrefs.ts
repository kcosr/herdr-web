export type NotificationStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type NotificationScopeDefault = "off" | "on";

export type NotificationPrefs = {
  statuses: Record<NotificationStatus, boolean>;
  scopeDefault: NotificationScopeDefault;
  workspaces: Record<string, boolean>;
  agents: Record<string, boolean>;
};

const STATUS_KEYS: NotificationStatus[] = ["idle", "working", "blocked", "done", "unknown"];

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  statuses: { idle: false, working: false, blocked: true, done: true, unknown: false },
  scopeDefault: "off",
  workspaces: {},
  agents: {},
};

export function parseNotificationPrefs(value: unknown): NotificationPrefs {
  if (!isRecord(value)) {
    return cloneDefault();
  }
  const statuses = { ...DEFAULT_NOTIFICATION_PREFS.statuses };
  if (isRecord(value.statuses)) {
    for (const key of STATUS_KEYS) {
      const v = value.statuses[key];
      if (typeof v === "boolean") {
        statuses[key] = v;
      }
    }
  }
  return {
    statuses,
    scopeDefault: value.scopeDefault === "on" ? "on" : "off",
    workspaces: parseBoolRecord(value.workspaces),
    agents: parseBoolRecord(value.agents),
  };
}

export function notificationPrefsWire(prefs: NotificationPrefs) {
  return {
    statuses: prefs.statuses,
    scope_default: prefs.scopeDefault,
    workspaces: prefs.workspaces,
    agents: prefs.agents,
  };
}

function parseBoolRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, boolean> = {};
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === "boolean") {
      out[key] = v;
    }
  }
  return out;
}

function cloneDefault(): NotificationPrefs {
  return {
    statuses: { ...DEFAULT_NOTIFICATION_PREFS.statuses },
    scopeDefault: DEFAULT_NOTIFICATION_PREFS.scopeDefault,
    workspaces: {},
    agents: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
