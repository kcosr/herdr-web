import { describe, expect, it } from "vitest";
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
import type { TerminalImeEvent, TerminalImeState } from "./terminalImeInput";

function reduceSequence(events: TerminalImeEvent[]) {
  let state = idleTerminalImeState();
  const output: string[] = [];
  const transitions = events.map((event) => {
    const transition = reduceTerminalImeState(state, event);
    state = transition.state;
    if (transition.output) {
      output.push(transition.output);
    }
    return transition;
  });
  return { state, output, transitions };
}

describe("terminal IME event sequences", () => {
  it("keeps preedit local and commits once when input precedes compositionend", () => {
    const result = reduceSequence([
      { type: "compositionstart", data: "", textareaValue: "" },
      { type: "compositionupdate", data: "ni", textareaValue: "" },
      {
        type: "input",
        data: "ni",
        inputType: "insertCompositionText",
        isComposing: true,
        textareaValue: "ni",
      },
      { type: "compositionupdate", data: "你好", textareaValue: "ni" },
      {
        type: "input",
        data: "你好",
        inputType: "insertCompositionText",
        isComposing: false,
        textareaValue: "你好",
      },
      { type: "compositionend", data: "你好", textareaValue: "你好" },
      { type: "settle" },
    ]);

    expect(result.output).toEqual(["你好"]);
    expect(result.transitions[2].suppressInput).toBe(true);
    expect(result.transitions[2].state.preedit).toBe("ni");
    expect(result.state).toEqual(idleTerminalImeState());
  });

  it("suppresses a composition input dispatched after compositionend", () => {
    const result = reduceSequence([
      { type: "compositionstart", data: "", textareaValue: "" },
      { type: "compositionupdate", data: "にほん", textareaValue: "" },
      { type: "compositionend", data: "日本", textareaValue: "日本" },
      {
        type: "input",
        data: "日本",
        inputType: "insertCompositionText",
        isComposing: false,
        textareaValue: "日本",
      },
    ]);

    expect(result.output).toEqual(["日本"]);
    expect(result.transitions[3]).toMatchObject({
      suppressInput: true,
      clearTextarea: true,
    });
  });

  it("suppresses a matching insertText dispatched after compositionend", () => {
    const result = reduceSequence([
      { type: "compositionstart", data: "", textareaValue: "" },
      { type: "compositionend", data: "한글", textareaValue: "한글" },
      {
        type: "input",
        data: "한글",
        inputType: "insertText",
        isComposing: false,
        textareaValue: "한글",
      },
    ]);

    expect(result.output).toEqual(["한글"]);
    expect(result.transitions[2].suppressInput).toBe(true);
  });

  it("does not turn canceled preedit into terminal input", () => {
    const result = reduceSequence([
      { type: "compositionstart", data: "", textareaValue: "" },
      { type: "compositionupdate", data: "nihao", textareaValue: "nihao" },
      { type: "compositionupdate", data: "", textareaValue: "nihao" },
      { type: "compositionend", data: "", textareaValue: "nihao" },
      { type: "settle" },
    ]);

    expect(result.output).toEqual([]);
    expect(result.transitions[2].state.preedit).toBe("");
    expect(result.transitions[3]).toMatchObject({ clearTextarea: true, output: null });
  });

  it("discards canceled Pinyin replay without swallowing the following character", () => {
    const result = reduceSequence([
      { type: "compositionstart", data: "", textareaValue: "" },
      { type: "compositionupdate", data: "n", textareaValue: "n" },
      { type: "compositionend", data: "", textareaValue: "n" },
      {
        type: "input",
        data: "n",
        inputType: "insertText",
        isComposing: false,
        textareaValue: "n",
      },
      { type: "settle" },
      {
        type: "input",
        data: "C",
        inputType: "insertText",
        isComposing: false,
        textareaValue: "C",
      },
    ]);

    expect(result.output).toEqual([]);
    expect(
      shouldDeferBeforeInputToIme(result.transitions[2].state, {
        data: "n",
        inputType: "insertText",
        isComposing: false,
      }),
    ).toBe(true);
    expect(result.transitions[3]).toMatchObject({ suppressInput: true, clearTextarea: true });
    expect(result.transitions[5].suppressInput).toBe(false);
    expect(textareaDelta("", "C")).toBe("C");
  });

  it("discards a canceled preedit replayed in multiple insertText fragments", () => {
    const result = reduceSequence([
      { type: "compositionstart", data: "", textareaValue: "" },
      { type: "compositionupdate", data: "ni", textareaValue: "ni" },
      { type: "compositionend", data: "", textareaValue: "ni" },
      {
        type: "input",
        data: "n",
        inputType: "insertText",
        isComposing: false,
        textareaValue: "n",
      },
      {
        type: "input",
        data: "i",
        inputType: "insertText",
        isComposing: false,
        textareaValue: "i",
      },
    ]);

    expect(result.transitions[3]).toMatchObject({ suppressInput: true, clearTextarea: true });
    expect(result.transitions[4]).toMatchObject({ suppressInput: true, clearTextarea: true });
    expect(result.state).toEqual(idleTerminalImeState());
  });

  it("does not swallow a keydown-less paste after canceled composition", () => {
    const result = reduceSequence([
      { type: "compositionstart", data: "", textareaValue: "" },
      { type: "compositionupdate", data: "n", textareaValue: "n" },
      { type: "compositionend", data: "", textareaValue: "n" },
      {
        type: "input",
        data: "PASTE",
        inputType: "insertFromPaste",
        isComposing: false,
        textareaValue: "PASTE",
      },
    ]);

    expect(
      shouldDeferBeforeInputToIme(result.transitions[2].state, {
        data: "PASTE",
        inputType: "insertFromPaste",
        isComposing: false,
      }),
    ).toBe(false);
    expect(result.transitions[3].suppressInput).toBe(false);
    expect(result.state).toEqual(idleTerminalImeState());
  });

  it("does not suppress a later ordinary key after the composition settles", () => {
    const result = reduceSequence([
      { type: "compositionstart", data: "", textareaValue: "" },
      { type: "compositionend", data: "a", textareaValue: "a" },
      { type: "settle" },
      {
        type: "input",
        data: "a",
        inputType: "insertText",
        isComposing: false,
        textareaValue: "a",
      },
    ]);

    expect(result.output).toEqual(["a"]);
    expect(result.transitions[3].suppressInput).toBe(false);
  });

  it("derives local preedit from the textarea when InputEvent.data is null", () => {
    const result = reduceSequence([
      { type: "compositionstart", data: "", textareaValue: "prefix" },
      {
        type: "input",
        data: null,
        inputType: "insertCompositionText",
        isComposing: true,
        textareaValue: "prefixnihao",
      },
    ]);

    expect(result.output).toEqual([]);
    expect(result.transitions[1]).toMatchObject({ suppressInput: true, clearTextarea: false });
    expect(result.state).toMatchObject({ phase: "composing", preedit: "nihao" });
  });

  it("discards an active composition on reset without changing an idle state", () => {
    const composing = reduceTerminalImeState(idleTerminalImeState(), {
      type: "compositionstart",
      data: "ni",
      textareaValue: "ni",
    }).state;
    const reset = reduceTerminalImeState(composing, { type: "reset" });
    expect(reset).toEqual({
      state: idleTerminalImeState(),
      output: null,
      suppressInput: true,
      clearTextarea: true,
    });

    const idleReset = reduceTerminalImeState(idleTerminalImeState(), { type: "reset" });
    expect(idleReset).toEqual({
      state: idleTerminalImeState(),
      output: null,
      suppressInput: false,
      clearTextarea: false,
    });
  });

  it("does not settle an active composition", () => {
    const composing: TerminalImeState = {
      phase: "composing",
      baseline: "",
      preedit: "に",
      pendingInput: null,
    };
    expect(reduceTerminalImeState(composing, { type: "settle" }).state).toBe(composing);
  });
});

describe("terminal IME guards", () => {
  it("recognizes composing key events including legacy keyCode 229", () => {
    expect(isImeComposingKeyEvent({ isComposing: true, keyCode: 65 })).toBe(true);
    expect(isImeComposingKeyEvent({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeComposingKeyEvent({ isComposing: false, keyCode: 65 })).toBe(false);
  });

  it("defers composition beforeinput and a matching trailing commit", () => {
    const composing: TerminalImeState = {
      phase: "composing",
      baseline: "",
      preedit: "ni",
      pendingInput: null,
    };
    expect(
      shouldDeferBeforeInputToIme(composing, {
        data: "ni",
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    ).toBe(true);

    const pending: TerminalImeState = {
      phase: "idle",
      preedit: "",
      pendingInput: { kind: "commit", text: "你好" },
    };
    expect(
      shouldDeferBeforeInputToIme(pending, {
        data: "你好",
        inputType: "insertText",
        isComposing: false,
      }),
    ).toBe(true);
    expect(
      shouldDeferBeforeInputToIme(pending, {
        data: "a",
        inputType: "insertText",
        isComposing: false,
      }),
    ).toBe(false);
  });

  it("maps ordinary beforeinput, keyboard, and textarea changes", () => {
    expect(beforeInputOutput({ inputType: "insertText", data: "a" })).toBe("a");
    expect(beforeInputOutput({ inputType: "insertLineBreak", data: null })).toBe("\r");
    expect(beforeInputOutput({ inputType: "deleteContentBackward", data: null })).toBe("\x7F");
    expect(beforeInputOutput({ inputType: "insertCompositionText", data: "ni" })).toBe(null);
    expect(
      keyboardEventOutput({ ctrlKey: false, altKey: false, metaKey: false, key: "Enter" }),
    ).toBe("\r");
    expect(textareaDelta("abc", "adc")).toBe("\x7F\x7Fdc");
  });
});

describe("IME textarea anchor", () => {
  it("positions the textarea at the terminal cursor", () => {
    expect(
      imeTextareaAnchor({
        terminalLeft: 100,
        terminalTop: 50,
        terminalWidth: 180,
        terminalHeight: 64,
        browserWidth: 800,
        browserHeight: 600,
        cellWidth: 9,
        cellHeight: 16,
        cursorCol: 2,
        cursorRow: 1,
        fontSizePx: 14,
      }),
    ).toEqual({ left: 118, top: 66, width: 9, height: 16, fontSizePx: 14 });
  });

  it("clamps the textarea to both terminal cells and the browser viewport", () => {
    expect(
      imeTextareaAnchor({
        terminalLeft: 790,
        terminalTop: 595,
        terminalWidth: 90,
        terminalHeight: 32,
        browserWidth: 800,
        browserHeight: 600,
        cellWidth: 9,
        cellHeight: 16,
        cursorCol: 99,
        cursorRow: 99,
        fontSizePx: 12,
      }),
    ).toMatchObject({ left: 790, top: 583 });
  });
});
