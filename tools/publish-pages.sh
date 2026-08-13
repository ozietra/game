#!/usr/bin/env bash
# Builds the game and force pushes the result to the gh-pages branch, which is
# what GitHub Pages serves. Run it from the repository root:
#
#   bash tools/publish-pages.sh
#
# The branch holds only the built site, never the sources. Pages has to be
# pointed at it once, under Settings, Pages, Deploy from a branch, gh-pages.

set -euo pipefail

BRANCH="gh-pages"
WORKTREE="$(mktemp -d)"

npm run build

git worktree add --detach "$WORKTREE" >/dev/null
trap 'git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true' EXIT

cd "$WORKTREE"
git switch --orphan "$BRANCH"
git rm -rq --cached . 2>/dev/null || true
find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

cp -r "$OLDPWD/dist/." .
# Stops GitHub from running the files through Jekyll.
touch .nojekyll

git add -A
git commit -qm "Publish build $(date -u +%Y-%m-%dT%H:%MZ)"
git push -f origin "$BRANCH"

echo "published $BRANCH"
