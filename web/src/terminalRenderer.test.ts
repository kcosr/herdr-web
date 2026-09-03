import { describe, expect, it, vi } from "vitest";
import { pageScrollLines, refreshTerminalFontRendering } from "./terminalRenderer";

describe("terminal renderer font refresh", () => {
  it("forces the current viewport to redraw when font settings are unchanged", () => {
    const calls: string[] = [];
    const wasmTerm = {};
    const renderer = {
      remeasureFont: vi.fn(() => calls.push("remeasure")),
      render: vi.fn(() => calls.push("render")),
    };
    const terminal = {
      options: {
        fontFamily: "same font",
        fontSize: 14,
      },
      renderer,
      viewportY: 7,
      wasmTerm,
    } as unknown as Parameters<typeof refreshTerminalFontRendering>[0];
    const fit = vi.fn(() => {
      calls.push("fit");
      return { cols: 120, rows: 40 };
    });

    expect(refreshTerminalFontRendering(terminal, "same font", 14, fit)).toEqual({
      cols: 120,
      rows: 40,
    });
    expect(terminal.options.fontFamily).toBe("same font");
    expect(terminal.options.fontSize).toBe(14);
    expect(renderer.render).toHaveBeenCalledWith(wasmTerm, true, 7, terminal, 0);
    expect(calls).toEqual(["remeasure", "fit", "render"]);
  });
});

describe("page scroll keys", () => {
  const key = (init: Partial<KeyboardEvent>) => init as KeyboardEvent;

  it("scrolls up a full viewport on PageUp and down a full viewport on PageDown", () => {
    expect(pageScrollLines(key({ key: "PageUp" }), 24)).toBe(-24);
    expect(pageScrollLines(key({ key: "PageDown" }), 24)).toBe(24);
  });

  it("still scrolls when shift is held", () => {
    expect(pageScrollLines(key({ key: "PageUp", shiftKey: true }), 30)).toBe(-30);
  });

  it("passes modified presses through to the terminal", () => {
    expect(pageScrollLines(key({ key: "PageUp", ctrlKey: true }), 24)).toBeNull();
    expect(pageScrollLines(key({ key: "PageDown", altKey: true }), 24)).toBeNull();
    expect(pageScrollLines(key({ key: "PageDown", metaKey: true }), 24)).toBeNull();
  });

  it("ignores every other key", () => {
    expect(pageScrollLines(key({ key: "Home" }), 24)).toBeNull();
    expect(pageScrollLines(key({ key: "a" }), 24)).toBeNull();
  });
});
