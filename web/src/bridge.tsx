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
import { addNativeResumeHandler } from "./native";

export type BridgeBackendProfile = {
  id: string;
  name: string;
  baseUrl: string;
  lastConnectedAt?: string;
};

export type BridgeBackendStore = {
  version: 1;
  activeBackendId: string | null;
  backends: BridgeBackendProfile[];
};

export type BridgeMode = "same-origin" | "configured" | "disconnected";

export type BridgeCapabilities = {
  commands: string[];
  bridge_version?: string;
  web_compat?: number;
  min_android_app_compat?: number;
};

export type CapabilityState = "idle" | "probing" | "ready" | "error";

export type BridgeRuntime = {
  mode: BridgeMode;
  store: BridgeBackendStore;
  activeBackend: BridgeBackendProfile | null;
  connectionKey: string;
  resumeToken: number;
  capabilities: BridgeCapabilities | null;
  capabilityState: CapabilityState;
  capabilityError: string | null;
  canConnect: boolean;
  sameOriginAvailable: boolean;
  httpUrl: (path: string, query?: URLSearchParams) => string;
  wsUrl: (path: string, query?: URLSearchParams) => string;
  addBackend: (input: BackendInput, activate?: boolean) => Promise<BridgeBackendProfile>;
  updateBackend: (id: string, input: BackendInput) => Promise<BridgeBackendProfile>;
  deleteBackend: (id: string) => void;
  setActiveBackend: (id: string) => void;
  clearActiveBackend: () => void;
  probeBackend: (baseUrl: string) => Promise<BridgeCapabilities>;
};

export type BackendInput = {
  name?: string;
  baseUrl: string;
};

const STORE_KEY = "herdrWeb.bridgeBackends.v1";
const STORE_VERSION = 1;
const APP_MIN_WEB_COMPAT = 1;
const fallbackStore: BridgeBackendStore = {
  version: STORE_VERSION,
  activeBackendId: null,
  backends: [],
};

const BridgeContext = createContext<BridgeRuntime | null>(null);

export function BridgeProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<BridgeBackendStore>(fallbackStore);
  const [storeLoaded, setStoreLoaded] = useState(false);
  const [capabilities, setCapabilities] = useState<BridgeCapabilities | null>(null);
  const [capabilityState, setCapabilityState] = useState<CapabilityState>("idle");
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [connectionBlocked, setConnectionBlocked] = useState(false);
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const [resumeToken, setResumeToken] = useState(0);
  const storeEditedRef = useRef(false);

  const activeBackend = store.activeBackendId
    ? (store.backends.find((backend) => backend.id === store.activeBackendId) ?? null)
    : null;
  const defaultMode = defaultBridgeMode();
  const sameOriginAvailable = defaultMode === "same-origin";
  const mode: BridgeMode = activeBackend ? "configured" : defaultMode;
  const connectionKey = activeBackend
    ? `configured:${activeBackend.id}:${activeBackend.baseUrl}`
    : mode;
  const canProbe = mode !== "disconnected";
  const canConnect = canProbe && !connectionBlocked;

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
    return addNativeResumeHandler(() => {
      setResumeToken((token) => token + 1);
    });
  }, []);

  useEffect(() => {
    if (storeLoaded) {
      void writeBackendStore(store);
    }
  }, [store, storeLoaded]);

  const httpUrl = useCallback(
    (path: string, query?: URLSearchParams) => buildHttpUrl(activeBackend?.baseUrl ?? null, path, query),
    [activeBackend?.baseUrl],
  );

  const wsUrl = useCallback(
    (path: string, query?: URLSearchParams) => buildWsUrl(activeBackend?.baseUrl ?? null, path, query),
    [activeBackend?.baseUrl],
  );

  const probeBackend = useCallback((baseUrl: string) => probeBridgeBaseUrl(baseUrl), []);

  useEffect(() => {
    setCapabilityRetry(0);
  }, [connectionKey, resumeToken]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    setCapabilities(null);
    setCapabilityError(null);
    setConnectionBlocked(false);
    if (!canProbe) {
      setCapabilityState("idle");
      return;
    }
    setCapabilityState("probing");
    void fetchCapabilities(httpUrl)
      .then((next) => {
        if (cancelled) {
          return;
        }
        const outcome = capabilityProbeSuccess(next);
        setCapabilityError(outcome.error);
        setCapabilities(outcome.capabilities);
        setConnectionBlocked(outcome.blocked);
        setCapabilityState(outcome.state);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const outcome = capabilityProbeFailure(error);
          setCapabilityError(outcome.error);
          setCapabilities(outcome.capabilities);
          setConnectionBlocked(outcome.blocked);
          setCapabilityState(outcome.state);
          if (outcome.retry) {
            const retryDelay = capabilityRetryDelayMs(capabilityRetry);
            retryTimer = window.setTimeout(() => {
              setCapabilityRetry((current) => current + 1);
            }, retryDelay);
          }
        }
      });
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [canProbe, capabilityRetry, connectionKey, httpUrl, resumeToken]);

  const addBackend = useCallback(async (input: BackendInput, activate = true) => {
    const baseUrl = normalizeBridgeBaseUrl(input.baseUrl);
    const profile: BridgeBackendProfile = {
      id: createBackendId(),
      name: backendDisplayName(input.name, baseUrl, store.backends),
      baseUrl,
      lastConnectedAt: activate ? new Date().toISOString() : undefined,
    };
    const nextProfile = { ...profile };
    storeEditedRef.current = true;
    setStore((current) => ({
      version: STORE_VERSION,
      activeBackendId: activate ? nextProfile.id : current.activeBackendId,
      backends: [...current.backends, nextProfile],
    }));
    return nextProfile;
  }, [store.backends]);

  const updateBackend = useCallback(async (id: string, input: BackendInput) => {
    const existing = store.backends.find((backend) => backend.id === id);
    if (!existing) {
      throw new Error("Backend not found");
    }
    const baseUrl = normalizeBridgeBaseUrl(input.baseUrl);
    const otherBackends = store.backends.filter((backend) => backend.id !== id);
    const updated: BridgeBackendProfile = {
      ...existing,
      name: backendDisplayName(input.name, baseUrl, otherBackends),
      baseUrl,
      lastConnectedAt:
        store.activeBackendId === id ? new Date().toISOString() : existing.lastConnectedAt,
    };
    storeEditedRef.current = true;
    setStore((current) => ({
      version: STORE_VERSION,
      activeBackendId: current.activeBackendId,
      backends: current.backends.map((backend) => (backend.id === id ? updated : backend)),
    }));
    return updated;
  }, [store.activeBackendId, store.backends]);

  const deleteBackend = useCallback((id: string) => {
    storeEditedRef.current = true;
    setStore((current) => ({
      version: STORE_VERSION,
      activeBackendId: current.activeBackendId === id ? null : current.activeBackendId,
      backends: current.backends.filter((backend) => backend.id !== id),
    }));
  }, []);

  const setActiveBackend = useCallback((id: string) => {
    storeEditedRef.current = true;
    setStore((current) => {
      if (!current.backends.some((backend) => backend.id === id)) {
        return current;
      }
      return {
        ...current,
        activeBackendId: id,
        backends: current.backends.map((backend) =>
          backend.id === id ? { ...backend, lastConnectedAt: new Date().toISOString() } : backend,
        ),
      };
    });
  }, []);

  const clearActiveBackend = useCallback(() => {
    storeEditedRef.current = true;
    setStore((current) => ({ ...current, activeBackendId: null }));
  }, []);

  const value = useMemo<BridgeRuntime>(
    () => ({
      mode,
      store,
      activeBackend,
      connectionKey,
      resumeToken,
      capabilities,
      capabilityState,
      capabilityError,
      canConnect,
      sameOriginAvailable,
      httpUrl,
      wsUrl,
      addBackend,
      updateBackend,
      deleteBackend,
      setActiveBackend,
      clearActiveBackend,
      probeBackend,
    }),
    [
      activeBackend,
      addBackend,
      canConnect,
      capabilities,
      capabilityError,
      capabilityState,
      clearActiveBackend,
      connectionKey,
      deleteBackend,
      httpUrl,
      mode,
      probeBackend,
      resumeToken,
      setActiveBackend,
      sameOriginAvailable,
      store,
      updateBackend,
      wsUrl,
    ],
  );

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}

export function useBridge() {
  const value = useContext(BridgeContext);
  if (!value) {
    throw new Error("useBridge must be used inside BridgeProvider");
  }
  return value;
}

export async function loadBackendStore(): Promise<BridgeBackendStore> {
  if (isNativeApp()) {
    try {
      const { value } = await Preferences.get({ key: STORE_KEY });
      if (value) {
        return parseBackendStore(JSON.parse(value));
      }
      const localStore = readBackendStore();
      if (localStore.backends.length > 0 || localStore.activeBackendId) {
        await Preferences.set({ key: STORE_KEY, value: JSON.stringify(localStore) });
      }
      return localStore;
    } catch {
      return readBackendStore();
    }
  }
  return readBackendStore();
}

export function readBackendStore(): BridgeBackendStore {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    if (!raw) {
      return fallbackStore;
    }
    return parseBackendStore(JSON.parse(raw));
  } catch {
    return fallbackStore;
  }
}

export async function writeBackendStore(store: BridgeBackendStore) {
  const value = JSON.stringify(store);
  if (isNativeApp()) {
    try {
      await Preferences.set({ key: STORE_KEY, value });
      return;
    } catch {
      // Fall through so browser storage remains a best-effort backup.
    }
  }
  try {
    globalThis.localStorage?.setItem(STORE_KEY, value);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

export function parseBackendStore(value: unknown): BridgeBackendStore {
  if (!isRecord(value) || value.version !== STORE_VERSION || !Array.isArray(value.backends)) {
    return fallbackStore;
  }
  const backends = value.backends
    .map(parseBackendProfile)
    .filter((backend): backend is BridgeBackendProfile => backend !== null);
  const activeBackendId =
    typeof value.activeBackendId === "string" &&
    backends.some((backend) => backend.id === value.activeBackendId)
      ? value.activeBackendId
      : null;
  return { version: STORE_VERSION, activeBackendId, backends };
}

function parseBackendProfile(value: unknown): BridgeBackendProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
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
      lastConnectedAt: typeof value.lastConnectedAt === "string" ? value.lastConnectedAt : undefined,
    };
  } catch {
    return null;
  }
}

function defaultBridgeMode(): BridgeMode {
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

function normalizeEndpointPath(path: string) {
  if (!path.startsWith("/")) {
    throw new Error("Bridge endpoint path must start with /");
  }
  return path;
}

export async function fetchCapabilities(
  httpUrl: (path: string, query?: URLSearchParams) => string,
): Promise<BridgeCapabilities> {
  const response = await fetch(httpUrl("/api/capabilities"));
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
    web_compat: typeof value.web_compat === "number" ? value.web_compat : undefined,
    min_android_app_compat:
      typeof value.min_android_app_compat === "number" ? value.min_android_app_compat : undefined,
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
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  return `backend-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const bytes = parts.map((part) => {
    if (!/^\d{1,3}$/u.test(part)) {
      return Number.NaN;
    }
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });
  return bytes.some(Number.isNaN) ? null : (bytes as [number, number, number, number]);
}

function stripIpv6Brackets(host: string) {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isIpv6Literal(host: string) {
  return host.includes(":");
}

function isValidHostname(host: string) {
  if (host === "localhost") {
    return true;
  }
  if (host.length > 253 || host.endsWith(".")) {
    return false;
  }
  return host.split(".").every((label) => {
    return (
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label)
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
