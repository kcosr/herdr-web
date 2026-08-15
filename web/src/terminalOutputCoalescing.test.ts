import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_OUTPUT_COALESCE_MS,
  parseTerminalOutputCoalesceMs,
} from "./terminalOutputCoalescing";

describe("terminal output coalescing preferences", () => {
  it("parses supported coalescing windows", () => {
    expect(parseTerminalOutputCoalesceMs(0)).toBe(0);
    expect(parseTerminalOutputCoalesceMs(8)).toBe(8);
    expect(parseTerminalOutputCoalesceMs(16)).toBe(16);
    expect(parseTerminalOutputCoalesceMs(32)).toBe(32);
    expect(parseTerminalOutputCoalesceMs(64)).toBe(64);
    expect(parseTerminalOutputCoalesceMs(128)).toBe(128);
    expect(parseTerminalOutputCoalesceMs(256)).toBe(256);
  });

  it("falls back for unsupported coalescing windows", () => {
    expect(parseTerminalOutputCoalesceMs(24)).toBe(DEFAULT_TERMINAL_OUTPUT_COALESCE_MS);
    expect(parseTerminalOutputCoalesceMs(512)).toBe(DEFAULT_TERMINAL_OUTPUT_COALESCE_MS);
    expect(parseTerminalOutputCoalesceMs("16")).toBe(DEFAULT_TERMINAL_OUTPUT_COALESCE_MS);
  });
});
