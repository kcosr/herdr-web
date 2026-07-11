import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFS,
  notificationPrefsWire,
  parseNotificationPrefs,
} from "./notificationPrefs";

describe("notificationPrefs", () => {
  it("defaults to blocked+done enabled, all-agents scope", () => {
    expect(DEFAULT_NOTIFICATION_PREFS.statuses.blocked).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFS.statuses.done).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFS.statuses.working).toBe(false);
    expect(DEFAULT_NOTIFICATION_PREFS.scopeDefault).toBe("on");
  });

  it("returns defaults for garbage input", () => {
    expect(parseNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parseNotificationPrefs(42)).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("parses partial input and fills missing statuses", () => {
    const parsed = parseNotificationPrefs({
      statuses: { blocked: false },
      scopeDefault: "on",
      workspaces: { w1: true },
      agents: { "w1:p1": false },
    });
    expect(parsed.statuses.blocked).toBe(false);
    expect(parsed.statuses.done).toBe(true);
    expect(parsed.scopeDefault).toBe("on");
    expect(parsed.workspaces.w1).toBe(true);
    expect(parsed.agents["w1:p1"]).toBe(false);
  });

  it("emits a snake_case wire body", () => {
    const wire = notificationPrefsWire(DEFAULT_NOTIFICATION_PREFS);
    expect(wire.scope_default).toBe("on");
    expect(wire.statuses.blocked).toBe(true);
  });
});
