#!/usr/bin/env bash
# JoyoFit iOS build on the MacBook, driven from this Linux laptop. Xcode builds, signs and exports.
#
#   scripts/build-ios-mac.sh                 build a signed App Store IPA, copy it to dist/
#   scripts/build-ios-mac.sh --upload        ...then upload it (altool) and wait until App Store Connect says VALID
#   scripts/build-ios-mac.sh --ref <rev>     build another commit that is on GitHub (default: local origin/HEAD)
#   scripts/build-ios-mac.sh --attach        follow the job of an earlier run (after an SSH drop or Ctrl-C)
#
# Only a clean commit is built: the Mac clones/fetches GitHub into ~/build/watch-fit and checks out the exact
# commit of this checkout's origin/HEAD. Uncommitted and unpushed work never reaches it. The build recipe
# (scripts/ios/mac-build.sh) is streamed from this checkout, so it need not be pushed first.
#
# The job runs as a launchd agent in the Mac's logged-in GUI session (the login keychain is unlocked
# there; over plain SSH codesign fails with errSecInternalComponent) and survives an SSH drop.
# Setup of the Mac: docs/ios-mac.md. Overrides: MAC_HOST, BUILD_NUMBER, ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
START=$SECONDS

REPO=watch-fit
GITHUB_URL=https://github.com/dzulfikar08/joyofit.git
APP=JoyoFit
BUNDLE_ID=com.joyodigitama.joyofit
# The rest-timer Live Activity (targets/rest-timer) is an extension with its own bundle id, signed and profiled like the
# app. It needs no capability (and no App Group); asc-mac-profile.py registers the bundle id when it is missing.
WIDGET_BUNDLE_ID=$BUNDLE_ID.resttimer
# HealthKit, Sign in with Apple and Push Notifications (Keluarga alerts) are portal capabilities: enable them on the bundle id
# before the profile is made. A profile made before one was enabled lacks it: asc-mac-profile.py checks the entitlements it needs.
CAPABILITIES=(HEALTHKIT APPLE_ID_AUTH PUSH_NOTIFICATIONS)
REQUIRED_ENTITLEMENTS=(aps-environment com.apple.developer.healthkit com.apple.developer.applesignin)

HOST=${MAC_HOST:-allicias-macbook-air}
PY=${ASC_PYTHON:-$HOME/.local/share/joyorogo-ios/venv/bin/python}
export ASC_KEY_ID=${ASC_KEY_ID:-BUU2CPKLGM}
export ASC_ISSUER_ID=${ASC_ISSUER_ID:-9e34111d-e39f-4122-9000-6eb4628fe9b9}
export ASC_KEY_PATH=${ASC_KEY_PATH:-$HOME/Downloads/AuthKey_$ASC_KEY_ID.p8}

upload=0 ref= attach=0
while [ $# -gt 0 ]; do
  case $1 in
    --upload) upload=1 ;;
    --ref) ref=${2:?--ref needs a revision}; shift ;;
    --attach) attach=1 ;;
    *) sed -n '2,12p' "$0" >&2; exit 2 ;;
  esac
  shift
done

SSH=(ssh -o ConnectTimeout=15 -o ServerAliveInterval=15 "$HOST")
LABEL=local.joyodigitama.build.$REPO
STATE=$ROOT/dist/.ios-mac-job
step() { printf '\n== %s ==\n' "$*"; }
remote() { "${SSH[@]}" "$@"; }

if [ "$attach" = 1 ]; then
  [ -f "$STATE" ] || { echo "no earlier job to attach to ($STATE)" >&2; exit 1; }
  . "$STATE"
else
  [ -f "$ASC_KEY_PATH" ] || { echo "no App Store Connect key at $ASC_KEY_PATH" >&2; exit 1; }
  remote true || { echo "cannot reach $HOST over SSH (Tailscale up? the Mac awake and plugged in?)" >&2; exit 1; }
  MAC_HOME=$(remote 'echo $HOME')
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  # The commit: this checkout's origin/HEAD, as last fetched. It has to be on GitHub for the Mac to fetch it.
  SHA=$(git rev-parse --verify "${ref:-refs/remotes/origin/HEAD}^{commit}")
  if [ -z "$ref" ] && [ "$(git rev-parse HEAD)" != "$SHA" ]; then
    echo "note: HEAD ($(git rev-parse --short HEAD)) is not origin/HEAD ($(git rev-parse --short "$SHA")); building origin/HEAD"
  fi
  BUILD_NUMBER=${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}
  step "$APP $(git rev-parse --short "$SHA") build $BUILD_NUMBER on $HOST$([ $upload = 1 ] && echo ' (+ upload)')"

  step "App Store Connect: bundle id capabilities, API key on the Mac"
  "$PY" "$ROOT/scripts/ios/enable-capabilities.py" "$BUNDLE_ID" "${CAPABILITIES[@]}"
  [ "$upload" = 0 ] || "$PY" "$ROOT/scripts/ios/asc-wait-valid.py" --check "$BUNDLE_ID" "$BUILD_NUMBER"
  KEY_REMOTE=$MAC_HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8
  local_sum=$(sha256sum "$ASC_KEY_PATH" | cut -d' ' -f1)
  remote_sum=$(remote "shasum -a 256 '$KEY_REMOTE' 2> /dev/null" | cut -d' ' -f1 || true)
  if [ "$local_sum" != "$remote_sum" ]; then
    remote "umask 077; mkdir -p '$(dirname "$KEY_REMOTE")' && chmod 700 '$MAC_HOME/.appstoreconnect' '$(dirname "$KEY_REMOTE")'; cat > '$KEY_REMOTE'; chmod 600 '$KEY_REMOTE'" < "$ASC_KEY_PATH"
    echo "key copied to $HOST:.appstoreconnect/private_keys (mode 600)"
  else
    echo "key already on the Mac"
  fi

  step "Signing: App Store profile for the Mac's Apple Distribution identity"
  # The archive is signed automatically (development); the export signs manually with the distribution identity in
  # the keychain and an App Store profile from App Store Connect (automatic export would need cloud signing).
  IDENTITY="Apple Distribution: Dzulfikar Ats Tsauri (F6Q6UFUK69)"
  cert_pem=$(remote "security find-certificate -c '$IDENTITY' -p")
  cert_serial=$(openssl x509 -noout -serial <<< "$cert_pem" | cut -d= -f2)
  cert_sha1=$(openssl x509 -noout -fingerprint -sha1 <<< "$cert_pem" | cut -d= -f2 | tr -d :)
  remote "security find-identity -v -p codesigning" | grep -q "$cert_sha1" ||
    { echo "$IDENTITY is not a valid signing identity in the Mac's keychain (no private key, or expired)" >&2; exit 1; }
  IFS=$'\t' read -r PROFILE_UUID PROFILE_NAME < <("$PY" "$ROOT/scripts/ios/asc-mac-profile.py" "$BUNDLE_ID" "$cert_serial" "$tmp/app.mobileprovision" "${REQUIRED_ENTITLEMENTS[@]}")
  IFS=$'\t' read -r WIDGET_PROFILE_UUID WIDGET_PROFILE_NAME < <("$PY" "$ROOT/scripts/ios/asc-mac-profile.py" "$WIDGET_BUNDLE_ID" "$cert_serial" "$tmp/widget.mobileprovision")
  PROFILE_DIR="$MAC_HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
  remote "mkdir -p '$PROFILE_DIR'"
  remote "cat > '$PROFILE_DIR/$PROFILE_UUID.mobileprovision'" < "$tmp/app.mobileprovision"
  remote "cat > '$PROFILE_DIR/$WIDGET_PROFILE_UUID.mobileprovision'" < "$tmp/widget.mobileprovision"
  echo "$IDENTITY, profiles '$PROFILE_NAME' ($PROFILE_UUID) and '$WIDGET_PROFILE_NAME' ($WIDGET_PROFILE_UUID) installed"

  step "Mac: clean checkout of $SHA"
  remote "set -e
    mkdir -p ~/build/jobs/$REPO
    cd ~/build
    [ -d $REPO/.git ] || git clone -q $GITHUB_URL $REPO
    cd $REPO
    git remote set-url origin $GITHUB_URL
    git fetch -q --prune origin '+refs/heads/*:refs/remotes/origin/*'
    git cat-file -e '$SHA^{commit}' 2> /dev/null || git fetch -q origin $SHA
    git checkout -q -f --detach $SHA
    # node_modules stay (bun install --frozen-lockfile syncs them); everything else untracked goes, ignored files included.
    git clean -ffdxq -e node_modules
    [ -z \"\$(git status --porcelain)\" ] || { echo 'checkout is not clean' >&2; exit 1; }
    [ \"\$(git rev-parse HEAD)\" = $SHA ]
    git log --oneline -1 | cut -c1-120"

  step "Mac: start the build job in the GUI session"
  JOB=$MAC_HOME/build/jobs/$REPO
  cat > "$tmp/job.sh" <<JOB_SH
#!/bin/bash
# launchd runs this in the GUI session. PATH: the tools docs/ios-mac.md installs.
export PATH=$MAC_HOME/build/tools/bin:$MAC_HOME/build/tools/node/bin:$MAC_HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin
export REPO_DIR=$MAC_HOME/build/$REPO BUILD_NUMBER=$BUILD_NUMBER ASC_KEY_ID=$ASC_KEY_ID ASC_ISSUER_ID=$ASC_ISSUER_ID
export EXPORT_PROFILE='$PROFILE_NAME' EXPORT_WIDGET_PROFILE='$WIDGET_PROFILE_NAME'
caffeinate -i bash $JOB/mac-build.sh $([ $upload = 1 ] && echo --upload)
echo \$? > $JOB/rc.tmp && mv $JOB/rc.tmp $JOB/rc
JOB_SH
  cat > "$tmp/job.plist" <<JOB_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$JOB/job.sh</string></array>
<key>StandardOutPath</key><string>$JOB/log</string>
<key>StandardErrorPath</key><string>$JOB/log</string>
<key>RunAtLoad</key><true/>
</dict></plist>
JOB_PLIST
  remote "launchctl bootout gui/\$(id -u)/$LABEL 2> /dev/null; rm -f '$JOB/rc' '$JOB/log'; true"
  scp -q "$ROOT/scripts/ios/mac-build.sh" "$tmp/job.sh" "$tmp/job.plist" "$HOST:$JOB/"
  mkdir -p "$ROOT/dist"
  printf 'BUILD_NUMBER=%s\nupload=%s\n' "$BUILD_NUMBER" "$upload" > "$STATE"
  remote ": > '$JOB/log'; launchctl bootstrap gui/\$(id -u) '$JOB/job.plist'"
fi

step "Mac build log"
# Print the job log from its start until the job writes its exit code.
remote "job=\$HOME/build/jobs/$REPO; tail -n +1 -F \"\$job/log\" 2> /dev/null & t=\$!
  while [ ! -s \"\$job/rc\" ]; do
    # no exit code and the agent is not running any more: the job died
    if ! launchctl print gui/\$(id -u)/$LABEL 2> /dev/null | grep -q 'state = running'; then
      sleep 5; [ -s \"\$job/rc\" ] || { echo 255 > \"\$job/rc\"; echo 'build job vanished without an exit code' >> \"\$job/log\"; }
    fi
    sleep 2
  done
  sleep 2; kill \$t 2> /dev/null; true"
rc=$(remote "cat \$HOME/build/jobs/$REPO/rc")
remote "launchctl bootout gui/\$(id -u)/$LABEL 2> /dev/null; true"
[ "$rc" = 0 ] || { echo "Mac build failed (exit $rc); log: $HOST:build/jobs/$REPO/log" >&2; exit "$rc"; }

step "IPA to dist/"
mkdir -p "$ROOT/dist"
IPA=$ROOT/dist/$APP-$BUILD_NUMBER-mac.ipa
scp -q "$HOST:build/$REPO/build/ios-mac/$APP.ipa" "$IPA"
ls -l "$IPA"
echo "ipa: $IPA"
printf 'total %dm%02ds\n' $(((SECONDS - START) / 60)) $(((SECONDS - START) % 60))

# mac-build.sh --upload already sent it with altool; App Store Connect processes it now.
[ "$upload" = 1 ] || exit 0
step "Wait for App Store Connect processing"
"$PY" "$ROOT/scripts/ios/asc-wait-valid.py" "$BUNDLE_ID" "$BUILD_NUMBER"

