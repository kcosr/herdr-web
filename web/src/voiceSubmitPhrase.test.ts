import { describe, expect, it } from "vitest";
import { matchTrailingVoiceSubmitPhrase, stripVoiceSubmitPhrase } from "./voiceSubmitPhrase";

describe("matchTrailingVoiceSubmitPhrase", () => {
  it("matches a trailing submit phrase case-insensitively", () => {
    expect(matchTrailingVoiceSubmitPhrase("run the tests bravely")).toBe("bravely");
    expect(matchTrailingVoiceSubmitPhrase("run the tests Bravely")).toBe("Bravely");
    expect(matchTrailingVoiceSubmitPhrase("git status LAP")).toBe("LAP");
  });

  it("tolerates trailing punctuation from dictation", () => {
    expect(matchTrailingVoiceSubmitPhrase("run the tests, bravely.")).toBe("bravely");
    expect(matchTrailingVoiceSubmitPhrase("git status lap!")).toBe("lap");
  });

  it("does not match a phrase that isn't trailing", () => {
    expect(matchTrailingVoiceSubmitPhrase("bravely run the tests")).toBeNull();
  });

  it("does not match a phrase embedded in a larger word", () => {
    expect(matchTrailingVoiceSubmitPhrase("do a lap around the block")).toBeNull();
    expect(matchTrailingVoiceSubmitPhrase("run overlap")).toBeNull();
  });

  it("returns null when there is no submit phrase", () => {
    expect(matchTrailingVoiceSubmitPhrase("just some text")).toBeNull();
    expect(matchTrailingVoiceSubmitPhrase("")).toBeNull();
  });
});

describe("stripVoiceSubmitPhrase", () => {
  it("strips the matched phrase and surrounding whitespace", () => {
    expect(stripVoiceSubmitPhrase("run the tests bravely", "bravely")).toBe("run the tests");
    expect(stripVoiceSubmitPhrase("git status lap!", "lap")).toBe("git status");
  });

  it("returns null when the buffer changed since the phrase was matched", () => {
    expect(stripVoiceSubmitPhrase("run the tests bravely more text", "bravely")).toBeNull();
  });

  it("returns null when stripping the phrase leaves nothing to send", () => {
    expect(stripVoiceSubmitPhrase("bravely", "bravely")).toBeNull();
    expect(stripVoiceSubmitPhrase("  bravely  ", "bravely")).toBeNull();
  });
});
