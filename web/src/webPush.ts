import type { BridgeCapabilities } from "./bridge";
import { fetchWithTimeout } from "./fetchWithTimeout";
import type { BridgeHttpUrl } from "./bridgeApi";

export type WebPushCapability = {
  version: number;
  public_key: string;
};

export type WebPushSubscriptionJson = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export function supportsWebPushCapability(
  capabilities: BridgeCapabilities | null | undefined,
): capabilities is BridgeCapabilities & { web_push: WebPushCapability } {
  return (
    !!capabilities &&
    typeof capabilities.web_push === "object" &&
    capabilities.web_push !== null &&
    capabilities.web_push.version === 1 &&
    typeof capabilities.web_push.public_key === "string" &&
    capabilities.web_push.public_key.length > 0
  );
}

export function isWebPushBrowserSupported(
  serviceWorker: ServiceWorkerContainer | undefined = globalServiceWorker(),
  pushManager: boolean = typeof PushManager !== "undefined",
  notification: boolean = typeof Notification !== "undefined",
): boolean {
  return Boolean(serviceWorker && pushManager && notification && window.isSecureContext);
}

export async function registerHerdrServiceWorker(
  serviceWorker: ServiceWorkerContainer | undefined = globalServiceWorker(),
): Promise<ServiceWorkerRegistration | null> {
  if (!serviceWorker) {
    return null;
  }
  try {
    return await serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export async function getCurrentPushSubscription(
  registration: ServiceWorkerRegistration | null,
): Promise<PushSubscription | null> {
  if (!registration) {
    return null;
  }
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function subscribeWebPush(options: {
  httpUrl: BridgeHttpUrl;
  publicKey: string;
  registration: ServiceWorkerRegistration;
}): Promise<PushSubscription> {
  const existing = await options.registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await options.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKeyFromBase64(options.publicKey),
    }));
  await postSubscription(options.httpUrl, "/api/push/subscribe", subscriptionToJson(subscription));
  return subscription;
}

export async function unsubscribeWebPush(options: {
  httpUrl: BridgeHttpUrl;
  registration: ServiceWorkerRegistration | null;
}): Promise<void> {
  const subscription = options.registration
    ? await options.registration.pushManager.getSubscription()
    : null;
  if (!subscription) {
    return;
  }
  try {
    await postSubscription(options.httpUrl, "/api/push/unsubscribe", {
      endpoint: subscription.endpoint,
    });
  } finally {
    await subscription.unsubscribe();
  }
}

export function subscriptionToJson(subscription: PushSubscription): WebPushSubscriptionJson {
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error("incomplete push subscription");
  }
  return {
    endpoint,
    keys: { p256dh, auth },
  };
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

function applicationServerKeyFromBase64(base64String: string): ArrayBuffer {
  const bytes = urlBase64ToUint8Array(base64String);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function postSubscription(
  httpUrl: BridgeHttpUrl,
  path: "/api/push/subscribe" | "/api/push/unsubscribe",
  body: unknown,
) {
  const response = await fetchWithTimeout(httpUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `push request failed (${response.status})`);
  }
}

function globalServiceWorker(): ServiceWorkerContainer | undefined {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return undefined;
  }
  return navigator.serviceWorker;
}
