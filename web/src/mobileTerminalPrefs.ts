export type MobileTerminalTapTarget = "command-input" | "terminal";
export type MobileTerminalControlScale = "compact" | "comfortable";
export type MobileChromeInsets = "system" | "extra";

export const DEFAULT_MOBILE_TERMINAL_TAP_TARGET: MobileTerminalTapTarget = "command-input";
export const DEFAULT_MOBILE_TERMINAL_CONTROL_SCALE: MobileTerminalControlScale = "compact";
export const DEFAULT_MOBILE_CHROME_INSETS: MobileChromeInsets = "system";
export const DEFAULT_MOBILE_TOUCH_SELECTION = true;
export const DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT = true;

export function parseMobileTerminalTapTarget(value: unknown): MobileTerminalTapTarget {
  return value === "terminal" || value === "command-input"
    ? value
    : DEFAULT_MOBILE_TERMINAL_TAP_TARGET;
}

export function parseMobileTerminalControlScale(value: unknown): MobileTerminalControlScale {
  return value === "comfortable" || value === "compact"
    ? value
    : DEFAULT_MOBILE_TERMINAL_CONTROL_SCALE;
}

export function parseMobileChromeInsets(value: unknown): MobileChromeInsets {
  return value === "extra" || value === "system" ? value : DEFAULT_MOBILE_CHROME_INSETS;
}

export function parseMobileTouchSelection(value: unknown) {
  return typeof value === "boolean" ? value : DEFAULT_MOBILE_TOUCH_SELECTION;
}

export function parseMobileKeyboardHideRefit(value: unknown) {
  return typeof value === "boolean" ? value : DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT;
}
