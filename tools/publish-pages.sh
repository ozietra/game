#!/usr/bin/env bash
# Builds the game and force pushes the result to the gh-pages branch, which is
# what GitHub Pages serves. Run it from the repository root:
#
#   bash tools/publish-pages.sh
#   bash tools/publish-pages.sh https://hollowdeep-metrics.<account>.workers.dev
#
# The optional argument is the metrics collector, written into the published
# pages so the game knows where to send and the panel opens ready to connect.
# It is stamped into the built files rather than compiled in, so the address
# never has to live in a commit. Without it the game makes no network calls.
#
# The branch holds only the built site, never the sources. Pages has to be
# pointed at it once, under Settings, Pages, Deploy from a branch, gh-pages.

set -euo pipefail

BRANCH="gh-pages"
WORKTREE="$(mktemp -d)"
STAGING="pages-staging-$$"
METRICS="${1:-}"

npm run build

if [ -n "$METRICS" ]; then
  # Trailing slashes are stripped at read time, but keep the file tidy anyway.
  CLEAN="${METRICS%/}"
  for page in dist/index.html dist/panel/index.html; do
    [ -f "$page" ] || continue
    python3 - "$page" "$CLEAN" <<'PY'
import re
import sys

path, url = sys.argv[1], sys.argv[2]
with open(path, encoding='utf-8') as handle:
    html = handle.read()
patched, count = re.subn(
    r'(<meta name="hollowdeep-metrics" content=")[^"]*(")',
    lambda match: match.group(1) + url + match.group(2),
    html,
)
if count == 0:
    raise SystemExit(f'no metrics meta tag in {path}')
with open(path, 'w', encoding='utf-8') as handle:
    handle.write(patched)
PY
  done
  echo "metrics endpoint stamped: $CLEAN"
fi

git worktree add --detach "$WORKTREE" >/dev/null
cleanup() {
  git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  git branch -D "$STAGING" >/dev/null 2>&1 || true
}
trap cleanup EXIT

SOURCE="$PWD"
cd "$WORKTREE"

# A throwaway orphan keeps this working whether or not gh-pages already exists
# locally, since a worktree cannot check out a branch another one holds.
git switch --orphan "$STAGING"
find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

cp -r "$SOURCE/dist/." .
# Stops GitHub from running the files through Jekyll.
touch .nojekyll

git add -A
git commit -qm "Publish build $(date -u +%Y-%m-%dT%H:%MZ)"
git push -f origin "HEAD:refs/heads/$BRANCH"
git branch -f "$BRANCH" HEAD

echo "published $BRANCH"
