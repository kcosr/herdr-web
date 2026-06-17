const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>`]+/iu;
const URL_CONTINUATION_PATTERN = /^[^\s"'<>`]+/u;
const TRAILING_URL_PUNCTUATION = /[.,;:!?]+$/u;
const TRAILING_BALANCED_CLOSERS = /[)\]}]+$/u;

export type TerminalSelectionPoint = {
  col: number;
  row: number;
};

export function terminalSelectionRange(
  start: TerminalSelectionPoint,
  end: TerminalSelectionPoint,
  cols: number,
) {
  const startIndex = start.row * cols + start.col;
  const endIndex = end.row * cols + end.col;
  const from = startIndex <= endIndex ? start : end;
  const to = startIndex <= endIndex ? end : start;
  return {
    from,
    to,
    length: to.row * cols + to.col - (from.row * cols + from.col) + 1,
  };
}

export function selectedTextFromVisibleRows(
  rows: readonly string[],
  start: TerminalSelectionPoint,
  end: TerminalSelectionPoint,
  cols: number,
) {
  const range = terminalSelectionRange(start, end, cols);
  if (range.length <= 1) {
    return "";
  }

  const selectedLines: string[] = [];
  for (let row = range.from.row; row <= range.to.row; row += 1) {
    const line = rows[row] ?? "";
    const startCol = row === range.from.row ? range.from.col : 0;
    const endCol = row === range.to.row ? range.to.col : Math.max(0, line.length - 1);
    selectedLines.push(line.slice(startCol, endCol + 1).trimEnd());
  }
  return selectedLines.join("\n");
}

export function findFirstUrlInSelection(selection: string) {
  const lines = selection
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/gu, " ").trim());
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(URL_PATTERN);
    if (match) {
      return trimUrlPunctuation(wrappedUrl(lines, index, match));
    }
  }
  return null;
}

export function openableHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeSelectionForUrl(selection: string) {
  return selection.replace(/\s*\n\s*/gu, "").replace(/[ \t\r\f\v]+/gu, " ").trim();
}

function wrappedUrl(lines: string[], startIndex: number, match: RegExpMatchArray) {
  const matchStart = match.index ?? 0;
  let url = match[0];
  let currentLine = lines[startIndex];
  let matchEnd = matchStart + match[0].length;

  for (let index = startIndex + 1; matchEnd >= currentLine.length && index < lines.length; index += 1) {
    const continuation = lines[index].match(URL_CONTINUATION_PATTERN)?.[0] ?? "";
    if (!continuation || !shouldJoinWrappedUrl(url, continuation)) {
      break;
    }
    url += continuation;
    currentLine = lines[index];
    matchEnd = continuation.length;
  }

  return url;
}

function shouldJoinWrappedUrl(url: string, continuation: string) {
  return /[/?#&=._~%+-]$/u.test(url) || /^[/?#&=._~%+-]/u.test(continuation);
}

function trimUrlPunctuation(value: string) {
  let next = value.replace(TRAILING_URL_PUNCTUATION, "");
  while (TRAILING_BALANCED_CLOSERS.test(next) && hasUnmatchedTrailingCloser(next)) {
    next = next.slice(0, -1);
  }
  return next;
}

function hasUnmatchedTrailingCloser(value: string) {
  const closer = value.at(-1);
  if (!closer) {
    return false;
  }
  const opener = closer === ")" ? "(" : closer === "]" ? "[" : closer === "}" ? "{" : "";
  if (!opener) {
    return false;
  }
  return countChars(value, closer) > countChars(value, opener);
}

function countChars(value: string, char: string) {
  let count = 0;
  for (const current of value) {
    if (current === char) {
      count += 1;
    }
  }
  return count;
}
