import { describe, expect, it } from "vitest";
import {
  beforeInputOutput,
  compositionCommittedOutput,
  compositionPreeditText,
  imeTextareaAnchor,
  imeTextareaSizeForPreedit,
  isImeComposingInputEvent,
  isImeComposingKeyEvent,
  isImeCompositionInputType,
  keyboardEventOutput,
  shouldHandleBeforeInputForTerminal,
  shouldSendTextareaDeltaOnInput,
  textareaDelta,
} from "./terminalImeInput";

describe("IME composition guards", () => {
  it("detects composing key events including keyCode 229", () => {
    expect(isImeComposingKeyEvent({ isComposing: true, keyCode: 65 })).toBe(true);
    expect(isImeComposingKeyEvent({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeComposingKeyEvent({ isComposing: false, keyCode: 65 })).toBe(false);
  });

  it("detects composition input types and isComposing", () => {
    expect(isImeCompositionInputType("insertCompositionText")).toBe(true);
    expect(isImeCompositionInputType("insertFromComposition")).toBe(true);
    expect(isImeCompositionInputType("insertText")).toBe(false);
    expect(
      isImeComposingInputEvent({ isComposing: true, inputType: "insertText" }),
    ).toBe(true);
    expect(
      isImeComposingInputEvent({ isComposing: false, inputType: "insertCompositionText" }),
    ).toBe(true);
  });

  it("blocks terminal beforeinput handling during composition preedit", () => {
    expect(
      shouldHandleBeforeInputForTerminal({
        isComposing: true,
        inputType: "insertCompositionText",
        data: "ni",
      }),
    ).toBe(false);
    expect(
      shouldHandleBeforeInputForTerminal({
        isComposing: false,
        inputType: "insertCompositionText",
        data: "ni",
      }),
    ).toBe(false);
    expect(
      shouldHandleBeforeInputForTerminal({
        isComposing: false,
        inputType: "insertText",
        data: "a",
      }),
    ).toBe(true);
    expect(
      shouldHandleBeforeInputForTerminal({
        isComposing: false,
        inputType: "insertText",
        data: null,
      }),
    ).toBe(false);
  });

  it("blocks textarea delta flush while composing", () => {
    expect(shouldSendTextareaDeltaOnInput(true)).toBe(false);
    expect(shouldSendTextareaDeltaOnInput(false)).toBe(true);
  });
});

describe("composition commit and deltas", () => {
  it("prefers CompositionEvent.data when present", () => {
    expect(compositionCommittedOutput("", "nihao", "你好")).toBe("你好");
  });

  it("falls back to textarea delta from the pre-composition baseline", () => {
    expect(compositionCommittedOutput("", "你好", "")).toBe("你好");
    expect(compositionCommittedOutput("ab", "ab你好", null)).toBe("你好");
  });

  it("returns null when composition commits nothing", () => {
    expect(compositionCommittedOutput("", "", "")).toBe(null);
    expect(compositionCommittedOutput("ab", "ab", null)).toBe(null);
  });

  it("extracts in-progress preedit for the caret overlay", () => {
    expect(compositionPreeditText("", "ni", "ni")).toBe("ni");
    expect(compositionPreeditText("", "nihao", undefined)).toBe("nihao");
    expect(compositionPreeditText("ab", "abni", null)).toBe("ni");
    // Empty composition data falls back to the textarea suffix.
    expect(compositionPreeditText("", "ni", "")).toBe("ni");
    expect(compositionPreeditText("", "", null)).toBe("");
  });

  it("grows the IME hit target with preedit length", () => {
    expect(imeTextareaSizeForPreedit(9, 16, 0)).toEqual({ width: 9, height: 16 });
    expect(imeTextareaSizeForPreedit(9, 16, 4)).toEqual({ width: 36, height: 16 });
  });

  it("computes simple and mid-string textarea deltas", () => {
    expect(textareaDelta("", "hi")).toBe("hi");
    expect(textareaDelta("hi", "hi!")).toBe("!");
    expect(textareaDelta("abc", "adc")).toBe("\x7F\x7Fdc");
  });

  it("maps beforeinput types used by non-IME typing", () => {
    expect(beforeInputOutput({ inputType: "insertText", data: "a" })).toBe("a");
    expect(beforeInputOutput({ inputType: "insertLineBreak", data: null })).toBe("\r");
    expect(beforeInputOutput({ inputType: "deleteContentBackward", data: null })).toBe("\x7F");
    expect(beforeInputOutput({ inputType: "insertCompositionText", data: "ni" })).toBe(null);
  });

  it("maps simple keyboard keys outside composition", () => {
    expect(
      keyboardEventOutput({
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        key: "a",
      }),
    ).toBe("a");
    expect(
      keyboardEventOutput({
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        key: "Enter",
      }),
    ).toBe("\r");
  });
});

describe("IME caret anchor", () => {
  it("places the textarea over the cursor cell inside the viewport", () => {
    expect(
      imeTextareaAnchor({
        viewportLeft: 100,
        viewportTop: 50,
        viewportWidth: 180,
        viewportHeight: 64,
        cellWidth: 9,
        cellHeight: 16,
        cursorCol: 2,
        cursorRow: 1,
        fontSizePx: 14,
      }),
    ).toEqual({
      left: 118,
      top: 66,
      width: 9,
      height: 16,
      fontSizePx: 14,
    });
  });

  it("clamps the cursor to the visible grid", () => {
    const anchor = imeTextareaAnchor({
      viewportLeft: 0,
      viewportTop: 0,
      viewportWidth: 90,
      viewportHeight: 32,
      cellWidth: 9,
      cellHeight: 16,
      cursorCol: 99,
      cursorRow: 99,
      fontSizePx: 12,
    });
    expect(anchor.left).toBe(81);
    expect(anchor.top).toBe(16);
  });
});
