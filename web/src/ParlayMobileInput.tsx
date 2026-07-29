import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import type { ActionEnvelope, CommandContext } from "@parlay/client";
import {
  applyEnvelope,
  bumpInputVersion,
  PARLAY_SETTINGS_DEFAULTS,
  scheduleEval,
  setDispatcherContext,
  setEvalServerBaseUrl,
} from "@parlay/client";
import { autosizeMobileCommandTextarea } from "./mobileCommandTextarea";

// ── impl 2: parlay-server-backed mobile command input ───────────────────────
//
// herdr-web does NOT reimplement voice-submit phrase detection (that's impl 1,
// web/src/TerminalView.tsx on branch fm/herdr-web-mobile-input). This component
// is a thin consumer of parlay's existing server-eval protocol instead:
//
//   1. Every keystroke bumps a client-owned input version and, after a short
//      voice-settle debounce, POSTs the buffer to the parlay server's
//      /api/chat/eval (see @parlay/client's scheduleEval / packages/server/src/
//      eval-relay.ts).
//   2. The server relays that text to the compiled Go phrase-matching engine
//      (packages/eval-engine) and broadcasts the resulting actions
//      (setText / clear / submitNow / ...) back over SSE at /api/chat/events.
//   3. applyEnvelope (also from @parlay/client) drives those actions against
//      the CommandContext below. This component only wires that context to
//      React state and hands the final submitted text to onVoiceSubmit, which
//      the caller relays to the terminal pty (sendTerminalInputData).
//
// Requires a parlay server + eval engine running locally:
//   cd ~/code/parlay/packages/eval-engine && ./parlay-eval-engine   # :4343
//   cd ~/code/parlay/packages/server && bun run start               # :4242 (PARLAY_PORT)
// Voice-submit phrases are whatever's configured for parlay (defaults:
// "bravely" / "gravely" / "briefly" / "lap" trailing the buffer).
// @parlay/client itself is a local, unpublished sibling package — see
// web/README.md for the one-time `local-deps/parlay-client` symlink setup
// required before `npm install`.

const PARLAY_SERVER_URL = "http://localhost:4242";
const PARLAY_DEVICE_ID = "herdr-web-mobile";
const PARLAY_STREAM_ID = "herdr-web-mobile-command";

setEvalServerBaseUrl(PARLAY_SERVER_URL);

export interface ParlayMobileInputProps {
  value: string;
  onValueChange: (next: string) => void;
  onVoiceSubmit: (text: string) => void;
  disabled: boolean;
  expandingInput: boolean;
  enterNewline: boolean;
  controlsScalePercent: number;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  inputRef: (node: HTMLInputElement | HTMLTextAreaElement | null) => void;
}

export function ParlayMobileInput({
  value,
  onValueChange,
  onVoiceSubmit,
  disabled,
  expandingInput,
  enterNewline,
  controlsScalePercent,
  onKeyDown,
  inputRef,
}: ParlayMobileInputProps) {
  const nodeRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const valueRef = useRef(value);
  const onValueChangeRef = useRef(onValueChange);
  const onVoiceSubmitRef = useRef(onVoiceSubmit);
  valueRef.current = value;
  onValueChangeRef.current = onValueChange;
  onVoiceSubmitRef.current = onVoiceSubmit;

  const setCommandInputNode = (node: HTMLInputElement | HTMLTextAreaElement | null) => {
    nodeRef.current = node;
    inputRef(node);
  };

  // Stable CommandContext identity: apply.ts's dispatcher context is a module
  // singleton, so this must be built once and kept fresh via the refs above
  // rather than recreated (and re-registered) on every render.
  const ctxRef = useRef<CommandContext | null>(null);
  if (!ctxRef.current) {
    ctxRef.current = {
      input: {
        value: () => valueRef.current,
        // Deliberately does NOT bump the input version / schedule an eval —
        // mirrors @parlay/client's own ctx.ts: programmatic edits (server
        // actions) must not re-trigger the pass that produced them.
        setText(t: string) {
          valueRef.current = t;
          onValueChangeRef.current(t);
        },
        clear() {
          valueRef.current = "";
          onValueChangeRef.current("");
        },
        submit(text: string) {
          const trimmed = text.trim();
          valueRef.current = "";
          onValueChangeRef.current("");
          if (trimmed) onVoiceSubmitRef.current(trimmed);
        },
        selection: () => ({
          anchor: nodeRef.current?.selectionStart ?? 0,
          active: nodeRef.current?.selectionEnd ?? 0,
        }),
        setSelection(anchor: number, active: number) {
          nodeRef.current?.setSelectionRange(Math.min(anchor, active), Math.max(anchor, active));
        },
      },
      // herdr-web is a single terminal pane, not a multi-agent tab strip —
      // tab/channel commands have nothing to resolve here.
      tabs: {
        list: () => [],
        active: () => null,
        switch: () => false,
        archive: () => false,
        next: () => {},
        prev: () => {},
      },
      drawer: { open: () => {} },
      speech: { stop: () => {} },
      settings: { get: () => PARLAY_SETTINGS_DEFAULTS },
      workspace: { navigate: () => false, present: () => false },
    };
  }

  useEffect(() => {
    setDispatcherContext(ctxRef.current as CommandContext);
  }, []);

  useEffect(() => {
    const evalCtx = () => ({
      voiceEnabled: true,
      settleMs: PARLAY_SETTINGS_DEFAULTS.voiceSettleMs,
      tabs: [],
      device: PARLAY_DEVICE_ID,
      streamId: PARLAY_STREAM_ID,
    });
    const resync = (reason: string) => {
      bumpInputVersion();
      scheduleEval(() => valueRef.current, evalCtx, true, reason);
    };
    const es = new EventSource(
      `${PARLAY_SERVER_URL}/api/chat/events?device=${encodeURIComponent(PARLAY_DEVICE_ID)}`,
    );
    const onInputAction = (event: MessageEvent<string>) => {
      let env: ActionEnvelope;
      try {
        env = JSON.parse(event.data) as ActionEnvelope;
      } catch {
        return;
      }
      // Only act on envelopes addressed to this component's own stream — the
      // server's SSE broadcast is otherwise unauthenticated, and applyEnvelope
      // can drive a submit straight into the terminal pty.
      if (env.streamId !== PARLAY_STREAM_ID) return;
      try {
        applyEnvelope(env, resync);
      } catch {
        // an action must never break input
      }
    };
    es.addEventListener("input_action", onInputAction);
    return () => {
      es.removeEventListener("input_action", onInputAction);
      es.close();
    };
  }, []);

  const handleChange = (next: string) => {
    valueRef.current = next;
    onValueChange(next);
    bumpInputVersion();
    scheduleEval(
      () => valueRef.current,
      () => ({
        voiceEnabled: true,
        settleMs: PARLAY_SETTINGS_DEFAULTS.voiceSettleMs,
        tabs: [],
        device: PARLAY_DEVICE_ID,
        streamId: PARLAY_STREAM_ID,
      }),
      false,
      "input",
    );
  };

  useEffect(() => {
    if (expandingInput) {
      autosizeMobileCommandTextarea(nodeRef.current);
    }
  }, [expandingInput, controlsScalePercent, value]);

  if (expandingInput) {
    return (
      <textarea
        ref={setCommandInputNode}
        className="term-native-input mono"
        rows={1}
        data-expanding="true"
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint={enterNewline ? "enter" : "send"}
        disabled={disabled}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    );
  }
  return (
    <input
      ref={setCommandInputNode}
      className="term-native-input mono"
      type="text"
      autoCapitalize="none"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="send"
      disabled={disabled}
      value={value}
      onChange={(event) => handleChange(event.target.value)}
    />
  );
}
