#!/usr/bin/env bash
# Deploy the squarespace mirror to GitHub Pages.
#
# Local HTML already references /preview/preview.{css,js} (root-absolute) thanks
# to preview/install.sh. Since GH project pages serve under /<repo>/, we copy
# the whole tree to a staging dir and re-prefix every root-absolute path.
# The local mirror itself stays untouched, so serve.sh keeps working.

set -euo pipefail

REPO="${REPO:-mikaelaholmes-squarespace}"
OWNER="${OWNER:-MikaelaHolmes}"
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

echo "==> Committing and force-pushing to $OWNER/$REPO"
cd "$STAGING"
git init -q -b main
git add -A
git -c user.email="$AUTHOR_EMAIL" -c user.name="$AUTHOR_NAME" \
  commit -q -m "Deploy preview build"
git remote add origin "https://github.com/$OWNER/$REPO.git" 2>/dev/null || \
  git remote set-url origin "https://github.com/$OWNER/$REPO.git"
git push -q --force origin main

echo
echo "Deployed: https://${OWNER,,}.github.io/$REPO/"
echo "Build status: gh api repos/$OWNER/$REPO/pages/builds/latest -q .status"
