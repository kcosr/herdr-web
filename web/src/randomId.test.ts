import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "./randomId";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

// Captured before any stubGlobal so the getRandomValues-only stub below can
// delegate to a real implementation instead of recursing into itself.
const realCrypto = globalThis.crypto;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("randomId", () => {
  it("uses crypto.randomUUID when the page is a secure context", () => {
    const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { randomUUID });

    expect(randomId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("falls back to getRandomValues when randomUUID is missing", () => {
    // Plain HTTP on a LAN / .local / Tailscale origin: randomUUID is undefined
    // but getRandomValues is still available (it is not secure-context gated).
    vi.stubGlobal("crypto", {
      randomUUID: undefined,
      getRandomValues: (bytes: Uint8Array) => realCrypto.getRandomValues(bytes),
    });

    const first = randomId();
    const second = randomId();

    expect(first).toMatch(UUID_SHAPE);
    expect(second).toMatch(UUID_SHAPE);
    expect(first).not.toBe(second);
  });

  it("falls back to clock plus Math.random with no Web Crypto at all", () => {
    vi.stubGlobal("crypto", undefined);

    const ids = new Set(Array.from({ length: 50 }, () => randomId()));

    expect(ids.size).toBe(50);
    for (const id of ids) {
      // Long enough that another tab cannot realistically guess it.
      expect(id.length).toBeGreaterThanOrEqual(20);
    }
  });
});
