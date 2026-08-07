# Changelog

## 2026-08-04 — session 573726b5

Files: CHANGELOG.md, AGENTS.md, web/src/App.tsx, web/src/paneSearch.ts, bridge/src/web_bridge.rs
## [Unreleased]

### Breaking Changes

### Added

- Added trailing voice-submit phrase detection (`bravely`, `gravely`, `briefly`, `lap`) to the
  mobile command input, so a spoken magic word sends the buffered dictation after a 1s
  confirmation delay. [PR #39](https://github.com/kcosr/herdr-web/pull/39)
- Added a mobile single-pane mode for split-pane tabs: touch devices now show only the selected
  pane by default, with a toggle to see the full split grid.
  [PR #39](https://github.com/kcosr/herdr-web/pull/39)
- Added a compact-controls toggle for the mobile special-keys row, defaulting to collapsed on
  mobile to save vertical space. [PR #39](https://github.com/kcosr/herdr-web/pull/39)
- Added a `POST`/`GET /api/mobile-mode` bridge endpoint and a mobile command-row toggle button
  that flip a `mobile-mode` presence flag in herdr-web's own data dir
  (`~/.local/share/herdr-web/mobile-mode` by default). herdr-web has no knowledge of what, if
  anything, reads the flag; a companion statusline script can check it directly to blank its
  output and save vertical space on mobile. [PR #39](https://github.com/kcosr/herdr-web/pull/39)
- Added a `--remote-bridge <url>` bridge CLI flag (repeatable) to register other herdr-web bridge
  instances (e.g. reached over Tailscale) as remote bridges. `/api/snapshot` now includes a
  `bridges` array describing each configured remote bridge (id, label, url), and a standalone
  `GET /api/bridges` endpoint returning the same list (`id`, `url`) without the session-snapshot
  round trip. The bridge proxies REST requests to an explicit allow-list of endpoints
  (`/api/remote/{bridge_id}/...`, GET and POST) and terminal WebSocket connections
  (`/ws/remote/{bridge_id}/terminal`) to the corresponding remote bridge. Paths outside the
  allow-list are rejected locally with 403; command-execution and upload endpoints are never
  forwarded. [PR #11](https://github.com/trillium/herdr-web/pull/11)
- The mobile command input is now backed by a locally running parlay server for phrase-triggered
  voice submit, replacing the previous native text input.

### Changed

- Made `@parlay/client` a permanently optional, local-only, never-published dependency so fresh
  worktrees and CI build cleanly when the local `web/local-deps/parlay-client` symlink is absent.
  It is no longer referenced in `web/package.json`/`web/package-lock.json` (so `npm ci` never
  resolves it from a registry); the Vite resolver picks up the symlink for `vite dev`/tests when
  present, production builds externalize it, and `ParlayMobileInput`'s guarded dynamic import falls
  back to a plain text input at runtime when the module is absent. Removed the dead `vite.config.ts`
  stub module and the duplicate `web/src/@parlay-client.d.ts` type shim (the canonical ambient
  declaration is `web/types/parlay-client.d.ts`).
  [PR #18](https://github.com/trillium/herdr-web/pull/18)
- Refreshed the vendored `herdr-compat` crate to the herdr `v0.8.0` baseline (wire protocol `19`,
  up from `v0.7.2`/protocol `16`): copied the exact-compared API schema surface and the
  `protocol::wire` body, added minimal `input`/`raw_input`/`popup_size` supporting shims for the
  new upstream types they reference, and migrated the bridge's launcher agent-split to herdr
  `v0.8.0`'s redesigned `agent.start` (which now starts a managed agent in an existing pane instead
  of creating and placing the pane itself).

### Fixed

- Fixed the mobile "next agent" / "previous agent" command doing nothing: the parlay command
  context's `tabs.next`/`tabs.prev` hooks were no-op stubs, so typing or speaking "next agent"
  (or "next tab" / "previous agent") in the mobile command input never switched panes. They now
  route through the same tested `nextVisibleAgentPaneEntry` + `focusPane` navigation used by the
  desktop ArrowUp/ArrowDown shortcut, matching its wrap-at-ends behavior.
  [PR #19](https://github.com/trillium/herdr-web/pull/19)
- Fixed herdr-web rejecting the herdr `v0.8.0` daemon at startup with "protocol 19 is newer than
  this herdr-web bridge supports": the vendored protocol constant is now `19`, so the bridge's
  terminal-attach accept range (`16..=PROTOCOL_VERSION`) admits protocol `19` daemons while still
  rejecting protocol `15` and older.
- Fixed herdr-web compatibility with herdr 0.8.0+: the bridge automatically allows
  `http://localhost` origins to work around herdr 0.8.0's CORS origin check that only
  permits localhost/127.0.0.1. Users serving herdr-web from a non-localhost address
  (machine hostname, Tailscale name, remote IP) should pass
  `--allow-origin http://HOSTNAME:PORT` when launching the bridge, or configure herdr
  itself with an `--allow-origin` flag for the serving hostname.

### Removed

## [0.3.3] - 2026-07-19

### Added

- Added Grok and OpenCode agent icons in the Agents sidebar and create-menu launch choices.
  [PR #36](https://github.com/kcosr/herdr-web/pull/36)
- Added built-in launcher presets for Grok and OpenCode (`builtin:grok`, `builtin:opencode`).
  [PR #36](https://github.com/kcosr/herdr-web/pull/36)
- Added optional `builtins` allowlist/order in `launcher-presets.json` so the create menu can show a
  subset of built-ins without PATH probing. Omitting `builtins` keeps the full default set; `[]`
  hides all built-ins (custom presets still appear). Short names (`shell`) and full ids
  (`builtin:shell`) are accepted; unknown entries warn and are ignored.
  [PR #36](https://github.com/kcosr/herdr-web/pull/36)

### Fixed

- Kept the first selected character anchored during mobile endpoint dragging, aligned the loupe caret
  with the selected row, and centered a hollow drag handle over the anchored character.
  [PR #35](https://github.com/kcosr/herdr-web/pull/35)

## [0.3.2] - 2026-07-07

### Breaking Changes

- Users must upgrade Herdr to `v0.7.2` or newer before upgrading herdr-web. The bridge now requires
  a Herdr daemon with protocol `16` because browser snapshots use Herdr's native
  `session.snapshot` API.
  [PR #32](https://github.com/kcosr/herdr-web/pull/32)

### Added

- Added an Agents-view active-status filter that shows only agents currently
  marked working, blocked, or done, with grouped views hiding empty groups after
  filtering. [PR #31](https://github.com/kcosr/herdr-web/pull/31)

### Changed

- Refreshed the vendored Herdr compatibility baseline to `v0.7.2`, including protocol `16`, native
  session snapshots, layout/scroll event schema drift, and terminal observe/control wire messages.
  [PR #32](https://github.com/kcosr/herdr-web/pull/32)
- Changed `/api/snapshot` to use one native Herdr `session.snapshot` request instead of separate
  workspace, tab, pane, and per-tab layout requests.
  [PR #32](https://github.com/kcosr/herdr-web/pull/32)

## [0.3.1] - 2026-07-03

### Added

- Added bridge-owned configurable launcher presets for the create menu, including argv-based custom
  agent commands, optional Herdr agent hints, and horizontally scrollable launch choices.
  [PR #30](https://github.com/kcosr/herdr-web/pull/30)
- Documented macOS x86_64 desktop tarball support alongside Linux x86_64 and macOS ARM64 release
  artifacts.
  [PR #30](https://github.com/kcosr/herdr-web/pull/30)
- Refreshed the vendored Herdr compatibility baseline to `v0.7.1` for launcher preset agent hints.
  [PR #30](https://github.com/kcosr/herdr-web/pull/30)

### Fixed

- Fixed mobile sidebar space selection so tapping a space updates the scoped Tabs list instead of
  snapping back to tabs from the previously selected pane.
  [PR #29](https://github.com/kcosr/herdr-web/pull/29)
- Fixed a bridge reattach race where a client reconnecting right after the last viewer left a
  terminal could be rejected by the daemon with `already has an attached client` and shown a
  permanent `Attached elsewhere` error; the bridge now shuts detached attach connections down and
  reattaches only after the pending detach has been delivered.
  [PR #26](https://github.com/kcosr/herdr-web/pull/26)
- Stopped detached terminal attach connections from leaking a blocked reader thread and an open
  socket on both the bridge and daemon sides after every pane switch.
  [PR #26](https://github.com/kcosr/herdr-web/pull/26)
- Serialized concurrent first attaches per terminal in the bridge and made the web client briefly
  retry `already has an attached client` rejections, so multiple viewers reconnecting at once
  (for example after a bridge restart) no longer strand a terminal on a permanent
  `Attached elsewhere` error. The bridge also now logs daemon-initiated attach connection closes,
  which were previously recorded nowhere.
  [PR #26](https://github.com/kcosr/herdr-web/pull/26)

## [0.3.0] - 2026-07-02

### Added

- Added an `Add note` action to pane and agent sidebar context menus, opening a quick-create
  dialog with a focused title and optional body that attaches the new note to the target pane.
  [PR #24](https://github.com/kcosr/herdr-web/pull/24)
- Added Mobile settings for an expanding terminal command input and Enter-as-newline
  editing, allowing long prompts to wrap and remain viewable while preserving send-on-Enter
  by default. [PR #21](https://github.com/kcosr/herdr-web/pull/21)
- Added bridge-tracked agent status transition activity with an Agents view sort option for
  `Last status change`, using semantic status changes rather than terminal output activity.
  [PR #23](https://github.com/kcosr/herdr-web/pull/23)
- Added server-side agent pins with pinned-first agent ordering, a pinned-only sidebar toggle, and
  a selected-pane header toggle plus a small pinned indicator on pinned agent rows.
  [PR #22](https://github.com/kcosr/herdr-web/pull/22)
- Added bridge-owned pane notes with a sidebar Notes view, desktop/mobile notes editor, pane
  attachment recovery states, and per-bridge note synchronization. Notes are exposed through the
  same bridge request policy as terminal controls, so allowed bridge clients can read and mutate
  saved note content. [PR #20](https://github.com/kcosr/herdr-web/pull/20)
- Added a Notes feature toggle plus persisted desktop notes panel sizing, notes list collapse
  state, notes panel open state, pane note tabs, and a dedicated Other notes list.
  [PR #20](https://github.com/kcosr/herdr-web/pull/20)
- Added a Markdown preview mode for notes that remembers Edit/Preview preference locally and keeps
  the Markdown renderer lazy-loaded until preview is used. [PR #20](https://github.com/kcosr/herdr-web/pull/20)

### Changed

- Unified the `session_key` reported by `/api/agent-activity` with the notes and agent-pins
  endpoints (`session:default` and FNV-1a socket hashes instead of a divergent local format).
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Extended the pinned-only sidebar toggle to the Tabs view so pinned panes can be found outside the
  Agents view. [PR #23](https://github.com/kcosr/herdr-web/pull/23)
- Notes created from the notes panel now open in Edit mode with the title selected, so the default
  title can be replaced immediately. [PR #24](https://github.com/kcosr/herdr-web/pull/24)

### Fixed

- Made the bridge close and cleanly reattach terminal sockets that fall behind fast output instead
  of silently dropping frames and corrupting the rendered stream.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Moved the bridge's remaining blocking daemon round-trips (snapshot, selection, agent activity,
  rename-label lookups) off async worker threads, so a stalled daemon no longer freezes unrelated
  requests and terminal websockets.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Bounded the bridge's per-terminal input queue so a client sending faster than the pty drains no
  longer grows bridge memory without limit.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Fixed terminal session races where a client connecting while the previous one disconnected could
  be handed an already-detached session, and where the daemon handshake blocked all other terminal
  clients.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Stopped the bridge from silently tightening permissions on a pre-existing operator-supplied
  `--upload-dir`; only directories the bridge creates itself are set to 0700.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Applied the standard 120-byte label validation to `pane.rename` requests, matching every other
  rename/create command.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Stopped a cancelled terminal mount from leaking an orphaned renderer and duplicated canvas when
  the pane changes while the terminal module is still loading.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Made single-cell touch selections highlight correctly instead of silently storing a wrong
  scrollback row.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Preserved combining characters and multi-codepoint emoji when copying terminal text via touch
  selection.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Kept the selected note open while no pane is selected, so notes no longer deselect mid-edit when
  a bridge disconnects, has zero panes, or a notes refresh lands.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Made Escape in settings number fields discard the typed value instead of committing it, and stop
  it from closing the whole settings dialog; out-of-range numbers now snap back to the clamped
  value in the field.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Reordered Android hardware-back handling so open menus and dialogs close before the notes panel
  underneath them.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Made Escape cancel the rename dialog from any focused control, not just the text input.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Extended long-press text-selection prevention to the stage header pane title.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Restored the intended drop shadow and muted URL color on the terminal selection sheet, which
  referenced undefined CSS variables.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Validated agent-pins responses at the fetch boundary so a malformed bridge response degrades
  gracefully instead of crashing the sidebar render.
  [PR #25](https://github.com/kcosr/herdr-web/pull/25)
- Prevented sidebar row labels and terminal tab labels from being text-selected during long-press
  context-menu gestures. [PR #24](https://github.com/kcosr/herdr-web/pull/24)
- Fixed notes editor selection and autosave edge cases so switching to panes without notes clears
  the editor, deleting the selected note no longer shows a deleted note, and stale local save
  refreshes do not appear as external note changes. Also fixed mobile delete-dialog back handling
  and unresolved note recovery actions in the notes panel. [PR #20](https://github.com/kcosr/herdr-web/pull/20)
- On mobile, kept the note editor's terminal action available for the current pane and made it
  close the full-screen notes surface. [PR #20](https://github.com/kcosr/herdr-web/pull/20)
- Changed mobile notes back navigation so back closes the notes surface from the editor, while a
  separate header button shows the notes list. [PR #20](https://github.com/kcosr/herdr-web/pull/20)
- Kept the new-tab button pinned at the right edge of the top tab bar while the tab list scrolls.
  [PR #20](https://github.com/kcosr/herdr-web/pull/20)
- Improved terminal reconnect/resume handling so Android foregrounding and quick terminal switches
  keep the renderer stable, avoid stale tab flashes, and suppress transient connecting overlays.
  [PR #19](https://github.com/kcosr/herdr-web/pull/19)

## [0.2.1] - 2026-06-20

### Added

- Added a Terminal font size setting. [PR #16](https://github.com/kcosr/herdr-web/pull/16)
- Added desktop click-to-open support for detected HTTP(S) terminal URLs.
  [PR #16](https://github.com/kcosr/herdr-web/pull/16)

### Changed

- Added a Mobile setting for long-press behavior, with Off, Copy, and Loupe modes; Loupe uses a
  two-stage endpoint flow, selected URLs keep the action sheet, and tapped HTTP(S) URLs open
  directly; original mobile selection work contributed by Will Hampson.
  [PR #16](https://github.com/kcosr/herdr-web/pull/16)

### Fixed

- Fixed Android/tablet bridge color picker dismissal so saving a backend after choosing a color
  keeps the Settings dialog open. [PR #16](https://github.com/kcosr/herdr-web/pull/16)
- Fixed sidebar keyboard shortcuts so agent and tab navigation follows the visible host/sidebar
  order across selected-host and all-host views. [PR #18](https://github.com/kcosr/herdr-web/pull/18)

## [0.2.0] - 2026-06-19

### Added

- Added multi-bridge connections, allowing multiple saved bridges to stay enabled at once with
  server chips and an all-agents sidebar overview. [PR #17](https://github.com/kcosr/herdr-web/pull/17)
- Added a bridge `--allow-connect-origin` option so bridge-served web pages can opt into connecting
  to other trusted bridge origins without relaxing the default Content Security Policy.
  [PR #17](https://github.com/kcosr/herdr-web/pull/17)
- Added a Host + workspace grouping option for agent lists.
  [PR #17](https://github.com/kcosr/herdr-web/pull/17)
- Added configurable bridge colors with a mobile-friendly color picker.
  [PR #17](https://github.com/kcosr/herdr-web/pull/17)

### Changed

- Moved sidebar agent/tab sorting and grouping controls into a vertical options menu, and removed
  redundant host prefixes from grouped tab labels. [PR #17](https://github.com/kcosr/herdr-web/pull/17)

## [0.1.2] - 2026-06-18

### Added

- Added a bridge-owned agent activity stream so pane status, title, display agent, and custom
  status updates reach connected browsers without waiting for a full snapshot refresh; concepts
  derived from the @roy-levi-amazon fork. [PR #11](https://github.com/kcosr/herdr-web/pull/11)
- Added Display settings for top/bottom app padding and mobile terminal controls size.
  [PR #13](https://github.com/kcosr/herdr-web/pull/13)
- Added configurable terminal input transport, with binary payload concepts derived from the
  @roy-levi-amazon fork. [PR #12](https://github.com/kcosr/herdr-web/pull/12)
- Added opt-in terminal input batching controls with a fixed 32-byte flush threshold for slow
  connections. [PR #12](https://github.com/kcosr/herdr-web/pull/12)
- Added a Shift-Tab key to the expanded mobile terminal key panel. [PR #11](https://github.com/kcosr/herdr-web/pull/11)

### Changed

- Coalesced fast terminal output bursts in the bridge before forwarding them to browser clients,
  with a per-client Terminal output batching setting for tuning frame churn during rapid TUI
  redraws; concepts derived from the @roy-levi-amazon fork.
  [PR #14](https://github.com/kcosr/herdr-web/pull/14)
- Reworked Settings into Bridge, Terminal, and Mobile areas, with horizontal area tabs on narrow
  screens. [PR #12](https://github.com/kcosr/herdr-web/pull/12)
- Improved browser startup by lazy-loading the terminal renderer with retry after load failures,
  adding installable mobile web app metadata and raster icons, and compressing static
  bridge-served web assets; concepts derived from the @roy-levi-amazon fork.
  [PR #10](https://github.com/kcosr/herdr-web/pull/10)

## [0.1.1] - 2026-06-17

### Breaking Changes

### Added

- Added a native Android setting, on by default, to blur text inputs and refit the terminal after
  the keyboard closes.
- Added an opt-in mobile terminal long-press selection setting with drag-to-copy selection, selected
  URL actions, and touch hit-testing for Ghostty-detected links.

### Changed

- Changed bridge URL validation so users can save HTTP bridge URLs at any valid host or IP address.

### Fixed

- Forced and reapplied Android dark system bar styling with light status/navigation bar icons.
- Removed duplicate bottom safe-area padding inside the mobile terminal controls.

### Removed

## [0.1.0] - 2026-06-16

### Added

- Initial release.
