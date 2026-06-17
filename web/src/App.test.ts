import { describe, expect, it } from "vitest";
import {
  currentConnectionSnapshot,
  isConnectionResultCurrent,
} from "./connectionState";
import { resumeRefreshMode } from "./resumeRefresh";

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

describe("resumeRefreshMode", () => {
  it("does nothing until a bridge is connected and resume token advances", () => {
    expect(
      resumeRefreshMode({
        canConnect: false,
        hasCapabilities: true,
        stateStream: true,
        previousToken: 1,
        currentToken: 2,
      }),
    ).toBe("none");
    expect(
      resumeRefreshMode({
        canConnect: true,
        hasCapabilities: false,
        stateStream: true,
        previousToken: 1,
        currentToken: 2,
      }),
    ).toBe("none");
    expect(
      resumeRefreshMode({
        canConnect: true,
        hasCapabilities: true,
        stateStream: true,
        previousToken: 2,
        currentToken: 2,
      }),
    ).toBe("none");
  });

  it("routes resume refreshes by bridge capability", () => {
    expect(
      resumeRefreshMode({
        canConnect: true,
        hasCapabilities: true,
        stateStream: true,
        previousToken: 1,
        currentToken: 2,
      }),
    ).toBe("state_stream");
    expect(
      resumeRefreshMode({
        canConnect: true,
        hasCapabilities: true,
        stateStream: false,
        previousToken: 1,
        currentToken: 2,
      }),
    ).toBe("legacy_snapshot");
  });
});
