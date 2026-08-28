# Changelog

## [Unreleased]

### Breaking Changes

- Reconciled this fork's `main` with upstream `kcosr/herdr-web` `v0.5.0`. The bridge now requires
  Herdr `v0.8.2` or newer reporting terminal protocol `20`; the fork's previous `v0.8.0`/protocol
  `19` baseline (and its wider `16..=19` accept range) is gone, so Herdr `v0.8.0`/`v0.8.1` daemons
  are rejected at startup. Upgrade Herdr before upgrading the bridge.

### Added

- Added Talk Back v1: gesture-primed `speechSynthesis` narration of the focused pane. Output is
  ANSI-stripped and settle-debounced so it speaks finished lines rather than every redraw, with a
  mute toggle in the header and device-local persisted preferences.

- Added `scripts/tailnet-bridge-check.sh`, a tailnet-wide bridge reachability and version
  compatibility matrix runnable from any host, plus `scripts/doctor.sh` for local environment
  checks.

- Added Playwright-based visual-space geometry harness (`npm run test:vspace` in `web/`) that
  asserts layout contracts for the mobile input panel at iPhone Pro Max (430×932) viewport:
  panel height ≤ 50% of viewport, terminal area ≥ 200 px under keyboard inset, textarea width
  dominates the input row, send button always inside viewport, special-keys strip absent when
  compact, and expanding textarea bounded by CSS max-height — no screenshots or vision models.

- Added a light/dark theme toggle (Sun/Moon button in the switcher header, next to
  Settings/Refresh). Light mode uses the Catppuccin Latte palette; the choice persists with the
  other display preferences and is applied on load. The app UI switches immediately; a terminal
  pane keeps the palette it was created with and adopts the new theme the next time it is created
  (new tab, reconnect, or reload), because the terminal's colors are fixed when it starts. Live
  terminal color-sync is tracked as a follow-up.

- Added real-time agent search/filter to the sidebar agents view: a compact text input appears
  above the agent list when any agents are present. Typing filters by agent title, meta (agent
  name + directory), workspace label, and tab label. Pressing Escape clears the filter; switching
  away from the agents view also clears it. Shows a "No matches" state with a clear button when
  the filter yields zero results.

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
- Added a bundled JetBrainsMono Nerd Font Mono fallback for special terminal and LLM output glyphs
  on devices without an accessible Nerd Font.
  [PR #74](https://github.com/kcosr/herdr-web/pull/74), contributed by
  [Craig P. Motlin (@motlin)](https://github.com/motlin).

### Changed

- Made the parlay-backed command composer the single terminal input experience at every viewport
  width and pointer type. Previously the composer (key strip, expanding/voice input, stage/send
  buttons) rendered only on touch devices (`(hover: none) and (pointer: coarse)`); wide desktop
  viewports had no composer and typed directly into the terminal. Desktop now gets the same input
  bar, layout, styling, and key handling — parlay owns input everywhere. Renamed `ParlayMobileInput`
  → `ParlayInput` to reflect that it is no longer mobile-specific. Terminal focus-on-attach
  (`autoFocus`) and wheel scroll speed remain tuned per pointer device.
  [PR #22](https://github.com/trillium/herdr-web/pull/22)
- The "Same origin" backend entry now leads with the machine's own Tailscale tailnet name
  (e.g. `macbook.tailnet.ts.net:8787`) instead of the generic "Same origin" label, so an agent
  reachable at `http://localhost:PORT` advertises a name another device on the tailnet can
  actually connect to. The served origin stays visible as the entry's subtitle. The bridge
  resolves its tailnet name server-side via `tailscale status --json` (`Self.DNSName`) and
  reports it in `GET /api/capabilities` as `tailnet_name`, resolving it at most once and caching
  the result. When Tailscale is absent, stopped, or the machine is not on a tailnet, the field is
  omitted and the UI falls back to the previous "Same origin" behavior.
  [PR #23](https://github.com/trillium/herdr-web/pull/23)
- Made `@parlay/client` a permanently optional, local-only, never-published dependency so fresh
  worktrees and CI build cleanly when the local `web/local-deps/parlay-client` symlink is absent.
  It is no longer referenced in `web/package.json`/`web/package-lock.json` (so `npm ci` never
  resolves it from a registry); the Vite resolver picks up the symlink for `vite dev`, tests, and
  production builds when present, builds without the symlink externalize it, and `ParlayInput`'s
  guarded dynamic import falls back to a plain text input at runtime when the module is absent.
  Removed the dead `vite.config.ts`
  stub module and the duplicate `web/src/@parlay-client.d.ts` type shim (the canonical ambient
  declaration is `web/types/parlay-client.d.ts`).
  [PR #18](https://github.com/trillium/herdr-web/pull/18)
- Refreshed the vendored `herdr-compat` crate to the herdr `v0.8.0` baseline (wire protocol `19`,
  up from `v0.7.2`/protocol `16`): copied the exact-compared API schema surface and the
  `protocol::wire` body, added minimal `input`/`raw_input`/`popup_size` supporting shims for the
  new upstream types they reference, and migrated the bridge's launcher agent-split to herdr
  `v0.8.0`'s redesigned `agent.start` (which now starts a managed agent in an existing pane instead
  of creating and placing the pane itself).
- Compress terminal output with gzip when the client and bridge both support it.
  [PR #59](https://github.com/kcosr/herdr-web/pull/59)
- Stop blinking the terminal cursor on touch devices so idle terminals do not keep redrawing.
  Desktop cursors still blink.
  [PR #60](https://github.com/kcosr/herdr-web/pull/60)

### Fixed

- Fixed a typing hitch on desktop while an agent was actively producing output. Snapshot updates
  (the 10s poll, agent-status activity bursts, and shared selection events) reconciled the whole
  app tree synchronously and blocked terminal keystroke handling on the main thread. Those updates
  are now applied as low-priority React transitions, so keystrokes stay responsive and panel
  updates remain interruptible.

- Fixed parlay voice-submit never working in built apps. Production builds externalized
  `@parlay/client` unconditionally, emitting a stub the browser could never load, so every
  deployed build silently fell back to the plain input and trailing phrases such as "bravely" did
  not send. Builds made on a machine with the local `web/local-deps/parlay-client` symlink now
  bundle the real client, and the entry is resolved from that package's own `exports`/`main`
  instead of a hardcoded `dist/index.js`. Builds without the symlink are unchanged: the specifier
  is still externalized and the input degrades to a plain text field. Note that this makes
  `web/dist` (and therefore release tarballs) depend on whether the build host had the symlink.

- Fixed the mobile "next agent" / "previous agent" command doing nothing: the parlay command
  context's `tabs.next`/`tabs.prev` hooks were no-op stubs, so typing or speaking "next agent"
  (or "next tab" / "previous agent") in the mobile command input never switched panes. They now
  route through the same tested `nextVisibleAgentPaneEntry` + `focusPane` navigation used by the
  desktop ArrowUp/ArrowDown shortcut, matching its wrap-at-ends behavior.
  [PR #19](https://github.com/trillium/herdr-web/pull/19)
- Fixed the terminal view being torn down by an uncaught `TypeError: crypto.randomUUID is not a
  function` whenever the mobile command input mounted on a page served over plain HTTP to a
  non-localhost origin (LAN IP, `.local` name, Tailscale address) — i.e. every real phone/tablet
  session. `crypto.randomUUID` is secure-context only and `http://localhost` counts as secure, so
  local dev never hit it. Session id generation now goes through a shared `randomId()` helper that
  falls back to `crypto.getRandomValues` (not secure-context gated, so the ids stay
  collision-resistant and unguessable across tabs) and then to a clock/`Math.random` last resort.
  `bridge.tsx`'s backend id generation was already guarded and now shares the same helper.
  [PR #17](https://github.com/trillium/herdr-web/pull/17)
- Fixed `npm run check` failing in `web/` with 7 ESLint errors in `ParlayMobileInput.tsx`
  (four `react-hooks/rules-of-hooks` from hooks called below the no-parlay early return, three
  `no-explicit-any`). Hooks are now unconditional and the parlay client is properly typed; the
  no-parlay path still renders a plain input, now with test coverage.
  [PR #17](https://github.com/trillium/herdr-web/pull/17)
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
- Join canvas-wrapped HTTP(S) URLs when copying from a mobile terminal.
  [PR #61](https://github.com/kcosr/herdr-web/pull/61)

### Removed

## [0.5.0] - 2026-08-21

### Breaking Changes

- The bridge now requires Herdr `v0.8.2` or newer reporting terminal protocol `20`. Herdr
  `v0.8.0` and `v0.8.1` daemons (protocol `19`) are rejected at startup.
  [PR #69](https://github.com/kcosr/herdr-web/pull/69)

### Changed

- Refreshed the vendored Herdr compatibility sources to the `v0.8.2`/protocol `20` baseline.
  The new protocol `20` server message variants (`TerminalBell`, `GraphicsFile`,
  `GraphicsTransmissionRetired`) decode but are ignored by the bridge, adding no new behavior.
  [PR #69](https://github.com/kcosr/herdr-web/pull/69)
- Compress terminal output with gzip when the client and bridge both support it.
  [PR #59](https://github.com/kcosr/herdr-web/pull/59), contributed by
  [Will Hampson (@Whamp)](https://github.com/Whamp).
- Changed the Attention agent sort to break ties within an attention band by the most recent agent
  status change, matching Herdr's Priority agent panel, and kept the existing bridge, Space, and tab
  order as the fallback for agents with no recorded transition.
  [PR #68](https://github.com/kcosr/herdr-web/pull/68), contributed by
  [Craig P. Motlin (@motlin)](https://github.com/motlin).
- Stop blinking the terminal cursor on touch devices so idle terminals do not keep redrawing.
  Desktop cursors still blink.
  [PR #60](https://github.com/kcosr/herdr-web/pull/60), contributed by
  [Will Hampson (@Whamp)](https://github.com/Whamp).

### Fixed

- Join canvas-wrapped HTTP(S) URLs when copying from a mobile terminal.
  [PR #61](https://github.com/kcosr/herdr-web/pull/61), contributed by
  [Will Hampson (@Whamp)](https://github.com/Whamp).

## [0.4.3] - 2026-08-17

### Added

- Added an optional screen-reader text mirror for visible terminal contents, with bounded updates
  and concealed-cell filtering. [PR #64](https://github.com/kcosr/herdr-web/pull/64), based on the
  concept proposed by
  [shuv (@shuv1337)](https://github.com/shuv1337) in
  [PR #37](https://github.com/kcosr/herdr-web/pull/37).

### Fixed

- Improved keyboard focus behavior for dialogs and action menus: modal focus stays contained,
  menus support arrow, Home, and End navigation, Tab exits menus normally, and dismissing an
  overlay restores its opener. [PR #62](https://github.com/kcosr/herdr-web/pull/62), based on work
  proposed by [shuv (@shuv1337)](https://github.com/shuv1337) in
  [PR #37](https://github.com/kcosr/herdr-web/pull/37).

## [0.4.2] - 2026-08-15

### Added

- Added `npm run dev` to supervise the bridge and Vite HMR server together, wait for bridge
  readiness, proxy API and WebSocket traffic, and stop both processes cleanly.
  [PR #57](https://github.com/kcosr/herdr-web/pull/57), based on work proposed by
  [Hopkins (@LosEcher)](https://github.com/LosEcher) in
  [PR #51](https://github.com/kcosr/herdr-web/pull/51).
- Declared the existing Herdr logo as the browser favicon.
  [PR #56](https://github.com/kcosr/herdr-web/pull/56), contributed by
  [Craig P. Motlin (@motlin)](https://github.com/motlin).

### Changed

- Static bridge responses now explicitly revalidate HTML and public files while caching successful
  content-hashed Vite assets as immutable. Error responses are never marked immutable.
  [PR #57](https://github.com/kcosr/herdr-web/pull/57), based on work proposed by
  [Hopkins (@LosEcher)](https://github.com/LosEcher) in
  [PR #51](https://github.com/kcosr/herdr-web/pull/51).

### Fixed

- Fixed CJK and other IME terminal input so preedit stays local, committed text is sent exactly
  once, canceled composition is discarded, and the candidate window and visible preedit stay near
  the terminal cursor. [PR #58](https://github.com/kcosr/herdr-web/pull/58), based on work proposed
  by [Hopkins (@LosEcher)](https://github.com/LosEcher) in
  [PR #51](https://github.com/kcosr/herdr-web/pull/51).
- Fixed icons rendering slightly off-center in square icon buttons (sidebar section header
  actions and the tab bar's new-tab button) by resetting the user-agent button padding, and
  removed the per-icon transform that compensated for it.
  [PR #55](https://github.com/kcosr/herdr-web/pull/55), contributed by
  [Philippe SEGATORI (@tigitz)](https://github.com/tigitz).

## [0.4.1] - 2026-08-05

### Breaking Changes

- Herdr `v0.8.0` or newer with terminal protocol exactly `19` is now required. The bridge rejects
  the previous protocol `17` baseline and other unreviewed protocols instead of attempting a
  backward-compatible wire fallback. [PR #48](https://github.com/kcosr/herdr-web/pull/48)

### Added

- Added a contextual Move Space mode to the Spaces menu. The selected space card becomes draggable,
  retains a cancel control and arrow/Home/End keyboard support, mutes unrelated sidebar actions
  until the move is completed or canceled, and moves worktree groups atomically within their host's
  canonical workspace order. [PR #48](https://github.com/kcosr/herdr-web/pull/48)
- Added persistent expand/collapse controls to grouped Agents, Tabs, and Spaces headers, including
  independent, visually nested host and workspace controls for Host + workspace grouping and a
  bulk expand/collapse control for the current Agents or Tabs list.
  [PR #47](https://github.com/kcosr/herdr-web/pull/47)
- Added a default-off Display setting that combines same-named workspaces across hosts when using
  Workspace grouping, while retaining host context on each agent or pane row.
  [PR #47](https://github.com/kcosr/herdr-web/pull/47)

### Changed

- Refreshed the minimal vendored Herdr compatibility sources to the `v0.8.0`/protocol `19`
  baseline, including the current API schemas, terminal wire definitions, and input model shims.
  [PR #48](https://github.com/kcosr/herdr-web/pull/48)
- Follow Herdr's canonical workspace order when atomic worktree groups are reordered.
  [PR #48](https://github.com/kcosr/herdr-web/pull/48)
- Simplified Workspace grouping in the Agents and Tabs sidebars to show workspace-only group
  headers and move host context into each detail row. Host + workspace grouping keeps its nested
  host and workspace headers. [PR #47](https://github.com/kcosr/herdr-web/pull/47)

### Fixed

- Fixed built-in agent launches against Herdr `v0.8.0` by waiting for a newly created pane's shell
  to become available before starting the managed agent.
  [PR #48](https://github.com/kcosr/herdr-web/pull/48)

## [0.4.0] - 2026-07-30

### Breaking Changes

- Herdr `v0.7.5` or newer with terminal protocol exactly `17` is now required. The bridge rejects
  older protocol `16` daemons and unreviewed newer protocols rather than attempting a
  backward-compatible wire fallback. [PR #45](https://github.com/kcosr/herdr-web/pull/45)
- Removed the obsolete `custom_status` field from bridge snapshots and activity events; agent
  presentation now uses Herdr's `state_labels`, title, display-agent, and status fields.
  [PR #45](https://github.com/kcosr/herdr-web/pull/45)
- Changed the default ungrouped Tabs and Spaces sidebar presentation to compact rows with inline
  host, Space, and tab context instead of contextual headers. Agent panes in Tabs also use the
  Agents row presentation and agent-aware ordering by default. Choose a grouping mode to restore
  contextual headers, or disable Agent features in Tabs to restore generic pane rows and the
  original tab order. [PR #41](https://github.com/kcosr/herdr-web/pull/41)

### Added

- Added a default-on client-local Sync navigation setting. Browser tabs and windows with sync off
  can view different panes through the same bridge without publishing or following shared pane
  selection or changing Herdr's focused tab through ordinary navigation.
  [PR #42](https://github.com/kcosr/herdr-web/pull/42)
- Added default-on Agent features in Tabs, including consistent Agents row metadata and pin
  placement, agent-aware sorting, and pinned-only and active-only filters. Non-agent tabs remain
  visible at the bottom of agent-aware sorts; disabling the setting restores generic pane rows.
  [PR #41](https://github.com/kcosr/herdr-web/pull/41)
- Added multi-host Spaces controls: Spaces can be shown as a flat list with host context or grouped
  under host headers, and the default-on Multi-host Space selection setting can be disabled to limit
  Space-scoped Agents, Tabs, and Notes to one globally selected Space. All scope remains unchanged.
  [PR #41](https://github.com/kcosr/herdr-web/pull/41)

### Changed

- Refreshed the minimal vendored Herdr compatibility sources to the `v0.7.5`/protocol `17` baseline,
  including the current API schemas and terminal wire definitions.
  [PR #45](https://github.com/kcosr/herdr-web/pull/45)
- Updated launching for Herdr `v0.7.5`: built-in agents use the managed `agent.start` flow after the
  destination pane is created. The bridge waits for interactive readiness and rolls back its new
  tab or pane after rejection, early process exit, or timeout. Custom launcher presets continue to
  execute their exact configured `argv`. [PR #45](https://github.com/kcosr/herdr-web/pull/45)
- Store the Sync navigation setting browser-wide while keeping sync-off pane selections only in
  memory. The app no longer creates per-tab navigation storage records.
  [PR #43](https://github.com/kcosr/herdr-web/pull/43)
- Simplified agent-row metadata by removing generic status text already communicated by the status
  indicator and badge, while retaining bridge-defined state labels.
  [PR #41](https://github.com/kcosr/herdr-web/pull/41)

### Fixed

- Cleared and remounted the mobile terminal command field after Send or Stage so stale native input
  cannot prefix the next command. [PR #44](https://github.com/kcosr/herdr-web/pull/44), with an
  earlier implementation contributed by
  [Alexander Makarov (@AlexanderMakarov)](https://github.com/AlexanderMakarov) in
  [PR #38](https://github.com/kcosr/herdr-web/pull/38).
- Fixed client-local navigation synchronization across reloads, reconnects, lagging snapshots, and
  rapid multi-client selection races. Sync-off split navigation now stays local, and independent
  clients no longer rewrite shared navigation persistence. After a bridge restart, the focused
  Herdr pane now seeds shared navigation so synced clients immediately converge.
  [PR #43](https://github.com/kcosr/herdr-web/pull/43)

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
