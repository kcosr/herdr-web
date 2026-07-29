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

`@parlay/client` (used by the optional parlay-backed mobile command input, see
`src/ParlayMobileInput.tsx`) is a local, unpublished sibling package, not an npm registry
dependency. It resolves via `file:./local-deps/parlay-client`, a path kept at a fixed depth so it
doesn't break for checkouts at a different on-disk location. Before `npm install`, point it at your
local parlay checkout:

```bash
mkdir -p local-deps
ln -s /path/to/parlay/packages/client local-deps/parlay-client
```

`local-deps/` is gitignored; each developer creates this symlink once, locally.

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
