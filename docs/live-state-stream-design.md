# Live State Stream Design

This document explains why `herdr-web` has a bridge-owned workspace state stream and how it adapts
Herdr's local API into browser-safe state synchronization.

## Problem

The browser UI needs a coherent model of the current Herdr workspace:

- workspaces
- tabs
- panes
- layouts
- pane agent status
- bridge-owned selected pane

Herdr does not currently expose a single durable browser-ready state feed. The bridge has to build
that feed from two lower-level Herdr surfaces:

- request/response API calls for current state, such as listing panes, tabs, workspaces, and layouts
- event subscriptions for live daemon activity, such as agent status or structural changes

Those event subscriptions are transient streams. They are useful for live updates, but they are not
a replayable log with durable cursors that a browser can resume from after disconnecting or missing
messages. Events can also be partial: an event may say a pane changed, while the UI still needs the
current pane, workspace, and tab context to render the update safely.

## Goals

- Keep browser state fresher than polling can.
- Avoid full snapshot rebuilds for routine agent status and selection changes.
- Detect drift instead of silently applying out-of-order or incomplete updates.
- Keep recovery explicit when Herdr events are missed, subscriptions close, or a pane disappears
  during a refresh.
- Keep the browser protocol small and end-state oriented. The web app and bridge upgrade together,
  so the bridge does not maintain legacy snapshot/event fallback routes.

## Non-Goals

- This is not a durable event-log protocol. A browser cannot reconnect with a Herdr cursor and replay
  exactly what it missed.
- This does not provide full browser authentication.
- This does not solve terminal attach fanout inside Herdr. The bridge still owns terminal fanout for
  browser clients separately from workspace state.
- This does not solve first-load bundle size. Bundle splitting remains separate frontend work.

## Bridge-Owned Protocol

The browser consumes one state stream:

- `GET /ws/state`

The browser can request a targeted rebuild for its current stream:

- `POST /api/state/refresh`

The bridge sends an initial full `snapshot` and then sequenced messages. The important protocol
fields are bridge-owned:

- `stream_id`: identifies one browser state WebSocket connection.
- `generation`: identifies the current snapshot generation for that stream.
- `sequence`: increments for every message within that generation.
- `refresh_id`: correlates a browser refresh request with the snapshot or failure that settles it.

These fields are not Herdr cursors. They are local consistency checks between the bridge and one
browser client.

## Normal Flow

1. A browser opens `/ws/state`.
2. The bridge reserves a stream ID and admission-checks the connection.
3. The bridge asks Herdr for the current pane list.
4. The bridge opens Herdr event subscriptions for the current panes and state events.
5. The bridge builds a full snapshot from Herdr request/response APIs.
6. The bridge sends a `snapshot` message with `generation = 1`, `sequence = 1`, and the stream ID.
7. The browser applies later deltas only when generation and sequence match the model it already has.

If the browser sees a sequence gap, generation mismatch, unknown pane, or explicit
`resync_required`, it requests a targeted refresh using `/api/state/refresh`.

## Why Per-Client Streams

Each browser has independent state-sync needs:

- it connects and disconnects at different times
- it can miss different messages
- it has its own stream sequence
- it may request a refresh for its own stale stream
- it may be recovering while other browsers are healthy

Because Herdr subscriptions are transient and not replayable, a shared global stream would still
need per-client buffering, cursors, gap detection, and rebuild handling. This design makes that
per-client state explicit inside the bridge projection.

The bridge still shares Herdr commands and terminal attach sessions where that is appropriate. The
per-client part is the workspace state projection, not the whole Herdr session.

## Snapshots And Deltas

The stream intentionally mixes full snapshots and narrow deltas.

Snapshots are used when the bridge needs a known coherent base:

- initial stream setup
- targeted browser refresh
- structural events that are safer to rebuild than patch
- subscription lag or stream errors
- unknown panes or startup convergence failures

Deltas are used where Herdr events carry enough information to update the browser cheaply:

- pane agent status changes
- pane agent detection
- bridge-local selection changes

For pane status and detection deltas, the bridge enriches the event with current pane, workspace,
and tab context before sending it. That keeps the browser update self-contained.

## Structural Changes

Structural workspace changes are difficult to patch reliably from partial events. Examples include:

- workspace created, closed, renamed, or focused
- worktree opened or removed
- tab created, closed, focused, or renamed
- pane created, closed, focused, moved, or exited

For these, the bridge marks the snapshot cache dirty and broadcasts a refresh event to state
streams. Streams debounce nearby refresh events, rebuild a snapshot, and send the new generation to
the browser.

Browser commands that can affect structure also trigger an explicit state refresh after the command
succeeds. This avoids relying on Herdr event replay for commands the browser itself initiated.

## Refresh Correlation

When the browser needs a rebuild, it calls `/api/state/refresh` with its `stream_id` and a local
reason such as `manual`, `visibility`, `android_resume`, `resync_required`, or `safety`.

The bridge:

1. verifies the stream ID is active
2. applies per-stream refresh rate limiting
3. creates a `refresh_id`
4. marks the snapshot cache dirty
5. sends a targeted refresh event to that stream

The stream includes the `refresh_id` on the resulting `snapshot` or `resync_required` message. The
browser scheduler waits for that ID so it can distinguish its own requested rebuild from unrelated
state traffic.

## Drift And Recovery

The browser refuses to apply a delta when:

- it has no snapshot yet
- a message sequence is not the next expected value
- a message generation does not match the current generation
- a delta references an unknown pane
- a previous resync is still pending

When this happens, the browser requests a targeted refresh instead of guessing. If the bridge cannot
patch a stream safely, it marks that projection quiescent and emits `resync_required`. A quiescent
projection suppresses upstream deltas until a targeted refresh rebuilds it, while still allowing
known selection changes.

If Herdr restarts or a subscription closes, existing state streams can emit `resync_required` or
`error`. The browser reconnects or requests a refresh. Once Herdr is reachable again, the bridge
opens fresh subscriptions and sends a new snapshot.

## Backpressure And Limits

The bridge applies local limits because it has no full browser authentication yet:

- a maximum number of active `/ws/state` connections
- opaque UUID-based stream and refresh IDs
- per-stream refresh rate limiting
- bounded blocking workers for per-event Herdr enrichment

Blocking Herdr lookups used to enrich state deltas run off the async WebSocket loop. They are still
bounded because a wedged Herdr daemon can leave blocking tasks running until the underlying call
returns.

## Why Not Keep Polling

Polling `/api/snapshot` every few seconds is simpler, but it has poor behavior for this UI:

- agent status can look stale until the next poll
- every refresh rebuilds and transfers the full workspace state
- multiple clients duplicate the same full-state work
- missed or out-of-order event handling is implicit
- selection sync needs a separate UI event channel

The live state stream keeps the common path smaller and makes drift recovery explicit.

## Why Not Pure Events

Pure event application is not safe enough with the current Herdr API:

- events are transient, not durable
- some events are partial
- startup can race with structural changes
- browser clients can connect after events already happened
- applying every structural relationship from events would duplicate too much Herdr state logic

The bridge therefore uses events where they are reliable and snapshots where coherence matters more
than patching.

## Remaining Work

- Split the frontend bundle so first load improves independently of state-stream responsiveness.
- Continue auditing which Herdr events are safe to patch and which should force snapshot rebuilds.
- Add browser authentication or token-based access before treating non-loopback deployment as
  broadly safe.
- Revisit terminal attach ownership if Herdr exposes native multi-client terminal fanout.
