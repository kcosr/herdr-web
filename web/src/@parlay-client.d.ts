// Type shim for @parlay/client — provides types for compilation when the module is unavailable.
// The actual implementation depends on web/local-deps/parlay-client (a local symlink).
// If the symlink is missing, ParlayMobileInput degrades gracefully to a regular input.
// See CLAUDE.md: this decision is owned by the captain and should not be pre-empted here.

export interface ActionEnvelope {
  streamId: string;
  [key: string]: unknown;
}

export interface CommandContext {
  input: {
    value(): string;
    setText(t: string): void;
    clear(): void;
    submit(text: string): void;
    selection(): { anchor: number; active: number };
    setSelection(anchor: number, active: number): void;
  };
  tabs: {
    list(): string[];
    active(): string | null;
    switch(id: string): boolean;
    archive(id: string): boolean;
    next(): void;
    prev(): void;
  };
  drawer: {
    open(): void;
  };
  speech: {
    stop(): void;
  };
  settings: {
    get(): { voiceSettleMs: number };
  };
  workspace: {
    navigate(path: string): boolean;
    present(id: string): boolean;
  };
}

export const PARLAY_SETTINGS_DEFAULTS: { voiceSettleMs: number } = {
  voiceSettleMs: 500,
};

export function applyEnvelope(env: ActionEnvelope, resync: (reason: string) => void): void {}
export function bumpInputVersion(): void {}
export function scheduleEval(
  getValue: () => string,
  evalCtx: () => object,
  force: boolean,
  reason: string,
): void {}
export function setDispatcherContext(ctx: CommandContext): void {}
export function setEvalServerBaseUrl(url: string): void {}
