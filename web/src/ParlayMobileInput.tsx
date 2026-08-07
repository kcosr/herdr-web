import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { autosizeMobileCommandTextarea } from "./mobileCommandTextarea";

// `@parlay/client` is an intentionally OPTIONAL, LOCAL-ONLY, NEVER-PUBLISHED dependency. It
// resolves only via the gitignored symlink `web/local-deps/parlay-client` (see web/README.md);
// it is deliberately absent from package.json/package-lock.json so `npm ci` never fetches it.
// This guarded dynamic import must stay in a try/catch: in production builds the specifier is
// externalized (vite.config.ts `build.rolldownOptions.external`), so it rejects at runtime when
// the package is absent and the component degrades to a plain input. Do NOT convert this to a
// static top-level `import` or add a registry version.
let parlayAvailable = false;
let parlay: any = null;

try {
  parlay = await import("@parlay/client");
  parlayAvailable = true;
} catch {
  // parlay-client unavailable; component will render as a plain input.
}

export interface ParlayMobileInputProps {
  value: string;
  onValueChange: (next: string) => void;
  onVoiceSubmit: (text: string) => void;
  /** Advance to the next agent pane ("next agent"/"next tab" parlay command). */
  onNextAgent?: () => void;
  /** Return to the previous agent pane ("previous agent" parlay command). */
  onPrevAgent?: () => void;
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
  onNextAgent,
  onPrevAgent,
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
  const onNextAgentRef = useRef(onNextAgent);
  const onPrevAgentRef = useRef(onPrevAgent);
  const disabledRef = useRef(disabled);
  valueRef.current = value;
  onValueChangeRef.current = onValueChange;
  onVoiceSubmitRef.current = onVoiceSubmit;
  onNextAgentRef.current = onNextAgent;
  onPrevAgentRef.current = onPrevAgent;
  disabledRef.current = disabled;

  const setCommandInputNode = (node: HTMLInputElement | HTMLTextAreaElement | null) => {
    nodeRef.current = node;
    inputRef(node);
  };

  // Autosize textarea when expanding input is enabled (works with or without parlay).
  useEffect(() => {
    if (expandingInput) {
      autosizeMobileCommandTextarea(nodeRef.current);
    }
  }, [expandingInput, controlsScalePercent, value]);

  // If parlay is not available, render a plain input.
  if (!parlayAvailable) {
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
          onChange={(event) => onValueChange(event.target.value)}
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
        onChange={(event) => onValueChange(event.target.value)}
      />
    );
  }

  // Parlay is available — use parlay server for voice-submit phrase detection.
  const PARLAY_SERVER_URL = `${window.location.protocol}//${window.location.hostname}:4242`;
  parlay.setEvalServerBaseUrl(PARLAY_SERVER_URL);

  // Session-scoped device IDs so one browser tab can't receive another's SSE actions.
  const idsRef = useRef<{ device: string; stream: string } | undefined>(undefined);
  if (!idsRef.current) {
    idsRef.current = {
      device: `herdr-web-mobile-${crypto.randomUUID()}`,
      stream: `herdr-web-mobile-command-${crypto.randomUUID()}`,
    };
  }
  const { device: deviceId, stream: streamId } = idsRef.current;

  // Stable CommandContext for parlay's dispatcher.
  const ctxRef = useRef<any>(null);
  if (!ctxRef.current) {
    ctxRef.current = {
      input: {
        value: () => valueRef.current,
        setText(t: string) {
          valueRef.current = t;
          onValueChangeRef.current(t);
        },
        clear() {
          valueRef.current = "";
          onValueChangeRef.current("");
        },
        submit(text: string) {
          if (disabledRef.current) return;
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
          nodeRef.current?.setSelectionRange(
            Math.min(anchor, active),
            Math.max(anchor, active),
          );
        },
      },
      tabs: {
        list: () => [],
        active: () => null,
        switch: () => false,
        archive: () => false,
        next: () => onNextAgentRef.current?.(),
        prev: () => onPrevAgentRef.current?.(),
      },
      drawer: { open: () => {} },
      speech: { stop: () => {} },
      settings: { get: () => parlay.PARLAY_SETTINGS_DEFAULTS },
      workspace: { navigate: () => false, present: () => false },
    };
  }

  useEffect(() => {
    parlay.setDispatcherContext(ctxRef.current);
  }, []);

  useEffect(() => {
    if (!parlay) return;
    const evalCtx = () => ({
      voiceEnabled: true,
      settleMs: parlay.PARLAY_SETTINGS_DEFAULTS.voiceSettleMs,
      tabs: [],
      device: deviceId,
      streamId: streamId,
    });
    const resync = (reason: string) => {
      parlay.bumpInputVersion();
      parlay.scheduleEval(() => valueRef.current, evalCtx, true, reason);
    };
    const es = new EventSource(
      `${PARLAY_SERVER_URL}/api/chat/events?device=${encodeURIComponent(deviceId)}`,
    );
    const onInputAction = (event: MessageEvent<string>) => {
      let env: any;
      try {
        env = JSON.parse(event.data);
      } catch {
        return;
      }
      if (env.streamId !== streamId) return;
      try {
        parlay.applyEnvelope(env, resync);
      } catch {
        // never break input
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
    parlay.bumpInputVersion();
    parlay.scheduleEval(
      () => valueRef.current,
      () => ({
        voiceEnabled: true,
        settleMs: parlay.PARLAY_SETTINGS_DEFAULTS.voiceSettleMs,
        tabs: [],
        device: deviceId,
        streamId: streamId,
      }),
      false,
      "input",
    );
  };

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
