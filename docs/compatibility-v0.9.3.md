# Herdr v0.9.3 compatibility update

## Reviewed baseline

The vendored reference is [Herdr v0.9.3](https://github.com/herdrdev/herdr/releases/tag/v0.9.3),
commit `7b116c05bfda646af39d2524c54e70c751f57ee8`. Only stable releases v0.9.1–v0.9.3 were
reviewed after the previous v0.9.0 baseline.

Terminal protocol remains `22`. The direct client/server message enums, terminal frame,
render encoding, resize, attach, and scroll definitions are unchanged. The runtime minimum
remains v0.9.0 because the bridge's existing commands retain their contracts.

## Vendored changes

- Refresh the JSON schemas, pure input model, production wire definitions, and upstream wire tests.
- Remove the retired `pane.graphics.*` API definitions. The bridge did not expose those methods.
- Include additive completion, restore-error, resume-command, link-resolution, pane-clear, and
  SSH-agent-registration schema fields without adding browser commands or controls.
- Extend the small input/color shims for the copied host-color conversion code.
- Preserve the bridge's concrete socket paths, rename sentinels, logging paths, request timeouts,
  and partial subscription-line buffering. Upstream socket, status, IPC, and logging helpers were
  reviewed; their source did not change between these tags. The upstream client's new deadline
  status reader does not replace the bridge's adapted timeout implementation.

The production wire body, unmodified schemas, input model, and adapted `PopupSize` still pass
the exact tagged-source comparison in `scripts/check-vendor.sh`. See [vendoring.md](vendoring.md)
for the mapping and intentionally excluded native terminal tests.

## Event recovery

Herdr v0.9.2 and later report an `events_lost` error and terminate a subscription when its
reader falls behind retained history. Other failures can also end a stream without a final event.

The bridge treats subscription error responses as failures and closes the browser structural
event WebSocket when its upstream stream ends. The browser reconnects and refreshes its snapshot;
the bridge also requests a refresh after acknowledging the new upstream subscription, covering
changes during reconnection. Disconnected browser subscriptions release their reader threads.

Activity watchers resubscribe after errors, establish a fresh baseline, and ask browsers to resync.
The structural watcher rechecks pane membership after each subscription acknowledgement, including
changes that occurred while disconnected. This covers new panes when the activity watcher had
been waiting on an empty session.

The bridge retains its per-terminal ANSI transport, shared browser fanout, and last-resize
ownership. Whole-tab surface encodings and new product features remain separate work.

## Verification — 2026-10-07

- Exact v0.9.3 source drift check passed.
- Full `npm run check` passed: 147 compatibility tests, 157 bridge tests, 421 web tests,
  5 development-runner tests, and 6 release-script tests (736 total), plus lint, formatting,
  TypeScript, frontend production build, and bridge build.
- Recovery regressions exercise real Unix sockets and browser WebSockets for upstream EOF,
  `events_lost`, malformed JSON, post-acknowledgement resync, membership refresh, and activity
  rebaselining. The frontend test verifies snapshot refresh before the polling interval.
- An isolated official Linux x86_64 Herdr v0.9.3 daemon reported protocol 22. The downloaded
  executable's SHA256 matched GitHub release metadata:
  `18a8dc65f1c2fa485884344356dea1cfd911c6f06cf46fa78e193f4087f4dba7`.
- Live smoke checks passed snapshot decoding, two terminal viewers, shell input/output, PTY
  resize (`stty size`), scroll up/down, and structural event delivery.
- Headless Chromium rendered the terminal with zero page errors, accepted keyboard input,
  updated a workspace label from live events, and reconnected/resnapshotted after a forced
  browser event-stream closure.

Builds and daemon state were isolated under `.scratch/`; tests used a writable temporary
directory there. Installed services and production assets were not replaced. This validates
Linux/browser behavior, not macOS or Android packaging or every managed agent integration.
