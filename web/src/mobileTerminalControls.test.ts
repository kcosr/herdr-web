import { describe, expect, it } from "vitest";

import {
  autosizeMobileCommandTextarea,
  encodeMobileTerminalChord,
  MOBILE_TERMINAL_SPECIAL_KEYS,
  mobileTerminalPrintableKey,
} from "./mobileTerminalControls";

describe("autosizeMobileCommandTextarea", () => {
  it("sizes the command textarea to its wrapped content height", () => {
    const textarea = {
      scrollHeight: 84,
      style: { height: "34px" },
    };

    autosizeMobileCommandTextarea(textarea);

    expect(textarea.style.height).toBe("84px");
  });

  it("includes the border height for border-box textareas", () => {
    const textarea = {
      scrollHeight: 84,
      clientHeight: 80,
      offsetHeight: 82,
      style: { height: "34px" },
    };

    autosizeMobileCommandTextarea(textarea);

    expect(textarea.style.height).toBe("86px");
  });

  it("ignores missing textarea refs while controls mount", () => {
    expect(() => autosizeMobileCommandTextarea(null)).not.toThrow();
  });
});

describe("encodeMobileTerminalChord", () => {
  it("encodes Ctrl+Shift+Up using the xterm modifier parameter", () => {
    expect(encodeMobileTerminalChord(specialKey("arrow-up"), ["ctrl", "shift"])).toBe(
      "\x1B[1;6A",
    );
  });

  it("prefixes printable Alt chords with Escape", () => {
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("p"), ["alt"])).toBe(
      "\x1Bp",
    );
  });

  it("encodes control letters before applying Alt", () => {
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("c"), ["ctrl"])).toBe(
      "\x03",
    );
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("p"), ["ctrl", "alt"])).toBe(
      "\x1B\x10",
    );
  });

  it("preserves unmodified special keys and adds modifiers to tilde keys", () => {
    expect(encodeMobileTerminalChord(specialKey("arrow-left"), [])).toBe("\x1B[D");
    expect(encodeMobileTerminalChord(specialKey("delete"), ["alt"])).toBe("\x1B[3;3~");
  });

  it("uses the standard Shift+Tab sequence", () => {
    expect(encodeMobileTerminalChord(specialKey("tab"), ["shift"])).toBe("\x1B[Z");
  });

  it("uses modifyOtherKeys when literal keys need other modifiers", () => {
    expect(encodeMobileTerminalChord(specialKey("tab"), ["ctrl"])).toBe(
      "\x1B[27;5;9~",
    );
    expect(encodeMobileTerminalChord(specialKey("escape"), ["shift"])).toBe(
      "\x1B[27;2;27~",
    );
  });

  it("applies Shift to printable punctuation and digits", () => {
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("1"), ["shift"])).toBe("!");
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("["), ["shift"])).toBe("{");
  });

  it("encodes conventional Ctrl digit aliases", () => {
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("2"), ["ctrl"])).toBe(
      "\x00",
    );
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("7"), ["ctrl"])).toBe(
      "\x1F",
    );
  });
});

function specialKey(id: string) {
  const key = MOBILE_TERMINAL_SPECIAL_KEYS.find((candidate) => candidate.id === id);
  if (!key) {
    throw new Error(`missing test special key: ${id}`);
  }
  return key;
}
