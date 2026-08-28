import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { addNativeResumeHandler } from "./native";
import { randomId } from "./randomId";

function stripPort(label: string): string {
  return label.replace(/:\d+$/, "");
}

function extractHostname(tailnetName: string): string {
  return tailnetName.split(".")[0];
}

export const SAME_ORIGIN_BRIDGE_ID = "same-origin";

export type BridgeId = string;

export type BridgeBackendProfile = {
  id: string;
  name: string;
  baseUrl: string;
  color?: string;
  lastConnectedAt?: string;
  discovered?: boolean;
};

export type BridgeBackendStore = {
  version: 2;
  enabledBridgeIds: BridgeId[];
  lastSelectedBridgeId: BridgeId | null;
  backends: BridgeBackendProfile[];
};

export type BridgeMode = "same-origin" | "configured";

/**
 * A remote herdr-web bridge the local (hub) bridge was launched to proxy for
 * (`--remote-bridge <url>`), as reported by the server at `GET /api/bridges`.
 *
 * These are NOT client-added backends: their existence and reachability are
 * owned by the hub bridge's process configuration. The client mirrors the
 * server's list and reaches each one through the hub's same-origin proxy
 * (`/api/remote/<id>/...`, `/ws/remote/<id>/terminal`) — never by connecting to
 * the remote host directly. `id` is the server-derived stable id (remote
 * hostname); `label`/`baseUrl` are for display only.
 */
export type RemoteBridgeSummary = {
  id: string;
  label: string;
  baseUrl: string;
};

export type BridgeCapabilities = {
  commands: string[];
  agent_activity?: {
    version: 1;
  };
  agent_pins?: {
    version: 1;
  };
  notes?: {
    version: 1;
  };
  launcher_presets?: {
    version: 1;
  };
  bridge_version?: string;
  web_compat?: number;
  min_android_app_compat?: number;
  /**
   * This machine's own Tailscale tailnet DNS name (e.g. `macbook.tailnet.ts.net`), resolved
   * server-side. Absent when Tailscale is not available; consumers fall back to the origin.
   */
  tailnet_name?: string;
};

export type CapabilityState = "idle" | "probing" | "ready" | "error";

type BridgeProbeState = {
  connectionKey: string;
  capabilities: BridgeCapabilities | null;
  capabilityState: CapabilityState;
  capabilityError: string | null;
  connectionBlocked: boolean;
};

export type BridgeRuntime = {
  id: BridgeId;
  mode: BridgeMode;
  label: string;
  color: string;
  backend: BridgeBackendProfile | null;
  connectionKey: string;
  resumeToken: number;
  capabilities: BridgeCapabilities | null;
  capabilityState: CapabilityState;
  capabilityError: string | null;
  canConnect: boolean;
  /**
   * True when this runtime reaches a remote bridge through the hub's same-origin
   * proxy (`/api/remote/<id>/...`). Only the server's read-oriented allow-list is
   * forwarded and only `/ws/terminal` is proxied, so callers must not expect
   * write endpoints (command/selection/uploads) or the non-terminal event
   * sockets (`/ws/events`, `/ws/activity`, `/ws/ui-events`) to work here.
   */
  proxied: boolean;
  httpUrl: (path: string, query?: URLSearchParams) => string;
  wsUrl: (path: string, query?: URLSearchParams) => string;
};

export type BridgeManager = {
  store: BridgeBackendStore;
  storeLoaded: boolean;
  sameOriginAvailable: boolean;
  /** Remote bridges the server proxies for (`GET /api/bridges`), for display. */
  remoteBridges: RemoteBridgeSummary[];
  availableRuntimes: BridgeRuntime[];
  enabledRuntimes: BridgeRuntime[];
  enabledBridgeIds: BridgeId[];
  lastSelectedBridgeId: BridgeId | null;
  getRuntime: (bridgeId: BridgeId | null | undefined) => BridgeRuntime | null;
  setBridgeEnabled: (bridgeId: BridgeId, enabled: boolean) => void;
  setLastSelectedBridgeId: (bridgeId: BridgeId | null) => void;
  markBridgeUsed: (bridgeId: BridgeId) => void;
  retryBridgeProbe: (bridgeId: BridgeId) => void;
  addBackend: (input: BackendInput, enable?: boolean) => Promise<BridgeBackendProfile>;
  updateBackend: (id: string, input: BackendInput) => Promise<BridgeBackendProfile>;
  deleteBackend: (id: string) => void;
  probeBackend: (baseUrl: string) => Promise<BridgeCapabilities>;
};

export type BackendInput = {
  name?: string;
  baseUrl: string;
  color?: string;
};

const STORE_KEY = "herdrWeb.bridgeBackends.v2";
const LEGACY_STORE_KEY = "herdrWeb.bridgeBackends.v1";
const NOTE_DRAFT_STORAGE_PREFIX = "herdr-web:note-draft:v1:";
const STORE_VERSION = 2;
const APP_MIN_WEB_COMPAT = 1;
export const SAME_ORIGIN_BRIDGE_COLOR = "#b4befe";
const BACKEND_COLOR_PALETTE = [
  "#89b4fa",
  "#a6e3a1",
  "#f9e2af",
  "#fab387",
  "#94e2d5",
  "#f38ba8",
  "#cba6f7",
  "#74c7ec",
] as const;

const BridgeContext = createContext<BridgeManager | null>(null);

export function BridgeProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<BridgeBackendStore>(() => fallbackStore());
  const [storeLoaded, setStoreLoaded] = useState(false);
  const [remoteBridges, setRemoteBridges] = useState<RemoteBridgeSummary[]>([]);
  const [probeStates, setProbeStates] = useState<Record<string, BridgeProbeState>>({});
  const [probeRetryTokens, setProbeRetryTokens] = useState<Record<string, number>>({});
  const [resumeToken, setResumeToken] = useState(0);
  const storeEditedRef = useRef(false);

  const sameOriginAvailable = defaultBridgeMode() === "same-origin";

  useEffect(() => {
    let cancelled = false;
    void loadBackendStore().then((next) => {
      if (!cancelled) {
        setStore((current) => (storeEditedRef.current ? current : next));
        setStoreLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Remote proxy bridges only exist when this app is served same-origin by a
    // hub bridge; in the native app (`disconnected` default) there is no
    // same-origin `/api/bridges` to discover, so skip the pointless request.
    if (!sameOriginAvailable) {
      return;
    }
    let cancelled = false;
    void fetchRemoteBridges().then((next) => {
      if (!cancelled) {
        setRemoteBridges(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sameOriginAvailable]);

  useEffect(() => {
    return addNativeResumeHandler(() => {
      setResumeToken((token) => token + 1);
    });
  }, []);

  useEffect(() => {
    if (storeLoaded) {
      void writeBackendStore(store);
    }
  }, [store, storeLoaded]);

  const availableRuntimes = useMemo(
    () =>
      buildAvailableRuntimes({
        backends: store.backends,
        remoteBridges,
        probeStates,
        resumeToken,
        sameOriginAvailable,
      }),
    [probeStates, remoteBridges, resumeToken, sameOriginAvailable, store.backends],
  );

  const availableRuntimeIds = useMemo(
    () => new Set(availableRuntimes.map((runtime) => runtime.id)),
    [availableRuntimes],
  );

  // Server-configured proxy bridges are always enabled: the hub's
  // `--remote-bridge` list is the authoritative selection, so there is no
  // per-bridge client opt-out. User-configured and same-origin bridges keep
  // their persisted enablement from the store.
  const proxyRuntimeIds = useMemo(
    () => availableRuntimes.filter((runtime) => runtime.proxied).map((runtime) => runtime.id),
    [availableRuntimes],
  );

  const enabledBridgeIds = useMemo(() => {
    const stored = store.enabledBridgeIds.filter((bridgeId) => availableRuntimeIds.has(bridgeId));
    const result = [...stored];
    for (const bridgeId of proxyRuntimeIds) {
      if (!result.includes(bridgeId)) {
        result.push(bridgeId);
      }
    }
    return result;
  }, [availableRuntimeIds, proxyRuntimeIds, store.enabledBridgeIds]);

  const enabledRuntimes = useMemo(
    () => availableRuntimes.filter((runtime) => enabledBridgeIds.includes(runtime.id)),
    [availableRuntimes, enabledBridgeIds],
  );

  useEffect(() => {
    const availableIds = new Set(availableRuntimes.map((runtime) => runtime.id));
    setProbeStates((current) => {
      let changed = false;
      const next: Record<string, BridgeProbeState> = {};
      for (const [bridgeId, state] of Object.entries(current)) {
        if (availableIds.has(bridgeId)) {
          next[bridgeId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [availableRuntimes]);

  const setBridgeEnabled = useCallback((bridgeId: BridgeId, enabled: boolean) => {
    storeEditedRef.current = true;
    setStore((current) => {
      if (!isAvailableBridgeId(bridgeId, current.backends, defaultBridgeMode() === "same-origin")) {
        return current;
      }
      if (current.enabledBridgeIds.includes(bridgeId) === enabled) {
        return current;
      }
      const enabledIds = new Set(current.enabledBridgeIds);
      let backends = current.backends;
      if (enabled) {
        enabledIds.add(bridgeId);
        // Persist discovered bridges when enabled to prevent loss on reload.
        const discoveredProfile = backends.find((b) => b.id === bridgeId && b.discovered);
        if (discoveredProfile) {
          const persistedProfile = { ...discoveredProfile, discovered: undefined };
          backends = [...current.backends.filter((b) => b.id !== bridgeId), persistedProfile];
        }
      } else {
        enabledIds.delete(bridgeId);
      }
      const enabledBridgeIds = normalizeEnabledBridgeIds(
        [...enabledIds],
        backends,
        defaultBridgeMode() === "same-origin",
      );
      const lastSelectedBridgeId =
        current.lastSelectedBridgeId && enabledBridgeIds.includes(current.lastSelectedBridgeId)
          ? current.lastSelectedBridgeId
          : enabledBridgeIds[0] ?? null;
      return {
        ...current,
        enabledBridgeIds,
        lastSelectedBridgeId,
        backends,
      };
    });
  }, []);

  const setLastSelectedBridgeId = useCallback((bridgeId: BridgeId | null) => {
    storeEditedRef.current = true;
    setStore((current) => {
      if (bridgeId === null) {
        return current.lastSelectedBridgeId === null
          ? current
          : { ...current, lastSelectedBridgeId: null };
      }
      if (!current.enabledBridgeIds.includes(bridgeId) || current.lastSelectedBridgeId === bridgeId) {
        return current;
      }
      return {
        ...current,
        lastSelectedBridgeId: bridgeId,
      };
    });
  }, []);

  const markBridgeUsed = useCallback((bridgeId: BridgeId) => {
    storeEditedRef.current = true;
    setStore((current) => {
      if (!current.enabledBridgeIds.includes(bridgeId) || current.lastSelectedBridgeId === bridgeId) {
        return current;
      }
      return {
        ...current,
        lastSelectedBridgeId: bridgeId,
      };
    });
  }, []);

  const markBridgeReachable = useCallback((bridgeId: BridgeId) => {
    if (bridgeId === SAME_ORIGIN_BRIDGE_ID) {
      return;
    }
    setStore((current) => {
      if (!current.backends.some((backend) => backend.id === bridgeId)) {
        return current;
      }
      return {
        ...current,
        backends: markBackendConnected(current.backends, bridgeId),
      };
    });
  }, []);

  const retryBridgeProbe = useCallback((bridgeId: BridgeId) => {
    setProbeRetryTokens((current) => ({
      ...current,
      [bridgeId]: (current[bridgeId] ?? 0) + 1,
    }));
  }, []);

  const addBackend = useCallback(async (input: BackendInput, enable = false) => {
    const baseUrl = normalizeBridgeBaseUrl(input.baseUrl);
    const id = createBackendId();
    const profile: BridgeBackendProfile = {
      id,
      name: backendDisplayName(input.name, baseUrl, store.backends),
      baseUrl,
      color: normalizeBackendColor(input.color) ?? suggestBackendColor(store.backends, id),
      lastConnectedAt: undefined,
    };
    storeEditedRef.current = true;
    setStore((current) => {
      const enabledBridgeIds = enable
        ? normalizeEnabledBridgeIds(
            [...current.enabledBridgeIds, profile.id],
            [...current.backends, profile],
            defaultBridgeMode() === "same-origin",
          )
        : current.enabledBridgeIds;
      return {
        version: STORE_VERSION,
        enabledBridgeIds,
        lastSelectedBridgeId: enable ? profile.id : current.lastSelectedBridgeId,
        backends: [...current.backends, profile],
      };
    });
    return profile;
  }, [store.backends]);

  const updateBackend = useCallback(async (id: string, input: BackendInput) => {
    const existing = store.backends.find((backend) => backend.id === id);
    if (!existing) {
      throw new Error("Backend not found");
    }
    storeEditedRef.current = true;
    const baseUrl = normalizeBridgeBaseUrl(input.baseUrl);
    if (baseUrl !== existing.baseUrl) {
      removeNoteDraftsForBridgeConnection(id, configuredBridgeConnectionKey(id, existing.baseUrl));
    }
    const otherBackends = store.backends.filter((backend) => backend.id !== id);
    const updated: BridgeBackendProfile = {
      ...existing,
      name: backendDisplayName(input.name, baseUrl, otherBackends),
      baseUrl,
      color: normalizeBackendColor(input.color) ?? existing.color,
      lastConnectedAt: existing.lastConnectedAt,
    };
    setStore((current) => {
      if (!current.backends.some((backend) => backend.id === id)) {
        return current;
      }
      return {
        ...current,
        backends: current.backends.map((backend) => (backend.id === id ? updated : backend)),
      };
    });
    return updated;
  }, [store.backends, store.enabledBridgeIds]);

  const deleteBackend = useCallback((id: string) => {
    const existing = store.backends.find((backend) => backend.id === id);
    if (existing) {
      removeNoteDraftsForBridgeConnection(id, configuredBridgeConnectionKey(id, existing.baseUrl));
    }
    storeEditedRef.current = true;
    setStore((current) => {
      const backends = current.backends.filter((backend) => backend.id !== id);
      const enabledBridgeIds = current.enabledBridgeIds.filter((bridgeId) => bridgeId !== id);
      const lastSelectedBridgeId =
        current.lastSelectedBridgeId === id ? (enabledBridgeIds[0] ?? null) : current.lastSelectedBridgeId;
      return {
        version: STORE_VERSION,
        enabledBridgeIds,
        lastSelectedBridgeId,
        backends,
      };
    });
  }, [store.backends]);

  const probeBackend = useCallback((baseUrl: string) => probeBridgeBaseUrl(baseUrl), []);

  const getRuntime = useCallback(
    (bridgeId: BridgeId | null | undefined) =>
      bridgeId ? (availableRuntimes.find((runtime) => runtime.id === bridgeId) ?? null) : null,
    [availableRuntimes],
  );

  const value = useMemo<BridgeManager>(
    () => ({
      store,
      storeLoaded,
      sameOriginAvailable,
      remoteBridges,
      availableRuntimes,
      enabledRuntimes,
      enabledBridgeIds,
      lastSelectedBridgeId:
        store.lastSelectedBridgeId && enabledBridgeIds.includes(store.lastSelectedBridgeId)
          ? store.lastSelectedBridgeId
          : (enabledBridgeIds[0] ?? null),
      getRuntime,
      setBridgeEnabled,
      setLastSelectedBridgeId,
      markBridgeUsed,
      retryBridgeProbe,
      addBackend,
      updateBackend,
      deleteBackend,
      probeBackend,
    }),
    [
      addBackend,
      availableRuntimes,
      deleteBackend,
      enabledBridgeIds,
      enabledRuntimes,
      getRuntime,
      markBridgeUsed,
      probeBackend,
      remoteBridges,
      retryBridgeProbe,
      sameOriginAvailable,
      setBridgeEnabled,
      setLastSelectedBridgeId,
      store,
      storeLoaded,
      updateBackend,
    ],
  );

  return (
    <BridgeContext.Provider value={value}>
      {children}
      {enabledRuntimes.map((runtime) => (
        <BridgeCapabilityProbe
          key={`${runtime.connectionKey}:${runtime.resumeToken}`}
          runtime={runtime}
          retryToken={probeRetryTokens[runtime.id] ?? 0}
          onReach={markBridgeReachable}
          onState={(state) =>
            setProbeStates((current) => ({
              ...current,
              [runtime.id]: state,
            }))
          }
        />
      ))}
    </BridgeContext.Provider>
  );
}

function BridgeCapabilityProbe({
  runtime,
  retryToken,
  onReach,
  onState,
}: {
  runtime: BridgeRuntime;
  retryToken: number;
  onReach: (bridgeId: BridgeId) => void;
  onState: (state: BridgeProbeState) => void;
}) {
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const onStateRef = useRef(onState);
  const httpUrlRef = useRef(runtime.httpUrl);

  useEffect(() => {
    onStateRef.current = onState;
  }, [onState]);

  useEffect(() => {
    httpUrlRef.current = runtime.httpUrl;
  }, [runtime.httpUrl]);

  useEffect(() => {
    setCapabilityRetry(0);
  }, [retryToken, runtime.connectionKey]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    onStateRef.current({
      connectionKey: runtime.connectionKey,
      capabilities: null,
      capabilityState: "probing",
      capabilityError: null,
      connectionBlocked: false,
    });
    void fetchCapabilities(httpUrlRef.current)
      .then((next) => {
        if (cancelled) {
          return;
        }
        const outcome = capabilityProbeSuccess(next);
        if (outcome.state === "ready") {
          onReach(runtime.id);
        }
        onStateRef.current({
          connectionKey: runtime.connectionKey,
          capabilities: outcome.capabilities,
          capabilityState: outcome.state,
          capabilityError: outcome.error,
          connectionBlocked: outcome.blocked,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const outcome = capabilityProbeFailure(error);
        onStateRef.current({
          connectionKey: runtime.connectionKey,
          capabilities: outcome.capabilities,
          capabilityState: outcome.state,
          capabilityError: outcome.error,
          connectionBlocked: outcome.blocked,
        });
        if (outcome.retry) {
          const retryDelay = capabilityRetryDelayMs(capabilityRetry);
          retryTimer = window.setTimeout(() => {
            setCapabilityRetry((current) => current + 1);
          }, retryDelay);
        }
      });
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [capabilityRetry, onReach, retryToken, runtime.connectionKey, runtime.id]);

  return null;
}

export function useBridge() {
  const value = useContext(BridgeContext);
  if (!value) {
    throw new Error("useBridge must be used inside BridgeProvider");
  }
  return value;
}

function buildAvailableRuntimes({
  backends,
  remoteBridges,
  probeStates,
  resumeToken,
  sameOriginAvailable,
}: {
  backends: BridgeBackendProfile[];
  remoteBridges: readonly RemoteBridgeSummary[];
  probeStates: Record<string, BridgeProbeState>;
  resumeToken: number;
  sameOriginAvailable: boolean;
}) {
  const runtimes: BridgeRuntime[] = [];
  if (sameOriginAvailable) {
    const sameOriginLabel = (() => {
      const tailnetName = probeStates[SAME_ORIGIN_BRIDGE_ID]?.capabilities?.tailnet_name;
      return tailnetName ? extractHostname(tailnetName) : "Same origin";
    })();
    runtimes.push(
      createBridgeRuntime({
        id: SAME_ORIGIN_BRIDGE_ID,
        mode: "same-origin",
        label: sameOriginLabel,
        backend: null,
        baseUrl: null,
        probeState: probeStates[SAME_ORIGIN_BRIDGE_ID],
        resumeToken,
      }),
    );
  }
  for (const backend of backends) {
    runtimes.push(
      createBridgeRuntime({
        id: backend.id,
        mode: "configured",
        label: stripPort(backend.name),
        backend,
        baseUrl: backend.baseUrl,
        probeState: probeStates[backend.id],
        resumeToken,
      }),
    );
  }
  const usedIds = new Set(runtimes.map((runtime) => runtime.id));
  for (const remote of remoteBridges) {
    const id = remoteBridgeRuntimeId(remote.id);
    if (usedIds.has(id)) {
      continue;
    }
    usedIds.add(id);
    runtimes.push(
      createBridgeRuntime({
        id,
        mode: "configured",
        label: stripPort(remote.label),
        backend: null,
        baseUrl: null,
        proxyServerId: remote.id,
        probeState: probeStates[id],
        resumeToken,
      }),
    );
  }
  return runtimes;
}

function createBridgeRuntime({
  id,
  mode,
  label,
  backend,
  baseUrl,
  proxyServerId,
  probeState,
  resumeToken,
}: {
  id: BridgeId;
  mode: BridgeMode;
  label: string;
  backend: BridgeBackendProfile | null;
  baseUrl: string | null;
  proxyServerId?: string;
  probeState: BridgeProbeState | undefined;
  resumeToken: number;
}): BridgeRuntime {
  const proxied = proxyServerId !== undefined;
  const connectionKey = proxied
    ? remoteBridgeConnectionKey(proxyServerId)
    : mode === "same-origin"
      ? SAME_ORIGIN_BRIDGE_ID
      : configuredBridgeConnectionKey(id, baseUrl ?? "");
  const currentProbeState = probeState?.connectionKey === connectionKey ? probeState : undefined;
  const httpUrl = proxied
    ? (path: string, query?: URLSearchParams) => buildProxyHttpUrl(proxyServerId, path, query)
    : (path: string, query?: URLSearchParams) => buildHttpUrl(baseUrl, path, query);
  const wsUrl = proxied
    ? (path: string, query?: URLSearchParams) => buildProxyWsUrl(proxyServerId, path, query)
    : (path: string, query?: URLSearchParams) => buildWsUrl(baseUrl, path, query);
  const color =
    backend?.color ?? (mode === "same-origin" ? SAME_ORIGIN_BRIDGE_COLOR : fallbackBackendColor(id));
  return {
    id,
    mode,
    label,
    color,
    backend,
    connectionKey,
    resumeToken,
    capabilities: currentProbeState?.capabilities ?? null,
    capabilityState: currentProbeState?.capabilityState ?? "idle",
    capabilityError: currentProbeState?.capabilityError ?? null,
    canConnect: !currentProbeState?.connectionBlocked,
    proxied,
    httpUrl,
    wsUrl,
  };
}

export type BridgeListEntry = {
  id: string;
  url: string;
};

export async function fetchDiscoveredBridges(): Promise<BridgeBackendProfile[]> {
  try {
    const response = await fetchWithTimeout("/api/bridges");
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }
    const profiles: BridgeBackendProfile[] = [];
    for (const entry of data) {
      if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.url !== "string") {
        continue;
      }
      try {
        const baseUrl = normalizeBridgeBaseUrl(entry.url);
        profiles.push({
          id: entry.id as BridgeId,
          name: displayNameFromUrl(baseUrl),
          baseUrl,
          discovered: true,
        });
      } catch {
        // Ignore invalid entries
      }
    }
    return profiles;
  } catch {
    return [];
  }
}

export function mergeBridges(
  stored: readonly BridgeBackendProfile[],
  discovered: readonly BridgeBackendProfile[],
): BridgeBackendProfile[] {
  const result = [...stored];
  const storedUrls = new Set(stored.map((b) => b.baseUrl));

  for (const discovered_backend of discovered) {
    if (!storedUrls.has(discovered_backend.baseUrl)) {
      result.push(discovered_backend);
      storedUrls.add(discovered_backend.baseUrl);
    }
  }

  return result;
}

export async function loadBackendStore(): Promise<BridgeBackendStore> {
  if (isNativeApp()) {
    try {
      const { value } = await Preferences.get({ key: STORE_KEY });
      if (value) {
        const store = parseBackendStore(JSON.parse(value));
        const discovered = await fetchDiscoveredBridges();
        const merged = mergeBridges(store.backends, discovered);
        return { ...store, backends: merged };
      }
    } catch {
      // Fall through to browser storage and legacy migration.
    }
  }

  const localStore = readBackendStoreKey(STORE_KEY);
  if (localStore) {
    const discovered = await fetchDiscoveredBridges();
    const merged = mergeBridges(localStore.backends, discovered);
    const storeWithDiscovered = { ...localStore, backends: merged };
    if (isNativeApp()) {
      await writeBackendStore(storeWithDiscovered);
    }
    return storeWithDiscovered;
  }

  const legacyStore = await loadLegacyBackendStore();
  if (legacyStore) {
    const discovered = await fetchDiscoveredBridges();
    const merged = mergeBridges(legacyStore.backends, discovered);
    const storeWithDiscovered = { ...legacyStore, backends: merged };
    await writeBackendStore(storeWithDiscovered);
    await removeLegacyBackendStore();
    return storeWithDiscovered;
  }

  const store = fallbackStore();
  const discovered = await fetchDiscoveredBridges();
  const merged = mergeBridges(store.backends, discovered);
  return { ...store, backends: merged };
}

export function readBackendStore(): BridgeBackendStore {
  return readBackendStoreKey(STORE_KEY) ?? fallbackStore();
}

function readBackendStoreKey(key: string): BridgeBackendStore | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) {
      return null;
    }
    return parseBackendStore(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function loadLegacyBackendStore(): Promise<BridgeBackendStore | null> {
  if (isNativeApp()) {
    try {
      const { value } = await Preferences.get({ key: LEGACY_STORE_KEY });
      if (value) {
        return parseBackendStore(JSON.parse(value));
      }
    } catch {
      // Fall through to localStorage backup.
    }
  }
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_STORE_KEY);
    if (!raw) {
      return null;
    }
    return parseBackendStore(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function removeLegacyBackendStore() {
  if (isNativeApp()) {
    try {
      await Preferences.remove({ key: LEGACY_STORE_KEY });
    } catch {
      // Browser storage cleanup below remains best effort.
    }
  }
  try {
    globalThis.localStorage?.removeItem(LEGACY_STORE_KEY);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

export async function writeBackendStore(store: BridgeBackendStore) {
  const value = JSON.stringify(store);
  if (isNativeApp()) {
    try {
      await Preferences.set({ key: STORE_KEY, value });
    } catch {
      // Browser storage below remains a best-effort backup.
    }
  }
  try {
    globalThis.localStorage?.setItem(STORE_KEY, value);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

export function parseBackendStore(value: unknown): BridgeBackendStore {
  if (!isRecord(value) || !Array.isArray(value.backends)) {
    return fallbackStore();
  }
  if (value.version === STORE_VERSION) {
    return parseBackendStoreV2(value);
  }
  if (value.version === 1) {
    return migrateLegacyBackendStore(value);
  }
  return fallbackStore();
}

function parseBackendStoreV2(value: Record<string, unknown>): BridgeBackendStore {
  const rawBackends = Array.isArray(value.backends) ? value.backends : [];
  const backends = rawBackends
    .map(parseBackendProfile)
    .filter((backend): backend is BridgeBackendProfile => backend !== null);
  const sameOriginAvailable = defaultBridgeMode() === "same-origin";
  const enabledBridgeIds = normalizeEnabledBridgeIds(
    Array.isArray(value.enabledBridgeIds) ? value.enabledBridgeIds : [],
    backends,
    sameOriginAvailable,
  );
  const lastSelectedBridgeId =
    typeof value.lastSelectedBridgeId === "string" &&
    enabledBridgeIds.includes(value.lastSelectedBridgeId)
      ? value.lastSelectedBridgeId
      : (enabledBridgeIds[0] ?? null);
  return { version: STORE_VERSION, enabledBridgeIds, lastSelectedBridgeId, backends };
}

function migrateLegacyBackendStore(value: Record<string, unknown>): BridgeBackendStore {
  const rawBackends = Array.isArray(value.backends) ? value.backends : [];
  const backends = rawBackends
    .map(parseBackendProfile)
    .filter((backend): backend is BridgeBackendProfile => backend !== null);
  const activeBackendId =
    typeof value.activeBackendId === "string" &&
    backends.some((backend) => backend.id === value.activeBackendId)
      ? value.activeBackendId
      : null;
  const sameOriginAvailable = defaultBridgeMode() === "same-origin";
  const enabledBridgeIds = activeBackendId
    ? [activeBackendId]
    : sameOriginAvailable
      ? [SAME_ORIGIN_BRIDGE_ID]
      : [];
  const lastSelectedBridgeId = enabledBridgeIds[0] ?? null;
  return { version: STORE_VERSION, enabledBridgeIds, lastSelectedBridgeId, backends };
}

function parseBackendProfile(value: unknown): BridgeBackendProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    value.id === SAME_ORIGIN_BRIDGE_ID ||
    typeof value.name !== "string" ||
    typeof value.baseUrl !== "string"
  ) {
    return null;
  }
  try {
    const baseUrl = normalizeBridgeBaseUrl(value.baseUrl);
    return {
      id: value.id,
      name: value.name.trim() || displayNameFromUrl(baseUrl),
      baseUrl,
      color: normalizeBackendColor(value.color) ?? undefined,
      lastConnectedAt: typeof value.lastConnectedAt === "string" ? value.lastConnectedAt : undefined,
    };
  } catch {
    return null;
  }
}

function fallbackStore(): BridgeBackendStore {
  const enabledBridgeIds = defaultBridgeMode() === "same-origin" ? [SAME_ORIGIN_BRIDGE_ID] : [];
  return {
    version: STORE_VERSION,
    enabledBridgeIds,
    lastSelectedBridgeId: enabledBridgeIds[0] ?? null,
    backends: [],
  };
}

function normalizeEnabledBridgeIds(
  ids: unknown[],
  backends: readonly BridgeBackendProfile[],
  sameOriginAvailable: boolean,
) {
  const result: BridgeId[] = [];
  const availableIds = new Set(backends.map((backend) => backend.id));
  if (sameOriginAvailable) {
    availableIds.add(SAME_ORIGIN_BRIDGE_ID);
  }
  for (const id of ids) {
    if (typeof id === "string" && availableIds.has(id) && !result.includes(id)) {
      result.push(id);
    }
  }
  return result;
}

function isAvailableBridgeId(
  bridgeId: BridgeId,
  backends: readonly BridgeBackendProfile[],
  sameOriginAvailable: boolean,
) {
  return (
    (sameOriginAvailable && bridgeId === SAME_ORIGIN_BRIDGE_ID) ||
    backends.some((backend) => backend.id === bridgeId)
  );
}

function markBackendConnected(
  backends: readonly BridgeBackendProfile[],
  bridgeId: BridgeId,
): BridgeBackendProfile[] {
  if (bridgeId === SAME_ORIGIN_BRIDGE_ID) {
    return [...backends];
  }
  const connectedAt = new Date().toISOString();
  return backends.map((backend) =>
    backend.id === bridgeId ? { ...backend, lastConnectedAt: connectedAt } : backend,
  );
}

function defaultBridgeMode(): "same-origin" | "disconnected" {
  return isNativeApp() ? "disconnected" : "same-origin";
}

function isNativeApp() {
  return Capacitor.isNativePlatform();
}

export function normalizeBridgeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Enter a bridge URL");
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("Bridge URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Bridge URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Bridge URL must not include credentials");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("Bridge URL must not include a path, query, or fragment");
  }
  validateBridgeHost(url.hostname);
  return url.origin;
}

function validateBridgeHost(hostname: string) {
  const host = stripIpv6Brackets(hostname).toLowerCase();
  if (!host) {
    throw new Error("Bridge URL must include a host");
  }
  if (parseIpv4(host)) {
    return;
  }
  if (isIpv6Literal(host)) {
    return;
  }
  if (!isValidHostname(host)) {
    throw new Error("Bridge hostname is invalid");
  }
}

function stripIpv6Brackets(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function parseIpv4(host: string) {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const bytes = parts.map((part) => {
    if (!/^\d+$/u.test(part)) {
      return Number.NaN;
    }
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });
  return bytes.every(Number.isFinite) ? bytes : null;
}

function isIpv6Literal(host: string) {
  return host.includes(":");
}

function isValidHostname(host: string) {
  if (host.length > 253) {
    return false;
  }
  return host
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}

export function buildHttpUrl(
  baseUrl: string | null,
  path: string,
  query?: URLSearchParams,
): string {
  const normalizedPath = normalizeEndpointPath(path);
  const suffix = query && query.toString() ? `?${query.toString()}` : "";
  if (!baseUrl) {
    return `${normalizedPath}${suffix}`;
  }
  const url = new URL(normalizedPath, baseUrl);
  if (query) {
    url.search = query.toString();
  }
  return url.toString();
}

export function buildWsUrl(
  baseUrl: string | null,
  path: string,
  query?: URLSearchParams,
): string {
  const normalizedPath = normalizeEndpointPath(path);
  const suffix = query && query.toString() ? `?${query.toString()}` : "";
  if (!baseUrl) {
    const location = globalThis.location;
    const protocol = location?.protocol === "https:" ? "wss:" : "ws:";
    const host = location?.host || "localhost";
    return `${protocol}//${host}${normalizedPath}${suffix}`;
  }
  const url = new URL(normalizedPath, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (query) {
    url.search = query.toString();
  }
  return url.toString();
}

export function configuredBridgeConnectionKey(id: BridgeId, baseUrl: string) {
  return `configured:${id}:${baseUrl}`;
}

const REMOTE_BRIDGE_RUNTIME_ID_PREFIX = "remote:";

/**
 * Namespaces a server-reported remote bridge id into a client runtime id so it
 * cannot collide with `same-origin` or a user backend's random id.
 */
export function remoteBridgeRuntimeId(serverId: string): BridgeId {
  return `${REMOTE_BRIDGE_RUNTIME_ID_PREFIX}${serverId}`;
}

export function remoteBridgeConnectionKey(serverId: string) {
  return `remote:${serverId}`;
}

/**
 * Rewrites a bridge API path into the hub's same-origin proxy path for a remote
 * bridge: `/api/<rest>` → `/api/remote/<serverId>/<rest>`. The hub then forwards
 * the request (allow-listed read endpoints only) to `<remote>/api/<rest>`.
 */
export function remoteProxyApiPath(serverId: string, path: string): string {
  const normalized = normalizeEndpointPath(path);
  const prefix = "/api/";
  if (!normalized.startsWith(prefix)) {
    throw new Error("Remote proxy only supports /api/ paths");
  }
  const rest = normalized.slice(prefix.length);
  return `/api/remote/${encodeURIComponent(serverId)}/${rest}`;
}

/**
 * Rewrites a bridge WebSocket path into the hub's same-origin proxy path:
 * `/ws/<rest>` → `/ws/remote/<serverId>/<rest>`. Only `/ws/terminal` is
 * actually proxied server-side; other event sockets 404 and callers must skip
 * them for proxied runtimes.
 */
export function remoteProxyWsPath(serverId: string, path: string): string {
  const normalized = normalizeEndpointPath(path);
  const prefix = "/ws/";
  if (!normalized.startsWith(prefix)) {
    throw new Error("Remote proxy only supports /ws/ paths");
  }
  const rest = normalized.slice(prefix.length);
  return `/ws/remote/${encodeURIComponent(serverId)}/${rest}`;
}

export function buildProxyHttpUrl(
  serverId: string,
  path: string,
  query?: URLSearchParams,
): string {
  return buildHttpUrl(null, remoteProxyApiPath(serverId, path), query);
}

export function buildProxyWsUrl(
  serverId: string,
  path: string,
  query?: URLSearchParams,
): string {
  return buildWsUrl(null, remoteProxyWsPath(serverId, path), query);
}

/**
 * Fetches the remote bridges the hub is configured to proxy for, from the
 * same-origin `GET /api/bridges` endpoint (a flat `{ id, url }[]` mirror of the
 * hub's `--remote-bridge` config). Any transport, status, or shape error yields
 * an empty list so a missing or older bridge never breaks the picker.
 */
export async function fetchRemoteBridges(): Promise<RemoteBridgeSummary[]> {
  let data: unknown;
  try {
    const response = await fetchWithTimeout("/api/bridges");
    if (!response.ok) {
      return [];
    }
    data = await response.json();
  } catch {
    return [];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  const result: RemoteBridgeSummary[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.url !== "string") {
      continue;
    }
    const id = entry.id.trim();
    const url = entry.url.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push({ id, label: remoteBridgeLabel(id, url), baseUrl: url });
  }
  return result;
}

function remoteBridgeLabel(id: string, url: string): string {
  try {
    return new URL(url).host || id;
  } catch {
    return id;
  }
}

export function removeNoteDraftsForBridgeConnection(bridgeId: BridgeId, connectionKey: string) {
  const draftPrefix = `${NOTE_DRAFT_STORAGE_PREFIX}${encodeURIComponent(
    bridgeId,
  )}:${encodeURIComponent(connectionKey)}:`;
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      return;
    }
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(draftPrefix)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      storage.removeItem(key);
    }
  } catch {
    // Draft cleanup is best-effort; stale keys are isolated by connection key.
  }
}

function normalizeEndpointPath(path: string) {
  if (!path.startsWith("/")) {
    throw new Error("Bridge endpoint path must start with /");
  }
  return path;
}

export async function fetchCapabilities(
  httpUrl: (path: string, query?: URLSearchParams) => string,
): Promise<BridgeCapabilities> {
  const response = await fetchWithTimeout(httpUrl("/api/capabilities"));
  if (!response.ok) {
    throw new Error(`capabilities failed: ${response.status}`);
  }
  return parseCapabilities(await response.json());
}

export async function probeBridgeBaseUrl(baseUrl: string): Promise<BridgeCapabilities> {
  const normalized = normalizeBridgeBaseUrl(baseUrl);
  const capabilities = await fetchCapabilities((path, query) => buildHttpUrl(normalized, path, query));
  const error = compatibilityError(capabilities);
  if (error) {
    throw new Error(error);
  }
  return capabilities;
}

export type CapabilityProbeOutcome = {
  blocked: boolean;
  state: CapabilityState;
  capabilities: BridgeCapabilities | null;
  error: string | null;
  retry: boolean;
};

export function capabilityProbeSuccess(
  capabilities: BridgeCapabilities,
): CapabilityProbeOutcome {
  const error = compatibilityError(capabilities);
  if (error) {
    return {
      blocked: true,
      state: "error",
      capabilities: null,
      error,
      retry: false,
    };
  }
  return {
    blocked: false,
    state: "ready",
    capabilities,
    error: null,
    retry: false,
  };
}

export function capabilityProbeFailure(error: unknown): CapabilityProbeOutcome {
  return {
    blocked: false,
    state: "error",
    capabilities: null,
    error: error instanceof Error ? error.message : "Bridge unavailable",
    retry: true,
  };
}

export function capabilityRetryDelayMs(attempt: number) {
  return Math.min(5000 * 2 ** Math.max(0, attempt), 60000);
}

export function parseCapabilities(value: unknown): BridgeCapabilities {
  if (!isRecord(value)) {
    return { commands: [] };
  }
  return {
    commands: Array.isArray(value.commands)
      ? value.commands.filter((command): command is string => typeof command === "string")
      : [],
    bridge_version: typeof value.bridge_version === "string" ? value.bridge_version : undefined,
    tailnet_name:
      typeof value.tailnet_name === "string" && value.tailnet_name.trim() !== ""
        ? value.tailnet_name
        : undefined,
    web_compat: typeof value.web_compat === "number" ? value.web_compat : undefined,
    min_android_app_compat:
      typeof value.min_android_app_compat === "number" ? value.min_android_app_compat : undefined,
    agent_activity:
      isRecord(value.agent_activity) && value.agent_activity.version === 1
        ? { version: 1 }
        : undefined,
    agent_pins:
      isRecord(value.agent_pins) && value.agent_pins.version === 1
        ? { version: 1 }
        : undefined,
    notes:
      isRecord(value.notes) && value.notes.version === 1
        ? { version: 1 }
        : undefined,
    launcher_presets:
      isRecord(value.launcher_presets) && value.launcher_presets.version === 1
        ? { version: 1 }
        : undefined,
  };
}

function compatibilityError(capabilities: BridgeCapabilities) {
  if (
    typeof capabilities.web_compat === "number" &&
    capabilities.web_compat < APP_MIN_WEB_COMPAT
  ) {
    return "Bridge is not compatible with this web app";
  }
  return null;
}

function backendDisplayName(
  name: string | undefined,
  baseUrl: string,
  existing: readonly BridgeBackendProfile[],
) {
  const requested = name?.trim() || displayNameFromUrl(baseUrl);
  const names = new Set(existing.map((backend) => backend.name));
  if (!names.has(requested)) {
    return requested;
  }
  let index = 2;
  while (names.has(`${requested} ${index}`)) {
    index += 1;
  }
  return `${requested} ${index}`;
}

function displayNameFromUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  return url.host;
}

function createBackendId() {
  let id: string;
  do {
    id = randomId();
  } while (id === SAME_ORIGIN_BRIDGE_ID);
  return id;
}

export function normalizeBackendColor(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/iu.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function fallbackBackendColor(seed: string) {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return BACKEND_COLOR_PALETTE[hash % BACKEND_COLOR_PALETTE.length] ?? SAME_ORIGIN_BRIDGE_COLOR;
}

export function suggestBackendColor(
  backends: readonly BridgeBackendProfile[],
  seed = `${Date.now()}`,
) {
  const used = new Set(backends.map((backend) => normalizeBackendColor(backend.color)).filter(Boolean));
  const unused = BACKEND_COLOR_PALETTE.find((color) => !used.has(color));
  return unused ?? fallbackBackendColor(seed);
}

export function duplicateBackend(
  backends: readonly BridgeBackendProfile[],
  baseUrl: string,
  ignoreId?: string,
) {
  const normalized = normalizeBridgeBaseUrl(baseUrl);
  return (
    backends.find((backend) => backend.id !== ignoreId && backend.baseUrl === normalized) ?? null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
