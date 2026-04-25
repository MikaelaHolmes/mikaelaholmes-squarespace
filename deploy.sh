#!/usr/bin/env bash
# Deploy the squarespace mirror to GitHub Pages (gh-pages branch).
#
# Local HTML already references /preview/preview.{css,js} (root-absolute) thanks
# to preview/install.sh. Since GH project pages serve under /<repo>/, we copy
# the whole tree to a staging dir and re-prefix every root-absolute path.
# The local mirror itself stays untouched, so serve.sh keeps working.
#
# This pushes the prefixed mirror to the `gh-pages` branch — `main` holds the
# source repo (preview tooling, mirror, scripts). Configure GitHub Pages to
# serve from `gh-pages` in the repo Settings → Pages.

set -euo pipefail

REPO="${REPO:-mikaelaholmes-squarespace}"
OWNER="${OWNER:-MikaelaHolmes}"
BRANCH="${BRANCH:-gh-pages}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING="${STAGING:-/tmp/sq-deploy}"
AUTHOR_NAME="${AUTHOR_NAME:-Mikaela Holmes}"
AUTHOR_EMAIL="${AUTHOR_EMAIL:-169160537+MikaelaHolmes@users.noreply.github.com}"

echo "==> Staging at $STAGING"
rm -rf "$STAGING"
mkdir -p "$STAGING"
rsync -a --delete \
  --exclude='.git' \
  --exclude='deploy.sh' \
  --exclude='serve.sh' \
  --exclude='flatten.sh' \
  --exclude='rebase-links.py' \
  --exclude='wget.log' \
  --exclude='preview/install.sh' \
  "$ROOT/" "$STAGING/"

echo "==> Prefixing root-absolute paths with /$REPO"
python3 "$ROOT/preview/prefix-paths.py" "$STAGING" "$REPO"

echo "==> Committing and force-pushing to $OWNER/$REPO ($BRANCH)"
cd "$STAGING"
git init -q -b "$BRANCH"
git add -A
git -c user.email="$AUTHOR_EMAIL" -c user.name="$AUTHOR_NAME" \
  commit -q -m "Deploy preview build"
# Auth: prefer ../.env's bare GitHub token; fall back to ambient git config.
TOKEN_FILE="$ROOT/../.env"
if [ -f "$TOKEN_FILE" ]; then
  TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
  REMOTE_URL="https://${TOKEN}@github.com/$OWNER/$REPO.git"
else
  REMOTE_URL="https://github.com/$OWNER/$REPO.git"
fi
git remote add origin "$REMOTE_URL" 2>/dev/null || git remote set-url origin "$REMOTE_URL"
git push -q --force origin "$BRANCH"

echo
echo "Deployed: https://${OWNER,,}.github.io/$REPO/"
echo "Build status: gh api repos/$OWNER/$REPO/pages/builds/latest -q .status"
