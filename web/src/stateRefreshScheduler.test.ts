import { describe, expect, it } from "vitest";
import { createStateRefreshScheduler } from "./stateRefreshScheduler";

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("state refresh scheduler", () => {
  it("posts a refresh and waits for the correlated snapshot id", async () => {
    let streamId = "stream-1";
    const posts: Array<{ streamId: string; reason: string }> = [];
    const scheduler = createStateRefreshScheduler({
      enabled: () => true,
      currentStreamId: () => streamId,
      hasCurrentSnapshot: () => false,
      postRefresh: async (nextStreamId, reason) => {
        posts.push({ streamId: nextStreamId, reason });
        return { refresh_id: "refresh-1" };
      },
      delay: async () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
    });

    const request = scheduler.request("manual");
    await flush();
    expect(posts).toEqual([{ streamId: "stream-1", reason: "manual" }]);

    streamId = "stream-2";
    scheduler.settle(["refresh-1"]);

    await expect(request).resolves.toBeUndefined();
  });

  it("coalesces concurrent requests onto one in-flight refresh", async () => {
    const posts: string[] = [];
    const scheduler = createStateRefreshScheduler({
      enabled: () => true,
      currentStreamId: () => "stream-1",
      hasCurrentSnapshot: () => false,
      postRefresh: async (streamId) => {
        posts.push(streamId);
        return { refresh_id: "refresh-1" };
      },
      delay: async () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
    });

    const first = scheduler.request("manual");
    const second = scheduler.request("safety");
    await flush();

    expect(posts).toEqual(["stream-1"]);
    scheduler.settle(["refresh-1"]);

    await Promise.all([first, second]);
  });

  it("retries with the latest stream id instead of a captured stale one", async () => {
    let streamId = "stream-1";
    const posts: string[] = [];
    const scheduler = createStateRefreshScheduler({
      enabled: () => true,
      currentStreamId: () => streamId,
      hasCurrentSnapshot: () => false,
      postRefresh: async (nextStreamId) => {
        posts.push(nextStreamId);
        if (posts.length === 1) {
          streamId = "stream-2";
          throw new Error("unknown stream_id");
        }
        return { refresh_id: "refresh-2" };
      },
      delay: async () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
    });

    const request = scheduler.request("resync_required");
    await flush();
    await flush();

    expect(posts).toEqual(["stream-1", "stream-2"]);
    scheduler.settle(["refresh-2"]);

    await expect(request).resolves.toBeUndefined();
  });

  it("retries a matching resync failure without hanging or storming", async () => {
    const refreshIds = ["refresh-1", "refresh-2"];
    const posts: string[] = [];
    const scheduler = createStateRefreshScheduler({
      enabled: () => true,
      currentStreamId: () => "stream-1",
      hasCurrentSnapshot: () => false,
      postRefresh: async () => {
        const refreshId = refreshIds[posts.length];
        posts.push(refreshId);
        return { refresh_id: refreshId };
      },
      delay: async () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
    });

    const request = scheduler.request("manual");
    await flush();
    scheduler.settle(["refresh-1"], new Error("rebuild failed"));
    await flush();
    await flush();
    scheduler.settle(["refresh-2"]);

    await expect(request).resolves.toBeUndefined();
    expect(posts).toEqual(["refresh-1", "refresh-2"]);
  });

  it("cancels stale requests without swallowing a new stream refresh", async () => {
    let streamId = "stream-1";
    let hasSnapshot = false;
    const posts: string[] = [];
    const scheduler = createStateRefreshScheduler({
      enabled: () => true,
      currentStreamId: () => streamId,
      hasCurrentSnapshot: () => hasSnapshot,
      postRefresh: async (nextStreamId) => {
        posts.push(nextStreamId);
        return { refresh_id: `refresh-${posts.length}` };
      },
      delay: async () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
    });

    const oldRequest = scheduler.request("manual");
    await flush();
    scheduler.clear("state stream closed");
    streamId = "stream-2";
    hasSnapshot = true;

    await expect(oldRequest).resolves.toBeUndefined();

    const newRequest = scheduler.request("visibility");
    await flush();
    scheduler.settle(["refresh-2"]);
    await expect(newRequest).resolves.toBeUndefined();
    expect(posts).toEqual(["stream-1", "stream-2"]);
  });
});
