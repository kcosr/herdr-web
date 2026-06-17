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
  maxSettledRefreshIds?: number;
};

type RefreshWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number;
};

export type StateRefreshScheduler = ReturnType<typeof createStateRefreshScheduler>;

class StateRefreshTimeoutError extends Error {}

export function createStateRefreshScheduler(options: StateRefreshSchedulerOptions) {
  const waiters = new Map<string, RefreshWaiter>();
  const completed = new Set<string>();
  const failed = new Map<string, Error>();
  const delay = options.delay ?? defaultDelay;
  const setTimer = options.setTimeout ?? ((handler, ms) => window.setTimeout(handler, ms));
  const clearTimer = options.clearTimeout ?? ((timer) => window.clearTimeout(timer));
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxAttempts = options.maxAttempts ?? 3;
  const maxSettledRefreshIds = options.maxSettledRefreshIds ?? 128;
  let inFlight: Promise<void> | null = null;
  let queuedReason: StateRefreshReason | null = null;
  let drainToken = 0;
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
        reject(new StateRefreshTimeoutError(`state refresh timed out: ${refreshId}`));
      }, timeoutMs);
      waiters.set(refreshId, { resolve, reject, timer });
    });

  const runRefresh = async (reason: StateRefreshReason) => {
    const requestEpoch = epoch;
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
        if (lastError instanceof StateRefreshTimeoutError && options.hasCurrentSnapshot()) {
          return;
        }
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
  };

  const startDrain = () => {
    const token = (drainToken += 1);
    inFlight = (async () => {
      try {
        while (token === drainToken && queuedReason !== null) {
          const reason = queuedReason;
          queuedReason = null;
          await runRefresh(reason);
        }
      } finally {
        if (token === drainToken) {
          inFlight = null;
        }
      }
    })();
    return inFlight;
  };

  const request = async (reason: StateRefreshReason) => {
    if (!options.enabled()) {
      return;
    }
    queuedReason = reason;
    return inFlight ?? startDrain();
  };

  const trimSettledRefreshIds = () => {
    while (completed.size + failed.size > maxSettledRefreshIds) {
      const completedRefreshId = completed.values().next().value as string | undefined;
      if (completedRefreshId) {
        completed.delete(completedRefreshId);
        continue;
      }
      const failedRefreshId = failed.keys().next().value as string | undefined;
      if (!failedRefreshId) {
        return;
      }
      failed.delete(failedRefreshId);
    }
  };

  const rememberSettledRefreshId = (refreshId: string, error?: Error) => {
    if (error) {
      completed.delete(refreshId);
      failed.set(refreshId, error);
    } else {
      failed.delete(refreshId);
      completed.add(refreshId);
    }
    trimSettledRefreshIds();
  };

  const settle = (refreshIds: string[] | undefined, error?: Error) => {
    if (!refreshIds) {
      return;
    }
    for (const refreshId of refreshIds) {
      const waiter = waiters.get(refreshId);
      if (!waiter) {
        rememberSettledRefreshId(refreshId, error);
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
    queuedReason = null;
    drainToken += 1;
    inFlight = null;
  };

  return { clear, request, settle };
}

function defaultDelay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}
