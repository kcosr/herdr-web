import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAVIGATION_SYNC_MODE,
  NAVIGATION_SYNC_MODE_KEY,
  navigationSyncModeForStorageEvent,
  parseNavigationSyncMode,
  readNavigationSyncMode,
  sharesNavigation,
  writeNavigationSyncMode,
} from "./navigationPrefs";

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: (key: string) => (key === NAVIGATION_SYNC_MODE_KEY ? value : null),
    setItem: (key: string, next: string) => {
      if (key === NAVIGATION_SYNC_MODE_KEY) {
        value = next;
      }
    },
  };
}

describe("navigation synchronization preference", () => {
  it("defaults navigation synchronization to shared", () => {
    expect(parseNavigationSyncMode(undefined)).toBe(DEFAULT_NAVIGATION_SYNC_MODE);
    expect(parseNavigationSyncMode("other")).toBe(DEFAULT_NAVIGATION_SYNC_MODE);
    expect(sharesNavigation(DEFAULT_NAVIGATION_SYNC_MODE)).toBe(true);
    expect(sharesNavigation("independent")).toBe(false);
  });

  it("round-trips only the browser-wide synchronization mode", () => {
    const storage = memoryStorage();

    writeNavigationSyncMode("independent", storage);

    expect(readNavigationSyncMode(storage)).toBe("independent");
  });

  it("defaults malformed stored modes to shared", () => {
    expect(readNavigationSyncMode(memoryStorage("invalid"))).toBe("shared");
  });

  it("ignores delayed events that no longer match the stored mode", () => {
    const storage = memoryStorage("shared");

    expect(navigationSyncModeForStorageEvent("independent", storage)).toBeNull();
    expect(navigationSyncModeForStorageEvent("shared", storage)).toBe("shared");
  });
});
