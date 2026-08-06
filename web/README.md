# @herdr/web

React + Vite frontend for `herdr-web`.

Run from this directory:

```bash
npm install
npm run dev
npm run lint
npm run test
npm run build
```

The production build is written to `web/dist/` and served by `herdr-web-bridge` through
`scripts/run-bridge.sh`.

During development, run the bridge separately and use the Vite server for the frontend:

```bash
# terminal 1, from repo root
npm run bridge:build
scripts/run-bridge.sh

# terminal 2, from repo root
npm run dev:web
```

`scripts/run-bridge.sh` points debug bridge builds at the stable Herdr socket by default instead of
the debug `herdr-dev` socket. Override `HERDR_SOCKET_PATH` when targeting a named or development
session.

## Optional: Enable Parlay-backed Mobile Voice Input

The `ParlayMobileInput` component (`src/ParlayMobileInput.tsx`) is optional and degrades gracefully
to a plain text input when parlay is unavailable. To enable parlay voice-submit phrase detection,
set up a local symlink to your parlay checkout:

```bash
mkdir -p web/local-deps
ln -s /path/to/parlay/packages/client web/local-deps/parlay-client
```

`@parlay/client` is intentionally NOT listed in `package.json`/`package-lock.json` (it is never
published and never fetched from a registry). The Vite resolver in `vite.config.ts` picks up the
symlink directly, so no reinstall is needed — just restart the dev server / rebuild after creating
it.

Parlay requires the eval engine and server running locally:

```bash
# Terminal 1: eval engine
cd /path/to/parlay/packages/eval-engine && ./parlay-eval-engine

# Terminal 2: parlay server
cd /path/to/parlay/packages/server && bun run start  # :4242
```

Voice-submit phrases are configured in parlay (defaults: "bravely", "gravely", "briefly", "lap").

If the symlink is missing or stale, the app will still build and run with the plain-text mobile
input — no special action needed. `web/local-deps/` is gitignored.

## Vite dev server environment variables:

- `HERDR_WEB_BRIDGE` — bridge URL the dev server proxies `/api` and `/ws` to. Defaults to
  `http://127.0.0.1:8787`.
- `HERDR_WEB_ALLOWED_HOSTS` — comma-separated list of hostnames the Vite dev server accepts `Host`
  headers from, e.g. `dev.example.ts.net`. Useful when reaching the dev server over Tailscale, a
  tunnel, or a reverse proxy. Set to `*` to allow any host. Unset by default (Vite's standard host
  restrictions apply).

The app expects these bridge routes:

- `/api/capabilities`
- `/api/snapshot`
- `/api/command`
- `/api/launcher-presets`
- `/api/launcher-presets/launch`
- `/api/selection`
- `/api/notes` (and `/api/notes/{note_id}/...` actions)
- `/api/agent-pins` (and `/api/agent-pins/{pane_id}/pin|unpin`)
- `/api/agent-activity`
- `/api/mobile-mode`
- `/api/uploads`
- `/ws/activity`
- `/ws/events`
- `/ws/ui-events`
- `/ws/terminal`
