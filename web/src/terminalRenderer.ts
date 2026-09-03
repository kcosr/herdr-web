import type { FitAddon, Terminal } from "ghostty-web";
import {
  findFirstUrlInSelection,
  terminalSelectionRange,
  terminalUrlTapTarget,
  trimUrlPunctuation,
} from "./terminalSelection";
import type { TerminalSelectionPoint } from "./terminalSelection";
import { terminalEndpointBubblePosition } from "./terminalEndpointBubblePosition";
import { terminalLoupeCursorGeometry } from "./terminalLoupeCursorGeometry";
import { terminalTapFocusAction } from "./terminalTapFocus";
import type { TerminalTapFocusResult } from "./terminalTapFocus";
import {
  terminalAccessibleText,
  TerminalAccessibleTextPublisher,
} from "./terminalAccessibleText";
import {
  beginTouchSelectionEndpointDrag,
  commitTouchSelectionStart,
  completeTouchSelection,
  idleTouchSelectionState,
  moveTouchSelectionEndpoint,
  moveTouchSelectionPlacement,
  startTouchSelectionPlacement,
  terminalTouchSelectionEndpointFromDrag,
} from "./terminalTouchSelection";
import type { TerminalTouchSelectionState } from "./terminalTouchSelection";
import { DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS } from "./mobileTerminalPrefs";
import type {
  MobileLongPressBehavior,
  MobileTouchSelectionEndpointTimeoutMs,
} from "./mobileTerminalPrefs";
import { DEFAULT_TERMINAL_FONT_SIZE_PX } from "./terminalPrefs";
import {
  beforeInputOutput,
  idleTerminalImeState,
  imeTextareaAnchor,
  isImeComposingKeyEvent,
  keyboardEventOutput,
  reduceTerminalImeState,
  shouldDeferBeforeInputToIme,
  textareaDelta,
} from "./terminalImeInput";
import type { TerminalImeState } from "./terminalImeInput";
import { installTerminalImeFocusRedirect } from "./terminalImeFocus";
import type { Theme } from "./theme";

const TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", "JetBrainsMono Nerd Font Mono", monospace';

interface TerminalThemeColors {
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

// Mirrors the app's CSS theme system (styles.css) so a terminal picks up the light/dark choice
// instead of staying fixed to Catppuccin Mocha. ghostty-web bakes glyph colors into the WASM
// terminal at construction and exposes no palette-update API, so the palette is only applied here,
// when a terminal is created.
const TERMINAL_THEME_COLORS: Record<Theme, TerminalThemeColors> = {
  dark: {
    background: "#11111b",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    selectionBackground: "#45475a",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
  light: {
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
  },
};
const TERMINAL_TEXT_INPUT_TAP_GRACE_MS = 4000;
const TOUCH_SELECTION_LONG_PRESS_MS = 600;
const TOUCH_SELECTION_TOLERANCE_PX = 10;
const TOUCH_SELECTION_SCROLL_INTENT_PX = 5;
const TOUCH_SELECTION_CLEAR_DELAY_MS = 1200;
const TOUCH_COMPAT_MOUSE_SUPPRESS_MS = 1200;
const TOUCH_LOUPE_WIDTH_PX = 132;
const TOUCH_LOUPE_HEIGHT_PX = 82;
const TOUCH_LOUPE_SOURCE_WIDTH_PX = 70;
const TOUCH_LOUPE_SOURCE_HEIGHT_PX = 44;
const TOUCH_LOUPE_OFFSET_Y_PX = 132;
const TOUCH_LOUPE_TARGET_OFFSET_Y_PX = 48;
const TOUCH_ENDPOINT_HIT_WIDTH_PX = 72;
const TOUCH_ENDPOINT_HIT_HEIGHT_PX = 72;
const TOUCH_ENDPOINT_RING_DIAMETER_PX = 42;
const TERMINAL_ACCESSIBLE_SCREEN_DEBOUNCE_MS = 160;
const TAP_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>`]+/giu;

type GhosttyModule = typeof import("ghostty-web");

let ghosttyModule: Promise<GhosttyModule> | null = null;

async function loadGhosttyModule() {
  if (!ghosttyModule) {
    ghosttyModule = import("ghostty-web")
      .then(async (module) => {
        await module.init();
        return module;
      })
      .catch((error) => {
        ghosttyModule = null;
        throw error;
      });
  }
  return ghosttyModule;
}

export type TerminalSize = {
  cols: number;
  rows: number;
};
type TerminalCellPosition = {
  col: number;
  row: number;
};
type TerminalSelectionEndpoint = {
  col: number;
  absoluteRow: number;
};
type GhosttySelectionManagerAccess = {
  selectionStart: TerminalSelectionEndpoint | null;
  selectionEnd: TerminalSelectionEndpoint | null;
  getSelectionCoords(): { startRow: number; endRow: number } | null;
  getDirtySelectionRows(): Set<number>;
  requestRender(): void;
  selectionChangedEmitter?: {
    fire?: () => void;
  };
};
type TerminalBufferLine = {
  readonly length: number;
  getCell(x: number):
    | {
        getCodepoint(): number;
        getChars(): string;
        getWidth(): number;
        getHyperlinkId(): number;
        isInvisible(): number;
        // Raw ghostty cell data; grapheme_len > 0 marks a multi-codepoint cluster.
        cell?: { grapheme_len?: number };
      }
    | undefined;
};

export type MobileTerminalTouchEvent =
  | { type: "selection"; text: string }
  | { type: "url"; url: string };

export type TerminalRenderer = {
  mount(container: HTMLElement): Promise<TerminalSize>;
  write(data: string | Uint8Array): void;
  setAccessibleScreenListener(callback: ((text: string) => void) | null): void;
  onInput(callback: (data: string) => void): () => void;
  onScroll(callback: (lines: number) => void): () => void;
  scrollToBottom(): void;
  setTapFocusHandler(callback: (() => TerminalTapFocusResult) | null): void;
  setMobileTouchSelection(
    behavior: MobileLongPressBehavior,
    callback: ((event: MobileTerminalTouchEvent) => void) | null,
    endpointTimeoutMs: MobileTouchSelectionEndpointTimeoutMs,
  ): void;
  fit(): TerminalSize;
  refreshMetrics(): TerminalSize;
  setFontSize(fontSizePx: number): TerminalSize | null;
  focus(): void;
  focusTextInput(): void;
  clearSelection(): void;
  setScrollSensitivity(value: number): void;
  dispose(): void;
};

export class GhosttyRenderer implements TerminalRenderer {
  #terminal: Terminal | null = null;
  #fitAddon: FitAddon | null = null;
  #container: HTMLElement | null = null;
  #scrollSensitivity = 1;
  #scrollCallback: ((lines: number) => void) | null = null;
  #touchCleanup: (() => void) | null = null;
  #mobileInputCleanup: (() => void) | null = null;
  #imeFocusCleanup: (() => void) | null = null;
  #accessibleScreenCallback: ((text: string) => void) | null = null;
  #accessibleScreenCleanup: (() => void) | null = null;
  #accessibleScreenPublisher: TerminalAccessibleTextPublisher | null = null;
  #tapFocusHandler: (() => TerminalTapFocusResult) | null = null;
  #mobileLongPressBehavior: MobileLongPressBehavior = "off";
  #mobileTouchSelectionHandler: ((event: MobileTerminalTouchEvent) => void) | null = null;
  #mobileTouchSelectionEndpointTimeoutMs: MobileTouchSelectionEndpointTimeoutMs =
    DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS;
  #textInputTapGraceUntil = 0;
  #fontSizePx: number;
  #cursorBlink: boolean;
  #theme: Theme;
  #disposed = false;

  constructor(
    fontSizePx = DEFAULT_TERMINAL_FONT_SIZE_PX,
    cursorBlink = true,
    theme: Theme = "dark",
  ) {
    this.#fontSizePx = fontSizePx;
    this.#cursorBlink = cursorBlink;
    this.#theme = theme;
  }

  async mount(container: HTMLElement) {
    const { FitAddon, Terminal } = await loadGhosttyModule();
    if (this.#disposed) {
      throw new Error("terminal renderer disposed");
    }

    this.#container = container;
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: this.#cursorBlink,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: this.#fontSizePx,
      scrollback: 8000,
      smoothScrollDuration: 0,
      theme: TERMINAL_THEME_COLORS[this.#theme],
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.attachCustomKeyEventHandler((event) => {
      if (isImeComposingKeyEvent(event)) {
        return false;
      }
      const output = customKeyboardEventOutput(event);
      if (!output) {
        return false;
      }
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      terminal.input(output, true);
      return true;
    });
    terminal.textarea?.blur();
    container.blur();
    container.removeAttribute("contenteditable");
    terminal.renderer
      ?.getCanvas()
      .style.setProperty("background-color", TERMINAL_THEME_COLORS[this.#theme].background);
    terminal.renderer?.getCanvas().style.setProperty("image-rendering", "auto");
    this.#terminal = terminal;
    this.#fitAddon = fitAddon;
    this.#installAccessibleScreenPublisher();
    this.#installScrollHandlers();
    this.#installMobileInputBridge();
    this.#installImeFocusRedirect();
    return this.fit();
  }

  write(data: string | Uint8Array) {
    const terminal = this.#terminal;
    if (!terminal) {
      return;
    }
    if (!this.#accessibleScreenPublisher) {
      terminal.write(data);
      return;
    }
    terminal.write(data, () => {
      if (this.#isCurrentTerminal(terminal)) {
        this.#accessibleScreenPublisher?.request();
      }
    });
  }

  setAccessibleScreenListener(callback: ((text: string) => void) | null) {
    if (this.#accessibleScreenCallback === callback) {
      return;
    }
    this.#accessibleScreenCallback = callback;
    this.#installAccessibleScreenPublisher();
  }

  onInput(callback: (data: string) => void) {
    const disposable = this.#requireTerminal().onData(callback);
    return () => disposable.dispose();
  }

  onScroll(callback: (lines: number) => void) {
    this.#scrollCallback = callback;
    return () => {
      if (this.#scrollCallback === callback) {
        this.#scrollCallback = null;
      }
    };
  }

  // Local-only viewport reset. Unlike onScroll (which forwards a scroll request to the
  // bridge so the server-owned scrollback can be paged through), everything needed to
  // return to the live tail is already in the local buffer, so no round trip is needed.
  scrollToBottom() {
    this.#terminal?.scrollToBottom();
  }

  setTapFocusHandler(callback: (() => TerminalTapFocusResult) | null) {
    this.#tapFocusHandler = callback;
  }

  setMobileTouchSelection(
    behavior: MobileLongPressBehavior,
    callback: ((event: MobileTerminalTouchEvent) => void) | null,
    endpointTimeoutMs: MobileTouchSelectionEndpointTimeoutMs,
  ) {
    const changed = this.#mobileLongPressBehavior !== behavior;
    this.#mobileLongPressBehavior = behavior;
    this.#mobileTouchSelectionHandler = callback;
    this.#mobileTouchSelectionEndpointTimeoutMs = endpointTimeoutMs;
    if (changed && this.#terminal && this.#container) {
      this.#installTouchHandlers();
    }
  }

  fit() {
    const terminal = this.#requireTerminal();
    this.#fitAddon?.fit();
    this.#accessibleScreenPublisher?.request();
    return {
      cols: terminal.cols,
      rows: terminal.rows,
    };
  }

  refreshMetrics() {
    const terminal = this.#requireTerminal();
    return refreshTerminalFontRendering(
      terminal,
      TERMINAL_FONT_FAMILY,
      this.#fontSizePx,
      () => this.fit(),
    );
  }

  setFontSize(fontSizePx: number) {
    this.#fontSizePx = fontSizePx;
    if (!this.#terminal) {
      return null;
    }
    return this.refreshMetrics();
  }

  focus() {
    this.focusTextInput();
  }

  focusTextInput() {
    const terminal = this.#terminal;
    const textarea = terminal?.textarea;
    if (!textarea || !terminal) {
      this.#terminal?.focus();
      return;
    }
    this.#textInputTapGraceUntil = performance.now() + TERMINAL_TEXT_INPUT_TAP_GRACE_MS;
    positionGhosttyTextareaForInput(textarea, terminal);
    textarea.classList.add("ghostty-keyboard-input");
    textarea.focus({ preventScroll: true });
    window.setTimeout(() => {
      if (textarea.isConnected) {
        positionGhosttyTextareaForInput(textarea, this.#terminal);
        textarea.classList.add("ghostty-keyboard-input");
        if (document.activeElement !== textarea) {
          textarea.focus({ preventScroll: true });
        }
      }
    }, 0);
  }

  clearSelection() {
    this.#terminal?.clearSelection();
  }

  setScrollSensitivity(value: number) {
    this.#scrollSensitivity = value;
  }

  dispose() {
    this.#disposed = true;
    this.#touchCleanup?.();
    this.#touchCleanup = null;
    this.#mobileInputCleanup?.();
    this.#mobileInputCleanup = null;
    this.#imeFocusCleanup?.();
    this.#imeFocusCleanup = null;
    this.#accessibleScreenCallback = null;
    this.#disposeAccessibleScreenPublisher();
    this.#fitAddon?.dispose();
    this.#fitAddon = null;
    this.#terminal?.dispose();
    this.#terminal = null;
    this.#container = null;
  }

  #requireTerminal() {
    if (!this.#terminal) {
      throw new Error("terminal renderer is not mounted");
    }
    return this.#terminal;
  }

  #isCurrentTerminal(terminal: Terminal) {
    return this.#terminal === terminal;
  }

  #installAccessibleScreenPublisher() {
    this.#disposeAccessibleScreenPublisher();
    const terminal = this.#terminal;
    const callback = this.#accessibleScreenCallback;
    if (!terminal || !callback || this.#disposed) {
      return;
    }

    const publisher = new TerminalAccessibleTextPublisher(
      () => {
        if (!this.#isCurrentTerminal(terminal)) {
          return null;
        }
        try {
          return terminalAccessibleScreenText(terminal);
        } catch (error) {
          if (!isGhosttyDisposedError(error)) {
            console.warn("terminal accessible screen snapshot skipped", error);
          }
          return null;
        }
      },
      callback,
      TERMINAL_ACCESSIBLE_SCREEN_DEBOUNCE_MS,
    );
    const scrollDisposable = terminal.onScroll(() => publisher.request());
    const bufferDisposable = terminal.buffer.onBufferChange(() => publisher.request());
    this.#accessibleScreenPublisher = publisher;
    this.#accessibleScreenCleanup = () => {
      scrollDisposable.dispose();
      bufferDisposable.dispose();
    };
    publisher.request(0);
  }

  #disposeAccessibleScreenPublisher() {
    this.#accessibleScreenCleanup?.();
    this.#accessibleScreenCleanup = null;
    this.#accessibleScreenPublisher?.dispose();
    this.#accessibleScreenPublisher = null;
  }

  #hasMouseTracking(terminal: Terminal) {
    if (!this.#isCurrentTerminal(terminal)) {
      return true;
    }
    try {
      return terminal.hasMouseTracking();
    } catch (error) {
      if (isGhosttyDisposedError(error)) {
        return true;
      }
      throw error;
    }
  }

  #installScrollHandlers() {
    const terminal = this.#requireTerminal();

    terminal.attachCustomWheelEventHandler((event) => {
      if (!this.#isCurrentTerminal(terminal) || this.#hasMouseTracking(terminal)) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      const lines = normalizeWheelLines(event, terminal.rows, this.#scrollSensitivity);
      if (lines === 0) {
        return true;
      }
      if (this.#scrollCallback) {
        this.#scrollCallback(lines);
      } else {
        terminal.scrollLines(lines);
      }
      return true;
    });
    this.#installTouchHandlers();
  }

  #installTouchHandlers() {
    const terminal = this.#requireTerminal();
    const container = this.#container;
    if (!container) {
      return;
    }

    this.#touchCleanup?.();

    let lastTouchY: number | null = null;
    let touchStartX: number | null = null;
    let touchStartY: number | null = null;
    let touchMoved = false;
    let touchScrolled = false;
    let pendingTouchLines = 0;
    let suppressMouseUntil = 0;
    let selectionTimer: number | null = null;
    let selectingFromTouch = false;
    let simpleSelectionStart: TerminalCellPosition | null = null;
    let simpleSelectionEnd: TerminalCellPosition | null = null;
    let selectionClearTimer: number | null = null;
    let endpointTimer: number | null = null;
    let loupeRenderFrame: number | null = null;
    let mouseDownX: number | null = null;
    let mouseDownY: number | null = null;
    let selectionState: TerminalTouchSelectionState = idleTouchSelectionState;
    let endpointBubble: HTMLDivElement | null = null;
    let loupe: { root: HTMLDivElement; canvas: HTMLCanvasElement } | null = null;
    let endpointDragStartX: number | null = null;
    let endpointDragStartY: number | null = null;
    let endpointDragMoved = false;

    const suppressMouseEvents = (duration = TOUCH_COMPAT_MOUSE_SUPPRESS_MS) => {
      suppressMouseUntil = performance.now() + duration;
    };
    const clearSelectionTimer = () => {
      if (selectionTimer !== null) {
        window.clearTimeout(selectionTimer);
        selectionTimer = null;
      }
    };
    const clearEndpointTimer = () => {
      if (endpointTimer !== null) {
        window.clearTimeout(endpointTimer);
        endpointTimer = null;
      }
    };
    const clearLoupeRenderFrame = () => {
      if (loupeRenderFrame !== null) {
        window.cancelAnimationFrame(loupeRenderFrame);
        loupeRenderFrame = null;
      }
    };
    const clearSelectionClearTimer = () => {
      if (selectionClearTimer !== null) {
        window.clearTimeout(selectionClearTimer);
        selectionClearTimer = null;
      }
    };
    const stopSimpleTouchSelection = () => {
      clearSelectionTimer();
      selectingFromTouch = false;
      simpleSelectionStart = null;
      simpleSelectionEnd = null;
    };
    const removeEndpointBubble = () => {
      endpointBubble?.remove();
      endpointBubble = null;
    };
    const removeLoupe = () => {
      clearLoupeRenderFrame();
      loupe?.root.remove();
      loupe = null;
    };
    const resetTouchSelection = (clearTerminalSelection = true) => {
      clearSelectionTimer();
      clearEndpointTimer();
      stopSimpleTouchSelection();
      selectionState = idleTouchSelectionState;
      removeEndpointBubble();
      removeLoupe();
      endpointDragStartX = null;
      endpointDragStartY = null;
      endpointDragMoved = false;
      if (clearTerminalSelection) {
        terminal.clearSelection();
      }
    };
    const preventTouchEvent = (event: TouchEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    };
    const positionFromTouch = (touch: Touch) => touchCellPosition(terminal, touch.clientX, touch.clientY);
    const clientFromTouch = (touch: Touch) => ({ clientX: touch.clientX, clientY: touch.clientY });
    const loupePositionFromClient = (clientX: number, clientY: number) =>
      touchCellPosition(terminal, clientX, clientY - TOUCH_LOUPE_TARGET_OFFSET_Y_PX);
    const loupePositionFromTouch = (touch: Touch) =>
      loupePositionFromClient(touch.clientX, touch.clientY);
    const endpointPositionFromDrag = (touch: Touch) => {
      if (
        selectionState.phase !== "dragging-endpoint" ||
        endpointDragStartX === null ||
        endpointDragStartY === null
      ) {
        return selectionState.phase === "idle" ? { col: 0, row: 0 } : selectionState.endpoint;
      }
      const metrics = terminal.renderer?.getMetrics();
      return terminalTouchSelectionEndpointFromDrag(
        selectionState.start,
        { clientX: endpointDragStartX, clientY: endpointDragStartY },
        clientFromTouch(touch),
        {
          cellWidth: metrics?.width ?? 9,
          cellHeight: metrics?.height ?? 16,
          cols: terminal.cols,
          rows: terminal.rows,
        },
      );
    };
    const updateSimpleTouchSelection = (touch: Touch) => {
      if (!simpleSelectionStart) {
        return;
      }
      const current = positionFromTouch(touch);
      const range = terminalSelectionRange(simpleSelectionStart, current, terminal.cols);
      simpleSelectionEnd = current;
      selectTerminalViewportRange(terminal, range.from, range.to);
    };
    const selectCurrentTouchRange = () => {
      if (selectionState.phase === "idle") {
        return;
      }
      const range = terminalSelectionRange(selectionState.start, selectionState.endpoint, terminal.cols);
      selectTerminalViewportRange(terminal, range.from, range.to);
    };
    const cellClientCenter = (point: TerminalCellPosition) => {
      const canvas = terminal.renderer?.getCanvas();
      const rect = (canvas ?? terminal.element)?.getBoundingClientRect();
      const metrics = terminal.renderer?.getMetrics();
      const cellWidth = metrics?.width ?? 9;
      const cellHeight = metrics?.height ?? 16;
      return {
        clientX: (rect?.left ?? 0) + (point.col + 0.5) * cellWidth,
        clientY: (rect?.top ?? 0) + (point.row + 0.5) * cellHeight,
      };
    };
    const positionOverlay = (
      element: HTMLElement,
      clientX: number,
      clientY: number,
      width: number,
      height: number,
      offsetY: number,
    ) => {
      const rect = container.getBoundingClientRect();
      const left = clampInteger(clientX - rect.left - width / 2, 4, Math.max(4, rect.width - width - 4));
      const top = clampInteger(clientY - rect.top - offsetY, 4, Math.max(4, rect.height - height - 4));
      element.style.transform = `translate(${left}px, ${top}px)`;
    };
    const ensureLoupe = () => {
      if (loupe) {
        return loupe;
      }
      const root = document.createElement("div");
      root.className = "terminal-touch-loupe";
      const canvas = document.createElement("canvas");
      canvas.width = TOUCH_LOUPE_WIDTH_PX;
      canvas.height = TOUCH_LOUPE_HEIGHT_PX;
      root.append(canvas);
      container.append(root);
      loupe = { root, canvas };
      return loupe;
    };
    const renderLoupe = (point: TerminalCellPosition, client: { clientX: number; clientY: number }) => {
      const source = terminal.renderer?.getCanvas();
      if (!source) {
        return;
      }
      const current = ensureLoupe();
      positionOverlay(
        current.root,
        client.clientX,
        client.clientY,
        TOUCH_LOUPE_WIDTH_PX,
        TOUCH_LOUPE_HEIGHT_PX,
        TOUCH_LOUPE_OFFSET_Y_PX,
      );
      const rect = source.getBoundingClientRect();
      const metrics = terminal.renderer?.getMetrics();
      const cellWidth = metrics?.width ?? 9;
      const cellHeight = metrics?.height ?? 16;
      const centerX = (point.col + 0.5) * cellWidth;
      const centerY = (point.row + 0.5) * cellHeight;
      const sourceWidth = Math.min(TOUCH_LOUPE_SOURCE_WIDTH_PX, rect.width || TOUCH_LOUPE_SOURCE_WIDTH_PX);
      const sourceHeight = Math.min(TOUCH_LOUPE_SOURCE_HEIGHT_PX, rect.height || TOUCH_LOUPE_SOURCE_HEIGHT_PX);
      const sxCss = clampNumber(centerX - sourceWidth / 2, 0, Math.max(0, rect.width - sourceWidth));
      const syCss = clampNumber(centerY - sourceHeight / 2, 0, Math.max(0, rect.height - sourceHeight));
      const scaleX = rect.width > 0 ? source.width / rect.width : 1;
      const scaleY = rect.height > 0 ? source.height / rect.height : 1;
      const ctx = current.canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.clearRect(0, 0, current.canvas.width, current.canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        source,
        sxCss * scaleX,
        syCss * scaleY,
        sourceWidth * scaleX,
        sourceHeight * scaleY,
        0,
        0,
        TOUCH_LOUPE_WIDTH_PX,
        TOUCH_LOUPE_HEIGHT_PX,
      );
      const cursor = terminalLoupeCursorGeometry({
        col: point.col,
        row: point.row,
        cellWidth,
        cellHeight,
        sourceX: sxCss,
        sourceY: syCss,
        sourceWidth,
        sourceHeight,
        loupeWidth: TOUCH_LOUPE_WIDTH_PX,
        loupeHeight: TOUCH_LOUPE_HEIGHT_PX,
      });
      const markerColor = cssColor(
        container,
        "--terminal-touch-marker",
        cssColor(container, "--accent", "#b4befe"),
      );
      ctx.lineCap = "butt";
      ctx.strokeStyle = "rgba(17, 17, 27, 0.78)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cursor.caretX, cursor.caretTop);
      ctx.lineTo(cursor.caretX, cursor.caretBottom);
      ctx.stroke();
      ctx.strokeStyle = markerColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cursor.caretX, cursor.caretTop);
      ctx.lineTo(cursor.caretX, cursor.caretBottom);
      ctx.stroke();
      ctx.lineCap = "butt";
      ctx.strokeStyle = "rgba(17, 17, 27, 0.85)";
      ctx.lineWidth = 1;
      ctx.strokeRect(1, 1, TOUCH_LOUPE_WIDTH_PX - 2, TOUCH_LOUPE_HEIGHT_PX - 2);
    };
    const renderLoupeAfterTerminalPaint = (
      point: TerminalCellPosition,
      client: { clientX: number; clientY: number },
    ) => {
      clearLoupeRenderFrame();
      loupeRenderFrame = window.requestAnimationFrame(() => {
        loupeRenderFrame = null;
        if (selectionState.phase === "dragging-endpoint") {
          renderLoupe(point, client);
        }
      });
    };
    const ensureEndpointBubble = () => {
      if (endpointBubble) {
        return endpointBubble;
      }
      endpointBubble = document.createElement("div");
      endpointBubble.className = "terminal-touch-endpoint";
      endpointBubble.setAttribute("aria-hidden", "true");
      endpointBubble.setAttribute("data-hint", "Drag");
      endpointBubble.style.setProperty(
        "--terminal-touch-endpoint-ring-diameter",
        `${TOUCH_ENDPOINT_RING_DIAMETER_PX}px`,
      );
      const ring = document.createElement("span");
      ring.className = "terminal-touch-endpoint-ring";
      endpointBubble.append(ring);
      container.append(endpointBubble);
      return endpointBubble;
    };
    const hideEndpointBubble = () => {
      if (endpointBubble) {
        endpointBubble.dataset.dragging = "true";
        endpointBubble.removeAttribute("data-hint");
      }
    };
    const positionEndpointBubble = (client: { clientX: number; clientY: number }) => {
      const bubble = ensureEndpointBubble();
      delete bubble.dataset.dragging;
      bubble.setAttribute("data-hint", "Drag");
      const rect = container.getBoundingClientRect();
      const position = terminalEndpointBubblePosition({
        targetClientX: client.clientX,
        targetClientY: client.clientY,
        containerLeft: rect.left,
        containerTop: rect.top,
        containerWidth: rect.width,
        containerHeight: rect.height,
        bubbleWidth: TOUCH_ENDPOINT_HIT_WIDTH_PX,
        bubbleHeight: TOUCH_ENDPOINT_HIT_HEIGHT_PX,
        ringDiameter: TOUCH_ENDPOINT_RING_DIAMETER_PX,
      });
      bubble.style.setProperty("--terminal-touch-endpoint-ring-left", `${position.ringLeft}px`);
      bubble.style.setProperty("--terminal-touch-endpoint-ring-top", `${position.ringTop}px`);
      bubble.style.transform = `translate(${position.left}px, ${position.top}px)`;
    };
    const startTouchSelection = () => {
      selectionTimer = null;
      if (
        this.#mobileLongPressBehavior === "off" ||
        this.#hasMouseTracking(terminal) ||
        touchStartX === null ||
        touchStartY === null
      ) {
        return;
      }
      const client = { clientX: touchStartX, clientY: touchStartY };
      if (this.#mobileLongPressBehavior === "copy") {
        const position = touchCellPosition(terminal, touchStartX, touchStartY);
        simpleSelectionStart = position;
        simpleSelectionEnd = position;
        selectingFromTouch = true;
        touchMoved = true;
        suppressMouseEvents();
        terminal.textarea?.blur();
        terminal.clearSelection();
        selectTerminalViewportRange(terminal, position, position);
        if (navigator.vibrate) {
          navigator.vibrate(35);
        }
        return;
      }
      const position = loupePositionFromClient(touchStartX, touchStartY);
      selectionState = startTouchSelectionPlacement(position, client);
      touchMoved = true;
      suppressMouseEvents();
      terminal.textarea?.blur();
      terminal.clearSelection();
      selectCurrentTouchRange();
      renderLoupe(position, client);
      if (navigator.vibrate) {
        navigator.vibrate(35);
      }
    };
    const updateStartPlacement = (touch: Touch) => {
      const position = loupePositionFromTouch(touch);
      const client = clientFromTouch(touch);
      selectionState = moveTouchSelectionPlacement(selectionState, position, client);
      selectCurrentTouchRange();
      renderLoupe(position, client);
    };
    const waitForEndpointDrag = () => {
      selectionState = commitTouchSelectionStart(selectionState);
      removeLoupe();
      if (selectionState.phase !== "waiting-endpoint") {
        return;
      }
      selectCurrentTouchRange();
      positionEndpointBubble(cellClientCenter(selectionState.start));
      clearEndpointTimer();
      endpointTimer = window.setTimeout(() => {
        resetTouchSelection(true);
      }, this.#mobileTouchSelectionEndpointTimeoutMs);
    };
    const beginEndpointDrag = (touch: Touch) => {
      clearEndpointTimer();
      if (selectionState.phase !== "waiting-endpoint") {
        return;
      }
      endpointDragStartX = touch.clientX;
      endpointDragStartY = touch.clientY;
      endpointDragMoved = false;
      const client = clientFromTouch(touch);
      selectionState = beginTouchSelectionEndpointDrag(selectionState, client);
      if (selectionState.phase !== "dragging-endpoint") {
        return;
      }
      selectCurrentTouchRange();
      hideEndpointBubble();
      renderLoupe(selectionState.endpoint, client);
      renderLoupeAfterTerminalPaint(selectionState.endpoint, client);
      suppressMouseEvents();
      terminal.textarea?.blur();
    };
    const updateEndpointDrag = (touch: Touch, force = false) => {
      clearLoupeRenderFrame();
      if (endpointDragStartX !== null && endpointDragStartY !== null) {
        const deltaX = touch.clientX - endpointDragStartX;
        const deltaY = touch.clientY - endpointDragStartY;
        if (!endpointDragMoved && Math.hypot(deltaX, deltaY) <= TOUCH_SELECTION_TOLERANCE_PX && !force) {
          return;
        }
        endpointDragMoved = true;
      }
      const position = endpointPositionFromDrag(touch);
      const client = clientFromTouch(touch);
      selectionState = moveTouchSelectionEndpoint(selectionState, position, client);
      selectCurrentTouchRange();
      renderLoupe(position, client);
    };
    const completeEndpointDrag = (event: TouchEvent) => {
      if (event.changedTouches.length > 0 && endpointDragMoved) {
        updateEndpointDrag(event.changedTouches[0], true);
      }
      preventTouchEvent(event);
      suppressMouseEvents();
      const selection = completeTouchSelection(selectionState);
      const selectedText = selection
        ? terminalSelectedTextFromViewportRange(terminal, selection.start, selection.end)
        : "";
      if (selectedText.length > 0 && this.#mobileTouchSelectionHandler) {
        resetTouchSelection(false);
        terminal.textarea?.blur();
        this.#mobileTouchSelectionHandler({ type: "selection", text: selectedText });
      } else {
        resetTouchSelection(true);
        terminal.textarea?.blur();
      }
    };
    const completeSimpleTouchSelection = (event: TouchEvent) => {
      preventTouchEvent(event);
      suppressMouseEvents();
      const selectedText =
        simpleSelectionStart && simpleSelectionEnd
          ? terminalSelectedTextFromViewportRange(terminal, simpleSelectionStart, simpleSelectionEnd)
          : "";
      stopSimpleTouchSelection();
      terminal.textarea?.blur();
      if (selectedText.trim() && this.#mobileTouchSelectionHandler) {
        this.#mobileTouchSelectionHandler({ type: "selection", text: selectedText });
        if (!findFirstUrlInSelection(selectedText.trim())) {
          clearSelectionClearTimer();
          selectionClearTimer = window.setTimeout(() => {
            selectionClearTimer = null;
            terminal.clearSelection();
          }, TOUCH_SELECTION_CLEAR_DELAY_MS);
        }
      }
    };
    const touchLinkText = (event: TouchEvent) => {
      const mouseTracking = this.#hasMouseTracking(terminal);
      if (
        this.#mobileLongPressBehavior === "off" ||
        !this.#mobileTouchSelectionHandler ||
        event.changedTouches.length === 0 ||
        mouseTracking
      ) {
        return null;
      }
      const touch = event.changedTouches[0];
      const position = positionFromTouch(touch);
      return terminalUrlTapTarget(terminalLinkAt(terminal, position), mouseTracking);
    };
    const mouseLinkText = (event: MouseEvent) => {
      const mouseTracking = this.#hasMouseTracking(terminal);
      if (mouseTracking) {
        return null;
      }
      const position = touchCellPosition(terminal, event.clientX, event.clientY);
      return terminalUrlTapTarget(terminalLinkAt(terminal, position), mouseTracking);
    };
    const redirectTapFocus = (event: TouchEvent | MouseEvent) => {
      const terminalHadFocusOrGrace =
        document.activeElement === terminal.textarea ||
        performance.now() < this.#textInputTapGraceUntil;
      const tapFocusResult = this.#tapFocusHandler?.();
      const action = terminalTapFocusAction(tapFocusResult, terminalHadFocusOrGrace);
      if (action === "ignore") {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      if (action === "redirect") {
        terminal.textarea?.blur();
      }
      return true;
    };
    const resetTouchTracking = () => {
      lastTouchY = null;
      touchStartX = null;
      touchStartY = null;
      touchMoved = false;
      touchScrolled = false;
      pendingTouchLines = 0;
    };
    const onTouchStart = (event: TouchEvent) => {
      clearSelectionTimer();
      if (selectionState.phase === "waiting-endpoint") {
        if (
          this.#mobileLongPressBehavior === "loupe" &&
          event.touches.length === 1 &&
          endpointBubble &&
          event.target instanceof Node &&
          endpointBubble.contains(event.target)
        ) {
          preventTouchEvent(event);
          beginEndpointDrag(event.touches[0]);
          return;
        }
        resetTouchSelection(true);
      }
      if (event.touches.length === 1) {
        const mouseTracking = this.#hasMouseTracking(terminal);
        if (this.#mobileLongPressBehavior !== "off" && !mouseTracking) {
          preventTouchEvent(event);
          suppressMouseEvents(TOUCH_SELECTION_LONG_PRESS_MS + TOUCH_COMPAT_MOUSE_SUPPRESS_MS);
        }
        const touch = event.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        lastTouchY = touch.clientY;
        touchMoved = false;
        touchScrolled = false;
        selectingFromTouch = false;
        simpleSelectionStart = null;
        simpleSelectionEnd = null;
        if (this.#mobileLongPressBehavior !== "off" && !mouseTracking) {
          clearSelectionClearTimer();
          selectionTimer = window.setTimeout(startTouchSelection, TOUCH_SELECTION_LONG_PRESS_MS);
        }
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length === 1 && selectionTimer !== null && touchStartX !== null && touchStartY !== null) {
        const touch = event.touches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        const threshold =
          Math.abs(deltaY) > Math.abs(deltaX)
            ? TOUCH_SELECTION_SCROLL_INTENT_PX
            : TOUCH_SELECTION_TOLERANCE_PX;
        if (Math.hypot(deltaX, deltaY) > threshold) {
          clearSelectionTimer();
        }
      }
      if (selectionState.phase === "placing-start" && event.touches.length === 1) {
        updateStartPlacement(event.touches[0]);
        preventTouchEvent(event);
        return;
      }
      if (selectingFromTouch && event.touches.length === 1) {
        updateSimpleTouchSelection(event.touches[0]);
        preventTouchEvent(event);
        return;
      }
      if (selectionState.phase === "dragging-endpoint" && event.touches.length === 1) {
        updateEndpointDrag(event.touches[0]);
        preventTouchEvent(event);
        return;
      }
      if (this.#hasMouseTracking(terminal) || event.touches.length !== 1 || lastTouchY === null) {
        return;
      }
      const currentY = event.touches[0].clientY;
      const deltaY = currentY - lastTouchY;
      lastTouchY = currentY;
      if (touchStartX !== null && touchStartY !== null) {
        const deltaX = event.touches[0].clientX - touchStartX;
        const totalDeltaY = currentY - touchStartY;
        if (Math.hypot(deltaX, totalDeltaY) > TOUCH_SELECTION_TOLERANCE_PX) {
          touchMoved = true;
        }
      }
      const cellHeight = terminal.renderer?.getMetrics().height ?? 16;
      pendingTouchLines += (-deltaY / cellHeight) * this.#scrollSensitivity;
      const lines = pendingTouchLines < 0 ? Math.ceil(pendingTouchLines) : Math.floor(pendingTouchLines);
      if (lines !== 0) {
        if (this.#scrollCallback) {
          this.#scrollCallback(lines);
        } else {
          terminal.scrollLines(lines);
        }
        pendingTouchLines -= lines;
        touchScrolled = true;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      clearSelectionTimer();
      if (this.#hasMouseTracking(terminal)) {
        if (selectionState.phase !== "idle") {
          resetTouchSelection(true);
        }
        stopSimpleTouchSelection();
        resetTouchTracking();
        return;
      }
      if (selectingFromTouch) {
        completeSimpleTouchSelection(event);
        resetTouchTracking();
        return;
      }
      if (selectionState.phase === "placing-start") {
        preventTouchEvent(event);
        suppressMouseEvents();
        waitForEndpointDrag();
        resetTouchTracking();
        return;
      }
      if (selectionState.phase === "dragging-endpoint") {
        completeEndpointDrag(event);
        resetTouchTracking();
        return;
      }
      if (touchMoved || touchScrolled) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        suppressMouseEvents();
        terminal.textarea?.blur();
      } else {
        const linkText = touchLinkText(event);
        if (linkText?.trim()) {
          preventTouchEvent(event);
          suppressMouseEvents();
          terminal.textarea?.blur();
          this.#mobileTouchSelectionHandler?.({ type: "url", url: linkText });
        } else {
          redirectTapFocus(event);
        }
      }
      resetTouchTracking();
    };
    const onTouchCancel = () => {
      clearSelectionTimer();
      if (selectionState.phase !== "idle" || selectingFromTouch) {
        suppressMouseEvents();
      }
      resetTouchSelection(true);
      resetTouchTracking();
      terminal.textarea?.blur();
    };
    const suppressCompatMouseEvent = (event: MouseEvent) => {
      if (performance.now() < suppressMouseUntil) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        return true;
      }
      return false;
    };
    const onMouseDown = (event: MouseEvent) => {
      mouseDownX = event.clientX;
      mouseDownY = event.clientY;
      if (this.#hasMouseTracking(terminal)) {
        return;
      }
      if (suppressCompatMouseEvent(event)) {
        return;
      }
      if (event.button === 0) {
        redirectTapFocus(event);
      }
    };
    const onMouseUp = (event: MouseEvent) => {
      suppressCompatMouseEvent(event);
    };
    const onClick = (event: MouseEvent) => {
      if (suppressCompatMouseEvent(event)) {
        return;
      }
      const moved =
        mouseDownX !== null &&
        mouseDownY !== null &&
        Math.hypot(event.clientX - mouseDownX, event.clientY - mouseDownY) >
          TOUCH_SELECTION_TOLERANCE_PX;
      mouseDownX = null;
      mouseDownY = null;
      if (moved) {
        return;
      }
      const linkText = mouseLinkText(event);
      if (!linkText?.trim()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      terminal.textarea?.blur();
      window.open(linkText, "_blank", "noopener,noreferrer");
    };

    container.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: this.#mobileLongPressBehavior === "off",
    });
    container.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    container.addEventListener("touchend", onTouchEnd, { capture: true });
    container.addEventListener("touchcancel", onTouchCancel, { capture: true });
    container.addEventListener("mousedown", onMouseDown, { capture: true });
    container.addEventListener("mouseup", onMouseUp, { capture: true });
    container.addEventListener("click", onClick, { capture: true });
    this.#touchCleanup = () => {
      resetTouchSelection(true);
      resetTouchTracking();
      clearSelectionClearTimer();
      container.removeEventListener("touchstart", onTouchStart, { capture: true });
      container.removeEventListener("touchmove", onTouchMove, { capture: true });
      container.removeEventListener("touchend", onTouchEnd, { capture: true });
      container.removeEventListener("touchcancel", onTouchCancel, { capture: true });
      container.removeEventListener("mousedown", onMouseDown, { capture: true });
      container.removeEventListener("mouseup", onMouseUp, { capture: true });
      container.removeEventListener("click", onClick, { capture: true });
    };
  }

  #installMobileInputBridge() {
    const terminal = this.#requireTerminal();
    const textarea = terminal.textarea;
    const host = this.#container;
    if (!textarea || !host) {
      return;
    }
    textarea.classList.add("ghostty-hidden-input");
    hideGhosttyTextarea(textarea);
    cleanupEditableArtifacts(host);

    const preeditOverlay = document.createElement("div");
    preeditOverlay.className = "ghostty-ime-preedit";
    preeditOverlay.setAttribute("aria-hidden", "true");
    preeditOverlay.hidden = true;
    host.append(preeditOverlay);

    let lastKeydown: { data: string; time: number } | null = null;
    let processedTextareaValue = "";
    let imeState: TerminalImeState = idleTerminalImeState();

    const sendTerminalText = (output: string) => {
      terminal.input(output, true);
      cleanupEditableArtifacts(host);
    };
    const clearTextareaState = () => {
      textarea.value = "";
      processedTextareaValue = "";
      lastKeydown = null;
    };
    const hidePreedit = () => {
      preeditOverlay.hidden = true;
      preeditOverlay.textContent = "";
    };
    const refreshCompositionUi = () => {
      positionGhosttyTextareaForInput(textarea, terminal);
      if (imeState.phase !== "composing" || !imeState.preedit) {
        hidePreedit();
        return;
      }
      updateImePreeditOverlay(preeditOverlay, imeState.preedit, textarea, terminal);
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (imeState.phase === "composing" || isImeComposingKeyEvent(event)) {
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        return;
      }
      if (imeState.pendingInput !== null) {
        // A real keydown marks the boundary after any trailing composition
        // edit, so cancellation suppression must not consume this new key.
        imeState = reduceTerminalImeState(imeState, { type: "settle" }).state;
      }
      // PageUp/PageDown scroll the scrollback a viewport at a time, matching the
      // 2-finger trackpad rate. Handled here rather than passed to the terminal so
      // it goes through the same scroll path as wheel/touch; when a CLI app has
      // mouse tracking on, the keys pass through to the app untouched. Placed after
      // the composition guards above so it can never intercept an IME keystroke.
      const scrollPageLines = pageScrollLines(event, terminal.rows);
      if (scrollPageLines !== null && !this.#hasMouseTracking(terminal)) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        if (this.#scrollCallback) {
          this.#scrollCallback(scrollPageLines);
        } else {
          terminal.scrollLines(scrollPageLines);
        }
        return;
      }
      const customOutput = textareaKeyboardEventOutput(event);
      if (customOutput) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        clearTextareaState();
        sendTerminalText(customOutput);
        return;
      }
      const output = keyboardEventOutput(event);
      if (output) {
        lastKeydown = { data: output, time: performance.now() };
      }
    };
    const onBeforeInput = (event: InputEvent) => {
      if (shouldDeferBeforeInputToIme(imeState, event)) {
        return;
      }
      const output = beforeInputOutput(event);
      if (!output) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }

      const now = performance.now();
      if (lastKeydown && lastKeydown.data === output && now - lastKeydown.time < 100) {
        clearTextareaState();
        cleanupEditableArtifacts(host);
        return;
      }

      clearTextareaState();
      sendTerminalText(output);
    };
    const sendTextareaDelta = () => {
      const value = textarea.value;
      if (value === processedTextareaValue) {
        return;
      }

      const output = textareaDelta(processedTextareaValue, value);
      processedTextareaValue = value;
      if (output) {
        sendTerminalText(output);
      } else {
        cleanupEditableArtifacts(host);
      }
    };
    const onInput = (event: Event) => {
      const inputEvent = event as InputEvent;
      const transition = reduceTerminalImeState(imeState, {
        type: "input",
        data: inputEvent.data,
        inputType: inputEvent.inputType,
        isComposing: inputEvent.isComposing,
        textareaValue: textarea.value,
      });
      imeState = transition.state;
      if (transition.suppressInput) {
        if (transition.clearTextarea) {
          clearTextareaState();
        }
        refreshCompositionUi();
        cleanupEditableArtifacts(host);
        return;
      }
      sendTextareaDelta();
    };
    const onCompositionStart = (event: CompositionEvent) => {
      imeState = reduceTerminalImeState(imeState, {
        type: "compositionstart",
        data: event.data,
        textareaValue: textarea.value,
      }).state;
      processedTextareaValue = textarea.value;
      lastKeydown = null;
      textarea.classList.add("ghostty-ime-composing");
      refreshCompositionUi();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      cleanupEditableArtifacts(host);
    };
    const onCompositionUpdate = (event: CompositionEvent) => {
      imeState = reduceTerminalImeState(imeState, {
        type: "compositionupdate",
        data: event.data,
        textareaValue: textarea.value,
      }).state;
      refreshCompositionUi();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    };
    const onCompositionEnd = (event: CompositionEvent) => {
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      const transition = reduceTerminalImeState(imeState, {
        type: "compositionend",
        data: event.data,
        textareaValue: textarea.value,
      });
      imeState = transition.state;
      textarea.classList.remove("ghostty-ime-composing");
      hidePreedit();
      if (transition.clearTextarea) {
        clearTextareaState();
      }
      if (transition.output) {
        sendTerminalText(transition.output);
      } else {
        cleanupEditableArtifacts(host);
      }
      if (document.activeElement === textarea) {
        positionGhosttyTextareaForInput(textarea, terminal);
      } else {
        hideGhosttyTextarea(textarea);
      }

      // A browser's trailing input event, when present, is dispatched in the
      // same event task. Do not let a successful commit's one-shot dedupe
      // affect a later key. Cancellation remains armed until the next keydown
      // because browsers may replay canceled preedit after a microtask.
      const endedState = imeState;
      if (
        endedState.phase === "idle" &&
        endedState.pendingInput?.kind === "cancellation"
      ) {
        return;
      }
      queueMicrotask(() => {
        if (imeState === endedState) {
          imeState = reduceTerminalImeState(imeState, { type: "settle" }).state;
        }
      });
    };
    const onFocus = () => {
      textarea.classList.add("ghostty-keyboard-input");
      positionGhosttyTextareaForInput(textarea, terminal);
    };
    const onBlur = () => {
      textarea.classList.remove("ghostty-keyboard-input");
      textarea.classList.remove("ghostty-ime-composing");
      imeState = reduceTerminalImeState(imeState, { type: "reset" }).state;
      clearTextareaState();
      this.#textInputTapGraceUntil = 0;
      hidePreedit();
      hideGhosttyTextarea(textarea);
    };

    textarea.addEventListener("keydown", onKeydown, { capture: true });
    textarea.addEventListener("beforeinput", onBeforeInput, { capture: true });
    textarea.addEventListener("input", onInput);
    textarea.addEventListener("compositionstart", onCompositionStart, { capture: true });
    textarea.addEventListener("compositionupdate", onCompositionUpdate, { capture: true });
    textarea.addEventListener("compositionend", onCompositionEnd, { capture: true });
    textarea.addEventListener("focus", onFocus);
    textarea.addEventListener("blur", onBlur);
    this.#mobileInputCleanup = () => {
      textarea.removeEventListener("keydown", onKeydown, { capture: true });
      textarea.removeEventListener("beforeinput", onBeforeInput, { capture: true });
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("compositionstart", onCompositionStart, { capture: true });
      textarea.removeEventListener("compositionupdate", onCompositionUpdate, { capture: true });
      textarea.removeEventListener("compositionend", onCompositionEnd, { capture: true });
      textarea.removeEventListener("focus", onFocus);
      textarea.removeEventListener("blur", onBlur);
      preeditOverlay.remove();
    };
  }

  #installImeFocusRedirect() {
    const terminal = this.#requireTerminal();
    const container = this.#container;
    const textarea = terminal.textarea;
    if (!container || !textarea) {
      return;
    }

    this.#imeFocusCleanup?.();
    this.#imeFocusCleanup = installTerminalImeFocusRedirect({
      container,
      textarea,
      hasAlternateTapFocus: () => this.#tapFocusHandler !== null,
      focusTextarea: () => this.focusTextInput(),
    });
  }
}

export function refreshTerminalFontRendering(
  terminal: Terminal,
  fontFamily: string,
  fontSizePx: number,
  fit: () => TerminalSize,
) {
  terminal.options.fontFamily = fontFamily;
  terminal.options.fontSize = fontSizePx;
  terminal.renderer?.remeasureFont();
  const size = fit();
  if (terminal.renderer && terminal.wasmTerm) {
    terminal.renderer.render(terminal.wasmTerm, true, terminal.viewportY, terminal, 0);
  }
  return size;
}

function hideGhosttyTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.position = "fixed";
  textarea.style.left = "-10000px";
  textarea.style.top = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  textarea.style.color = "transparent";
  textarea.style.background = "transparent";
  textarea.style.caretColor = "transparent";
  textarea.style.overflow = "hidden";
  textarea.style.fontFamily = "";
  textarea.style.fontSize = "";
  textarea.style.lineHeight = "";
  textarea.style.zIndex = "";
  textarea.style.setProperty("--ghostty-ime-left", "-10000px");
  textarea.style.setProperty("--ghostty-ime-top", "0px");
  textarea.style.setProperty("--ghostty-ime-width", "1px");
  textarea.style.setProperty("--ghostty-ime-height", "1px");
}

function positionGhosttyTextareaForInput(
  textarea: HTMLTextAreaElement,
  terminal: Terminal | null | undefined,
) {
  if (!terminal) {
    hideGhosttyTextarea(textarea);
    return;
  }
  const canvas = terminal.renderer?.getCanvas();
  const host = canvas ?? terminal.element;
  const rect = host?.getBoundingClientRect();
  const metrics = terminal.renderer?.getMetrics();
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    hideGhosttyTextarea(textarea);
    return;
  }

  const cursor = terminal.buffer?.active;
  const anchor = imeTextareaAnchor({
    terminalLeft: rect.left,
    terminalTop: rect.top,
    terminalWidth: rect.width,
    terminalHeight: rect.height,
    browserWidth: window.innerWidth,
    browserHeight: window.innerHeight,
    cellWidth: metrics?.width ?? 9,
    cellHeight: metrics?.height ?? 16,
    cursorCol: cursor?.cursorX ?? 0,
    cursorRow: cursor?.cursorY ?? 0,
    fontSizePx: terminal.options.fontSize ?? DEFAULT_TERMINAL_FONT_SIZE_PX,
  });

  textarea.style.position = "fixed";
  textarea.style.left = `${anchor.left}px`;
  textarea.style.top = `${anchor.top}px`;
  textarea.style.width = `${anchor.width}px`;
  textarea.style.height = `${anchor.height}px`;
  textarea.style.opacity = "0";
  textarea.style.color = "transparent";
  textarea.style.background = "transparent";
  textarea.style.caretColor = "transparent";
  textarea.style.overflow = "hidden";
  textarea.style.fontFamily = TERMINAL_FONT_FAMILY;
  textarea.style.fontSize = `${anchor.fontSizePx}px`;
  textarea.style.lineHeight = `${anchor.height}px`;
  textarea.style.zIndex = "5";
  textarea.style.setProperty("--ghostty-ime-left", `${anchor.left}px`);
  textarea.style.setProperty("--ghostty-ime-top", `${anchor.top}px`);
  textarea.style.setProperty("--ghostty-ime-width", `${anchor.width}px`);
  textarea.style.setProperty("--ghostty-ime-height", `${anchor.height}px`);
}

function updateImePreeditOverlay(
  overlay: HTMLDivElement,
  preedit: string,
  textarea: HTMLTextAreaElement,
  terminal: Terminal,
) {
  if (!preedit) {
    overlay.hidden = true;
    overlay.textContent = "";
    return;
  }

  const canvas = terminal.renderer?.getCanvas();
  const terminalRect = (canvas ?? terminal.element)?.getBoundingClientRect();
  const fontSize = terminal.options.fontSize ?? DEFAULT_TERMINAL_FONT_SIZE_PX;
  const lineHeight = textarea.style.height || `${Math.ceil(fontSize * 1.2)}px`;
  const anchorLeft = Number.parseFloat(textarea.style.left) || 1;
  const anchorTop = Number.parseFloat(textarea.style.top) || 1;
  const visibleLeft = Math.max(4, terminalRect?.left ?? 4);
  const visibleRight = Math.min(window.innerWidth - 4, terminalRect?.right ?? window.innerWidth - 4);
  const maxWidth = Math.max(1, Math.min(576, visibleRight - visibleLeft));

  overlay.hidden = false;
  overlay.textContent = preedit;
  overlay.style.left = `${anchorLeft}px`;
  overlay.style.top = `${anchorTop}px`;
  overlay.style.maxWidth = `${maxWidth}px`;
  overlay.style.fontFamily = TERMINAL_FONT_FAMILY;
  overlay.style.fontSize = `${fontSize}px`;
  overlay.style.lineHeight = lineHeight;
  overlay.style.minHeight = lineHeight;

  const overlayRect = overlay.getBoundingClientRect();
  const maxLeft = Math.max(visibleLeft, visibleRight - overlayRect.width);
  overlay.style.left = `${clampNumber(anchorLeft, visibleLeft, maxLeft)}px`;
}

function isGhosttyDisposedError(error: unknown) {
  return error instanceof Error && error.message === "Terminal has been disposed";
}

function cleanupEditableArtifacts(container: HTMLElement | null) {
  if (!container) {
    return;
  }
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      node.remove();
    }
  }
}

// PageUp/PageDown map to a full viewport of scrollback; every other key returns null
// so the caller leaves it alone. Modified presses (ctrl/alt/meta) pass through to the
// terminal, where apps bind them to their own actions.
export function pageScrollLines(event: KeyboardEvent, rows: number): number | null {
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return null;
  }
  if (event.key === "PageUp") {
    return -rows;
  }
  if (event.key === "PageDown") {
    return rows;
  }
  return null;
}

function customKeyboardEventOutput(event: KeyboardEvent) {
  if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
    return "\x1B[Z";
  }
  return null;
}

function textareaKeyboardEventOutput(event: KeyboardEvent) {
  if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) {
    return customKeyboardEventOutput(event);
  }
  return event.shiftKey ? "\x1B[Z" : "\t";
}

function touchCellPosition(terminal: Terminal, clientX: number, clientY: number): TerminalCellPosition {
  const canvas = terminal.renderer?.getCanvas();
  const rect = (canvas ?? terminal.element)?.getBoundingClientRect();
  const metrics = terminal.renderer?.getMetrics();
  const cellWidth = metrics?.width ?? 9;
  const cellHeight = metrics?.height ?? 16;
  const relativeX = rect ? clientX - rect.left : clientX;
  const relativeY = rect ? clientY - rect.top : clientY;
  return {
    col: clampInteger(Math.floor(relativeX / cellWidth), 0, terminal.cols - 1),
    row: clampInteger(Math.floor(relativeY / cellHeight), 0, terminal.rows - 1),
  };
}

function terminalBufferRow(terminal: Terminal, viewportRow: number) {
  const scrollbackLength = terminal.getScrollbackLength();
  const viewportY = Math.max(0, Math.floor(terminal.getViewportY()));
  return scrollbackLength + viewportRow - viewportY;
}

function terminalAccessibleScreenText(terminal: Terminal) {
  return terminalAccessibleText({
    rows: terminal.rows,
    cols: terminal.cols,
    buffer: terminal.buffer,
    getViewportY: () => terminal.getViewportY(),
    readGrapheme: (bufferType, row, column) => {
      const wasmTerm = terminal.wasmTerm;
      if (!wasmTerm) {
        return null;
      }
      if (bufferType === "alternate") {
        return typeof wasmTerm.getGraphemeString === "function"
          ? wasmTerm.getGraphemeString(row, column)
          : null;
      }
      const scrollbackLength = terminal.getScrollbackLength();
      if (row < scrollbackLength) {
        return typeof wasmTerm.getScrollbackGraphemeString === "function"
          ? wasmTerm.getScrollbackGraphemeString(row, column)
          : null;
      }
      return typeof wasmTerm.getGraphemeString === "function"
        ? wasmTerm.getGraphemeString(row - scrollbackLength, column)
        : null;
    },
  });
}

function selectTerminalViewportRange(
  terminal: Terminal,
  start: TerminalSelectionPoint,
  end: TerminalSelectionPoint,
) {
  const selectionManager = terminalSelectionManager(terminal);
  if (!selectionManager) {
    const range = terminalSelectionRange(start, end, terminal.cols);
    terminal.select(range.from.col, range.from.row, range.length);
    return;
  }

  markSelectionRowsDirty(selectionManager, selectionManager.getSelectionCoords());
  selectionManager.selectionStart = {
    col: start.col,
    absoluteRow: terminalBufferRow(terminal, start.row),
  };
  selectionManager.selectionEnd = {
    col: end.col,
    absoluteRow: terminalBufferRow(terminal, end.row),
  };
  markSelectionRowsDirty(selectionManager, selectionManager.getSelectionCoords());
  selectionManager.requestRender();
  selectionManager.selectionChangedEmitter?.fire?.();
}

function terminalSelectionManager(terminal: Terminal) {
  const selectionManager = (terminal as unknown as { selectionManager?: unknown }).selectionManager;
  if (!isGhosttySelectionManager(selectionManager)) {
    return null;
  }
  return selectionManager;
}

function isGhosttySelectionManager(value: unknown): value is GhosttySelectionManagerAccess {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<GhosttySelectionManagerAccess>;
  return (
    typeof candidate.getSelectionCoords === "function" &&
    typeof candidate.getDirtySelectionRows === "function" &&
    typeof candidate.requestRender === "function"
  );
}

function markSelectionRowsDirty(
  selectionManager: GhosttySelectionManagerAccess,
  selection: { startRow: number; endRow: number } | null,
) {
  if (!selection) {
    return;
  }
  const dirtyRows = selectionManager.getDirtySelectionRows();
  if (!(dirtyRows instanceof Set)) {
    return;
  }
  for (let row = selection.startRow; row <= selection.endRow; row += 1) {
    dirtyRows.add(row);
  }
}

function terminalSelectedTextFromViewportRange(
  terminal: Terminal,
  start: TerminalSelectionPoint,
  end: TerminalSelectionPoint,
) {
  const range = terminalSelectionRange(start, end, terminal.cols);

  const selectedLines: string[] = [];
  for (let row = range.from.row; row <= range.to.row; row += 1) {
    const bufferRow = terminalBufferRow(terminal, row);
    const line = terminal.buffer.active.getLine(bufferRow) as TerminalBufferLine | undefined;
    const startCol = row === range.from.row ? range.from.col : 0;
    const endCol = row === range.to.row ? range.to.col : terminal.cols - 1;
    selectedLines.push(
      line
        ? terminalBufferLineCellText(
            line,
            startCol,
            endCol,
            terminalGraphemeReader(terminal, bufferRow),
          ).trimEnd()
        : "",
    );
  }
  return selectedLines.join("\n");
}

// Cells holding multi-codepoint grapheme clusters (combining marks, emoji with
// modifiers/ZWJ) store only the first codepoint; the full cluster has to be
// read back through the wasm terminal, mirroring the vendored getSelection().
function terminalGraphemeReader(terminal: Terminal, bufferRow: number) {
  const wasmTerm = terminal.wasmTerm;
  if (
    typeof wasmTerm?.getGraphemeString !== "function" ||
    typeof wasmTerm.getScrollbackGraphemeString !== "function"
  ) {
    return null;
  }
  const scrollbackLength = terminal.getScrollbackLength();
  return (col: number) =>
    bufferRow < scrollbackLength
      ? wasmTerm.getScrollbackGraphemeString(bufferRow, col)
      : wasmTerm.getGraphemeString(bufferRow - scrollbackLength, col);
}

function terminalBufferLineCellText(
  line: TerminalBufferLine,
  startCol: number,
  endCol: number,
  readGrapheme: ((col: number) => string) | null = null,
) {
  let text = "";
  for (let col = startCol; col <= endCol && col < line.length; col += 1) {
    const cell = line.getCell(col);
    const codepoint = cell?.getCodepoint() ?? 0;
    if (codepoint === 0 && cell?.getWidth() === 0) {
      continue;
    }
    if (codepoint === 0 || codepoint < 32) {
      text += " ";
      continue;
    }
    const graphemeLength = cell?.cell?.grapheme_len ?? 0;
    const cluster = graphemeLength > 0 ? readGrapheme?.(col) : null;
    text += cluster || String.fromCodePoint(codepoint);
  }
  return text;
}

function terminalLinkAt(terminal: Terminal, position: TerminalCellPosition) {
  const row = terminalBufferRow(terminal, position.row);
  const line = terminal.buffer.active.getLine(row) as TerminalBufferLine | undefined;
  if (!line || position.col < 0 || position.col >= line.length) {
    return null;
  }

  const cell = line.getCell(position.col);
  const hyperlinkId = cell?.getHyperlinkId() ?? 0;
  if (hyperlinkId > 0) {
    return terminal.wasmTerm?.getHyperlinkUri(hyperlinkId) ?? null;
  }

  const { text, columns } = terminalBufferLineText(line);
  TAP_URL_PATTERN.lastIndex = 0;
  let match = TAP_URL_PATTERN.exec(text);
  while (match) {
    const rawUrl = match[0];
    const url = trimUrlPunctuation(rawUrl);
    const start = columns[match.index];
    const end = columns[match.index + url.length - 1];
    if (url.length > 8 && position.col >= start && position.col <= end) {
      return url;
    }
    match = TAP_URL_PATTERN.exec(text);
  }
  return null;
}

function terminalBufferLineText(line: TerminalBufferLine) {
  let text = "";
  const columns: number[] = [];
  for (let col = 0; col < line.length; col += 1) {
    const cell = line.getCell(col);
    const codepoint = cell?.getCodepoint() ?? 0;
    if (codepoint === 0 && cell?.getWidth() === 0) {
      continue;
    }
    const char = codepoint === 0 || codepoint < 32 ? " " : String.fromCodePoint(codepoint);
    text += char;
    for (let index = 0; index < char.length; index += 1) {
      columns.push(col);
    }
  }
  return { text, columns };
}

function clampInteger(value: number, min: number, max: number) {
  return Math.round(clampNumber(value, min, max));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function cssColor(element: Element, property: string, fallback: string) {
  const value = getComputedStyle(element).getPropertyValue(property).trim();
  return value || fallback;
}

function normalizeWheelLines(event: WheelEvent, rows: number, sensitivity: number) {
  const unit =
    event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? rows
      : event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 1
        : 1 / 16;
  const rawLines = event.deltaY * unit * sensitivity;
  if (Math.abs(rawLines) < 1) {
    return rawLines < 0 ? -1 : rawLines > 0 ? 1 : 0;
  }
  return rawLines < 0 ? Math.ceil(rawLines) : Math.floor(rawLines);
}
