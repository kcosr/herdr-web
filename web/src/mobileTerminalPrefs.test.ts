import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT,
  DEFAULT_MOBILE_TOUCH_SELECTION,
  DEFAULT_MOBILE_TERMINAL_TAP_TARGET,
  parseMobileKeyboardHideRefit,
  parseMobileTouchSelection,
  parseMobileTerminalTapTarget,
} from "./mobileTerminalPrefs";

describe("mobile terminal preferences", () => {
  it("parses supported tap targets", () => {
    expect(parseMobileTerminalTapTarget("command-input")).toBe("command-input");
    expect(parseMobileTerminalTapTarget("terminal")).toBe("terminal");
  });

  it("falls back for unknown tap targets", () => {
    expect(parseMobileTerminalTapTarget("native-input")).toBe(
      DEFAULT_MOBILE_TERMINAL_TAP_TARGET,
    );
    expect(parseMobileTerminalTapTarget(null)).toBe(DEFAULT_MOBILE_TERMINAL_TAP_TARGET);
  });

  it("parses the mobile touch selection flag", () => {
    expect(parseMobileTouchSelection(true)).toBe(true);
    expect(parseMobileTouchSelection(false)).toBe(false);
    expect(parseMobileTouchSelection("true")).toBe(DEFAULT_MOBILE_TOUCH_SELECTION);
  });

  it("parses the keyboard-hide refit flag", () => {
    expect(parseMobileKeyboardHideRefit(true)).toBe(true);
    expect(parseMobileKeyboardHideRefit(false)).toBe(false);
    expect(parseMobileKeyboardHideRefit("false")).toBe(DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT);
  });
});
