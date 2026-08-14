import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHttpUrl,
  buildWsUrl,
  capabilityProbeFailure,
  capabilityProbeSuccess,
  capabilityRetryDelayMs,
  configuredBridgeConnectionKey,
  duplicateBackend,
  fetchDiscoveredBridges,
  loadBackendStore,
  mergeBridges,
  normalizeBridgeBaseUrl,
  normalizeBackendColor,
  parseBackendStore,
  parseCapabilities,
  probeBridgeBaseUrl,
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
        tailnet_name: "macbook.hippo-tilapia.ts.net",
        agent_activity: { version: 1 },
        agent_pins: { version: 1 },
        notes: { version: 1 },
      }),
    ).toEqual({
      commands: ["pane.split"],
      bridge_version: "1.2.3",
      web_compat: 1,
      min_android_app_compat: 2,
      tailnet_name: "macbook.hippo-tilapia.ts.net",
      agent_activity: { version: 1 },
      agent_pins: { version: 1 },
      notes: { version: 1 },
    });
  });

  it("omits a blank or non-string tailnet name", () => {
    expect(parseCapabilities({ commands: [], tailnet_name: "   " }).tailnet_name).toBeUndefined();
    expect(parseCapabilities({ commands: [], tailnet_name: 42 }).tailnet_name).toBeUndefined();
    expect(parseCapabilities({ commands: [] }).tailnet_name).toBeUndefined();
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

describe("bridge discovery", () => {
  it("fetches discovered bridges from /api/bridges", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: "bridge1", url: "http://192.168.1.20:4000" },
          { id: "bridge2", url: "http://192.168.1.21:4000" },
        ]),
        { status: 200 },
      ),
    );

    const discovered = await fetchDiscoveredBridges();

    expect(discovered).toHaveLength(2);
    expect(discovered[0]).toMatchObject({
      name: "192.168.1.20:4000",
      baseUrl: "http://192.168.1.20:4000",
      discovered: true,
    });
    expect(discovered[1]).toMatchObject({
      name: "192.168.1.21:4000",
      baseUrl: "http://192.168.1.21:4000",
      discovered: true,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/bridges", expect.any(Object));

    fetchMock.mockRestore();
  });

  it("degrades gracefully when /api/bridges returns 404 (older bridge)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );

    const discovered = await fetchDiscoveredBridges();

    expect(discovered).toEqual([]);

    fetchMock.mockRestore();
  });

  it("degrades gracefully on network errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const discovered = await fetchDiscoveredBridges();

    expect(discovered).toEqual([]);

    fetchMock.mockRestore();
  });

  it("ignores malformed entries in discovered bridges", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: "bridge1", url: "http://192.168.1.20:4000" },
          { id: "bridge2" },
          { url: "http://192.168.1.22:4000" },
          { id: "bridge3", url: "not a valid url" },
          { id: "bridge4", url: "http://192.168.1.21:4000" },
        ]),
        { status: 200 },
      ),
    );

    const discovered = await fetchDiscoveredBridges();

    expect(discovered).toHaveLength(2);
    expect(discovered[0].baseUrl).toBe("http://192.168.1.20:4000");
    expect(discovered[1].baseUrl).toBe("http://192.168.1.21:4000");

    fetchMock.mockRestore();
  });

  it("returns empty array when response is not an array", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ bridges: [] }), { status: 200 }),
    );

    const discovered = await fetchDiscoveredBridges();

    expect(discovered).toEqual([]);

    fetchMock.mockRestore();
  });

  it("merges discovered bridges without duplicating stored backends", () => {
    const stored = [
      { id: "one", name: "Home", baseUrl: "http://192.168.1.20:4000" },
      { id: "two", name: "Work", baseUrl: "http://192.168.1.21:4000" },
    ];
    const discovered = [
      {
        id: "disc1",
        name: "192.168.1.21:4000",
        baseUrl: "http://192.168.1.21:4000",
        discovered: true,
      },
      {
        id: "disc2",
        name: "192.168.1.22:4000",
        baseUrl: "http://192.168.1.22:4000",
        discovered: true,
      },
    ];

    const merged = mergeBridges(stored, discovered);

    expect(merged).toHaveLength(3);
    expect(merged.map((b) => b.baseUrl)).toEqual([
      "http://192.168.1.20:4000",
      "http://192.168.1.21:4000",
      "http://192.168.1.22:4000",
    ]);
    expect(merged[0].id).toBe("one");
    expect(merged[1].id).toBe("two");
    expect(merged[2].discovered).toBe(true);
  });

  it("prioritizes stored backends over discovered ones with the same URL", () => {
    const stored = [
      { id: "stored", name: "My Home", baseUrl: "http://192.168.1.20:4000", color: "#89b4fa" },
    ];
    const discovered = [
      {
        id: "disc",
        name: "192.168.1.20:4000",
        baseUrl: "http://192.168.1.20:4000",
        discovered: true,
      },
    ];

    const merged = mergeBridges(stored, discovered);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("stored");
    expect(merged[0].name).toBe("My Home");
    expect(merged[0].color).toBe("#89b4fa");
  });

  it("loads backend store with discovered bridges merged in", async () => {
    const storedData = {
      version: 2,
      enabledBridgeIds: ["one"],
      lastSelectedBridgeId: "one",
      backends: [{ id: "one", name: "Home", baseUrl: "http://192.168.1.20:4000" }],
    };
    const discoveredData = [
      { id: "bridge-2", url: "http://192.168.1.21:4000" },
      { id: "bridge-3", url: "http://192.168.1.22:4000" },
    ];

    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) =>
        key === "herdrWeb.bridgeBackends.v2" ? JSON.stringify(storedData) : null,
      ),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(discoveredData), { status: 200 }),
    );

    const loaded = await loadBackendStore();

    expect(loaded.backends).toHaveLength(3);
    expect(loaded.backends[0].id).toBe("one");
    expect(loaded.backends[1]).toMatchObject({
      name: "192.168.1.21:4000",
      baseUrl: "http://192.168.1.21:4000",
      discovered: true,
    });
    expect(loaded.backends[2]).toMatchObject({
      name: "192.168.1.22:4000",
      baseUrl: "http://192.168.1.22:4000",
      discovered: true,
    });

    fetchMock.mockRestore();
    vi.unstubAllGlobals();
  });

  it("loads empty storage with only discovered bridges", async () => {
    const discoveredData = [
      { id: "bridge-1", url: "http://192.168.1.20:4000" },
      { id: "bridge-2", url: "http://192.168.1.21:4000" },
    ];

    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(discoveredData), { status: 200 }),
    );

    const loaded = await loadBackendStore();

    expect(loaded.backends).toHaveLength(2);
    expect(loaded.backends[0]).toMatchObject({
      name: "192.168.1.20:4000",
      baseUrl: "http://192.168.1.20:4000",
      discovered: true,
    });
    expect(loaded.backends[1]).toMatchObject({
      name: "192.168.1.21:4000",
      baseUrl: "http://192.168.1.21:4000",
      discovered: true,
    });

    fetchMock.mockRestore();
    vi.unstubAllGlobals();
  });

  it("handles discovery errors gracefully without blocking store load", async () => {
    const storedData = {
      version: 2,
      enabledBridgeIds: ["one"],
      lastSelectedBridgeId: "one",
      backends: [{ id: "one", name: "Home", baseUrl: "http://192.168.1.20:4000" }],
    };

    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) =>
        key === "herdrWeb.bridgeBackends.v2" ? JSON.stringify(storedData) : null,
      ),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));

    const loaded = await loadBackendStore();

    expect(loaded.backends).toHaveLength(1);
    expect(loaded.backends[0].id).toBe("one");

    fetchMock.mockRestore();
    vi.unstubAllGlobals();
  });
});
