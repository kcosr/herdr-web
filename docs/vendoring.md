# Vendoring Herdr Compatibility

`herdr-web` vendors a small Herdr compatibility crate because the bridge depends on private API and
wire protocol details needed for its existing per-terminal ANSI attach behavior. Herdr v0.9.0 also
provides stable whole-tab endpoints, but this bridge deliberately retains the pane-oriented ANSI path.

## What Is Vendored

`vendor/herdr-compat/` is the only vendored Herdr source in this repository. It is a minimal local
Rust crate containing copied or lightly pruned compatibility code needed by `herdr-web-bridge`:

- JSON API client, status, request, response, and event schema types.
- Terminal attach wire protocol messages, framing, protocol constants, and frame data types.
- Local socket connection helpers.
- Client socket path derivation helpers.
- Small dependent model shims needed by copied schema/protocol modules.
- Bridge file logging adapted to accept a bridge-owned log directory.

`bridge/` remains the repo-owned executable:

- `bridge/src/main.rs` exposes the `herdr-web-bridge` command.
- `bridge/src/session.rs` owns active Herdr session, config directory, and socket path selection.
- `bridge/src/web_bridge.rs` owns the HTTP/WebSocket bridge implementation and browser command
  allow-list.
- `bridge/src/workspace.rs` owns web-specific workspace label derivation.

The full upstream Herdr source tree is intentionally not vendored. Do not recreate `vendor/herdr/`
or path-import files from an upstream checkout at build time.

The browser app is not vendored into Herdr. It lives at `web/`, and `herdr-web-bridge` serves
`web/dist` through `--static-dir`.

## Current Reference

- Upstream checkout: a clean Herdr source checkout outside this repository
- Upstream release baseline: `v0.9.0`
- Terminal wire baseline: protocol `22`
- Upstream commit: `b99002ac99b09e00b4ca692436cb15a6b0d676f1`

Use the upstream checkout as an external reference for audits and refreshes. It is not required to
build `herdr-web`.

## Why This Shape

The bridge needs private pieces from Herdr:

- `api::client::ApiClient`
- API schema enums and response types
- `protocol::{ClientMessage, ServerMessage, RenderEncoding, ...}`
- local IPC socket helpers
- protocol version constants
- direct terminal handshake, resize, scroll, and input frames

Vendoring only `vendor/herdr-compat` keeps these dependencies explicit without carrying the full
Herdr app, website, CI, terminal runtime build path, or legacy `herdr web-bridge` overlay. The cost
is that copied private protocol/API code can drift from upstream Herdr, so refreshes must be
intentional and reviewed.

The compatibility crate currently keeps `ratatui` and `crossterm` because upstream
`protocol::wire` includes semantic frame and input conversion types next to the terminal attach
messages used by the bridge. `herdr-web-bridge` requests terminal ANSI rendering, but keeping the
wire module broad makes protocol drift reviewable against upstream. Revisit this tradeoff if the
bridge narrows the drift check to only the terminal attach message regions.

## Refresh Process

Use a clean Herdr checkout at the reviewed `v0.9.0` release tag as the source reference. Do not
refresh from an experimental tree that may contain unrelated local drift. Copy the reviewed
upstream source files into the minimal compatibility crate; do not make the bridge compile against
the external checkout or recreate a full upstream vendor snapshot.

```bash
HERDR_SRC=/path/to/herdr
HERDR_WEB=/path/to/herdr-web
```

1. Verify the source checkout is clean:

```bash
git -C "$HERDR_SRC" status --short
git -C "$HERDR_SRC" rev-parse --short HEAD
```

2. Reconcile only the compatibility surface:

```text
src/api/client.rs          -> vendor/herdr-compat/src/api/client.rs
src/api/status.rs          -> vendor/herdr-compat/src/api/status.rs
src/api/schema.rs          -> vendor/herdr-compat/src/api/schema.rs
src/api/schema/*.rs        -> vendor/herdr-compat/src/api/schema/*.rs
src/protocol/wire.rs       -> vendor/herdr-compat/src/protocol/wire.rs
src/input/model.rs         -> vendor/herdr-compat/src/input.rs (pure input model)
src/raw_input.rs           -> vendor/herdr-compat/src/raw_input.rs (minimal protocol shim)
src/ipc.rs                 -> vendor/herdr-compat/src/ipc.rs
src/logging.rs             -> vendor/herdr-compat/src/logging.rs
src/popup_size.rs          -> vendor/herdr-compat/src/popup_size.rs
src/server/socket_paths.rs -> vendor/herdr-compat/src/server/socket_paths.rs
```

3. Preserve intentional local adaptations:

- `ApiClient` takes concrete socket paths; it must not know bridge session rules.
- `logging::init_file_logging` takes a concrete directory from the bridge.
- socket path helpers derive paths from supplied overrides/defaults; bridge session resolution stays
  in `bridge/src/session.rs`.
- `tabs.rs` and `workspaces.rs` keep bridge-internal clear-name sentinel fields; the bridge
  substitutes concrete default labels before forwarding rename requests to Herdr.
- `PopupSize` is public in the compatibility crate because copied public plugin schema fields expose
  it, while upstream keeps the type crate-visible inside the full Herdr crate. This visibility-only
  adaptation is expected by the vendor drift check.
- `input.rs` contains the upstream pure input model. Small config/terminal-theme shims satisfy
  shared wire types; terminal parsing and rendering remain owned by Herdr.
- Upstream wire serialization tests live in `protocol/wire/upstream_wire_tests.rs`; two tests requiring
  the native terminal key encoder are excluded. The production wire body remains exact and
  separately checked against the tagged source.
- `protocol.rs` and schema tests include bridge fixture tests for the reviewed protocol/schema
  baseline.

4. Run layout and optional upstream drift checks:

```bash
scripts/check-vendor.sh
HERDR_SRC="$HERDR_SRC" scripts/check-vendor.sh
```

The optional `HERDR_SRC` mode exact-compares unmodified schema files and the terminal wire protocol
production body (excluding the upstream test module). Locally adapted files are intentionally excluded from exact comparison and must be reviewed
manually during refresh. `PopupSize` is compared with only the documented visibility adaptation
allowed.

5. Re-run validation:

```bash
npm run lint
npm run test
npm run build
```

6. Smoke test:

```bash
scripts/run-bridge.sh
```

Open `http://127.0.0.1:8787`, attach multiple browser clients, switch panes, type, scroll, and use
the refit button after changing browser sizes.

## Compatibility Policy

The bridge pings Herdr's status API at startup and requires Herdr `v0.9.0` or newer with daemon
protocol exactly `22`. Older daemons and any unreviewed newer protocol are rejected before serving
the web app. The version floor covers the private JSON API shape, including the managed
`agent.start` contract; the exact protocol check protects the copied bincode terminal wire format.
This is not a complete stability guarantee because the bridge mirrors private APIs.

When updating Herdr:

- inspect `src/protocol/wire.rs`
- inspect API schema changes under `src/api/schema/`
- inspect terminal attach handling in `src/server/headless.rs`
- rerun `HERDR_SRC=/path/to/herdr scripts/check-vendor.sh`
- rerun bridge tests and a browser smoke test
- update this document if the bridge compatibility surface changes

## Long-Term Removal Condition

Remove `vendor/herdr-compat` when Herdr exposes enough public surface for the bridge to live outside
Herdr:

- public snapshot/events API
- public terminal websocket or stable terminal attach protocol crate
- multi-client terminal fanout or documented attach ownership
- exact pane focus/selection endpoint
- resize ownership model
- browser authentication story
