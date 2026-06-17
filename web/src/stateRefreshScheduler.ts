export type StateRefreshReason =
  | "visibility"
  | "android_resume"
  | "resync_required"
  | "manual"
  | "safety";

type RefreshResponse = {
  refresh_id: string;
};

type StateRefreshSchedulerOptions = {
  enabled: () => boolean;
  currentStreamId: () => string | null;
  hasCurrentSnapshot: () => boolean;
  postRefresh: (streamId: string, reason: StateRefreshReason) => Promise<RefreshResponse>;
  isTerminalError?: (error: Error) => boolean;
  onTerminalError?: (error: Error) => void;
  delay?: (ms: number) => Promise<void>;
  setTimeout?: (handler: () => void, ms: number) => number;
  clearTimeout?: (timer: number) => void;
  timeoutMs?: number;
  maxAttempts?: number;
};

type RefreshWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number;
};

export type StateRefreshScheduler = ReturnType<typeof createStateRefreshScheduler>;

export function createStateRefreshScheduler(options: StateRefreshSchedulerOptions) {
  const waiters = new Map<string, RefreshWaiter>();
  const completed = new Set<string>();
  const failed = new Map<string, Error>();
  const delay = options.delay ?? defaultDelay;
  const setTimer = options.setTimeout ?? ((handler, ms) => window.setTimeout(handler, ms));
  const clearTimer = options.clearTimeout ?? ((timer) => window.clearTimeout(timer));
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxAttempts = options.maxAttempts ?? 3;
  let inFlight: Promise<void> | null = null;
  let epoch = 0;

  const hasFreshSnapshotAfterCancel = (requestEpoch: number) =>
    requestEpoch !== epoch && options.hasCurrentSnapshot();

  const waitForRefresh = (refreshId: string) =>
    new Promise<void>((resolve, reject) => {
      if (completed.delete(refreshId)) {
        resolve();
        return;
      }
      const priorFailure = failed.get(refreshId);
      if (priorFailure) {
        failed.delete(refreshId);
        reject(priorFailure);
        return;
      }
      const timer = setTimer(() => {
        waiters.delete(refreshId);
        reject(new Error(`state refresh timed out: ${refreshId}`));
      }, timeoutMs);
      waiters.set(refreshId, { resolve, reject, timer });
    });

  const request = async (reason: StateRefreshReason) => {
    if (!options.enabled()) {
      return;
    }
    if (inFlight) {
      return inFlight;
    }
    const requestEpoch = epoch;
    const activeRequest = (async () => {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (hasFreshSnapshotAfterCancel(requestEpoch)) {
          return;
        }
        if (requestEpoch !== epoch) {
          throw new Error("state refresh cancelled");
        }
        const streamId = options.currentStreamId();
        if (!streamId) {
          if (options.hasCurrentSnapshot()) {
            return;
          }
          throw new Error("state stream is not ready");
        }
        try {
          const { refresh_id: refreshId } = await options.postRefresh(streamId, reason);
          await waitForRefresh(refreshId);
          return;
        } catch (err) {
          if (hasFreshSnapshotAfterCancel(requestEpoch)) {
            return;
          }
          lastError = err instanceof Error ? err : new Error(String(err));
          if (options.isTerminalError?.(lastError)) {
            options.onTerminalError?.(lastError);
            if (options.hasCurrentSnapshot()) {
              return;
            }
            throw lastError;
          }
          if (attempt + 1 < maxAttempts) {
            await delay(Math.min(250 * 2 ** attempt, 1000));
          }
        }
      }
      if (options.hasCurrentSnapshot()) {
        return;
      }
      throw lastError ?? new Error("state refresh failed");
    })();

    inFlight = activeRequest;
    try {
      await activeRequest;
    } finally {
      if (inFlight === activeRequest) {
        inFlight = null;
      }
    }
  };

  const settle = (refreshIds: string[] | undefined, error?: Error) => {
    if (!refreshIds) {
      return;
    }
    for (const refreshId of refreshIds) {
      const waiter = waiters.get(refreshId);
      if (!waiter) {
        if (error) {
          failed.set(refreshId, error);
        } else {
          completed.add(refreshId);
        }
        continue;
      }
      clearTimer(waiter.timer);
      waiters.delete(refreshId);
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve();
      }
    }
  };

  const clear = (message: string) => {
    epoch += 1;
    for (const [refreshId, waiter] of waiters) {
      clearTimer(waiter.timer);
      waiter.reject(new Error(message || `state refresh ${refreshId} cancelled`));
    }
    waiters.clear();
    completed.clear();
    failed.clear();
    inFlight = null;
  };

  return { clear, request, settle };
}

function defaultDelay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}
