// Talk Back hook — wires the speech core (talkBack.ts) to the app:
// device-local prefs, one-gesture priming, per-pane text accumulation with a
// settle debounce (hysteresis on output quiescence, mirroring the dictation
// settleMs pattern), and pane-switch resets. See project-jzd.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  diffSpokenText,
  readTalkBackEnabled,
  stripSpeechNoise,
  TalkBackController,
  writeTalkBackEnabled,
  type SpeechSynthesisLike,
  type TalkBackState,
} from "./talkBack";

const TALK_BACK_SETTLE_MS = 1500;
/** Speak at most the trailing lines of an accumulated burst; responses, not replays. */
const TALK_BACK_TAIL_LINES = 12;

function browserSynth(): SpeechSynthesisLike | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const synth = window.speechSynthesis;
  return {
    speaking: () => synth.speaking,
    cancel: () => synth.cancel(),
    speak: ({ text, rate, onend, onerror }) => {
      const utterance = new SpeechSynthesisUtterance(text);
      if (typeof rate === "number") utterance.rate = rate;
      utterance.onend = () => onend?.();
      utterance.onerror = () => onerror?.();
      synth.speak(utterance);
    },
  };
}

export function useTalkBack(paneKey: string | null) {
  const controllerRef = useRef<TalkBackController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new TalkBackController(browserSynth());
  }
  const [enabled, setEnabled] = useState(() =>
    readTalkBackEnabled(
      typeof localStorage !== "undefined" ? localStorage : null,
    ),
  );
  const [state, setState] = useState<TalkBackState>(
    () => controllerRef.current?.getState() ?? "unsupported",
  );
  const bufferRef = useRef("");
  const previousRef = useRef("");
  const settleTimerRef = useRef<number | null>(null);
  const paneKeyRef = useRef<string | null>(paneKey);
  paneKeyRef.current = paneKey;

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setEnabled(enabled);
    setState(controller.getState());
    if (!enabled) {
      writeTalkBackEnabled(localStorage, false);
      bufferRef.current = "";
      previousRef.current = "";
    } else {
      writeTalkBackEnabled(localStorage, true);
    }
  }, [enabled]);

  // Priming: the first speak() must follow a user gesture (Chrome M71+, iOS
  // Safari). Any pointerdown primes; idempotent afterwards.
  useEffect(() => {
    if (!enabled) return;
    const prime = () => {
      controllerRef.current?.prime();
      setState(controllerRef.current?.getState() ?? "unsupported");
    };
    window.addEventListener("pointerdown", prime);
    return () => window.removeEventListener("pointerdown", prime);
  }, [enabled]);

  // Pane switch: reset accumulation so speech never crosses panes.
  useEffect(() => {
    bufferRef.current = "";
    previousRef.current = "";
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, [paneKey]);

  const handleAccessibleText = useCallback(
    (text: string) => {
      const controller = controllerRef.current;
      if (!controller || !enabled || controller.getState() !== "ready") return;
      const cleaned = stripSpeechNoise(text);
      const fresh = diffSpokenText(previousRef.current, cleaned);
      previousRef.current = cleaned;
      if (!fresh.trim()) return;
      bufferRef.current = `${bufferRef.current}\n${fresh}`.trim();
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        const pending = bufferRef.current.trim();
        bufferRef.current = "";
        if (!pending || paneKeyRef.current === null) return;
        const tail = pending.split("\n").slice(-TALK_BACK_TAIL_LINES);
        controller.speak(tail.join(". "));
        setState(controller.getState());
      }, TALK_BACK_SETTLE_MS);
    },
    [enabled],
  );

  const toggle = useCallback(() => {
    setEnabled((current) => !current);
  }, []);

  return { enabled, state, toggle, handleAccessibleText };
}
