import { describe, expect, it } from "vitest";
import { sameOriginDisplay, sameOriginServedUrl } from "./sameOrigin";

describe("sameOriginServedUrl", () => {
  it("returns the origin when available", () => {
    expect(sameOriginServedUrl("http://localhost:8787")).toBe("http://localhost:8787");
  });

  it("falls back to the literal same-origin when origin is missing or null", () => {
    expect(sameOriginServedUrl(null)).toBe("same-origin");
    expect(sameOriginServedUrl(undefined)).toBe("same-origin");
    expect(sameOriginServedUrl("")).toBe("same-origin");
    expect(sameOriginServedUrl("null")).toBe("same-origin");
  });
});

describe("sameOriginDisplay", () => {
  it("leads with the tailnet name and keeps the served origin as subtitle", () => {
    expect(
      sameOriginDisplay({
        tailnetName: "macbook.hippo-tilapia.ts.net",
        origin: "http://localhost:8787",
        port: "8787",
      }),
    ).toEqual({
      title: "macbook.hippo-tilapia.ts.net:8787",
      subtitle: "http://localhost:8787",
    });
  });

  it("omits the port when the page is served on a default port", () => {
    expect(
      sameOriginDisplay({
        tailnetName: "macbook.hippo-tilapia.ts.net",
        origin: "https://macbook.hippo-tilapia.ts.net",
        port: "",
      }),
    ).toEqual({
      title: "macbook.hippo-tilapia.ts.net",
      subtitle: "https://macbook.hippo-tilapia.ts.net",
    });
  });

  it("falls back to the previous behavior when no tailnet name is available", () => {
    expect(
      sameOriginDisplay({ tailnetName: undefined, origin: "http://localhost:8787", port: "8787" }),
    ).toEqual({ title: "Same origin", subtitle: "http://localhost:8787" });
    expect(
      sameOriginDisplay({ tailnetName: "  ", origin: "http://localhost:8787", port: "8787" }),
    ).toEqual({ title: "Same origin", subtitle: "http://localhost:8787" });
  });

  it("still renders when origin is unavailable", () => {
    expect(
      sameOriginDisplay({ tailnetName: "macbook.ts.net", origin: "null", port: "" }),
    ).toEqual({ title: "macbook.ts.net", subtitle: "same-origin" });
    expect(sameOriginDisplay({ origin: null, port: null })).toEqual({
      title: "Same origin",
      subtitle: "same-origin",
    });
  });
});

describe("sameOriginDisplay bridge version", () => {
  it("appends the bridge version to the subtitle when present", () => {
    expect(
      sameOriginDisplay({
        tailnetName: "macbook.ts.net",
        origin: "http://macbook.ts.net:8787",
        port: "8787",
        bridgeVersion: "0.4.2",
      }),
    ).toEqual({
      title: "macbook.ts.net:8787",
      subtitle: "http://macbook.ts.net:8787 · bridge 0.4.2",
    });
  });

  it("omits the version suffix when absent or blank", () => {
    const base = {
      tailnetName: "mini.ts.net",
      origin: "http://mini.ts.net",
      port: "",
    };
    expect(sameOriginDisplay({ ...base, bridgeVersion: undefined }).subtitle).toBe(
      "http://mini.ts.net",
    );
    expect(sameOriginDisplay({ ...base, bridgeVersion: "   " }).subtitle).toBe(
      "http://mini.ts.net",
    );
  });

  it("does not decorate the literal same-origin fallback", () => {
    expect(
      sameOriginDisplay({ origin: null, port: null, bridgeVersion: "0.4.2" }).subtitle,
    ).toBe("same-origin");
  });
});
