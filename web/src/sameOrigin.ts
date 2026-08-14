// Display helpers for the "Same origin" backend entry.
//
// The same-origin bridge is the server that delivered this web app. Historically it identified
// itself by `location.origin`, which is only meaningful on the machine you are already sitting at
// (e.g. `http://localhost:8787`). When the bridge reports its own Tailscale tailnet name, we lead
// with a name that another device on the tailnet can actually connect to, while keeping the served
// origin visible so the operator still knows what URL is serving the current page.

export type SameOriginDisplay = {
  /** Primary identifier — leads the same-origin entry. */
  title: string;
  /** Secondary line — the URL this page is actually served from. */
  subtitle: string;
};

/**
 * The URL this page is actually served from, or the literal `"same-origin"` when `location.origin`
 * is unavailable (e.g. `about:blank`, sandboxed contexts). This is the pre-tailnet behavior.
 */
export function sameOriginServedUrl(origin: string | null | undefined): string {
  if (!origin || origin === "null") {
    return "same-origin";
  }
  return origin;
}

/**
 * Builds the title/subtitle for the same-origin entry.
 *
 * - With a tailnet name: the title becomes a reachable `host:port` identity (port included only
 *   when the page is served on a non-default port), and the subtitle keeps the served origin.
 * - Without a tailnet name (Tailscale absent/stopped, not on a tailnet): falls back exactly to the
 *   previous behavior — title `"Same origin"`, subtitle the served origin.
 */
export function sameOriginDisplay(params: {
  tailnetName?: string | null;
  origin?: string | null;
  port?: string | null;
}): SameOriginDisplay {
  const subtitle = sameOriginServedUrl(params.origin);
  const tailnetName = params.tailnetName?.trim();
  if (!tailnetName) {
    return { title: "Same origin", subtitle };
  }
  const port = params.port?.trim();
  const title = port ? `${tailnetName}:${port}` : tailnetName;
  return { title, subtitle };
}
