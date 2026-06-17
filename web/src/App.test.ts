import { describe, expect, it } from "vitest";
import {
  currentConnectionSnapshot,
  isConnectionResultCurrent,
} from "./connectionState";

describe("App connection guards", () => {
  it("hides snapshots from stale backend connections", () => {
    const snapshot = { panes: ["pane-a"] };

    expect(currentConnectionSnapshot(snapshot, "same-origin", "same-origin")).toBe(snapshot);
    expect(currentConnectionSnapshot(snapshot, "configured:a", "configured:b")).toBeNull();
  });

  it("rejects async results from stale backend connections", () => {
    expect(isConnectionResultCurrent("configured:a", "configured:a")).toBe(true);
    expect(isConnectionResultCurrent("configured:b", "configured:a")).toBe(false);
  });
});
