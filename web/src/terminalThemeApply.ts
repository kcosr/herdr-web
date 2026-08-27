export interface TerminalThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

interface ThemeCanvasLike {
  style: { setProperty: (property: string, value: string) => void };
}

// Method syntax (not property-with-function-type) keeps parameter checking bivariant, so
// ghostty-web's concrete `CanvasRenderer` satisfies this shape without importing its
// non-exported `IScrollbackProvider` type.
export interface TerminalThemeRendererLike {
  setTheme?(colors: TerminalThemeColors): void;
  getCanvas?(): ThemeCanvasLike | null | undefined;
  render?(
    buffer: unknown,
    forceAll?: boolean,
    viewportY?: number,
    scrollbackProvider?: unknown,
  ): void;
}

export interface TerminalThemeTarget {
  renderer?: TerminalThemeRendererLike;
  wasmTerm?: unknown;
  viewportY?: number;
}

/**
 * Recolor an open terminal in place via `CanvasRenderer.setTheme`, which swaps the palette but
 * does not repaint, so a forced full render follows. Assigning `terminal.options.theme` is not a
 * substitute: ghostty-web's options Proxy routes `"theme"` to a case that only warns once the
 * terminal is open.
 *
 * Returns true when the live recolor path ran, so callers can fall back for renderers that predate
 * `setTheme` or for a terminal that has not been opened yet.
 */
export function applyTerminalTheme(
  terminal: TerminalThemeTarget | null | undefined,
  colors: TerminalThemeColors,
): boolean {
  const renderer = terminal?.renderer;
  if (!terminal || !renderer || typeof renderer.setTheme !== "function") {
    return false;
  }

  renderer.setTheme(colors);

  const canvas = typeof renderer.getCanvas === "function" ? renderer.getCanvas() : null;
  canvas?.style.setProperty("background-color", colors.background);

  if (typeof renderer.render === "function" && terminal.wasmTerm) {
    renderer.render(terminal.wasmTerm, true, terminal.viewportY ?? 0, terminal);
  }

  return true;
}
