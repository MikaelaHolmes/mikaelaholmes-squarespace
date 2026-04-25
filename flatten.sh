#!/usr/bin/env bash
# Flatten the wget mirror so it serves from the root URL.
#
# Before: squarespace/antelope-tulip-5nyy.squarespace.com/index.html
#         squarespace/assets.squarespace.com/...
# After:  squarespace/index.html
#         squarespace/assets.squarespace.com/...
#
# Idempotent: safe to re-run; if the primary host dir is gone it just exits.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRIMARY="antelope-tulip-5nyy.squarespace.com"

cd "$ROOT"

if [[ -d "$PRIMARY" ]]; then
  echo "Moving $PRIMARY/* to $ROOT/"
  shopt -s dotglob
  mv "$PRIMARY"/* ./
  shopt -u dotglob
  rmdir "$PRIMARY"
else
  echo "$PRIMARY already flattened."
fi

# Rewrite cross-host references in the moved HTML pages.
# wget wrote them as "../<host>/..." (one level up from the primary host dir).
# After flattening, those need to become "<host>/..." (same level as the page).
HOSTS=(
  "assets.squarespace.com"
  "images.squarespace-cdn.com"
  "static1.squarespace.com"
  "$PRIMARY"
)

echo "Rewriting ../<host>/ references in HTML/CSS/JS at root..."
# Only top-level files need rewriting — assets in subdirs reference each other
# with relative paths that didn't shift.
mapfile -t FILES < <(find . -maxdepth 1 -type f \( -name '*.html' -o -name '*.htm' -o -name '*.css' -o -name '*.js' \))

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No top-level HTML/CSS/JS files found — nothing to rewrite."
  exit 0
fi

for host in "${HOSTS[@]}"; do
  esc="${host//./\\.}"
  sed -i -E "s|\.\./${esc}/|${host}/|g" "${FILES[@]}"
done

echo "Done. Open: http://localhost:8000/"
