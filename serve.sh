#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="http://localhost:${PORT}/"

cd "$ROOT"

# Kill any existing http.server instances bound to this port (or any).
echo "Stopping any prior http.server instances on port $PORT..."
# pkill matches the full command line; -f matches against args, exit 1 if none.
pkill -f "python3? -m http.server $PORT" 2>/dev/null || true
# Also kill anything actually listening on the port (covers other servers).
if command -v fuser >/dev/null 2>&1; then
  fuser -k -n tcp "$PORT" 2>/dev/null || true
fi
sleep 0.3

echo "Serving $ROOT on port $PORT"
echo "Open: $URL"
echo "Press Ctrl-C to stop."
echo

# Open the page in the default browser (best-effort; WSL → Windows browser).
( sleep 1
  if command -v wslview >/dev/null 2>&1; then wslview "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  elif command -v open >/dev/null 2>&1; then open "$URL"
  fi
) >/dev/null 2>&1 &

exec python3 -m http.server "$PORT"
