import { describe, expect, it } from "vitest";
import {
  isWebPushBrowserSupported,
  supportsWebPushCapability,
  urlBase64ToUint8Array,
} from "./webPush";

describe("web push helpers", () => {
  it("detects bridge web_push capability", () => {
    expect(supportsWebPushCapability({ commands: [] })).toBe(false);
    expect(
      supportsWebPushCapability({
        commands: [],
        web_push: { version: 1, public_key: "abc" },
      }),
    ).toBe(true);
    expect(
      supportsWebPushCapability({
        commands: [],
        web_push: { version: 1, public_key: "" },
      }),
    ).toBe(false);
  });

  it("decodes applicationServerKey material", () => {
    const bytes = urlBase64ToUint8Array("AQID");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it("requires secure context APIs for browser support", () => {
    expect(isWebPushBrowserSupported(undefined, true, true)).toBe(false);
  });
});
