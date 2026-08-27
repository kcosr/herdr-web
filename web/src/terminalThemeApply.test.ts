import { describe, expect, it, vi } from "vitest";
import { applyTerminalTheme } from "./terminalThemeApply";
import type { TerminalThemeColors, TerminalThemeRendererLike } from "./terminalThemeApply";

const LIGHT: TerminalThemeColors = {
  background: "#eff1f5",
  foreground: "#4c4f69",
  cursor: "#dc8a78",
  selectionBackground: "#bcc0cc",
  black: "#bcc0cc",
  red: "#d20f39",
  green: "#40a02b",
  yellow: "#df8e1d",
  blue: "#1e66f5",
  magenta: "#ea76cb",
  cyan: "#179299",
  white: "#5c5f77",
  brightBlack: "#acb0be",
  brightRed: "#d20f39",
  brightGreen: "#40a02b",
  brightYellow: "#df8e1d",
  brightBlue: "#1e66f5",
  brightMagenta: "#ea76cb",
  brightCyan: "#179299",
  brightWhite: "#6c6f85",
};

const WASM_TERM = { id: "wasm" };

interface FakeOptions {
  hasSetTheme?: boolean;
  hasRender?: boolean;
  trace?: string[];
}

function fakeRenderer({ hasSetTheme = true, hasRender = true, trace }: FakeOptions = {}) {
  const setProperty = vi.fn();
  const canvas = { style: { setProperty } };
  const setTheme = vi.fn(() => trace?.push("setTheme"));
  const render = vi.fn(() => trace?.push("render"));
  const renderer: TerminalThemeRendererLike = {
    getCanvas: () => canvas,
    ...(hasSetTheme ? { setTheme } : {}),
    ...(hasRender ? { render } : {}),
  };
  return { renderer, setTheme, render, setProperty };
}

describe("applyTerminalTheme", () => {
  it("swaps the palette through the renderer, not the options proxy", () => {
    const { renderer, setTheme } = fakeRenderer();

    expect(applyTerminalTheme({ renderer, wasmTerm: WASM_TERM, viewportY: 7 }, LIGHT)).toBe(true);
    expect(setTheme).toHaveBeenCalledWith(LIGHT);
  });

  it("forces a full repaint so the swapped palette is visible without a remount", () => {
    const { renderer, render } = fakeRenderer();
    const terminal = { renderer, wasmTerm: WASM_TERM, viewportY: 7 };

    applyTerminalTheme(terminal, LIGHT);

    expect(render).toHaveBeenCalledWith(WASM_TERM, true, 7, terminal);
  });

  it("repaints after setting the palette, never before", () => {
    const trace: string[] = [];
    const { renderer } = fakeRenderer({ trace });

    applyTerminalTheme({ renderer, wasmTerm: WASM_TERM }, LIGHT);

    expect(trace).toEqual(["setTheme", "render"]);
  });

  it("updates the canvas background color", () => {
    const { renderer, setProperty } = fakeRenderer();

    applyTerminalTheme({ renderer, wasmTerm: WASM_TERM }, LIGHT);

    expect(setProperty).toHaveBeenCalledWith("background-color", LIGHT.background);
  });

  it("reports no live recolor when the renderer predates setTheme", () => {
    const { renderer, render, setProperty } = fakeRenderer({ hasSetTheme: false });

    expect(applyTerminalTheme({ renderer, wasmTerm: WASM_TERM }, LIGHT)).toBe(false);
    expect(render).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
  });

  it("reports no live recolor before the terminal is opened", () => {
    expect(applyTerminalTheme({}, LIGHT)).toBe(false);
    expect(applyTerminalTheme(null, LIGHT)).toBe(false);
    expect(applyTerminalTheme(undefined, LIGHT)).toBe(false);
  });

  it("still recolors when the renderer exposes no render hook", () => {
    const { renderer, setTheme, setProperty } = fakeRenderer({ hasRender: false });

    expect(applyTerminalTheme({ renderer, wasmTerm: WASM_TERM }, LIGHT)).toBe(true);
    expect(setTheme).toHaveBeenCalledWith(LIGHT);
    expect(setProperty).toHaveBeenCalledWith("background-color", LIGHT.background);
  });

  it("skips the repaint when there is no wasm terminal to render", () => {
    const { renderer, render } = fakeRenderer();

    expect(applyTerminalTheme({ renderer }, LIGHT)).toBe(true);
    expect(render).not.toHaveBeenCalled();
  });

  it("defaults viewportY to 0 when the terminal does not report one", () => {
    const { renderer, render } = fakeRenderer();

    applyTerminalTheme({ renderer, wasmTerm: WASM_TERM }, LIGHT);

    expect(render).toHaveBeenCalledWith(WASM_TERM, true, 0, expect.anything());
  });
});
