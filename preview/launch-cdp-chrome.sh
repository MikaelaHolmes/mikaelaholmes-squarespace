#!/usr/bin/env bash
# Launch Chrome on this Mac with a CDP debugging port and a dedicated
# user-data-dir so Playwright scripts can attach (`SQS_CDP=...`) and reuse
# the logged-in Squarespace session. Headed only — macOS keychain blocks
# headless OAuth token decryption, so this is the only reliable path.
#
# Default: off-screen so it runs invisibly. Pass `--onscreen` to put it on
# the visible desktop (useful for first-time login or debugging).
#
# Usage:
#   ./launch-cdp-chrome.sh                  # off-screen (background)
#   ./launch-cdp-chrome.sh --onscreen       # visible window
#   ./launch-cdp-chrome.sh --onscreen --url https://login.squarespace.com/
#   ./launch-cdp-chrome.sh --port 9222      # override CDP port
#   ./launch-cdp-chrome.sh --kill           # close just the CDP Chrome
#
# Env overrides:
#   SQS_CDP_PORT=9222
#   SQS_CDP_PROFILE=$HOME/sqs-pw-profile
set -euo pipefail

PORT="${SQS_CDP_PORT:-9222}"
PROFILE="${SQS_CDP_PROFILE:-$HOME/sqs-pw-profile}"
URL=""
ON_SCREEN=0
DO_KILL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --onscreen)  ON_SCREEN=1; shift ;;
    --offscreen) ON_SCREEN=0; shift ;;
    --port)      PORT="$2"; shift 2 ;;
    --profile)   PROFILE="$2"; shift 2 ;;
    --url)       URL="$2"; shift 2 ;;
    --kill)      DO_KILL=1; shift ;;
    -h|--help)   sed -n '1,/^set -e/p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [ "$DO_KILL" = 1 ]; then
  pkill -f "remote-debugging-port=${PORT}" 2>/dev/null || true
  echo "killed CDP Chrome on port ${PORT} (if it was running)"
  exit 0
fi

# Idempotent: if our CDP port is already up with our profile, just print.
if curl -sf -m 2 "http://localhost:${PORT}/json/version" >/dev/null 2>&1; then
  if pgrep -f "remote-debugging-port=${PORT}.*${PROFILE}" >/dev/null 2>&1; then
    echo "CDP Chrome already running on :${PORT} with ${PROFILE}"
    [ -n "$URL" ] && curl -sf -X PUT "http://localhost:${PORT}/json/new?${URL}" >/dev/null && echo "opened tab: $URL"
    exit 0
  fi
  echo "port ${PORT} busy with a different process — exiting" >&2
  exit 1
fi

mkdir -p "$PROFILE"

ARGS=(
  --remote-debugging-port="$PORT"
  --user-data-dir="$PROFILE"
  --no-first-run
  --no-default-browser-check
)
if [ "$ON_SCREEN" = 0 ]; then
  # Off-screen at -3000,-3000; small window so it doesn't gobble pixels if
  # somehow shown. Chrome respects --window-position only at startup.
  ARGS+=(--window-position=-3000,-3000 --window-size=1280,900)
fi
[ -n "$URL" ] && ARGS+=("$URL")

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME" >&2; exit 1; }

# Launch detached. `nohup` + `&` so closing this shell doesn't kill it.
nohup "$CHROME" "${ARGS[@]}" >/dev/null 2>&1 &
disown || true

# Wait for CDP to come up (up to ~6s).
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 0.5
  if curl -sf -m 1 "http://localhost:${PORT}/json/version" >/dev/null 2>&1; then
    BROWSER=$(curl -sf "http://localhost:${PORT}/json/version" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("Browser",""))')
    echo "CDP up on :${PORT} (${BROWSER})  profile=${PROFILE}  $([ "$ON_SCREEN" = 1 ] && echo onscreen || echo offscreen)"
    exit 0
  fi
done
echo "Chrome did not respond on :${PORT} within 6s" >&2
exit 1
