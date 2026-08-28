import { describe, expect, it, vi } from "vitest";
import {
  chunkForUtterance,
  diffSpokenText,
  readTalkBackEnabled,
  readTalkBackRate,
  stripSpeechNoise,
  TalkBackController,
  writeTalkBackEnabled,
  writeTalkBackRate,
  type SpeechSynthesisLike,
} from "./talkBack";

describe("stripSpeechNoise", () => {
  it("strips ANSI CSI and OSC sequences", () => {
    const raw = "\x1b[32mBuild passed\x1b[0m \x1b]0;title\x07done";
    expect(stripSpeechNoise(raw)).toBe("Build passed done");
  });

  it("collapses box-drawing runs and progress bars", () => {
    const raw = "┌──────────┐\n│ step one │\n└──────────┘\n====== 45% ======";
    const out = stripSpeechNoise(raw);
    expect(out).not.toMatch(/[─│┌┐└┘=]/);
    expect(out).toContain("step one");
    expect(out.split("\n").length).toBeLessThanOrEqual(2);
  });

  it("drops spinner frames and blank lines", () => {
    expect(stripSpeechNoise("⠋ working...\n\n\n⠙ still")).toBe(
      "working...\nstill",
    );
  });
});

describe("diffSpokenText", () => {
  it("returns full text with no previous snapshot", () => {
    expect(diffSpokenText("", "hello\nworld")).toBe("hello\nworld");
  });

  it("returns only new trailing lines when previous aligns", () => {
    const prev = "line one\nline two";
    const cur = "line zero\nline one\nline two\nline three";
    expect(diffSpokenText(prev, cur)).toBe("line three");
  });

  it("falls back to a capped tail when alignment is lost", () => {
    const prev = "alpha\nbeta\ngamma";
    const cur = "totally\nfresh\nbuffer\nnow\nwith more";
    const out = diffSpokenText(prev, cur);
    expect(out.length).toBeGreaterThan(0);
    expect(out.split("\n").length).toBeLessThanOrEqual(3);
  });

  it("returns empty when nothing changed", () => {
    const snap = "same\nlines";
    expect(diffSpokenText(snap, snap)).toBe("");
  });
});

describe("chunkForUtterance", () => {
  it("splits long text on sentence boundaries", () => {
    const text = `${"word ".repeat(40)}First end. Second sentence here. Third one.`;
    const chunks = chunkForUtterance(text, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(130);
  });

  it("keeps short text as one chunk", () => {
    expect(chunkForUtterance("Short reply.")).toEqual(["Short reply."]);
  });
});

function makeSynth() {
  const spoken: string[] = [];
  let speaking = false;
  const synth: SpeechSynthesisLike = {
    speaking: () => speaking,
    cancel: () => {
      speaking = false;
    },
    speak: (utterance) => {
      spoken.push(utterance.text);
      speaking = true;
      utterance.onend?.();
    },
  };
  return { synth, spoken };
}

describe("TalkBackController", () => {
  it("reports unsupported without a synthesizer", () => {
    const c = new TalkBackController(null);
    c.setEnabled(true);
    c.prime();
    c.speak("hello");
    expect(c.getState()).toBe("unsupported");
  });

  it("stays unprimed until a gesture primes it", () => {
    const { synth } = makeSynth();
    const c = new TalkBackController(synth);
    c.setEnabled(true);
    expect(c.getState()).toBe("unprimed");
    c.speak("ignored");
    expect(c.getState()).toBe("unprimed");
    c.prime();
    expect(c.getState()).toBe("ready");
  });

  it("speaks after enable + prime, chunking into utterances", () => {
    const { synth, spoken } = makeSynth();
    const c = new TalkBackController(synth);
    c.setEnabled(true);
    c.prime();
    c.speak("First part. Second part. Third part here.");
    expect(spoken.length).toBeGreaterThanOrEqual(1);
    expect(spoken.join(" ")).toContain("Third part here.");
    expect(c.getState()).toBe("ready");
  });

  it("mutes and cancels on disable", () => {
    const { synth } = makeSynth();
    const cancelSpy = vi.spyOn(synth, "cancel");
    const c = new TalkBackController(synth);
    c.setEnabled(true);
    c.prime();
    c.speak("some speech");
    c.setEnabled(false);
    expect(cancelSpy).toHaveBeenCalled();
    expect(c.getState()).toBe("muted");
  });

  it("barges in: new speak cancels in-flight queue", () => {
    const { synth } = makeSynth();
    const cancelSpy = vi.spyOn(synth, "cancel");
    const c = new TalkBackController(synth);
    c.setEnabled(true);
    c.prime();
    c.speak(`long ${"text ".repeat(60)}`);
    c.speak("replacement");
    expect(cancelSpy).toHaveBeenCalled();
    expect(c.getState()).toBe("ready");
  });
});

describe("prefs round-trip", () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }

  it("enabled defaults to false and round-trips", () => {
    const storage = memoryStorage();
    expect(readTalkBackEnabled(storage)).toBe(false);
    writeTalkBackEnabled(storage, true);
    expect(readTalkBackEnabled(storage)).toBe(true);
  });

  it("rate clamps to sane bounds and tolerates garbage", () => {
    const storage = memoryStorage();
    expect(readTalkBackRate(storage)).toBe(1);
    writeTalkBackRate(storage, 1.5);
    expect(readTalkBackRate(storage)).toBe(1.5);
    storage.setItem("herdrWeb.talkBackRate.v1", "banana");
    expect(readTalkBackRate(storage)).toBe(1);
  });

  it("tolerates null storage everywhere", () => {
    expect(readTalkBackEnabled(null)).toBe(false);
    expect(() => writeTalkBackEnabled(null, true)).not.toThrow();
    expect(readTalkBackRate(null)).toBe(1);
  });
});
