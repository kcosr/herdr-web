/* herdr-web service worker — web push + notification click deep links.
 * Kept dependency-free so it can be served as a static asset from /sw.js. */

const ICON = "/herdr-logo-192.png";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = notificationTargetUrl(data);
  event.waitUntil(openOrFocusClient(targetUrl));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

async function handlePush(event) {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  if (payload.type === "clear" && payload.tag) {
    const stale = await self.registration.getNotifications({ tag: payload.tag });
    for (const notification of stale) {
      notification.close();
    }
    return;
  }

  // When a herdr-web tab is visible, in-page Notification/API already covers alerts.
  if (await anyVisibleClient()) {
    return;
  }

  const title = payload.title || "herdr-web";
  const options = {
    body: payload.body || "",
    tag: payload.tag || "herdr-web",
    renotify: Boolean(payload.renotify),
    icon: ICON,
    badge: ICON,
    data: {
      paneId: payload.pane_id || payload.paneId || null,
      workspaceId: payload.workspace_id || payload.workspaceId || null,
      bridgeId: payload.bridge_id || payload.bridgeId || null,
    },
  };
  await self.registration.showNotification(title, options);
}

async function anyVisibleClient() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.some((client) => client.visibilityState === "visible");
}

function notificationTargetUrl(data) {
  const url = new URL(self.registration.scope);
  if (data && data.paneId) {
    url.searchParams.set("pane", data.paneId);
  }
  if (data && data.bridgeId) {
    url.searchParams.set("bridge", data.bridgeId);
  }
  return url.href;
}

async function openOrFocusClient(targetUrl) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if ("focus" in client) {
      await client.focus();
      if ("navigate" in client && targetUrl) {
        try {
          await client.navigate(targetUrl);
        } catch {
          // Older clients may reject navigate; focus alone is still useful.
        }
      }
      return;
    }
  }
  if (self.clients.openWindow) {
    await self.clients.openWindow(targetUrl || "/");
  }
}
