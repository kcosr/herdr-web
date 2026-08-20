export type NavigationSyncMode = "shared" | "independent";

export const DEFAULT_NAVIGATION_SYNC_MODE: NavigationSyncMode = "shared";
export const NAVIGATION_SYNC_MODE_KEY = "herdrWeb.navigationSyncMode.v1";

export function parseNavigationSyncMode(value: unknown): NavigationSyncMode {
  return value === "independent" || value === "shared"
    ? value
    : DEFAULT_NAVIGATION_SYNC_MODE;
}

export function sharesNavigation(mode: NavigationSyncMode) {
  return mode === "shared";
}

export function readNavigationSyncMode(
  storage: Pick<Storage, "getItem"> | null = browserLocalStorage(),
): NavigationSyncMode {
  if (!storage) {
    return DEFAULT_NAVIGATION_SYNC_MODE;
  }
  try {
    return parseNavigationSyncMode(storage.getItem(NAVIGATION_SYNC_MODE_KEY));
  } catch {
    return DEFAULT_NAVIGATION_SYNC_MODE;
  }
}

export function writeNavigationSyncMode(
  mode: NavigationSyncMode,
  storage: Pick<Storage, "setItem"> | null = browserLocalStorage(),
) {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(NAVIGATION_SYNC_MODE_KEY, mode);
  } catch {
    // Local storage can be unavailable in private or locked-down browser contexts.
  }
}

export function navigationSyncModeForStorageEvent(
  eventValue: string | null,
  storage: Pick<Storage, "getItem"> | null = browserLocalStorage(),
): NavigationSyncMode | null {
  if (!storage) {
    return null;
  }
  try {
    const storedValue = storage.getItem(NAVIGATION_SYNC_MODE_KEY);
    return eventValue === storedValue ? parseNavigationSyncMode(storedValue) : null;
  } catch {
    return null;
  }
}

function browserLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
