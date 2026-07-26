import { describe, expect, it } from "vitest";

import {
  mobileCommandSubmitInput,
  nextMobileCommandFieldKey,
  syncMobileCommandInputValue,
} from "./mobileCommandInput";

describe("syncMobileCommandInputValue", () => {
  it("writes value and defaultValue so a cleared prefix cannot stick in the native field", () => {
    const node = { value: "first prompt", defaultValue: "first prompt" };

    syncMobileCommandInputValue(node, "");

    expect(node.value).toBe("");
    expect(node.defaultValue).toBe("");
  });

  it("ignores a missing ref while the field remounts", () => {
    expect(() => syncMobileCommandInputValue(null, "")).not.toThrow();
    expect(() => syncMobileCommandInputValue(undefined, "")).not.toThrow();
  });
});

describe("nextMobileCommandFieldKey", () => {
  it("bumps the remount key after each clear", () => {
    expect(nextMobileCommandFieldKey(0)).toBe(1);
    expect(nextMobileCommandFieldKey(7)).toBe(8);
  });
});

describe("mobileCommandSubmitInput", () => {
  it("appends Enter in the same frame as the command text", () => {
    expect(mobileCommandSubmitInput("hello")).toBe("hello\r");
  });

  it("still sends Enter when the field is empty", () => {
    expect(mobileCommandSubmitInput("")).toBe("\r");
  });
});
