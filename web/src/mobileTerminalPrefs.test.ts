import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOBILE_COMMAND_ENTER_NEWLINE,
  DEFAULT_MOBILE_COMMAND_EXPANDING_INPUT,
  DEFAULT_MOBILE_COMPACT_CONTROLS,
  DEFAULT_MOBILE_LONG_PRESS_BEHAVIOR,
  DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT,
  DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS,
  DEFAULT_MOBILE_TERMINAL_TAP_TARGET,
  MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_OPTIONS_MS,
  parseMobileCommandEnterNewline,
  parseMobileCommandExpandingInput,
  parseMobileCompactControls,
  parseMobileLongPressBehavior,
  parseMobileKeyboardHideRefit,
  parseMobileTouchSelectionEndpointTimeoutMs,
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

  it("parses supported long-press behaviors", () => {
    expect(parseMobileLongPressBehavior("off")).toBe("off");
    expect(parseMobileLongPressBehavior("copy")).toBe("copy");
    expect(parseMobileLongPressBehavior("loupe")).toBe("loupe");
  });

  it("falls back for unknown long-press behaviors", () => {
    expect(parseMobileLongPressBehavior(true)).toBe(DEFAULT_MOBILE_LONG_PRESS_BEHAVIOR);
    expect(parseMobileLongPressBehavior("selection")).toBe(DEFAULT_MOBILE_LONG_PRESS_BEHAVIOR);
  });

  it("parses the mobile touch selection endpoint timeout", () => {
    for (const timeoutMs of MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_OPTIONS_MS) {
      expect(parseMobileTouchSelectionEndpointTimeoutMs(timeoutMs)).toBe(timeoutMs);
    }
    expect(parseMobileTouchSelectionEndpointTimeoutMs(1250)).toBe(
      DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS,
    );
    expect(parseMobileTouchSelectionEndpointTimeoutMs("3000")).toBe(
      DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS,
    );
  });

  it("parses the keyboard-hide refit flag", () => {
    expect(parseMobileKeyboardHideRefit(true)).toBe(true);
    expect(parseMobileKeyboardHideRefit(false)).toBe(false);
    expect(parseMobileKeyboardHideRefit("false")).toBe(DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT);
  });

  it("parses mobile command input flags", () => {
    expect(parseMobileCommandExpandingInput(true)).toBe(true);
    expect(parseMobileCommandExpandingInput(false)).toBe(false);
    expect(parseMobileCommandExpandingInput("true")).toBe(
      DEFAULT_MOBILE_COMMAND_EXPANDING_INPUT,
    );
    expect(parseMobileCommandEnterNewline(true)).toBe(true);
    expect(parseMobileCommandEnterNewline(false)).toBe(false);
    expect(parseMobileCommandEnterNewline("false")).toBe(
      DEFAULT_MOBILE_COMMAND_ENTER_NEWLINE,
    );
  });

  it("parses the compact mobile controls flag", () => {
    expect(parseMobileCompactControls(true)).toBe(true);
    expect(parseMobileCompactControls(false)).toBe(false);
    expect(parseMobileCompactControls("false")).toBe(DEFAULT_MOBILE_COMPACT_CONTROLS);
    expect(parseMobileCompactControls(undefined)).toBe(DEFAULT_MOBILE_COMPACT_CONTROLS);
  });
});
