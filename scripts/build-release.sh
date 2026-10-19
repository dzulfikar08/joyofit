#!/usr/bin/env bash
# Release build signed with keystore/keystore.properties (see ~/.config/joyofit/KEYSTORE_BACKUP.md).
#
#   scripts/build-release.sh            sideload APK  -> dist/joyofit-<versionCode>.apk        (all permissions)
#   scripts/build-release.sh --play     Play AAB      -> dist/joyofit-play-<versionCode>.aab   (no SEND_SMS, READ_CALL_LOG, READ_CONTACTS, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
#   --clean                             regenerate android/ with a fresh prebuild
#
# --play sets JOYOFIT_DISTRIBUTION=play; see docs/play-store.md. ARCHS overrides the ABIs
# (default: arm64-v8a,armeabi-v7a for the AAB because Play splits per device, arm64-v8a for the APK).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

export JAVA_HOME="${JAVA_HOME:-$HOME/jdk17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export PATH="$JAVA_HOME/bin:$PATH"
export TMPDIR="${TMPDIR:-$HOME/.cache/jf-tmp}"
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:--Djava.io.tmpdir=$TMPDIR}"
mkdir -p "$TMPDIR"

# ~/.gradle is a symlink to the SSD image (/run/media/dzul/ioswork/gradle-home); without the mount Gradle would fail on a dangling link.
if [ -L "$HOME/.gradle" ] && [ ! -d "$HOME/.gradle/" ]; then
  echo "~/.gradle -> $(readlink "$HOME/.gradle") is not there: the ioswork SSD image is not mounted." >&2
  echo "mount it: udisksctl loop-setup -f /run/media/dzul/Data/dzul-offload/ios-work.ext4" >&2
  exit 1
fi

PLAY=0
CLEAN=0
for arg in "$@"; do
  case "$arg" in
    --play) PLAY=1 ;;
    --clean) CLEAN=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

KEYSTORE_PROPS="keystore/keystore.properties"
if [ ! -f "$KEYSTORE_PROPS" ]; then
  echo "missing $KEYSTORE_PROPS: restore it (see ~/.config/joyofit/KEYSTORE_BACKUP.md); a release signed with the debug key cannot update or be uploaded" >&2
  exit 1
fi

if [ "$PLAY" = 1 ]; then
  export JOYOFIT_DISTRIBUTION=play
  ARCHS="${ARCHS:-arm64-v8a,armeabi-v7a}"
else
  export JOYOFIT_DISTRIBUTION=sideload
  ARCHS="${ARCHS:-arm64-v8a}"
fi

# Minutes since 2024-01-01 UTC, the same scheme as JoyoRogo (plugins/with-version-code.js reads it).
export JOYOFIT_VERSION_CODE="$(( ($(date -u +%s) - 1704067200) / 60 ))"

# Prebuild only when native inputs changed: it wipes android/build caches.
STAMP=android/.prebuild-hash
HASH="$(
  { sha256sum app.json package.json bun.lock
    find plugins modules assets -type f -not -path '*/build/*' -print0 | sort -z | xargs -0 sha256sum
  } | sha256sum | cut -d' ' -f1
)"
if [ "$CLEAN" = 1 ] || [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$HASH" ]; then
  [ "$CLEAN" = 1 ] && rm -rf android
  bunx expo prebuild -p android --no-install 2>&1 | tail -1
  echo "$HASH" > "$STAMP"
fi

mkdir -p dist
cd android
if [ "$PLAY" = 1 ]; then
  ./gradlew bundleRelease -PreactNativeArchitectures="$ARCHS"
  OUT="$ROOT/dist/joyofit-play-$JOYOFIT_VERSION_CODE.aab"
  cp app/build/outputs/bundle/release/app-release.aab "$OUT"

  BUNDLETOOL="${BUNDLETOOL_JAR:-$HOME/.cache/bundletool/bundletool.jar}"
  if [ ! -f "$BUNDLETOOL" ]; then
    mkdir -p "$(dirname "$BUNDLETOOL")"
    curl -fsSL -o "$BUNDLETOOL" https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar
  fi
  MANIFEST="$(java -jar "$BUNDLETOOL" dump manifest --bundle "$OUT")"
  # Proof for the reviewer: none of the restricted permissions may be in the merged manifest.
  # CAMERA is allowed: the workout share image's "Take photo" asks for it at that tap; the photo stays on the phone.
  if grep -E 'android.permission.(SEND_SMS|READ_CALL_LOG|READ_CONTACTS|READ_SMS|RECEIVE_SMS|REQUEST_INSTALL_PACKAGES|REQUEST_IGNORE_BATTERY_OPTIMIZATIONS|SYSTEM_ALERT_WINDOW|RECORD_AUDIO)"' <<<"$MANIFEST"; then
    echo "Play AAB still declares a forbidden permission" >&2
    exit 1
  fi
  echo "Permissions in $OUT:"
  grep -o 'android:name="[^"]*"' <<<"$(grep -E '<uses-permission' <<<"$MANIFEST")" | cut -d'"' -f2 | sort
else
  ./gradlew assembleRelease -PreactNativeArchitectures="$ARCHS"
  OUT="$ROOT/dist/joyofit-$JOYOFIT_VERSION_CODE.apk"
  cp app/build/outputs/apk/release/app-release.apk "$OUT"
fi
echo "versionCode $JOYOFIT_VERSION_CODE"
ls -la "$OUT"
