// Every terminal scroll delta (wheel, touch drag, PageUp/PageDown) is forwarded to the
// bridge as a request to move the remote session's view, since scrolling up past what's
// locally buffered requires the server-owned scrollback. Presence (are we away from the
// live tail right now) is inferred purely from the net lines requested, since there is no
// server signal for "at the bottom" today. Returning to present is a separate, local-only
// operation (see TerminalRenderer.scrollToBottom) because everything already written to the
// local buffer is available without a server round trip.
export function advanceTerminalScrollOffset(offsetLines: number, deltaLines: number): number {
  if (!Number.isFinite(deltaLines) || deltaLines === 0) {
    return offsetLines;
  }
  return Math.max(0, offsetLines - deltaLines);
}

export function isTerminalScrolledAwayFromPresent(offsetLines: number): boolean {
  return offsetLines > 0;
}
