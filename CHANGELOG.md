# Changelog

## [Unreleased]

### Breaking Changes

### Added

- Added bridge state-stream admission control, per-stream refresh rate limiting, and opaque stream
  and refresh IDs.

### Changed

- Changed browser commands that can affect workspace structure to explicitly refresh state streams
  after success instead of relying on structural subscription replay.
- Moved state-stream pane/workspace/tab enrichment off the async WebSocket loop and tightened
  frontend state refresh scheduling around reconnects, timeouts, and queued refresh triggers.

### Fixed

- Reduced structural refresh subscription reconnect noise with capped backoff and fewer redundant
  broadcasts.

### Removed

- Removed the legacy browser snapshot polling and event WebSocket fallback; the web app now requires
  the bridge state stream.

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
