// Type declarations for @parlay/client (optional local dependency)
// This is a stub that allows TypeScript to compile when @parlay/client is not available.
// The actual implementation is at web/local-deps/parlay-client (requires local symlink).

declare module "@parlay/client" {
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

  export const PARLAY_SETTINGS_DEFAULTS: { voiceSettleMs: number };

  export function applyEnvelope(env: ActionEnvelope, resync: (reason: string) => void): void;
  export function bumpInputVersion(): void;
  export function scheduleEval(
    getValue: () => string,
    evalCtx: () => object,
    force: boolean,
    reason: string,
  ): void;
  export function setDispatcherContext(ctx: CommandContext): void;
  export function setEvalServerBaseUrl(url: string): void;
}
