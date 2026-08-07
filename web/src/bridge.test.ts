import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHttpUrl,
  buildProxyHttpUrl,
  buildProxyWsUrl,
  buildWsUrl,
  capabilityProbeFailure,
  capabilityProbeSuccess,
  capabilityRetryDelayMs,
  configuredBridgeConnectionKey,
  duplicateBackend,
  fetchRemoteBridges,
  loadBackendStore,
  normalizeBridgeBaseUrl,
  normalizeBackendColor,
  parseBackendStore,
  parseCapabilities,
  probeBridgeBaseUrl,
  remoteBridgeConnectionKey,
  remoteBridgeRuntimeId,
  remoteProxyApiPath,
  remoteProxyWsPath,
  removeNoteDraftsForBridgeConnection,
  SAME_ORIGIN_BRIDGE_ID,
} from "./bridge";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bridge URL normalization", () => {
  it("normalizes origin-only bridge URLs", () => {
    expect(normalizeBridgeBaseUrl("192.168.1.20:4000")).toBe("http://192.168.1.20:4000");
    expect(normalizeBridgeBaseUrl(" http://herdr-host.local:4000/ ")).toBe(
      "http://herdr-host.local:4000",
    );
    expect(normalizeBridgeBaseUrl("https://herdr-host.local:443")).toBe(
      "https://herdr-host.local",
    );
    expect(normalizeBridgeBaseUrl("http://192.168.1.20:80")).toBe("http://192.168.1.20");
    expect(normalizeBridgeBaseUrl("http://[fd00::1234]:4000")).toBe(
      "http://[fd00::1234]:4000",
    );
    expect(normalizeBridgeBaseUrl("http://100.64.0.1:4000")).toBe("http://100.64.0.1:4000");
    expect(normalizeBridgeBaseUrl("http://8.8.8.8:4000")).toBe("http://8.8.8.8:4000");
  });

  it("rejects unsupported URL shapes", () => {
    expect(() => normalizeBridgeBaseUrl("ftp://192.168.1.20:4000")).toThrow(/http or https/iu);
    expect(() => normalizeBridgeBaseUrl("http://user@192.168.1.20:4000")).toThrow(
      /credentials/iu,
    );
    expect(() => normalizeBridgeBaseUrl("http://192.168.1.20:4000/api")).toThrow(
      /path/iu,
    );
  });
});

describe("backend colors", () => {
  it("normalizes six-digit hex colors", () => {
    expect(normalizeBackendColor("#A1b2C3")).toBe("#a1b2c3");
    expect(normalizeBackendColor(" #89B4FA ")).toBe("#89b4fa");
    expect(normalizeBackendColor("#fff")).toBeNull();
    expect(normalizeBackendColor("red")).toBeNull();
  });
});

describe("bridge URL builders", () => {
  it("builds same-origin HTTP and WebSocket URLs", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "app.local:8787" });

    expect(buildHttpUrl(null, "/api/snapshot")).toBe("/api/snapshot");
    expect(buildWsUrl(null, "/ws/events")).toBe("wss://app.local:8787/ws/events");

    vi.unstubAllGlobals();
  });

  it("builds configured HTTP and WebSocket URLs", () => {
    const query = new URLSearchParams({ terminal_id: "term-1" });

    expect(buildHttpUrl("http://192.168.1.20:4000", "/api/snapshot")).toBe(
      "http://192.168.1.20:4000/api/snapshot",
    );
    expect(buildWsUrl("http://192.168.1.20:4000", "/ws/terminal", query)).toBe(
      "ws://192.168.1.20:4000/ws/terminal?terminal_id=term-1",
    );
  });
});

describe("backend store parsing", () => {
  it("migrates valid v1 profiles and clears invalid active ids", () => {
    expect(
      parseBackendStore({
        version: 1,
        activeBackendId: "missing",
        backends: [
          { id: "one", name: "Home", baseUrl: "http://192.168.1.20:4000" },
          { id: "bad", name: "Bad", baseUrl: "http://192.168.1.20:4000/api" },
        ],
      }),
    ).toEqual({
      version: 2,
      enabledBridgeIds: [SAME_ORIGIN_BRIDGE_ID],
      lastSelectedBridgeId: SAME_ORIGIN_BRIDGE_ID,
      backends: [
        {
          id: "one",
          name: "Home",
          baseUrl: "http://192.168.1.20:4000",
          lastConnectedAt: undefined,
        },
      ],
    });
  });

  it("migrates a v1 active backend into the enabled bridge list", () => {
    expect(
      parseBackendStore({
        version: 1,
        activeBackendId: "one",
        backends: [{ id: "one", name: "Home", baseUrl: "http://192.168.1.20:4000" }],
      }),
    ).toEqual({
      version: 2,
      enabledBridgeIds: ["one"],
      lastSelectedBridgeId: "one",
      backends: [
        {
          id: "one",
          name: "Home",
          baseUrl: "http://192.168.1.20:4000",
          lastConnectedAt: undefined,
        },
      ],
    });
  });

  it("keeps valid v2 enabled bridge ids only", () => {
    expect(
      parseBackendStore({
        version: 2,
        enabledBridgeIds: ["one", "missing", "one", SAME_ORIGIN_BRIDGE_ID],
        lastSelectedBridgeId: "missing",
        backends: [{ id: "one", name: "Home", baseUrl: "http://192.168.1.20:4000" }],
      }),
    ).toEqual({
      version: 2,
      enabledBridgeIds: ["one", SAME_ORIGIN_BRIDGE_ID],
      lastSelectedBridgeId: "one",
      backends: [
        {
          id: "one",
          name: "Home",
          baseUrl: "http://192.168.1.20:4000",
          lastConnectedAt: undefined,
        },
      ],
    });
  });

  it("keeps valid backend colors and drops invalid colors", () => {
    expect(
      parseBackendStore({
        version: 2,
        enabledBridgeIds: ["one", "two"],
        lastSelectedBridgeId: "one",
        backends: [
          {
            id: "one",
            name: "Home",
            baseUrl: "http://192.168.1.20:4000",
            color: "#A1b2C3",
          },
          {
            id: "two",
            name: "Work",
            baseUrl: "http://192.168.1.21:4000",
            color: "red",
          },
        ],
      }).backends,
    ).toEqual([
      {
        id: "one",
        name: "Home",
        baseUrl: "http://192.168.1.20:4000",
        color: "#a1b2c3",
        lastConnectedAt: undefined,
      },
      {
        id: "two",
        name: "Work",
        baseUrl: "http://192.168.1.21:4000",
        lastConnectedAt: undefined,
      },
    ]);
  });

  it("drops saved backend profiles that use the reserved same-origin id", () => {
    expect(
      parseBackendStore({
        version: 2,
        enabledBridgeIds: [SAME_ORIGIN_BRIDGE_ID],
        lastSelectedBridgeId: SAME_ORIGIN_BRIDGE_ID,
        backends: [
          {
            id: SAME_ORIGIN_BRIDGE_ID,
            name: "Impostor",
            baseUrl: "http://192.168.1.20:4000",
          },
        ],
      }),
    ).toEqual({
      version: 2,
      enabledBridgeIds: [SAME_ORIGIN_BRIDGE_ID],
      lastSelectedBridgeId: SAME_ORIGIN_BRIDGE_ID,
      backends: [],
    });
  });

  it("migrates the legacy browser store into the v2 browser key", async () => {
    const legacyStore = {
      version: 1,
      activeBackendId: "one",
      backends: [{ id: "one", name: "Home", baseUrl: "http://192.168.1.20:4000" }],
    };
    const setItem = vi.fn();
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) =>
        key === "herdrWeb.bridgeBackends.v1" ? JSON.stringify(legacyStore) : null,
      ),
      setItem,
      removeItem,
    });

    const migrated = await loadBackendStore();

    expect(migrated).toEqual({
      version: 2,
      enabledBridgeIds: ["one"],
      lastSelectedBridgeId: "one",
      backends: [
        {
          id: "one",
          name: "Home",
          baseUrl: "http://192.168.1.20:4000",
          lastConnectedAt: undefined,
        },
      ],
    });
    expect(setItem).toHaveBeenCalledWith("herdrWeb.bridgeBackends.v2", JSON.stringify(migrated));
    expect(removeItem).toHaveBeenCalledWith("herdrWeb.bridgeBackends.v1");

    vi.unstubAllGlobals();
  });

  it("detects duplicate normalized backend URLs", () => {
    const backends = [{ id: "one", name: "Home", baseUrl: "http://192.168.1.20:4000" }];

    expect(duplicateBackend(backends, "192.168.1.20:4000")?.id).toBe("one");
    expect(duplicateBackend(backends, "192.168.1.20:4000", "one")).toBeNull();
  });

  it("removes note drafts scoped to a retired backend connection", () => {
    const retained = "herdr-web:note-draft:v1:two:configured%3Atwo%3Ahttp%3A%2F%2Fold:store:session:note";
    const removed = `herdr-web:note-draft:v1:${encodeURIComponent("one")}:${encodeURIComponent(
      configuredBridgeConnectionKey("one", "http://old"),
    )}:store:session:note`;
    const storage = new Map([
      [retained, "{}"],
      [removed, "{}"],
    ]);
    vi.stubGlobal("localStorage", {
      get length() {
        return storage.size;
      },
      key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });

    removeNoteDraftsForBridgeConnection("one", configuredBridgeConnectionKey("one", "http://old"));

    expect(storage.has(removed)).toBe(false);
    expect(storage.has(retained)).toBe(true);
  });
});

describe("capabilities", () => {
  it("maps capability probe outcomes to connection blocking state", () => {
    expect(capabilityProbeSuccess({ commands: ["pane.split"], web_compat: 1 })).toEqual({
      blocked: false,
      state: "ready",
      capabilities: { commands: ["pane.split"], web_compat: 1 },
      error: null,
      retry: false,
    });
    expect(capabilityProbeSuccess({ commands: [], web_compat: 0 })).toEqual({
      blocked: true,
      state: "error",
      capabilities: null,
      error: "Bridge is not compatible with this web app",
      retry: false,
    });
    expect(capabilityProbeFailure(new Error("network down"))).toEqual({
      blocked: false,
      state: "error",
      capabilities: null,
      error: "network down",
      retry: true,
    });
  });

  it("backs off capability retry delays", () => {
    expect(capabilityRetryDelayMs(0)).toBe(5000);
    expect(capabilityRetryDelayMs(1)).toBe(10000);
    expect(capabilityRetryDelayMs(3)).toBe(40000);
    expect(capabilityRetryDelayMs(10)).toBe(60000);
  });

  it("parses optional compatibility fields", () => {
    expect(
      parseCapabilities({
        commands: ["pane.split", 42],
        bridge_version: "1.2.3",
        web_compat: 1,
        min_android_app_compat: 2,
        agent_activity: { version: 1 },
        agent_pins: { version: 1 },
        notes: { version: 1 },
      }),
    ).toEqual({
      commands: ["pane.split"],
      bridge_version: "1.2.3",
      web_compat: 1,
      min_android_app_compat: 2,
      agent_activity: { version: 1 },
      agent_pins: { version: 1 },
      notes: { version: 1 },
    });
  });

  it("probes configured bridge capabilities", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ commands: ["pane.move"] }), { status: 200 }),
    );

    await expect(probeBridgeBaseUrl("192.168.1.20:4000")).resolves.toEqual({
      commands: ["pane.move"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.1.20:4000/api/capabilities",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fetchMock.mockRestore();
  });

  it("rejects incompatible configured bridge capabilities", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ commands: [], web_compat: 0 }), { status: 200 }),
    );

    await expect(probeBridgeBaseUrl("192.168.1.20:4000")).rejects.toThrow(/not compatible/iu);

    fetchMock.mockRestore();
  });
});

describe("remote bridge proxy runtime", () => {
  it("namespaces runtime and connection ids so proxied bridges cannot collide", () => {
    expect(remoteBridgeRuntimeId("mini1")).toBe("remote:mini1");
    expect(remoteBridgeConnectionKey("mini1")).toBe("remote:mini1");
    expect(remoteBridgeRuntimeId("mini1")).not.toBe(SAME_ORIGIN_BRIDGE_ID);
  });

  it("rewrites bridge API paths to the hub's same-origin proxy path", () => {
    expect(remoteProxyApiPath("mini1", "/api/snapshot")).toBe(
      "/api/remote/mini1/snapshot",
    );
    expect(remoteProxyApiPath("mini1", "/api/agent-activity")).toBe(
      "/api/remote/mini1/agent-activity",
    );
  });

  it("percent-encodes the server id in proxy API paths", () => {
    expect(remoteProxyApiPath("mini/1 a", "/api/snapshot")).toBe(
      "/api/remote/mini%2F1%20a/snapshot",
    );
  });

  it("rejects proxy API rewrites for non-/api/ paths", () => {
    expect(() => remoteProxyApiPath("mini1", "/ws/terminal")).toThrow(/\/api\//u);
  });

  it("rewrites bridge WebSocket paths to the hub's same-origin proxy path", () => {
    expect(remoteProxyWsPath("mini1", "/ws/terminal")).toBe(
      "/ws/remote/mini1/terminal",
    );
    expect(remoteProxyWsPath("mini/1", "/ws/terminal")).toBe(
      "/ws/remote/mini%2F1/terminal",
    );
  });

  it("rejects proxy WebSocket rewrites for non-/ws/ paths", () => {
    expect(() => remoteProxyWsPath("mini1", "/api/snapshot")).toThrow(/\/ws\//u);
  });

  it("builds same-origin proxy HTTP URLs that preserve query params", () => {
    const query = new URLSearchParams({ terminal_id: "term-1" });

    expect(buildProxyHttpUrl("mini1", "/api/snapshot")).toBe("/api/remote/mini1/snapshot");
    expect(buildProxyHttpUrl("mini1", "/api/notes", query)).toBe(
      "/api/remote/mini1/notes?terminal_id=term-1",
    );
  });

  it("builds absolute same-origin proxy WebSocket URLs from window location", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "hub.local:8787" });
    const query = new URLSearchParams({ terminal_id: "term-1" });

    expect(buildProxyWsUrl("mini1", "/ws/terminal", query)).toBe(
      "wss://hub.local:8787/ws/remote/mini1/terminal?terminal_id=term-1",
    );

    vi.unstubAllGlobals();
  });

  it("reads the server-configured remote bridges and derives host labels", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: "mini1", url: "http://mini1.tail-scale.ts.net:8787" },
          { id: "mini2", url: "http://100.64.0.2:8787" },
        ]),
        { status: 200 },
      ),
    );

    await expect(fetchRemoteBridges()).resolves.toEqual([
      { id: "mini1", label: "mini1.tail-scale.ts.net:8787", baseUrl: "http://mini1.tail-scale.ts.net:8787" },
      { id: "mini2", label: "100.64.0.2:8787", baseUrl: "http://100.64.0.2:8787" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/bridges",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fetchMock.mockRestore();
  });

  it("deduplicates remote bridges by id and skips malformed entries", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: "mini1", url: "http://mini1:8787" },
          { id: "mini1", url: "http://mini1-dupe:8787" },
          { id: "  ", url: "http://blank:8787" },
          { id: "mini3" },
          { url: "http://no-id:8787" },
          "not-an-object",
        ]),
        { status: 200 },
      ),
    );

    await expect(fetchRemoteBridges()).resolves.toEqual([
      { id: "mini1", label: "mini1:8787", baseUrl: "http://mini1:8787" },
    ]);

    fetchMock.mockRestore();
  });

  it("falls back to the bridge id when the url has no parseable host", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: "mini9", url: "not a url" }]), { status: 200 }),
    );

    await expect(fetchRemoteBridges()).resolves.toEqual([
      { id: "mini9", label: "mini9", baseUrl: "not a url" },
    ]);

    fetchMock.mockRestore();
  });

  it("returns an empty list when the bridges endpoint is unavailable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 404 }),
    );

    await expect(fetchRemoteBridges()).resolves.toEqual([]);

    fetchMock.mockRestore();
  });

  it("returns an empty list on transport failure", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network down"));

    await expect(fetchRemoteBridges()).resolves.toEqual([]);

    fetchMock.mockRestore();
  });

  it("returns an empty list when the payload is not an array", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ bridges: [] }), { status: 200 }),
    );

    await expect(fetchRemoteBridges()).resolves.toEqual([]);

    fetchMock.mockRestore();
  });
});
