/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roots: Root[] = [];

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
  }
}

const realCrypto = globalThis.crypto;

/** jsdom has no matchMedia; @parlay/client reads it at module scope. */
function stubMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

/**
 * `@parlay/client` is an intentionally OPTIONAL, LOCAL-ONLY dependency: it only
 * resolves when the gitignored `web/local-deps/parlay-client` symlink is present
 * (see web/README.md), so the standard `npm ci` environment has no such module.
 * Mirror ParlayInput's own guarded import to decide whether the parlay path is
 * exercisable here, and skip these session-id tests when it is not. matchMedia
 * must be stubbed before the import since the package reads it at module scope.
 */
stubMatchMedia();
let parlayAvailable = true;
try {
  await import("@parlay/client");
} catch {
  parlayAvailable = false;
}

/** Plain HTTP on a non-localhost origin: no randomUUID, getRandomValues intact. */
function stubInsecureContextCrypto() {
  vi.stubGlobal("crypto", {
    randomUUID: undefined,
    getRandomValues: (bytes: Uint8Array) => realCrypto.getRandomValues(bytes),
  });
}

/**
 * Since #14 the component early-returns a plain input when `@parlay/client` is
 * unavailable, and that branch never generates ids — so these tests only mean
 * anything on the parlay-available path. Reading the ids back off the
 * `/api/chat/events` EventSource keeps that honest: no parlay, no EventSource,
 * no ids, and the assertions fail loudly instead of passing vacuously.
 */
function deviceIdsFromEventSources() {
  return FakeEventSource.instances.map(
    (instance) => new URL(instance.url).searchParams.get("device") ?? "",
  );
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  stubMatchMedia();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountInput() {
  const { ParlayInput } = await import("./ParlayInput");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <ParlayInput
        value=""
        onValueChange={() => {}}
        onVoiceSubmit={() => {}}
        disabled={false}
        expandingInput={false}
        enterNewline={false}
        controlsScalePercent={100}
        inputRef={() => {}}
      />,
    );
  });
  return host;
}

describe.skipIf(!parlayAvailable)("ParlayMobileInput session ids", () => {
  it("mounts without crypto.randomUUID (insecure-context origins)", async () => {
    // Reproduces the mobile-mode crash: herdr-web served over plain HTTP to a
    // LAN / .local / Tailscale origin has no `crypto.randomUUID` (it is
    // secure-context only), so the unguarded call threw a TypeError during
    // render and React tore down the whole terminal tree with it.
    stubInsecureContextCrypto();

    const host = await mountInput();

    expect(host.querySelector("input.term-native-input")).not.toBeNull();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(deviceIdsFromEventSources()[0]).toMatch(/^herdr-web-mobile-.+/u);
  });

  it("mounts with no Web Crypto at all", async () => {
    vi.stubGlobal("crypto", undefined);

    const host = await mountInput();

    expect(host.querySelector("input.term-native-input")).not.toBeNull();
    expect(deviceIdsFromEventSources()[0]).toMatch(/^herdr-web-mobile-.+/u);
  });

  it("gives every mount distinct ids when randomUUID is missing", async () => {
    // The point of be704dc: two tabs must not share a device id, or one tab
    // replays the other's SSE-broadcast actions into its terminal.
    stubInsecureContextCrypto();

    await mountInput();
    await mountInput();

    const [first, second] = deviceIdsFromEventSources();
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});
