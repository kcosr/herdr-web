import { describe, expect, it, vi } from "vitest";
import {
  buildHttpUrl,
  buildWsUrl,
  capabilityProbeFailure,
  capabilityProbeSuccess,
  capabilityRetryDelayMs,
  duplicateBackend,
  normalizeBridgeBaseUrl,
  parseBackendStore,
  parseCapabilities,
  probeBridgeBaseUrl,
} from "./bridge";

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
  it("keeps valid profiles and clears invalid active ids", () => {
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
      version: 1,
      activeBackendId: null,
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

  it("detects duplicate normalized backend URLs", () => {
    const backends = [{ id: "one", name: "Home", baseUrl: "http://192.168.1.20:4000" }];

    expect(duplicateBackend(backends, "192.168.1.20:4000")?.id).toBe("one");
    expect(duplicateBackend(backends, "192.168.1.20:4000", "one")).toBeNull();
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
      }),
    ).toEqual({
      commands: ["pane.split"],
      bridge_version: "1.2.3",
      web_compat: 1,
      min_android_app_compat: 2,
    });
  });

  it("probes configured bridge capabilities", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ commands: ["pane.move"] }), { status: 200 }),
    );

    await expect(probeBridgeBaseUrl("192.168.1.20:4000")).resolves.toEqual({
      commands: ["pane.move"],
    });
    expect(fetchMock).toHaveBeenCalledWith("http://192.168.1.20:4000/api/capabilities");

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
