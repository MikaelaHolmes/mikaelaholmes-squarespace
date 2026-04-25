#!/usr/bin/env bash
# Local dev server — static files PLUS a tiny POST/DELETE endpoint at
# /preview/api/image-titles that merges {basename: title} into config.json
# and re-runs preview/install.sh so the inlined preview-config tag picks
# up the change without a manual rebuild.
set -euo pipefail

PORT="${1:-8000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="http://localhost:${PORT}/"

cd "$ROOT"

echo "Stopping any prior http.server instances on port $PORT..."
pkill -f "python3 .*serve_with_api.*$PORT" 2>/dev/null || true
pkill -f "python3? -m http.server $PORT" 2>/dev/null || true
if command -v fuser >/dev/null 2>&1; then
  fuser -k -n tcp "$PORT" 2>/dev/null || true
fi
sleep 0.3

echo "Serving $ROOT on port $PORT (with /preview/api/image-titles endpoint)"
echo "Open: $URL"
echo "Press Ctrl-C to stop."
echo

( sleep 1
  if command -v wslview >/dev/null 2>&1; then wslview "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  elif command -v open >/dev/null 2>&1; then open "$URL"
  fi
) >/dev/null 2>&1 &

exec python3 "$ROOT/preview/serve_with_api.py" "$PORT"
