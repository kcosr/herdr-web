export type MobileTerminalTapTarget = "command-input" | "terminal";

export const DEFAULT_MOBILE_TERMINAL_TAP_TARGET: MobileTerminalTapTarget = "command-input";
export const DEFAULT_MOBILE_TOUCH_SELECTION = false;
export const DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT = true;

export function parseMobileTerminalTapTarget(value: unknown): MobileTerminalTapTarget {
  return value === "terminal" || value === "command-input"
    ? value
    : DEFAULT_MOBILE_TERMINAL_TAP_TARGET;
}

export function parseMobileTouchSelection(value: unknown) {
  return typeof value === "boolean" ? value : DEFAULT_MOBILE_TOUCH_SELECTION;
}

export function parseMobileKeyboardHideRefit(value: unknown) {
  return typeof value === "boolean" ? value : DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT;
}
