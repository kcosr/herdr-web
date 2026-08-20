export const DEFAULT_TERMINAL_SCREEN_READER_TEXT = false;
export const TERMINAL_ACCESSIBLE_MAX_ROWS = 200;
export const TERMINAL_ACCESSIBLE_MAX_COLUMNS = 500;
export const TERMINAL_ACCESSIBLE_MAX_CHARACTERS = 32_000;

type TerminalAccessibleCell = {
  getChars?: () => string;
  getCodepoint?: () => number;
  getWidth?: () => number;
  isInvisible?: () => boolean | number;
  cell?: {
    grapheme_len?: number;
  };
};

type TerminalAccessibleLine = {
  readonly length: number;
  getCell(column: number): TerminalAccessibleCell | undefined;
};

type TerminalAccessibleBuffer = {
  readonly type: "normal" | "alternate";
  readonly length: number;
  readonly viewportY?: number;
  getLine(row: number): TerminalAccessibleLine | undefined;
};

export type TerminalAccessibleViewport = {
  readonly rows: number;
  readonly cols: number;
  readonly buffer: {
    readonly active: TerminalAccessibleBuffer;
  };
  getViewportY?: () => number;
  readGrapheme?: (
    bufferType: "normal" | "alternate",
    row: number,
    column: number,
  ) => string | null;
};

export type TerminalAccessibleTextOptions = {
  maxRows?: number;
  maxColumns?: number;
  maxCharacters?: number;
};

/** Returns the active terminal viewport as bounded, screen-reader-safe plain text. */
export function terminalAccessibleText(
  terminal: TerminalAccessibleViewport,
  options: TerminalAccessibleTextOptions = {},
) {
  const buffer = terminal.buffer.active;
  const terminalRows = nonNegativeInteger(terminal.rows);
  const bufferLength = nonNegativeInteger(buffer.length);
  const viewportRows = Math.min(terminalRows, bufferLength);
  const maxRows = normalizedLimit(options.maxRows, TERMINAL_ACCESSIBLE_MAX_ROWS);
  const rowsToRead = Math.min(viewportRows, maxRows);
  const maxColumns = normalizedLimit(options.maxColumns, TERMINAL_ACCESSIBLE_MAX_COLUMNS);
  const columnsToRead = Math.min(nonNegativeInteger(terminal.cols), maxColumns);

  if (rowsToRead === 0 || columnsToRead === 0) {
    return "";
  }

  const maxViewportOffset = Math.max(0, bufferLength - viewportRows);
  const requestedViewportOffset =
    buffer.type === "alternate"
      ? 0
      : nonNegativeInteger(terminal.getViewportY?.() ?? buffer.viewportY ?? 0);
  const viewportOffset = Math.min(requestedViewportOffset, maxViewportOffset);
  const viewportStart = Math.max(0, bufferLength - viewportRows - viewportOffset);
  const firstRow = viewportStart + viewportRows - rowsToRead;
  const endRow = viewportStart + viewportRows;
  const lines: string[] = [];

  for (let row = firstRow; row < endRow; row += 1) {
    lines.push(
      terminalAccessibleLineText(
        buffer.getLine(row),
        columnsToRead,
        row,
        buffer.type,
        terminal.readGrapheme,
      ),
    );
  }
  while (lines.at(-1) === "") {
    lines.pop();
  }

  return newestBoundedLines(
    lines,
    normalizedLimit(options.maxCharacters, TERMINAL_ACCESSIBLE_MAX_CHARACTERS),
  );
}

export function parseTerminalScreenReaderText(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export class TerminalAccessibleTextPublisher {
  readonly #readText: () => string | null;
  readonly #publish: (text: string) => void;
  readonly #delayMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #lastText: string | null = null;
  #disposed = false;

  constructor(readText: () => string | null, publish: (text: string) => void, delayMs: number) {
    this.#readText = readText;
    this.#publish = publish;
    this.#delayMs = Math.max(0, delayMs);
  }

  request(delayMs = this.#delayMs) {
    if (this.#disposed || this.#timer !== null) {
      return;
    }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#disposed) {
        return;
      }
      const text = this.#readText();
      if (text !== null && text !== this.#lastText) {
        this.#lastText = text;
        this.#publish(text);
      }
    }, Math.max(0, delayMs));
  }

  dispose() {
    this.#disposed = true;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}

function terminalAccessibleLineText(
  line: TerminalAccessibleLine | undefined,
  maxColumns: number,
  row: number,
  bufferType: "normal" | "alternate",
  readGrapheme: TerminalAccessibleViewport["readGrapheme"],
) {
  if (!line) {
    return "";
  }
  const columns = Math.min(nonNegativeInteger(line.length), maxColumns);
  let text = "";
  for (let column = 0; column < columns; column += 1) {
    const cell = line.getCell(column);
    const width = cell?.getWidth?.() ?? 1;
    if (cell?.isInvisible?.()) {
      if (width !== 0) {
        text += " ";
      }
      continue;
    }
    const graphemeLength = cell?.cell?.grapheme_len ?? 0;
    const chars =
      (graphemeLength > 0 ? readGrapheme?.(bufferType, row, column) : null) ??
      terminalCellCharacters(cell);
    if (chars.length === 0) {
      if (width !== 0) {
        text += " ";
      }
      continue;
    }
    text += visibleCharacters(chars);
  }
  return text.trimEnd();
}

function terminalCellCharacters(cell: TerminalAccessibleCell | undefined) {
  if (!cell) {
    return "";
  }
  const chars = cell.getChars?.();
  if (typeof chars === "string") {
    return chars;
  }
  const codepoint = cell.getCodepoint?.() ?? 0;
  if (
    !Number.isInteger(codepoint) ||
    codepoint <= 0 ||
    codepoint > 0x10ffff ||
    (codepoint >= 0xd800 && codepoint <= 0xdfff)
  ) {
    return "";
  }
  return String.fromCodePoint(codepoint);
}

function visibleCharacters(value: string) {
  let result = "";
  for (const character of value) {
    const codepoint = character.codePointAt(0) ?? 0;
    result += codepoint < 32 || codepoint === 127 ? " " : character;
  }
  return result;
}

function newestBoundedLines(lines: readonly string[], maxCharacters: number) {
  if (maxCharacters === 0 || lines.length === 0) {
    return "";
  }

  const retained: string[] = [];
  let remaining = maxCharacters;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const lineCharacters = Array.from(lines[index]);
    const separatorCharacters = retained.length > 0 ? 1 : 0;
    if (lineCharacters.length + separatorCharacters <= remaining) {
      retained.unshift(lines[index]);
      remaining -= lineCharacters.length + separatorCharacters;
      continue;
    }
    if (retained.length === 0 && remaining > 0) {
      retained.unshift(lineCharacters.slice(-remaining).join(""));
    }
    break;
  }
  return retained.join("\n");
}

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizedLimit(value: number | undefined, fallback: number) {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(0, Math.floor(value));
}
