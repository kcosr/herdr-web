import posthog from "posthog-js";

const POSTHOG_KEY = (import.meta.env.VITE_POSTHOG_KEY as string | undefined) || "";
const POSTHOG_HOST = "https://us.i.posthog.com";

export function initAnalytics() {
  if (typeof window === "undefined") {
    return;
  }
  // Only initialize if a key is provided; disabled by default
  if (!POSTHOG_KEY) {
    return;
  }
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "always",
    capture_pageview: true,
  });
}
