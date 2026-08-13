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
STAGING="pages-staging-$$"

npm run build

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
