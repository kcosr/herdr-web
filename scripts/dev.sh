#!/usr/bin/env bash
# Local development: bridge (API/WS) + Vite HMR frontend.
# Frontend: http://127.0.0.1:5173  (proxies /api and /ws to the bridge)
# Bridge:   http://127.0.0.1:8787  (also serves last web/dist build)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8787}"
VITE_PORT="${VITE_PORT:-5173}"
BRIDGE_BIN="${BRIDGE_BIN:-$ROOT/bridge/target/debug/herdr-web-bridge}"
STATIC_DIR="${STATIC_DIR:-$ROOT/web/dist}"

if [[ -z "${HERDR_SOCKET_PATH:-}" ]]; then
  if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
    export HERDR_SOCKET_PATH="$XDG_CONFIG_HOME/herdr/herdr.sock"
  elif [[ -n "${HOME:-}" ]]; then
    export HERDR_SOCKET_PATH="$HOME/.config/herdr/herdr.sock"
  fi
fi

if [[ ! -d "$ROOT/web/node_modules" ]]; then
  echo "web dependencies missing; run: npm install --prefix web" >&2
  exit 1
fi

if [[ ! -x "$BRIDGE_BIN" ]]; then
  echo "bridge binary not found; building..."
  npm run bridge:build --prefix "$ROOT"
fi

if [[ ! -d "$STATIC_DIR" ]]; then
  mkdir -p "$STATIC_DIR"
  # Minimal placeholder so ServeDir has a root; Vite serves the live UI.
  printf '%s\n' '<!doctype html><title>herdr-web bridge</title><p>Use the Vite dev server.</p>' \
    >"$STATIC_DIR/index.html"
fi

if [[ -n "${HERDR_SOCKET_PATH:-}" && ! -S "$HERDR_SOCKET_PATH" ]]; then
  echo "warning: Herdr socket not found at HERDR_SOCKET_PATH=$HERDR_SOCKET_PATH" >&2
  echo "start Herdr first, or set HERDR_SOCKET_PATH (e.g. \$HOME/.config/herdr-dev/herdr.sock)" >&2
fi

bridge_pid=""
cleanup() {
  if [[ -n "$bridge_pid" ]] && kill -0 "$bridge_pid" 2>/dev/null; then
    kill "$bridge_pid" 2>/dev/null || true
    wait "$bridge_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "starting bridge on http://${HOST}:${PORT}"
echo "  HERDR_SOCKET_PATH=${HERDR_SOCKET_PATH:-<unset>}"
"$BRIDGE_BIN" --host "$HOST" --port "$PORT" --static-dir "$STATIC_DIR" "$@" &
bridge_pid=$!

# Give the bridge a moment to bind (or fail loudly).
sleep 0.4
if ! kill -0 "$bridge_pid" 2>/dev/null; then
  wait "$bridge_pid" || true
  exit 1
fi

export HERDR_WEB_BRIDGE="${HERDR_WEB_BRIDGE:-http://${HOST}:${PORT}}"
echo "starting Vite HMR on http://127.0.0.1:${VITE_PORT} (proxy → $HERDR_WEB_BRIDGE)"
echo "open the Vite URL for hot reload; rebuild web/dist only for production static serving."
cd "$ROOT/web"
exec npm run dev -- --port "$VITE_PORT"
