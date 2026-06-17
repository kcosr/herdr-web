import { FitAddon, init, Terminal } from "ghostty-web";
import { selectedTextFromVisibleRows, terminalSelectionRange } from "./terminalSelection";
import type { TerminalSelectionPoint } from "./terminalSelection";
import { terminalTapFocusAction } from "./terminalTapFocus";
import type { TerminalTapFocusResult } from "./terminalTapFocus";

const TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';
const TERMINAL_TEXT_INPUT_TAP_GRACE_MS = 4000;
const TOUCH_SELECTION_LONG_PRESS_MS = 600;
const TOUCH_SELECTION_TOLERANCE_PX = 10;
const TOUCH_SELECTION_SCROLL_INTENT_PX = 5;
const TOUCH_SELECTION_CLEAR_DELAY_MS = 1200;
const TOUCH_COMPAT_MOUSE_SUPPRESS_MS = 1200;
const TAP_URL_PATTERN =
  /(?:https?:\/\/|mailto:|ftp:\/\/|ssh:\/\/|git:\/\/|tel:|magnet:|gemini:\/\/|gopher:\/\/|news:)[\w\-.~:/?#@!$&*+,;=%]+/giu;
const TAP_URL_TRAILING_PUNCTUATION = /[.,;!?)\]]+$/u;

const ghosttyReady = init();

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
        getWidth(): number;
        getHyperlinkId(): number;
      }
    | undefined;
};

export type TerminalRenderer = {
  mount(container: HTMLElement): Promise<TerminalSize>;
  write(data: string | Uint8Array): void;
  onInput(callback: (data: string) => void): () => void;
  onScroll(callback: (lines: number) => void): () => void;
  setTapFocusHandler(callback: (() => TerminalTapFocusResult) | null): void;
  setMobileTouchSelection(enabled: boolean, callback: ((text: string) => void) | null): void;
  fit(): TerminalSize;
  refreshMetrics(): TerminalSize;
  focus(): void;
  focusTextInput(): void;
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
  #tapFocusHandler: (() => TerminalTapFocusResult) | null = null;
  #mobileTouchSelectionEnabled = false;
  #mobileTouchSelectionHandler: ((text: string) => void) | null = null;
  #textInputTapGraceUntil = 0;

  async mount(container: HTMLElement) {
    await ghosttyReady;

    this.#container = container;
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      scrollback: 8000,
      smoothScrollDuration: 0,
      theme: {
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
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.attachCustomKeyEventHandler((event) => {
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
    terminal.renderer?.getCanvas().style.setProperty("background-color", "#11111b");
    terminal.renderer?.getCanvas().style.setProperty("image-rendering", "auto");
    this.#terminal = terminal;
    this.#fitAddon = fitAddon;
    this.#installScrollHandlers();
    this.#installMobileInputBridge();
    return this.fit();
  }

  write(data: string | Uint8Array) {
    this.#terminal?.write(data);
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

  setTapFocusHandler(callback: (() => TerminalTapFocusResult) | null) {
    this.#tapFocusHandler = callback;
  }

  setMobileTouchSelection(enabled: boolean, callback: ((text: string) => void) | null) {
    const changed = this.#mobileTouchSelectionEnabled !== enabled;
    this.#mobileTouchSelectionEnabled = enabled;
    this.#mobileTouchSelectionHandler = callback;
    if (changed && this.#terminal && this.#container) {
      this.#installTouchHandlers();
    }
  }

  fit() {
    const terminal = this.#requireTerminal();
    this.#fitAddon?.fit();
    return {
      cols: terminal.cols,
      rows: terminal.rows,
    };
  }

  refreshMetrics() {
    const terminal = this.#requireTerminal();
    terminal.options.fontFamily = TERMINAL_FONT_FAMILY;
    terminal.renderer?.remeasureFont();
    return this.fit();
  }

  focus() {
    this.#terminal?.focus();
  }

  focusTextInput() {
    const textarea = this.#terminal?.textarea;
    if (!textarea) {
      this.#terminal?.focus();
      return;
    }
    this.#textInputTapGraceUntil = performance.now() + TERMINAL_TEXT_INPUT_TAP_GRACE_MS;
    textarea.classList.add("ghostty-keyboard-input");
    textarea.focus({ preventScroll: true });
    window.setTimeout(() => {
      if (textarea.isConnected) {
        textarea.classList.add("ghostty-keyboard-input");
        textarea.focus({ preventScroll: true });
      }
    }, 0);
  }

  setScrollSensitivity(value: number) {
    this.#scrollSensitivity = value;
  }

  dispose() {
    this.#touchCleanup?.();
    this.#touchCleanup = null;
    this.#mobileInputCleanup?.();
    this.#mobileInputCleanup = null;
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

  #installScrollHandlers() {
    const terminal = this.#requireTerminal();

    terminal.attachCustomWheelEventHandler((event) => {
      if (terminal.hasMouseTracking()) {
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
    let selectionStart: TerminalCellPosition | null = null;
    let selectionEnd: TerminalCellPosition | null = null;
    let selectionClearTimer: number | null = null;
    const suppressMouseEvents = (duration = TOUCH_COMPAT_MOUSE_SUPPRESS_MS) => {
      suppressMouseUntil = performance.now() + duration;
    };
    const clearSelectionTimer = () => {
      if (selectionTimer !== null) {
        window.clearTimeout(selectionTimer);
        selectionTimer = null;
      }
    };
    const clearSelectionClearTimer = () => {
      if (selectionClearTimer !== null) {
        window.clearTimeout(selectionClearTimer);
        selectionClearTimer = null;
      }
    };
    const stopTouchSelection = () => {
      clearSelectionTimer();
      selectingFromTouch = false;
      selectionStart = null;
      selectionEnd = null;
    };
    const preventTouchEvent = (event: TouchEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    };
    const positionFromTouch = (touch: Touch) => touchCellPosition(terminal, touch.clientX, touch.clientY);
    const updateTouchSelection = (touch: Touch) => {
      if (!selectionStart) {
        return;
      }
      const current = positionFromTouch(touch);
      const range = terminalSelectionRange(selectionStart, current, terminal.cols);
      selectionEnd = current;
      selectTerminalViewportRange(terminal, range.from, range.to);
    };
    const startTouchSelection = () => {
      selectionTimer = null;
      if (
        !this.#mobileTouchSelectionEnabled ||
        terminal.hasMouseTracking() ||
        touchStartX === null ||
        touchStartY === null
      ) {
        return;
      }
      const position = touchCellPosition(terminal, touchStartX, touchStartY);
      selectionStart = position;
      selectionEnd = position;
      selectingFromTouch = true;
      touchMoved = true;
      suppressMouseEvents();
      terminal.textarea?.blur();
      terminal.clearSelection();
      selectTerminalViewportRange(terminal, position, position);
      if (navigator.vibrate) {
        navigator.vibrate(35);
      }
    };
    const completeTouchSelection = (event: TouchEvent) => {
      preventTouchEvent(event);
      suppressMouseEvents();
      const selectedText =
        selectionStart && selectionEnd
          ? terminalSelectedTextFromViewportRange(terminal, selectionStart, selectionEnd)
          : "";
      stopTouchSelection();
      terminal.textarea?.blur();
      if (selectedText.trim()) {
        this.#mobileTouchSelectionHandler?.(selectedText);
        clearSelectionClearTimer();
        selectionClearTimer = window.setTimeout(() => {
          selectionClearTimer = null;
          terminal.clearSelection();
        }, TOUCH_SELECTION_CLEAR_DELAY_MS);
      }
    };
    const touchLinkText = (event: TouchEvent) => {
      if (
        !this.#mobileTouchSelectionEnabled ||
        !this.#mobileTouchSelectionHandler ||
        event.changedTouches.length === 0
      ) {
        return null;
      }
      if (terminal.hasMouseTracking()) {
        return null;
      }
      const touch = event.changedTouches[0];
      const position = positionFromTouch(touch);
      return terminalLinkAt(terminal, position);
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
    const onTouchStart = (event: TouchEvent) => {
      clearSelectionTimer();
      if (event.touches.length === 1) {
        const mouseTracking = terminal.hasMouseTracking();
        if (this.#mobileTouchSelectionEnabled && !mouseTracking) {
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
        selectionStart = null;
        selectionEnd = null;
        if (this.#mobileTouchSelectionEnabled && !mouseTracking) {
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
      if (selectingFromTouch && event.touches.length === 1) {
        updateTouchSelection(event.touches[0]);
        preventTouchEvent(event);
        return;
      }
      if (terminal.hasMouseTracking() || event.touches.length !== 1 || lastTouchY === null) {
        return;
      }
      const currentY = event.touches[0].clientY;
      const deltaY = currentY - lastTouchY;
      lastTouchY = currentY;
      if (touchStartX !== null && touchStartY !== null) {
        const deltaX = event.touches[0].clientX - touchStartX;
        const totalDeltaY = currentY - touchStartY;
        if (Math.hypot(deltaX, totalDeltaY) > 2) {
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
      if (terminal.hasMouseTracking()) {
        lastTouchY = null;
        touchStartX = null;
        touchStartY = null;
        touchMoved = false;
        touchScrolled = false;
        pendingTouchLines = 0;
        return;
      }
      if (selectingFromTouch) {
        completeTouchSelection(event);
        lastTouchY = null;
        touchStartX = null;
        touchStartY = null;
        touchMoved = false;
        touchScrolled = false;
        pendingTouchLines = 0;
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
          this.#mobileTouchSelectionHandler?.(linkText);
        } else {
          redirectTapFocus(event);
        }
      }
      lastTouchY = null;
      touchStartX = null;
      touchStartY = null;
      touchMoved = false;
      touchScrolled = false;
      pendingTouchLines = 0;
    };
    const onTouchCancel = () => {
      clearSelectionTimer();
      if (selectingFromTouch) {
        terminal.clearSelection();
        suppressMouseEvents();
      }
      stopTouchSelection();
      lastTouchY = null;
      touchStartX = null;
      touchStartY = null;
      touchMoved = false;
      touchScrolled = false;
      pendingTouchLines = 0;
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
      if (terminal.hasMouseTracking()) {
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
      suppressCompatMouseEvent(event);
    };

    container.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: !this.#mobileTouchSelectionEnabled,
    });
    container.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    container.addEventListener("touchend", onTouchEnd, { capture: true });
    container.addEventListener("touchcancel", onTouchCancel, { capture: true });
    container.addEventListener("mousedown", onMouseDown, { capture: true });
    container.addEventListener("mouseup", onMouseUp, { capture: true });
    container.addEventListener("click", onClick, { capture: true });
    this.#touchCleanup = () => {
      clearSelectionTimer();
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
    if (!textarea) {
      return;
    }
    textarea.classList.add("ghostty-hidden-input");
    hideGhosttyTextarea(textarea);
    cleanupEditableArtifacts(this.#container);

    let lastKeydown: { data: string; time: number } | null = null;
    let processedTextareaValue = "";
    const onKeydown = (event: KeyboardEvent) => {
      const customOutput = textareaKeyboardEventOutput(event);
      if (customOutput) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        textarea.value = "";
        processedTextareaValue = "";
        terminal.input(customOutput, true);
        cleanupEditableArtifacts(this.#container);
        return;
      }
      const output = keyboardEventOutput(event);
      if (output) {
        lastKeydown = { data: output, time: performance.now() };
      }
    };
    const onBeforeInput = (event: InputEvent) => {
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
        textarea.value = "";
        processedTextareaValue = "";
        cleanupEditableArtifacts(this.#container);
        return;
      }

      textarea.value = "";
      processedTextareaValue = "";
      terminal.input(output, true);
      cleanupEditableArtifacts(this.#container);
    };
    const sendTextareaDelta = () => {
      const value = textarea.value;
      if (value === processedTextareaValue) {
        return;
      }

      const output = textareaDelta(processedTextareaValue, value);
      processedTextareaValue = value;
      if (output) {
        terminal.input(output, true);
      }
      cleanupEditableArtifacts(this.#container);
    };
    const onInput = () => {
      sendTextareaDelta();
    };
    const onCompositionStart = (event: CompositionEvent) => {
      processedTextareaValue = textarea.value;
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      cleanupEditableArtifacts(this.#container);
    };
    const onCompositionUpdate = (event: CompositionEvent) => {
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
      sendTextareaDelta();
      textarea.value = "";
      processedTextareaValue = "";
      cleanupEditableArtifacts(this.#container);
    };
    const onBlur = () => {
      textarea.classList.remove("ghostty-keyboard-input");
      this.#textInputTapGraceUntil = 0;
    };

    textarea.addEventListener("keydown", onKeydown, { capture: true });
    textarea.addEventListener("beforeinput", onBeforeInput, { capture: true });
    textarea.addEventListener("input", onInput);
    textarea.addEventListener("compositionstart", onCompositionStart, { capture: true });
    textarea.addEventListener("compositionupdate", onCompositionUpdate, { capture: true });
    textarea.addEventListener("compositionend", onCompositionEnd, { capture: true });
    textarea.addEventListener("blur", onBlur);
    this.#mobileInputCleanup = () => {
      textarea.removeEventListener("keydown", onKeydown, { capture: true });
      textarea.removeEventListener("beforeinput", onBeforeInput, { capture: true });
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("compositionstart", onCompositionStart, { capture: true });
      textarea.removeEventListener("compositionupdate", onCompositionUpdate, { capture: true });
      textarea.removeEventListener("compositionend", onCompositionEnd, { capture: true });
      textarea.removeEventListener("blur", onBlur);
    };
  }
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

function beforeInputOutput(event: InputEvent) {
  switch (event.inputType) {
    case "insertText":
    case "insertReplacementText":
      return event.data ? event.data.replace(/\n/g, "\r") : null;
    case "insertLineBreak":
    case "insertParagraph":
      return "\r";
    case "deleteContentBackward":
      return "\x7F";
    case "deleteContentForward":
      return "\x1B[3~";
    default:
      return null;
  }
}

function textareaDelta(previousValue: string, nextValue: string) {
  if (nextValue.startsWith(previousValue)) {
    return nextValue.slice(previousValue.length).replace(/\n/g, "\r");
  }

  const previousChars = Array.from(previousValue);
  const nextChars = Array.from(nextValue);
  let commonPrefixLength = 0;
  while (
    commonPrefixLength < previousChars.length &&
    commonPrefixLength < nextChars.length &&
    previousChars[commonPrefixLength] === nextChars[commonPrefixLength]
  ) {
    commonPrefixLength += 1;
  }

  const deletes = "\x7F".repeat(previousChars.length - commonPrefixLength);
  const inserts = nextChars.slice(commonPrefixLength).join("").replace(/\n/g, "\r");
  return `${deletes}${inserts}`;
}

function keyboardEventOutput(event: KeyboardEvent) {
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return null;
  }
  if (event.key.length === 1) {
    return event.key;
  }
  switch (event.key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return "\x7F";
    case "Delete":
      return "\x1B[3~";
    default:
      return null;
  }
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
  if (range.length <= 1) {
    return "";
  }

  const rows: string[] = [];
  for (let row = range.from.row; row <= range.to.row; row += 1) {
    const bufferRow = terminalBufferRow(terminal, row);
    const line = terminal.buffer.active.getLine(bufferRow) as TerminalBufferLine | undefined;
    rows[row] = line ? terminalBufferLineText(line).text : "";
  }
  return selectedTextFromVisibleRows(rows, start, end, terminal.cols);
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
    const url = rawUrl.replace(TAP_URL_TRAILING_PUNCTUATION, "");
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
  return Math.min(Math.max(value, min), max);
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
