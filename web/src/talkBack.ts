// Talk Back — speaks agent pane output via the page speechSynthesis engine
// (project-jzd). Plain text comes from the terminal's accessible-buffer
// extraction (terminalAccessibleText), never from raw ANSI.
//
// Constraints honored here:
// - speechSynthesis works over plain HTTP (no secure-context gate) BUT Chrome
//   M71+/iOS Safari require one user gesture before any speak() succeeds — so
//   the controller stays "unprimed" until prime() is called from a gesture,
//   and callers surface that state in the UI.
// - No secure-context-only APIs are touched unguarded: everything checks for
//   feature support first and reports "unsupported".
// - Pure helpers are separated from the side-effectful controller so they are
//   unit-testable without a real synthesizer (repo convention).

export type TalkBackState =
  | "unsupported"
  | "muted"
  | "unprimed"
  | "ready"
  | "speaking";

export type SpeechSynthesisLike = {
  speaking(): boolean;
  cancel(): void;
  speak(utterance: {
    text: string;
    rate?: number;
    voiceURI?: string | null;
    onend?: () => void;
    onerror?: () => void;
  }): void;
};

// eslint-disable-next-line no-control-regex -- control characters are exactly what this stripper removes
const ANSI_ESCAPE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>NOM78]/g;
// Box drawing, borders, separators and other terminal furniture that reads
// badly aloud. Kept as a single class run stripper rather than a blocklist of
// specific glyphs so unknown decorations still collapse to spaces.
const DECORATION_RUN = /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬▁▂▃▄▅▆▇█▏▎▍▌▐░▒▓■□▪▫·•←→↑↓⟳⏳◐◑◒◓⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✔✗✘]+/g;

/** Strip ANSI/control sequences and terminal decoration from extracted text. */
export function stripSpeechNoise(text: string): string {
  return text
    .replace(ANSI_ESCAPE, "")
    .replace(DECORATION_RUN, " ")
    // Long progress-bar / rule runs of punctuation-only characters.
    .replace(/[-_=~*]{6,}/g, " ")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Return the portion of `current` that is new relative to `previous`, assuming
 * both are cleaned terminal snapshots of the same pane. Terminal buffers scroll,
 * so the previous snapshot is usually a *suffix* of the current one; find the
 * best alignment near the start of `previous` inside `current` and return what
 * follows it. Returns "" when nothing new can be attributed.
 */
export function diffSpokenText(previous: string, current: string): string {
  if (!current) return "";
  if (!previous) return current;
  const prevLines = previous.split("\n");
  const curLines = current.split("\n");
  const anchor = prevLines[0];
  // Only trust an anchor match within the first few lines of the new snapshot;
  // otherwise scrolling invalidated alignment and speaking would repeat junk.
  const searchLimit = Math.min(curLines.length, prevLines.length > 0 ? 8 : 0);
  for (let i = 0; i < searchLimit; i++) {
    if (curLines[i] === anchor && i + prevLines.length <= curLines.length + 4) {
      const alignedPrev = prevLines.filter(
        (line, j) => j === 0 || curLines[i + j] === line,
      );
      if (alignedPrev.length >= Math.floor(prevLines.length * 0.5)) {
        return curLines.slice(i + alignedPrev.length).join("\n");
      }
    }
  }
  // Anchor lost (clear/full redraw): speak only the trailing half-screen worth
  // of lines, capped, so a repaint does not replay the whole buffer.
  const tail = curLines.slice(-Math.max(1, Math.ceil(curLines.length * 0.25)));
  return tail.join("\n");
}

/** Collapse spoken text into utterance-sized chunks on sentence boundaries. */
export function chunkForUtterance(text: string, maxChars = 220): string[] {
  const sentences = text.replace(/\n+/g, " ").match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const pieces: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      pieces.push(sentence);
      continue;
    }
    // A single sentence over the cap: split at word boundaries.
    let rest = sentence;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(" ", maxChars);
      if (cut <= 0) cut = maxChars;
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    if (rest) pieces.push(rest);
  }
  const chunks: string[] = [];
  let chunk = "";
  for (const piece of pieces) {
    if ((chunk + piece).length > maxChars && chunk) {
      chunks.push(chunk.trim());
      chunk = piece;
    } else {
      chunk += piece;
    }
  }
  if (chunk.trim()) chunks.push(chunk.trim());
  return chunks;
}

const ENABLED_KEY = "herdrWeb.talkBackEnabled.v1";
const RATE_KEY = "herdrWeb.talkBackRate.v1";

export type TalkBackStorage = Pick<Storage, "getItem" | "setItem">;

export function readTalkBackEnabled(
  storage: TalkBackStorage | null,
): boolean {
  try {
    return storage?.getItem(ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeTalkBackEnabled(storage: TalkBackStorage | null, enabled: boolean): void {
  try {
    storage?.setItem(ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    /* storage unavailable — pref stays session-local */
  }
}

export function readTalkBackRate(storage: TalkBackStorage | null): number {
  try {
    const parsed = Number(storage?.getItem(RATE_KEY));
    return Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 3 ? parsed : 1;
  } catch {
    return 1;
  }
}

export function writeTalkBackRate(storage: TalkBackStorage | null, rate: number): void {
  try {
    storage?.setItem(RATE_KEY, String(rate));
  } catch {
    /* ignore */
  }
}

type SpeakRequest = { text: string; ondone?: () => void };

/**
 * Controller over an injected SpeechSynthesisLike. Lifecycle:
 *   construct -> "unsupported"|"muted"|"unprimed"
 *   setEnabled(true) + prime() from a user gesture -> "ready"
 *   speak(text) -> "speaking" until utterances drain
 * Barge-in default: a new speak() cancels the in-flight utterance.
 */
export class TalkBackController {
  private synth: SpeechSynthesisLike | null;
  private queue: SpeakRequest[] = [];
  private primed = false;
  private enabled = false;
  private rate = 1;
  private state: TalkBackState;

  constructor(synth: SpeechSynthesisLike | null) {
    this.synth = synth;
    this.state = synth === null ? "unsupported" : "muted";
  }

  getState(): TalkBackState {
    return this.state;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.synth === null) {
      this.state = "unsupported";
      return;
    }
    if (!enabled) {
      this.cancel();
      this.state = "muted";
      return;
    }
    this.state = this.primed ? "ready" : "unprimed";
  }

  setRate(rate: number): void {
    this.rate = Math.min(3, Math.max(0.5, rate));
  }

  /** Must be called from inside a user-gesture handler. Idempotent. */
  prime(): void {
    if (this.synth === null) return;
    this.primed = true;
    if (this.enabled) this.state = "ready";
  }

  isPrimed(): boolean {
    return this.primed;
  }

  cancel(): void {
    this.queue = [];
    try {
      this.synth?.cancel();
    } catch {
      /* some engines throw cancel with empty queue — non-fatal */
    }
    if (this.state === "speaking") this.state = this.enabled && this.primed ? "ready" : this.state;
  }

  /** Enqueue text for speech. Ignores empty input and unprimed/muted states. */
  speak(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.synth === null || !this.enabled || !this.primed) return;
    this.cancel();
    for (const part of chunkForUtterance(trimmed)) {
      this.queue.push({
        text: part,
        ondone: () => this.drain(),
      });
    }
    this.drain();
  }

  private drain(): void {
    if (!this.synth || this.queue.length === 0) {
      if (this.queue.length === 0 && this.state === "speaking") {
        this.state = this.enabled && this.primed ? "ready" : this.state;
      }
      return;
    }
    const request = this.queue.shift();
    if (!request) return;
    this.state = "speaking";
    try {
      this.synth.speak({
        text: request.text,
        rate: this.rate,
        onend: () => {
          request.ondone?.();
        },
        onerror: () => {
          request.ondone?.();
        },
      });
    } catch {
      request.ondone?.();
    }
  }
}
