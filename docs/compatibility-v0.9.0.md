# Herdr v0.9.0 compatibility update

## Scope

The compatibility update began on `compat/herdr-v0.9.0`, based on main, and is
committed on `feat/workspace-launch-context` with the launch-context follow-up.
The stable-endpoint experiment is
preserved separately as a named stash and `refs/archives/stable-endpoint-proof`
(`6cb2baeb2905f6178e73d610830ce7c786dd2407`). It is not part of this update.

The bridge retains its per-terminal ANSI attach transport, Ghostty Web renderer,
existing browser input/clipboard behavior, shared terminal fanout, and last-resize
ownership. It does not use whole-tab endpoint surfaces or automatically zoom tabs.

The vendored baseline is Herdr v0.9.0, protocol 22, commit
`b99002ac99b09e00b4ca692436cb15a6b0d676f1`. Required adaptations include:

- `TerminalHello` handshake and explicit ANSI welcome/version validation.
- New resize `pixel_mouse` field set false; browser mouse coordinates remain cells.
- Updated wire/API schemas and minimal dependent model shims.
- Explicit workspace-group close confirmation and `close_group` intent.
- Live activity subscription acknowledged before the initial baseline snapshot,
  with membership rechecked before publishing it.

See [vendoring.md](vendoring.md) for exact-source checks and intentional adaptations.
The JSON activity events have no public sequence watermark; startup follows the
upstream subscribe/snapshot/buffered-event ordering, not a new transactional API.

## Verification — 2026-09-07

- 143 compatibility tests, 147 bridge tests, 359 web tests, and 5 development-runner
  tests passed (654 total).
- Exact v0.9.0 upstream vendor drift checks, ESLint, Rust formatting, TypeScript,
  Vite production build, bridge build, and whitespace checks passed.
- Fresh-eyes review verified the direct-terminal contract and group-close intent,
  and added a fake-socket subscription-order/membership regression test.
- Isolated official Linux Herdr v0.9.0 daemon, with release SHA256 verified.
- Headless Chromium at `http://127.0.0.1:18880` rendered without page errors.
  Real keyboard typing, Ctrl+C selection copy, Ctrl+C interrupt, clipboard paste,
  Shell split creation, desktop split rendering, and compact/mobile pane viewing
  passed. Desktop split widths no longer exhibit the endpoint prototype's double
  division; mobile shows one pane using the available terminal area.
- Direct WebSocket tests passed initial output, two-viewer fanout, input/Enter,
  scroll up/down, and resize confirmed by `stty size` reporting `40 120`.

Frontend output was built outside the production-served directory. No installed
service, binary, or production assets were replaced or restarted. This is local
validation, not a cross-platform release or a full agent-provider/device test.

Temporary local scripts and screenshots (not release artifacts):

- `/tmp/herdr-compat09-fixture.0alAmJ/browser-smoke.cjs`
- `/tmp/herdr-compat09-fixture.0alAmJ/mobile-smoke.cjs`
- `/tmp/herdr-compat09-fixture.0alAmJ/transport-smoke.cjs`
- `/tmp/herdr-compat09-fixture.0alAmJ/desktop-split.png`
- `/tmp/herdr-compat09-fixture.0alAmJ/mobile-pane.png`

Browser tests used the terminal input textarea, word selection and clipboard
permissions, the Shell/Create split dialog, and the Tabs sidebar pane row. No
authentication was needed on the isolated loopback fixture.

## Implemented follow-up: explicit workspace launch context

New-space requests pass `source_workspace_id` from the active space on the selected
bridge. Herdr applies its `terminal.new_cwd` policy using that source, rather than
another client's workspace focus. Other directory policies remain unchanged.
The follow-up passed the full check with 656 tests (143 compatibility, 148 bridge,
360 web, and 5 development-runner tests), with build output isolated from production.

If another client closes the source space before the request reaches Herdr, creation
returns `workspace_not_found`. Refresh/select an existing space and retry. We do not
silently retry without the source, which could launch in an unintended directory.

## Optional follow-up features (not implemented here)

1. **Acknowledged agent submission:** offer an agent-aware composer action using
   `agent.prompt`, with submission/wait/error feedback. Keep raw terminal input
   and Stage separate; upstream prompt acknowledgment does not automatically apply
   to today's WebSocket keystrokes.
2. **Server-backed history search/copy:** the new selection/copy/search methods are
   JSON APIs, not endpoint-only. They require synchronized content revisions and
   terminal coordinates, so this deserves a separate history/search design.
3. **Muse icon/presentation:** detection can flow through existing generic agent
   fields; a dedicated icon is optional if Muse is used.

Daemon-side detection, foreground-directory, and idle scrollback-compression
improvements can benefit the app after the daemon itself is upgraded. Native
multi-machine UI, native copy fixes, and inline graphics are not automatically
new browser features. Graphics and richer keyboard/mouse protocol forwarding
remain separate capability projects.
