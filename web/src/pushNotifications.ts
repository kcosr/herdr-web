import type { BridgeHttpUrl } from "./bridgeApi";
import type { BridgeCapabilities } from "./bridge";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { notificationPrefsWire, type NotificationPrefs } from "./notificationPrefs";

export type PushEnableResult = "enabled" | "denied" | "unsupported";

export function supportsPush(capabilities: BridgeCapabilities | null | undefined) {
  return capabilities?.push?.version === 1;
}

export function pushRuntimeSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function enablePush(
  httpUrl: BridgeHttpUrl,
  prefs: NotificationPrefs,
): Promise<PushEnableResult> {
  if (!pushRuntimeSupported()) {
    return "unsupported";
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return "denied";
  }
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const vapid = await fetchVapidPublicKey(httpUrl);
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    }));
  await postSubscription(httpUrl, subscription, prefs);
  return "enabled";
}

export async function updatePushPrefs(httpUrl: BridgeHttpUrl, prefs: NotificationPrefs) {
  if (!pushRuntimeSupported()) {
    return;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) {
    return;
  }
  await postSubscription(httpUrl, subscription, prefs);
}

export async function disablePush(httpUrl: BridgeHttpUrl) {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) {
    return;
  }
  await fetchWithTimeout(httpUrl("/api/push/unsubscribe"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

async function postSubscription(
  httpUrl: BridgeHttpUrl,
  subscription: PushSubscription,
  prefs: NotificationPrefs,
) {
  const json = subscription.toJSON();
  const response = await fetchWithTimeout(httpUrl("/api/push/subscribe"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      prefs: notificationPrefsWire(prefs),
    }),
  });
  if (!response.ok) {
    throw new Error(`push subscribe failed: ${response.status}`);
  }
}

async function fetchVapidPublicKey(httpUrl: BridgeHttpUrl): Promise<string> {
  const response = await fetchWithTimeout(httpUrl("/api/push/vapid-public-key"));
  if (!response.ok) {
    throw new Error(`vapid key fetch failed: ${response.status}`);
  }
  const value = (await response.json()) as { public_key?: unknown };
  if (typeof value.public_key !== "string") {
    throw new Error("vapid public key missing");
  }
  return value.public_key;
}

function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
