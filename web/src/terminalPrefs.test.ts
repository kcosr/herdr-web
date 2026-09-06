import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESKTOP_COMMAND_COMPOSER,
  DEFAULT_DESKTOP_COMMAND_ENTER_NEWLINE,
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  defaultTerminalCursorBlink,
  MAX_TERMINAL_FONT_SIZE_PX,
  MIN_TERMINAL_FONT_SIZE_PX,
  parseDesktopCommandComposer,
  parseDesktopCommandEnterNewline,
  parseTerminalFontSizePx,
  parseTerminalCursorBlink,
} from "./terminalPrefs";

describe("terminal preferences", () => {
  it("parses and clamps the terminal font size", () => {
    expect(parseTerminalFontSizePx(13)).toBe(13);
    expect(parseTerminalFontSizePx(16.7)).toBe(17);
    expect(parseTerminalFontSizePx(4)).toBe(MIN_TERMINAL_FONT_SIZE_PX);
    expect(parseTerminalFontSizePx(999)).toBe(MAX_TERMINAL_FONT_SIZE_PX);
  });

  it("falls back for invalid terminal font sizes", () => {
    expect(parseTerminalFontSizePx(null)).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
    expect(parseTerminalFontSizePx("13")).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
    expect(parseTerminalFontSizePx(Number.NaN)).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
  });

  it("parses desktop command composer flags", () => {
    expect(parseDesktopCommandComposer(true)).toBe(true);
    expect(parseDesktopCommandComposer(false)).toBe(false);
    expect(parseDesktopCommandComposer("true")).toBe(DEFAULT_DESKTOP_COMMAND_COMPOSER);
    expect(parseDesktopCommandComposer(undefined, true)).toBe(true);
    expect(parseDesktopCommandEnterNewline(true)).toBe(true);
    expect(parseDesktopCommandEnterNewline(false)).toBe(false);
    expect(parseDesktopCommandEnterNewline("false")).toBe(
      DEFAULT_DESKTOP_COMMAND_ENTER_NEWLINE,
    );
    expect(parseDesktopCommandEnterNewline(undefined, false)).toBe(false);
  });

  it("defaults cursor blink off on Windows and on elsewhere", () => {
    expect(defaultTerminalCursorBlink("Win32")).toBe(false);
    expect(defaultTerminalCursorBlink("Windows")).toBe(false);
    expect(defaultTerminalCursorBlink("MacIntel")).toBe(true);
    expect(defaultTerminalCursorBlink("Linux x86_64")).toBe(true);
  });

  it("parses stored cursor blink preferences", () => {
    expect(parseTerminalCursorBlink(true, false)).toBe(true);
    expect(parseTerminalCursorBlink(false, true)).toBe(false);
    expect(parseTerminalCursorBlink("false", true)).toBe(true);
  });
});
