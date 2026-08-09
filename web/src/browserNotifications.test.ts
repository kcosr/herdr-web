import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserNotificationBody,
  browserNotificationTag,
  browserNotificationTitle,
  browserNotificationTarget,
  countAttentionPanes,
  DEFAULT_BROWSER_NOTIFICATION_PREFS,
  documentTitleWithBadge,
  parseBrowserNotificationPrefs,
  parseBrowserNotificationTarget,
  requestBrowserNotificationPermission,
  shouldNotifyAgentStatus,
  showAgentStatusNotification,
} from "./browserNotifications";
import type { PaneAgentStatusChangedMessage, PaneInfo } from "./types";

function message(
  overrides: Partial<PaneAgentStatusChangedMessage> = {},
): PaneAgentStatusChangedMessage {
  return {
    type: "pane.agent_status_changed",
    pane_id: "w1:p1",
    workspace_id: "w1",
    agent_status: "blocked",
    agent: "claude",
    title: "fix auth",
    display_agent: "Claude",
    state_labels: {},
    ...overrides,
  };
}

describe("browser notification prefs", () => {
  it("parses known booleans and falls back otherwise", () => {
    expect(
      parseBrowserNotificationPrefs({
        enabled: true,
        notifyOnBlocked: false,
        notifyOnDone: true,
        documentBadge: false,
      }),
    ).toEqual({
      enabled: true,
      notifyOnBlocked: false,
      notifyOnDone: true,
      documentBadge: false,
    });
    expect(parseBrowserNotificationPrefs({})).toEqual(DEFAULT_BROWSER_NOTIFICATION_PREFS);
    expect(parseBrowserNotificationPrefs(null)).toEqual(DEFAULT_BROWSER_NOTIFICATION_PREFS);
  });
});

describe("shouldNotifyAgentStatus", () => {
  it("respects the master switch and per-status toggles", () => {
    expect(
      shouldNotifyAgentStatus("blocked", {
        enabled: false,
        notifyOnBlocked: true,
        notifyOnDone: true,
      }),
    ).toBe(false);
    expect(
      shouldNotifyAgentStatus("blocked", {
        enabled: true,
        notifyOnBlocked: true,
        notifyOnDone: true,
      }),
    ).toBe(true);
    expect(
      shouldNotifyAgentStatus("done", {
        enabled: true,
        notifyOnBlocked: true,
        notifyOnDone: false,
      }),
    ).toBe(false);
    expect(
      shouldNotifyAgentStatus("working", {
        enabled: true,
        notifyOnBlocked: true,
        notifyOnDone: true,
      }),
    ).toBe(false);
  });
});

describe("notification copy and tags", () => {
  it("builds attention-oriented titles and bodies", () => {
    expect(browserNotificationTitle(message())).toBe("Claude needs you");
    expect(browserNotificationTitle(message({ agent_status: "done" }))).toBe("Claude is done");
    expect(browserNotificationBody(message(), "laptop")).toBe("laptop · fix auth · w1:p1");
    expect(browserNotificationTag("bridge-a", "w1:p1")).toBe("herdr-web:agent:bridge-a:w1:p1");
  });

  it("round-trips notification click targets", () => {
    const target = browserNotificationTarget("b1", message());
    expect(target).toEqual({ bridgeId: "b1", paneId: "w1:p1", workspaceId: "w1" });
    expect(parseBrowserNotificationTarget(target)).toEqual(target);
    expect(parseBrowserNotificationTarget({ bridgeId: "b1" })).toBeNull();
  });
});

describe("document title badge", () => {
  it("prefixes attention counts when enabled", () => {
    expect(documentTitleWithBadge("herdr-web", 0, true)).toBe("herdr-web");
    expect(documentTitleWithBadge("herdr-web", 3, true)).toBe("(3) herdr-web");
    expect(documentTitleWithBadge("herdr-web", 3, false)).toBe("herdr-web");
  });

  it("counts blocked and done panes", () => {
    const panes = [
      { agent_status: "blocked" },
      { agent_status: "done" },
      { agent_status: "working" },
      { agent_status: "idle" },
    ] as PaneInfo[];
    expect(countAttentionPanes(panes)).toBe(2);
  });
});

describe("showAgentStatusNotification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a notification when enabled and permission is granted", () => {
    function MockNotification(this: { close: () => void; onclick: null }, title: string, options?: NotificationOptions) {
      void title;
      void options;
      this.close = vi.fn();
      this.onclick = null;
    }
    MockNotification.permission = "granted" as NotificationPermission;
    MockNotification.requestPermission = async () => "granted" as NotificationPermission;
    const NotificationCtor = vi.fn(MockNotification) as unknown as typeof Notification;
    Object.defineProperty(NotificationCtor, "permission", { value: "granted" });

    const shown = showAgentStatusNotification({
      bridgeId: "b1",
      message: message(),
      prefs: { ...DEFAULT_BROWSER_NOTIFICATION_PREFS, enabled: true },
      bridgeLabel: "dev",
      NotificationCtor,
      onClick: vi.fn(),
    });

    expect(shown).toBe(true);
    expect(NotificationCtor).toHaveBeenCalledWith(
      "Claude needs you",
      expect.objectContaining({
        body: "dev · fix auth · w1:p1",
        tag: "herdr-web:agent:b1:w1:p1",
        renotify: true,
        data: { bridgeId: "b1", paneId: "w1:p1", workspaceId: "w1" },
      }),
    );
  });

  it("skips when permission is not granted", () => {
    function MockNotification() {
      return undefined;
    }
    const NotificationCtor = vi.fn(MockNotification) as unknown as typeof Notification;
    Object.defineProperty(NotificationCtor, "permission", { value: "denied" });
    expect(
      showAgentStatusNotification({
        bridgeId: "b1",
        message: message(),
        prefs: { ...DEFAULT_BROWSER_NOTIFICATION_PREFS, enabled: true },
        NotificationCtor,
      }),
    ).toBe(false);
    expect(NotificationCtor).not.toHaveBeenCalled();
  });
});

describe("requestBrowserNotificationPermission", () => {
  it("returns unsupported when Notification is missing", async () => {
    await expect(requestBrowserNotificationPermission(undefined)).resolves.toBe("unsupported");
  });

  it("requests permission when still default", async () => {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    function MockNotification() {
      return undefined;
    }
    MockNotification.permission = "default" as NotificationPermission;
    MockNotification.requestPermission = requestPermission;
    await expect(
      requestBrowserNotificationPermission(
        MockNotification as unknown as typeof Notification,
      ),
    ).resolves.toBe("granted");
    expect(requestPermission).toHaveBeenCalled();
  });
});
