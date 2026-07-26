/**
 * Helpers for the mobile terminal command field.
 *
 * A controlled command field can keep a stale native value after React clears
 * state. Later keystrokes then report `event.target.value` as `previous + typed`,
 * so Send prefixes the old prompt.
 */

export type MobileCommandInputNode = {
  value: string;
  defaultValue: string;
};

/** Force the native field to match React state after clear/submit. */
export function syncMobileCommandInputValue(
  node: MobileCommandInputNode | null | undefined,
  next: string,
) {
  if (!node) {
    return;
  }
  node.value = next;
  node.defaultValue = next;
}

/** Bump after clear so the command field remounts with an empty native value. */
export function nextMobileCommandFieldKey(key: number): number {
  return key + 1;
}

/**
 * Build a single PTY input frame for Send: text plus Enter together.
 * Splitting text and `\r` across delayed frames leaves agent prompts (e.g. Cursor)
 * with staged text that the next Send appends to.
 */
export function mobileCommandSubmitInput(command: string): string {
  return `${command}\r`;
}
