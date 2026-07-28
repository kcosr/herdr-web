export type MobileTerminalTapTarget = "command-input" | "terminal";
export type MobileLongPressBehavior = "off" | "copy" | "loupe";

export const DEFAULT_MOBILE_TERMINAL_TAP_TARGET: MobileTerminalTapTarget = "command-input";
export const DEFAULT_MOBILE_LONG_PRESS_BEHAVIOR: MobileLongPressBehavior = "off";
export const MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_OPTIONS_MS = [1500, 3000, 5000] as const;
export type MobileTouchSelectionEndpointTimeoutMs =
  (typeof MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_OPTIONS_MS)[number];
export const DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS: MobileTouchSelectionEndpointTimeoutMs = 1500;
export const DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT = true;
export const DEFAULT_MOBILE_COMMAND_EXPANDING_INPUT = true;
export const DEFAULT_MOBILE_COMMAND_ENTER_NEWLINE = false;
export const DEFAULT_MOBILE_COMPACT_CONTROLS = true;

export function parseMobileTerminalTapTarget(value: unknown): MobileTerminalTapTarget {
  return value === "terminal" || value === "command-input"
    ? value
    : DEFAULT_MOBILE_TERMINAL_TAP_TARGET;
}

export function parseMobileLongPressBehavior(value: unknown): MobileLongPressBehavior {
  return value === "off" || value === "copy" || value === "loupe"
    ? value
    : DEFAULT_MOBILE_LONG_PRESS_BEHAVIOR;
}

export function parseMobileTouchSelectionEndpointTimeoutMs(
  value: unknown,
): MobileTouchSelectionEndpointTimeoutMs {
  return MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_OPTIONS_MS.includes(
    value as MobileTouchSelectionEndpointTimeoutMs,
  )
    ? (value as MobileTouchSelectionEndpointTimeoutMs)
    : DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS;
}

export function parseMobileKeyboardHideRefit(value: unknown) {
  return typeof value === "boolean" ? value : DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT;
}

export function parseMobileCommandExpandingInput(value: unknown) {
  return typeof value === "boolean" ? value : DEFAULT_MOBILE_COMMAND_EXPANDING_INPUT;
}

export function parseMobileCommandEnterNewline(value: unknown) {
  return typeof value === "boolean" ? value : DEFAULT_MOBILE_COMMAND_ENTER_NEWLINE;
}

export function parseMobileCompactControls(value: unknown) {
  return typeof value === "boolean" ? value : DEFAULT_MOBILE_COMPACT_CONTROLS;
}
