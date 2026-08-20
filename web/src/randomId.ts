/**
 * `crypto.randomUUID` is only defined in a **secure context**. `http://localhost`
 * counts as secure, so it is always present in local dev — but herdr-web is
 * routinely served over plain HTTP to a LAN IP, a `.local` name, or a Tailscale
 * address, where `crypto.randomUUID` is `undefined` and calling it throws a
 * TypeError. Older Safari lacks it outright. Never call it unguarded; route new
 * id call sites through this helper.
 *
 * Some of these ids session-scope otherwise unauthenticated streams (see
 * ParlayMobileInput's `/api/chat/events` device/stream ids), so the fallback has
 * to stay collision-resistant and hard to guess from another tab.
 * `crypto.getRandomValues` is *not* secure-context gated, so the first fallback
 * is still cryptographically strong; the clock+`Math.random` tier only runs in
 * environments with no Web Crypto at all.
 */
export function randomId(): string {
  const cryptoApi: Crypto | undefined = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    // Shape the bytes as a RFC 4122 v4 UUID so fallback ids stay
    // indistinguishable from randomUUID() output downstream.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
  }

  const entropy = `${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
  return `${Date.now().toString(36)}-${entropy}`;
}
