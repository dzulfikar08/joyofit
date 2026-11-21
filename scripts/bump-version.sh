#!/usr/bin/env bash
# Sets the app version for the next store release (docs/ci-release.md "Versions").
#
#   scripts/bump-version.sh patch          1.2.0 -> 1.2.1   fixes
#   scripts/bump-version.sh minor          1.2.1 -> 1.3.0   new features
#   scripts/bump-version.sh major          1.3.0 -> 2.0.0
#   scripts/bump-version.sh 1.4.0          an exact version (must be higher than the current one)
#   scripts/bump-version.sh minor --push   also pushes master and the tag
#
# Writes `expo.version` in app.json and `version` in package.json, commits "Version X.Y.Z" on top of origin/master (on
# master, or a detached worktree at origin/master) and tags it vX.Y.Z.
# Store builds are made from that tag: gh workflow run release-android.yml --ref vX.Y.Z ... (scripts/check-release-version.sh
# refuses a Play or TestFlight upload from anything else).
#
# The version is part of the runtimeVersion fingerprint (docs/ota.md): OTA updates published after a bump only reach
# binaries built from it.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
[ $# -ge 1 ] || usage
what=$1
push=0
[ "${2:-}" = "--push" ] && push=1

current=$(node -p "require('./app.json').expo.version")
pkg=$(node -p "require('./package.json').version")

if [[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]}
elif [[ "$current" =~ ^([0-9]+)\.([0-9]+)$ ]]; then
  # Versions before 1.2.0 had two parts ("1.1").
  major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=0
else
  echo "app.json version \"$current\" is not X.Y.Z" >&2
  exit 1
fi

case "$what" in
  major) next="$((major + 1)).0.0" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  patch) next="$major.$minor.$((patch + 1))" ;;
  *)
    [[ "$what" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
    next=$what
    ;;
esac

# The new version must sort after the current one (stores refuse a lower one on iOS).
if [ "$(printf '%s\n%s\n' "$major.$minor.$patch" "$next" | sort -V | tail -1)" != "$next" ] || [ "$next" = "$current" ]; then
  echo "$next is not higher than $current" >&2
  exit 1
fi

# On master, or a detached checkout of it (a worktree), exactly at origin/master.
git diff --quiet && git diff --cached --quiet || { echo "commit or stash your changes first" >&2; exit 1; }
git fetch -q origin master --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || { echo "HEAD is not origin/master; check out or pull master first" >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/v$next" >/dev/null; then
  echo "tag v$next exists already" >&2
  exit 1
fi

# Rewrite only the version lines, so the files keep their formatting.
node - "$next" <<'JS'
const fs = require('fs');
const next = process.argv[2];
for (const [file, re] of [
  ['app.json', /("version":\s*")[^"]*(")/],
  ['package.json', /("version":\s*")[^"]*(")/],
]) {
  const text = fs.readFileSync(file, 'utf8');
  if (!re.test(text)) throw new Error(`no version in ${file}`);
  fs.writeFileSync(file, text.replace(re, `$1${next}$2`));
}
if (require('./app.json').expo.version !== next) throw new Error('app.json: the first "version" is not expo.version');
JS

git add app.json package.json
git commit -q -m "Version $next"
git tag -a "v$next" -m "JoyoFit $next"
echo "Version $current -> $next (package.json was $pkg), commit $(git rev-parse --short HEAD), tag v$next"

if [ $push = 1 ]; then
  git push -q origin HEAD:refs/heads/master "v$next"
  echo "pushed master and v$next"
else
  echo "push with: git push origin HEAD:refs/heads/master v$next"
fi
echo "then build from the tag:"
echo "  gh workflow run release-android.yml -R dzulfikar08/joyofit --ref v$next -f target=both -f play_track=alpha -f play_status=draft"
echo "  gh workflow run release-ios.yml -R dzulfikar08/joyofit --ref v$next -f upload_testflight=true"
