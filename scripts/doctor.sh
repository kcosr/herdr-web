#!/usr/bin/env bash
# doctor.sh — herdr-web self-diagnosis. Run from any host that can reach the
# bridge; verifies the full chain and explains known client-console errors
# (which cannot be read remotely).
#
# Usage: scripts/doctor.sh [bridge-base-url]   (default http://localhost:8787)
# Exit 0 = all PASS/WARN only · 1 = at least one FAIL.

set -u
BASE="${1:-http://localhost:8787}"
fail=0

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
warn() { printf '  \033[33mWARN\033[0m %s\n' "$1"; }
failf(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=1; }

echo "== bridge process"
if pgrep -fl 'herdr-web-bridge' | grep -q .; then
  pass "running ($(pgrep -f 'herdr-web-bridge' | wc -l | tr -d ' ') process/es)"
else
  failf "no herdr-web-bridge process found"
fi

echo "== capabilities ($BASE/api/capabilities)"
caps=$(curl -fsS -m 5 "$BASE/api/capabilities" 2>/dev/null)
if [ -z "$caps" ]; then
  failf "capabilities endpoint unreachable"
else
  bv=$(printf '%s' "$caps" | jq -r '.bridge_version // empty')
  wc=$(printf '%s' "$caps" | jq -r '.web_compat // empty')
  tn=$(printf '%s' "$caps" | jq -r '.tailnet_name // empty')
  if [ -n "$bv" ]; then pass "bridge_version=$bv"; else warn "bridge_version absent — binary predates capability reporting (rebuild)"; fi
  if [ -n "$wc" ] && [ "$wc" -ge 1 ] 2>/dev/null; then pass "web_compat=$wc"; else failf "web_compat missing/<1 — web app will refuse this bridge"; fi
  if [ -n "$tn" ]; then pass "tailnet_name=$tn"; else warn "tailnet_name absent — Tailscale CLI unreachable from bridge PATH or not on a tailnet"; fi
fi

echo "== static assets"
served=$(curl -fsS -m 5 "$BASE/" 2>/dev/null | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
here=$(grep -oE 'index-[A-Za-z0-9_-]+\.js' "$(dirname "$0")/../web/dist/index.html" 2>/dev/null | head -1)
if [ -n "$served" ]; then
  pass "served asset $served"
  if [ -n "$here" ] && [ "$served" != "$here" ]; then
    warn "local dist differs ($here) — rebuild/redeploy if unintended"
  fi
else
  failf "no index served at $BASE/"
fi

echo ==" daemon socket"
SOCK="${HERDR_SOCK:-$HOME/.config/herdr/herdr.sock}"
if [ -S "$SOCK" ]; then pass "socket present: $SOCK"; else failf "daemon socket missing: $SOCK"; fi

echo "== remote bridges"
REMS=$(ps aux | grep 'herdr-web-bridge' | grep -oE '\-\-remote-bridge http://[^ ]+' | awk '{print $2}' | sort -u)
if [ -z "$REMS" ]; then
  echo "  (none configured)"
fi
for r in $REMS; do
  code=$(curl -sS -m 4 -o /dev/null -w '%{http_code}' "$r/api/capabilities" 2>/dev/null)
  name=${r#http://}; name=${name%%:*}
  if [ "$code" = "200" ]; then
    pass "remote $name reachable (200)"
  else
    failf "remote $name → HTTP ${code:-none} — proxy calls to it will 502"
  fi
done

echo "== recent bridge log errors"
for LOG in "$HOME/.local/share/herdr-web/bridge.log" /tmp/hwb.log; do
  [ -f "$LOG" ] || continue
  n=$(grep -icE 'error|panic' "$LOG" 2>/dev/null)
  if [ "${n:-0}" -gt 0 ]; then
    warn "$LOG has $n error-ish lines; last:"
    grep -iE 'error|panic' "$LOG" | tail -1 | cut -c1-160
  else
    echo "  $LOG: clean"
  fi
done

cat <<'EOF'
== client console legend (browser side is not remotely readable)
  "terminal resize skipped … renderer is not mounted"  → benign resize race on pane switch; spam only
  "terminal attach failed: connection is not pending"  → stale socket after a bridge restart → reload the page
  "Could not establish connection … apply.js/inject"   → browser extension noise, unrelated
EOF

exit $fail
