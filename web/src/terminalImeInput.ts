/**
 * Helpers for browser IME (especially CJK) on the ghostty terminal textarea.
 *
 * Composition must not stream intermediate preedit (pinyin, etc.) into the PTY.
 * Only the final committed text after compositionend (or non-composition insertText)
 * should become terminal input.
 */

export type ImeTextareaAnchor = {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSizePx: number;
};

/** True while an IME composition is active (keydown / input paths). */
export function isImeComposingKeyEvent(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">,
): boolean {
  return event.isComposing || event.keyCode === 229;
}

/** True for InputEvent / beforeinput while composition is in progress. */
export function isImeComposingInputEvent(
  event: Pick<InputEvent, "isComposing" | "inputType">,
): boolean {
  if (event.isComposing) {
    return true;
  }
  return isImeCompositionInputType(event.inputType);
}

/** Input types that belong to IME preedit, not final terminal bytes. */
export function isImeCompositionInputType(inputType: string): boolean {
  return (
    inputType === "insertCompositionText" ||
    inputType === "deleteCompositionText" ||
    inputType === "insertFromComposition" ||
    inputType === "deleteByComposition"
  );
}

/**
 * Whether beforeinput should send bytes to the terminal immediately.
 * Composition preedit must pass through the textarea so the OS IME can work.
 */
export function shouldHandleBeforeInputForTerminal(
  event: Pick<InputEvent, "isComposing" | "inputType" | "data">,
): boolean {
  if (isImeComposingInputEvent(event)) {
    return false;
  }
  return beforeInputOutput(event) !== null;
}

/**
 * Whether a generic input event may flush textarea deltas to the terminal.
 * While composing, intermediate values stay local until compositionend.
 */
export function shouldSendTextareaDeltaOnInput(isComposing: boolean): boolean {
  return !isComposing;
}

/**
 * Final committed text for a completed composition.
 * Prefer CompositionEvent.data when present; otherwise diff against the pre-composition baseline.
 */
export function compositionCommittedOutput(
  baseline: string,
  textareaValue: string,
  compositionData: string | null | undefined,
): string | null {
  if (typeof compositionData === "string" && compositionData.length > 0) {
    return compositionData.replace(/\n/g, "\r");
  }
  const delta = textareaDelta(baseline, textareaValue);
  return delta.length > 0 ? delta : null;
}

/**
 * In-progress IME preedit (pinyin / partial CJK) for on-screen preview.
 * Prefer CompositionEvent.data; fall back to the textarea suffix after the baseline.
 */
export function compositionPreeditText(
  baseline: string,
  textareaValue: string,
  compositionData: string | null | undefined,
): string {
  // Empty string from CompositionEvent means "no data this event", not "clear preedit".
  if (typeof compositionData === "string" && compositionData.length > 0) {
    return compositionData;
  }
  if (textareaValue.startsWith(baseline)) {
    return textareaValue.slice(baseline.length);
  }
  return textareaValue;
}

/** Grow the invisible IME hit target with preedit length so candidate windows stay near the caret. */
export function imeTextareaSizeForPreedit(
  cellWidth: number,
  cellHeight: number,
  preeditLength: number,
): { width: number; height: number } {
  const cells = Math.max(1, preeditLength > 0 ? preeditLength : 1);
  return {
    width: Math.max(2, Math.ceil(cellWidth) * cells),
    height: Math.max(2, Math.ceil(cellHeight)),
  };
}

export function beforeInputOutput(event: Pick<InputEvent, "inputType" | "data">): string | null {
  switch (event.inputType) {
    case "insertText":
    case "insertReplacementText":
    case "insertFromPaste":
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

export function textareaDelta(previousValue: string, nextValue: string): string {
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

export function keyboardEventOutput(
  event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey" | "key">,
): string | null {
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

/**
 * Compute a fixed-position rect for the hidden textarea so the OS IME candidate
 * window anchors near the terminal caret instead of off-screen.
 */
export function imeTextareaAnchor(options: {
  viewportLeft: number;
  viewportTop: number;
  viewportWidth: number;
  viewportHeight: number;
  cellWidth: number;
  cellHeight: number;
  cursorCol: number;
  cursorRow: number;
  fontSizePx: number;
}): ImeTextareaAnchor {
  const cellWidth = Math.max(1, options.cellWidth);
  const cellHeight = Math.max(1, options.cellHeight);
  const maxCol = Math.max(0, Math.floor(options.viewportWidth / cellWidth) - 1);
  const maxRow = Math.max(0, Math.floor(options.viewportHeight / cellHeight) - 1);
  const col = clampInteger(options.cursorCol, 0, maxCol);
  const row = clampInteger(options.cursorRow, 0, maxRow);
  return {
    left: options.viewportLeft + col * cellWidth,
    top: options.viewportTop + row * cellHeight,
    width: cellWidth,
    height: cellHeight,
    fontSizePx: Math.max(1, options.fontSizePx),
  };
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
