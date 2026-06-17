# Changelog

## [Unreleased]

### Breaking Changes

### Added

- Added an opt-in mobile terminal long-press selection setting with drag-to-copy selection, selected
  URL actions, and touch hit-testing for Ghostty-detected links.

### Changed

### Fixed

### Removed

## [0.1.0] - 2026-06-16

### Added

- Added a standalone `herdr-web-bridge` Rust executable so the web bridge builds outside Herdr's
  full CLI package and avoids the vendored `libghostty-vt` build path.
- Added a Capacitor Android shell that bundles the web app, stores bridge profiles with native
  Preferences, starts disconnected until a bridge is selected, and supports debug APK builds.
- Added bridge `--allow-origin` and `--allow-host` options with CORS preflight support for bundled
  Android bridge access and explicit hostname backends.
- Added `herdr-web-bridge --session NAME` to target a named Herdr session while ignoring
  `HERDR_SOCKET_PATH`.
- Added Android build, sync, HTTP/cleartext, and smoke-test documentation.
- Added named bridge backend profiles and a settings dialog for switching the active backend.
- Added a bridge capabilities endpoint so the web app can discover supported commands without
  sending probe commands to Herdr.
- Added pane context-menu actions to move a pane into a new tab or a new workspace when the bridge
  exposes `pane.move`.
- Added styled Codex/OpenAI, Claude, and Pi icons in the agent list.
- Added a clear-name action for workspace and tab rename dialogs so custom names can return to
  their default labels.
- Added release-process documentation and a GitHub Release script.
- Added a desktop tarball packaging script for bridge/web release artifacts.
- Added packaging documentation for Linux/macOS tarballs, Android APK artifacts, and manual GitHub
  release uploads.
- Added a run-focused README for desktop tarball distributions.
- Added top-level agent onboarding guidance for web app, bridge, vendoring, testing, and release work.
- Added a mobile terminal tap-focus setting and a stage-only text input action.

### Changed

- Changed bridge build, test, and run scripts to use the repo-owned `herdr-web-bridge` executable
  instead of invoking `herdr web-bridge` from the vendored Herdr package.
- Split README setup guidance into release quick-start and source development sections.
- Clarified Android debug APK release artifact naming separately from future signed release APKs.
- Updated the vendoring strategy so only a minimal `vendor/herdr-compat` crate is checked in
  instead of the full upstream Herdr source tree.
- Removed bridge build-time path imports from `vendor/herdr/src` and moved copied compatibility
  modules for IPC, runtime status, socket path discovery, bridge file logging, API schema, and
  terminal protocol into `vendor/herdr-compat`.
- Added vendoring checks that reject a restored full `vendor/herdr` tree and optionally compare
  exact upstream schema/protocol copies when `HERDR_SRC` points at a Herdr checkout.
- Added a bridge `Host` header allow-list and basic static security headers.
- Narrowed web bridge validation for workspace and tab creation parameters.
- Narrowed web bridge command validation for browser-launched pane input, splits, and agent starts.
- Added same-origin browser request checks to bridge API and WebSocket routes.
- Changed the Android shell origin to `http://localhost` with cleartext enabled for trusted-LAN
  HTTP bridge URLs.
- Added the Herdr logo to the app header and Android launcher icon.
- Disabled Android cloud backup for the shell and removed unused Capacitor mixed-content/deprecated
  runtime config.
- Included Rust formatting checks for the bridge in the root lint command.
- Changed mobile terminal taps to focus the text input by default, with raw terminal focus behind
  a keyboard-row button.
- Moved mobile arrow keys into the expanded keyboard and added separate `1`, `2`, and `3` quick keys.
- Changed new-tab launches so the entered title names the created pane while default-looking single-pane tabs display that pane title.
- Added bridge-provided clear-name state to snapshots so the web UI does not guess whether a workspace
  or tab name is already default.

### Fixed

- Sent desktop `Shift+Tab` through the web terminal as backtab instead of letting it fall through
  to browser focus traversal or plain Tab handling.
- Allowed the embedded Ghostty WASM loader under the bridge CSP so the terminal renderer can mount.
- Reworded terminal attach conflict copy and reports when uploads skip files beyond the batch limit.
- Rechecked sanitized upload filenames after truncation.
- Pointed the bridge launcher at the stable Herdr socket by default so the debug bridge does not
  fall back to `herdr-dev`.
- Fixed sidebar active workspace selection so explicit space picks are not overridden by a previously selected pane.
- Made terminal upload controls keyboard-operable and guarded upload status against overlapping uploads.
- Avoided duplicate default agent names when launching repeated agent splits.
- Kept clear-name requests compatible with older running Herdr daemons by translating them in the bridge.
- Hid the clear-name action when a workspace or tab is already using its default label.
- Preserved custom CORS preflight request headers for future bridge auth headers.
- Re-probed and reconnected active Android bridge sessions promptly after app foreground/resume.
- Centered the mobile header summary next to the Herdr logo and app title.
- Added a bounded timeout to the bridge startup daemon protocol check so an accepted but
  unresponsive Herdr daemon returns actionable restart guidance instead of blocking indefinitely.

### Removed

- Removed the full `vendor/herdr/` source snapshot and the legacy vendored `herdr web-bridge`
  overlay from this repository.
