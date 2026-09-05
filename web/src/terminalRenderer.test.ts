import { describe, expect, it, vi } from "vitest";
import {
  handleTerminalCustomKeyEvent,
  refreshTerminalFontRendering,
} from "./terminalRenderer";

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

describe("terminal selection copy shortcuts", () => {
  it("consumes Windows/Linux Ctrl+C when canonical terminal selection text exists", () => {
    const terminal = terminalInput("selected terminal text");

    expect(dispatchCtrlC(keyEvent({ ctrlKey: true }), terminal, "Win32")).toBe(true);
    expect(terminal.getSelection).toHaveBeenCalledOnce();
    expect(terminal.input).not.toHaveBeenCalled();
  });

  it("delegates Windows/Linux Ctrl+C to Ghostty for PTY ^C when selection is empty", () => {
    const terminal = terminalInput("");

    expect(dispatchCtrlC(keyEvent({ ctrlKey: true }), terminal, "Linux x86_64")).toBe(false);
    expect(terminal.input).toHaveBeenCalledOnce();
    expect(terminal.input).toHaveBeenCalledWith("\x03", true);
  });

  it("consumes macOS Cmd+C when canonical terminal selection text exists", () => {
    const terminal = terminalInput("selected terminal text");

    expect(dispatchCtrlC(keyEvent({ metaKey: true }), terminal, "MacIntel")).toBe(true);
    expect(terminal.input).not.toHaveBeenCalled();
  });

  it("delegates macOS Ctrl+C to Ghostty for PTY interrupt even with a selection", () => {
    const terminal = terminalInput("selected terminal text");

    expect(dispatchCtrlC(keyEvent({ ctrlKey: true }), terminal, "MacIntel")).toBe(false);
    expect(terminal.input).toHaveBeenCalledOnce();
    expect(terminal.input).toHaveBeenCalledWith("\x03", true);
  });
});

function keyEvent(overrides: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    code: "KeyC",
    ctrlKey: false,
    isComposing: false,
    key: "c",
    keyCode: 67,
    metaKey: false,
    shiftKey: false,
    stopImmediatePropagation: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

function terminalInput(selection: string) {
  return {
    getSelection: vi.fn(() => selection),
    input: vi.fn(),
  };
}

function dispatchCtrlC(
  event: KeyboardEvent,
  terminal: ReturnType<typeof terminalInput>,
  platform: string,
) {
  const handled = handleTerminalCustomKeyEvent(event, terminal, platform);
  if (!handled) {
    // This is Ghostty's existing default Ctrl+C encoding path.
    terminal.input("\x03", true);
  }
  return handled;
}
