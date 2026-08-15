export const DEFAULT_TERMINAL_OUTPUT_COALESCE_MS = 16;
export const TERMINAL_OUTPUT_COALESCE_OPTIONS_MS = [0, 8, 16, 32, 64, 128, 256] as const;

export function parseTerminalOutputCoalesceMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TERMINAL_OUTPUT_COALESCE_MS;
  }
  return TERMINAL_OUTPUT_COALESCE_OPTIONS_MS.includes(
    value as (typeof TERMINAL_OUTPUT_COALESCE_OPTIONS_MS)[number],
  )
    ? value
    : DEFAULT_TERMINAL_OUTPUT_COALESCE_MS;
}
