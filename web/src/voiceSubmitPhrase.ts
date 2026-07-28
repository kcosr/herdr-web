// Voice dictation on iPhone rewrites/corrects itself mid-stream, so the mobile
// command input buffers it before it reaches the pty. A trailing "submit
// phrase" lets the captain speak a magic word to send the buffered text once
// dictation settles — mirrors Parlay's `submit` built-in (trailing match,
// case-insensitive, tolerant of trailing punctuation).
export const VOICE_SUBMIT_PHRASES = ["bravely", "gravely", "briefly", "lap"];
export const VOICE_SUBMIT_TIMER_MS = 1000;

const VOICE_SUBMIT_PHRASE_SEP = "[\\s,.!?;:]+";

function escapeVoiceSubmitPhraseRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildVoiceSubmitPhraseCore(phrase: string): string {
  const words = phrase.trim().split(/\s+/);
  return words
    .map((word, index) => {
      const isLast = index === words.length - 1;
      return `${escapeVoiceSubmitPhraseRegExp(word)}${isLast ? "" : VOICE_SUBMIT_PHRASE_SEP}`;
    })
    .join("");
}

const VOICE_SUBMIT_PHRASE_MATCHERS = VOICE_SUBMIT_PHRASES.map(
  (phrase) => new RegExp(`(?:^|\\s+)(${buildVoiceSubmitPhraseCore(phrase)})[.!?,;]*\\s*$`, "i"),
);

/** Returns the trailing submit phrase text if `value` ends with one, else null. */
export function matchTrailingVoiceSubmitPhrase(value: string): string | null {
  for (const matcher of VOICE_SUBMIT_PHRASE_MATCHERS) {
    const match = value.match(matcher);
    if (match) {
      return match[1] ?? match[0];
    }
  }
  return null;
}

/**
 * Re-verifies `value` still ends with `matchedTail` (allowing trailing
 * punctuation) and returns the text with the phrase stripped, or null if the
 * buffer changed since the phrase was matched.
 */
export function stripVoiceSubmitPhrase(value: string, matchedTail: string): string | null {
  const idx = value.toLowerCase().lastIndexOf(matchedTail.toLowerCase());
  if (idx === -1 || value.slice(idx + matchedTail.length).trim().replace(/[.!?,;]+/g, "") !== "") {
    return null;
  }
  const stripped = value.slice(0, idx).trim();
  return stripped || null;
}
