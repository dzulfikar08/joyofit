#!/usr/bin/env bash
# Run by the release workflows before building (docs/ci-release.md "Versions").
#
#   scripts/check-release-version.sh <store-upload: 0|1>
#
# The app version (app.json expo.version) must be X.Y.Z. A build that goes to a store (Play track or TestFlight) must be
# built from the tag of that version (GITHUB_REF = refs/tags/vX.Y.Z, made by scripts/bump-version.sh), so every store
# release carries a version of its own. Builds that stay a workflow artifact may come from any ref.
set -euo pipefail
cd "$(dirname "$0")/.."

upload=${1:-0}
version=$(node -p "require('./app.json').expo.version")
pkg=$(node -p "require('./package.json').version")
ref=${GITHUB_REF:-$(git symbolic-ref -q HEAD || echo detached)}

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::app.json version \"$version\" is not X.Y.Z; set it with scripts/bump-version.sh"
  exit 1
fi
if [ "$pkg" != "$version" ]; then
  echo "::error::package.json version $pkg differs from app.json $version; set both with scripts/bump-version.sh"
  exit 1
fi

if [ "$ref" = "refs/tags/v$version" ]; then
  echo "Version $version, built from tag v$version"
  exit 0
fi
if [ "$upload" = 1 ]; then
  echo "::error::A store upload must be built from the tag v$version (now $ref). Bump first: scripts/bump-version.sh patch|minor|major --push, then run this workflow with --ref v<new version>."
  exit 1
fi
echo "::warning::Version $version built from $ref, not from tag v$version: fine for an artifact, not for a store."
