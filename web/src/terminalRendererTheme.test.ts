// @vitest-environment jsdom
/**
 * The light/dark toggle has to reach the terminal too, not just the app chrome: a pane created
 * while light mode is on must come up with the Latte palette instead of staying on Mocha.
 * ghostty-web bakes glyph colors in at construction, so the only place that choice is observable
 * is the options `GhosttyRenderer.mount()` hands to `new Terminal(...)` and the canvas background
 * it paints afterwards. This drives the real `mount()` against a stand-in ghostty-web module and
 * asserts both.
 *
 * Before the theme work the renderer took no theme argument and always passed the hardcoded Mocha
 * palette, so the light-mode expectations here fail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type TerminalOptions = {
  theme: Record<string, string>;
  fontSize: number;
  cursorBlink: boolean;
};

const constructedOptions: TerminalOptions[] = [];
let lastCanvas: HTMLCanvasElement | null = null;

class FakeTerminal {
  options: TerminalOptions;
  cols = 80;
  rows = 24;
  // No textarea: the IME/mobile-input bridges bail out early, keeping this stand-in to the
  // surface `mount()` needs for palette setup.
  textarea = null;
  renderer: { getCanvas: () => HTMLCanvasElement };

  constructor(options: TerminalOptions) {
    this.options = options;
    constructedOptions.push(options);
    lastCanvas = document.createElement("canvas");
    this.renderer = { getCanvas: () => lastCanvas as HTMLCanvasElement };
  }

  loadAddon() {}
  open() {}
  attachCustomKeyEventHandler() {}
  attachCustomWheelEventHandler() {}
  input() {}
  write() {}
  scrollLines() {}
  onScroll() {
    return { dispose() {} };
  }
  buffer = {
    onBufferChange() {
      return { dispose() {} };
    },
  };
}

vi.mock("ghostty-web", () => ({
  init: async () => {},
  Terminal: FakeTerminal,
  FitAddon: class {
    fit() {}
  },
}));

const { GhosttyRenderer } = await import("./terminalRenderer");

async function mountWith(theme: "dark" | "light" | undefined) {
  const container = document.createElement("div");
  document.body.append(container);
  const renderer =
    theme === undefined
      ? new GhosttyRenderer()
      : new GhosttyRenderer(undefined, undefined, theme);
  const size = await renderer.mount(container);
  return { size, options: constructedOptions.at(-1)!, canvas: lastCanvas! };
}

beforeEach(() => {
  constructedOptions.length = 0;
  lastCanvas = null;
  document.body.innerHTML = "";
});

describe("terminal palette follows the app theme", () => {
  it("creates a light-mode pane with the Latte palette and a light canvas", async () => {
    const { options, canvas, size } = await mountWith("light");

    expect(size).toEqual({ cols: 80, rows: 24 });
    expect(options.theme.background).toBe("#eff1f5");
    expect(options.theme.foreground).toBe("#4c4f69");
    expect(options.theme.blue).toBe("#1e66f5");
    expect(canvas.style.getPropertyValue("background-color")).toBe("rgb(239, 241, 245)");
  });

  it("creates a dark-mode pane with the Mocha palette and a dark canvas", async () => {
    const { options, canvas } = await mountWith("dark");

    expect(options.theme.background).toBe("#11111b");
    expect(options.theme.foreground).toBe("#cdd6f4");
    expect(options.theme.blue).toBe("#89b4fa");
    expect(canvas.style.getPropertyValue("background-color")).toBe("rgb(17, 17, 27)");
  });

  it("defaults to the dark palette when no theme is supplied", async () => {
    const { options } = await mountWith(undefined);

    expect(options.theme.background).toBe("#11111b");
  });

  it("gives light and dark panes fully distinct palettes", async () => {
    const { options: light } = await mountWith("light");
    const { options: dark } = await mountWith("dark");

    const shared = Object.keys(light.theme).filter((key) => light.theme[key] === dark.theme[key]);
    expect(shared).toEqual([]);
  });
});
