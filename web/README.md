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

The app expects these bridge routes:

- `/api/capabilities`
- `/api/command`
- `/api/state/refresh`
- `/api/selection`
- `/api/uploads`
- `/ws/state`
- `/ws/terminal`
