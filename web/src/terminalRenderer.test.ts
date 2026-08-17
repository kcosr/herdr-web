import { describe, expect, it } from "vitest";
import { terminalCursorBlinkEnabled } from "./terminalRenderer";

describe("terminalCursorBlinkEnabled", () => {
  it("keeps the desktop cursor blinking", () => {
    expect(terminalCursorBlinkEnabled(false, false)).toBe(true);
  });

  it("uses a static cursor when mobile controls are active", () => {
    expect(terminalCursorBlinkEnabled(true, true)).toBe(false);
  });

  it("uses a static cursor for unselected split panes on touch devices", () => {
    expect(terminalCursorBlinkEnabled(false, true)).toBe(false);
  });
});
