import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseTerminalScreenReaderText,
  terminalAccessibleText,
  TerminalAccessibleTextPublisher,
  type TerminalAccessibleViewport,
} from "./terminalAccessibleText";

afterEach(() => {
  vi.useRealTimers();
});

describe("terminal accessible text", () => {
  it("reads only the visible bottom of the normal buffer", () => {
    const terminal = fakeTerminal({
      lines: ["old one", "old two", "visible one", "visible two"],
      rows: 2,
      cols: 16,
    });

    expect(terminalAccessibleText(terminal)).toBe("visible one\nvisible two");
  });

  it("reads the viewport when it is scrolled into normal-buffer scrollback", () => {
    const terminal = fakeTerminal({
      lines: ["old zero", "old one", "old two", "current one", "current two"],
      rows: 2,
      cols: 16,
      viewportY: 2,
    });

    expect(terminalAccessibleText(terminal)).toBe("old one\nold two");
  });

  it("reads the active alternate buffer without applying normal scrollback offset", () => {
    const terminal = fakeTerminal({
      lines: ["editor header", "editor body"],
      rows: 2,
      cols: 16,
      type: "alternate",
      viewportY: 50,
    });

    expect(terminalAccessibleText(terminal)).toBe("editor header\neditor body");
  });

  it("preserves Unicode and meaningful blank rows while trimming screen padding", () => {
    const terminal = fakeTerminal({
      lines: ["naïve 👩", "", "done   ", "   "],
      rows: 4,
      cols: 16,
      graphemes: { "0:6": "👩‍💻" },
    });

    expect(terminalAccessibleText(terminal)).toBe("naïve 👩‍💻\n\ndone");
  });

  it("bounds rows and columns while retaining the newest viewport rows", () => {
    const terminal = fakeTerminal({
      lines: ["first row", "second row", "third row", "fourth row"],
      rows: 4,
      cols: 20,
    });

    expect(terminalAccessibleText(terminal, { maxRows: 2, maxColumns: 5 })).toBe(
      "third\nfourt",
    );
  });

  it("bounds text without splitting Unicode surrogate pairs", () => {
    const terminal = fakeTerminal({
      lines: ["older", "A😀BC"],
      rows: 2,
      cols: 12,
    });

    const text = terminalAccessibleText(terminal, { maxCharacters: 3 });
    expect(text).toBe("😀BC");
    expect(Array.from(text)).toHaveLength(3);
    expect(text).not.toContain("�");
  });

  it("treats blank cells as spaces and drops trailing blank rows", () => {
    const terminal = fakeTerminal({
      lines: ["left  right", "value", ""],
      rows: 3,
      cols: 16,
    });

    expect(terminalAccessibleText(terminal)).toBe("left  right\nvalue");
  });

  it("does not expose concealed terminal cells", () => {
    const terminal = fakeTerminal({
      lines: ["public secret value"],
      rows: 1,
      cols: 19,
      invisibleCells: ["0:7", "0:8", "0:9", "0:10", "0:11", "0:12"],
    });

    expect(terminalAccessibleText(terminal)).toBe("public        value");
    expect(terminalAccessibleText(terminal)).not.toContain("secret");
  });

  it("parses the persisted opt-in setting conservatively", () => {
    expect(parseTerminalScreenReaderText(true)).toBe(true);
    expect(parseTerminalScreenReaderText(false, true)).toBe(false);
    expect(parseTerminalScreenReaderText("true")).toBe(false);
    expect(parseTerminalScreenReaderText(undefined, true)).toBe(true);
  });
});

describe("terminal accessible text publisher", () => {
  it("debounces requests and publishes only changed snapshots", () => {
    vi.useFakeTimers();
    let text = "first";
    const read = vi.fn(() => text);
    const publish = vi.fn();
    const publisher = new TerminalAccessibleTextPublisher(read, publish, 160);

    publisher.request();
    publisher.request();
    vi.advanceTimersByTime(159);
    expect(read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(publish).toHaveBeenCalledWith("first");

    publisher.request();
    vi.advanceTimersByTime(160);
    expect(publish).toHaveBeenCalledTimes(1);

    text = "second";
    publisher.request(0);
    vi.runOnlyPendingTimers();
    expect(publish).toHaveBeenLastCalledWith("second");
  });

  it("cancels pending snapshot work when disposed", () => {
    vi.useFakeTimers();
    const read = vi.fn(() => "text");
    const publish = vi.fn();
    const publisher = new TerminalAccessibleTextPublisher(read, publish, 160);

    publisher.request();
    publisher.dispose();
    vi.runAllTimers();

    expect(read).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

type FakeTerminalOptions = {
  lines: string[];
  rows: number;
  cols: number;
  type?: "normal" | "alternate";
  viewportY?: number;
  graphemes?: Record<string, string>;
  invisibleCells?: readonly string[];
};

function fakeTerminal({
  lines,
  rows,
  cols,
  type = "normal",
  viewportY = 0,
  graphemes = {},
  invisibleCells = [],
}: FakeTerminalOptions): TerminalAccessibleViewport {
  const invisibleCellSet = new Set(invisibleCells);
  const bufferLines = lines.map((line, row) =>
    fakeLine(line, cols, row, graphemes, invisibleCellSet),
  );
  return {
    rows,
    cols,
    buffer: {
      active: {
        type,
        length: bufferLines.length,
        viewportY,
        getLine(row: number) {
          return bufferLines[row];
        },
      },
    },
    getViewportY: () => viewportY,
    readGrapheme: (_bufferType, row, column) => graphemes[`${row}:${column}`] ?? null,
  };
}

function fakeLine(
  value: string,
  columns: number,
  row: number,
  graphemes: Record<string, string>,
  invisibleCells: ReadonlySet<string>,
) {
  const characters = Array.from(value);
  return {
    length: columns,
    getCell(column: number) {
      const character = characters[column] ?? "";
      return {
        cell: { grapheme_len: graphemes[`${row}:${column}`] ? 1 : 0 },
        getChars: () => character,
        getCodepoint: () => character.codePointAt(0) ?? 0,
        getWidth: () => 1,
        isInvisible: () => invisibleCells.has(`${row}:${column}`),
      };
    },
  };
}
