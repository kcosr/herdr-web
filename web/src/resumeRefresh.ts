export type ResumeRefreshMode = "none" | "state_stream" | "legacy_snapshot";

export function resumeRefreshMode({
  canConnect,
  hasCapabilities,
  stateStream,
  previousToken,
  currentToken,
}: {
  canConnect: boolean;
  hasCapabilities: boolean;
  stateStream: boolean;
  previousToken: number;
  currentToken: number;
}): ResumeRefreshMode {
  if (!canConnect || !hasCapabilities || previousToken === currentToken) {
    return "none";
  }
  return stateStream ? "state_stream" : "legacy_snapshot";
}
