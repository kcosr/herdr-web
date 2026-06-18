# Changelog

## [Unreleased]

### Breaking Changes

### Added

- Added bridge state-stream admission control, per-stream refresh rate limiting, and opaque stream
  and refresh IDs.
- Added live state stream design documentation covering Herdr API adaptation and recovery behavior.
- Added PWA metadata and mobile safe-area handling for installed/mobile browser use.

### Changed

- Changed browser commands that can affect workspace structure to explicitly refresh state streams
  after success instead of relying on structural subscription replay.
- Changed bridge capability probing to require explicit web protocol compatibility metadata.
- Changed terminal panes to keep recently used terminals mounted, send keystroke input as binary
  WebSocket frames, lazy-load Ghostty, and split terminal/react bundles for faster switching and
  smaller app chunks.
- Changed mobile terminal controls and dialog inputs to avoid Safari zoom and use larger touch
  targets on touch layouts.
- Moved state-stream pane/workspace/tab enrichment off the async WebSocket loop and tightened
  frontend state refresh scheduling around reconnects, timeouts, and queued refresh triggers.

### Fixed

- Reduced structural refresh subscription reconnect noise with capped backoff and fewer redundant
  broadcasts.
- Reduced stale-state windows after failed state-stream resyncs by scheduling shorter retry follow-ups
  and waiting briefly for busy bridge patch workers before forcing resync.

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
