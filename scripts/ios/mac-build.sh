#!/usr/bin/env bash
# JoyoFit iOS build, run ON macOS with Xcode (the MacBook, or any Mac with the toolchain below).
# Linux laptop: use scripts/build-ios-mac.sh, which runs this on the MacBook over SSH.
#
#   scripts/ios/mac-build.sh            prebuild, pods, archive, export, check build/ios-mac/JoyoFit.ipa
#   scripts/ios/mac-build.sh --upload   ...then upload it to App Store Connect with altool
#
# Needs on PATH: node, bun, pod (CocoaPods 1.17), Xcode (xcodebuild, xcrun altool).
# Env:
#   BUILD_NUMBER   CFBundleVersion, YYYYMMDDHHMM (UTC) by default, as the Linux pipeline
#   ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH   App Store Connect API key; default path is
#                  ~/.appstoreconnect/private_keys/AuthKey_<id>.p8 (mode 600, never in git)
#   EXPORT_PROFILE / EXPORT_WIDGET_PROFILE   names of the installed App Store profiles of the app and of the Live
#                  Activity extension; set both for a manual export, neither for an automatic one
#   MAC_BUILD_OUT  output directory (default <repo>/build/ios-mac)
#   REPO_DIR       checkout to build (default: the repo this script lives in)
#
# Signing, two modes:
#   - EXPORT_PROFILE + EXPORT_WIDGET_PROFILE set (CI, scripts/build-ios-mac.sh): manual. The app and the Live Activity
#     extension targets are set to the Apple Distribution identity in the keychain and these App Store profiles before
#     the archive, and the export uses them too, so xcodebuild never signs in to the account.
#   - neither set: automatic, through the API key (xcodebuild -allowProvisioningUpdates).
# The app embeds the rest-timer extension (targets/rest-timer, bundle id <app>.resttimer), a second bundle id with its
# own profile. Run it in the logged-in GUI session (the Linux driver does), an SSH session cannot use the keychain's
# private keys (errSecInternalComponent).
set -euo pipefail
REPO=${REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}
cd "$REPO"
mode=${1:-}
OUT=${MAC_BUILD_OUT:-$REPO/build/ios-mac}

APP=JoyoFit
BUNDLE_ID=com.joyodigitama.joyofit
WIDGET=RestTimerActivity
WIDGET_BUNDLE_ID=$BUNDLE_ID.resttimer
TEAM_ID=F6Q6UFUK69
JS_DIR=$REPO
IOS_DIR=$JS_DIR/ios

export ASC_KEY_ID=${ASC_KEY_ID:-BUU2CPKLGM}
export ASC_ISSUER_ID=${ASC_ISSUER_ID:-9e34111d-e39f-4122-9000-6eb4628fe9b9}
export ASC_KEY_PATH=${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}
BUILD_NUMBER=${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}
[ -f "$ASC_KEY_PATH" ] || { echo "no App Store Connect key at $ASC_KEY_PATH" >&2; exit 1; }
for tool in node bun pod xcodebuild xcrun; do
  command -v "$tool" > /dev/null || { echo "$tool is not on PATH" >&2; exit 1; }
done
export LANG=en_US.UTF-8
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH"
      -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
MANUAL=0
if [ -n "${EXPORT_PROFILE:-}" ]; then
  [ -n "${EXPORT_WIDGET_PROFILE:-}" ] ||
    { echo "EXPORT_PROFILE is set but EXPORT_WIDGET_PROFILE is not: the Live Activity extension ($WIDGET_BUNDLE_ID) needs its own App Store profile" >&2; exit 1; }
  MANUAL=1
  AUTH=()
fi

step() { printf '\n== %s ==\n' "$*"; }
START=$SECONDS
lap() { printf '   [%dm%02ds]\n' $(((SECONDS - START) / 60)) $(((SECONDS - START) % 60)); }

# Metro keeps its transform and file-map caches in the temp dir; one left by a build of another checkout
# bundled the router with no routes (a blank app, no error). Own temp dir per build, old caches removed.
rm -rf "$OUT"
mkdir -p "$OUT/tmp"
rm -rf "$(getconf DARWIN_USER_TEMP_DIR)"metro-* "$(getconf DARWIN_USER_TEMP_DIR)"haste-map-* 2> /dev/null || true
export TMPDIR=$OUT/tmp

step "Toolchain"
xcodebuild -version | tr '\n' ' '; echo
echo "node $(node -v), bun $(bun -v), pod $(pod --version 2> /dev/null | tail -n1)"
echo "$APP $(git rev-parse --short HEAD) build $BUILD_NUMBER"

step "1. bun install --frozen-lockfile"
bun install --frozen-lockfile 2>&1 | tail -n 3
lap

# Release JS env. Cloud URLs come from expo.extra in app.json (src/cloud/config.ts).
export NODE_ENV=production

step "2. expo prebuild --platform ios --clean"
(cd "$JS_DIR" && bunx expo prebuild --platform ios --clean --no-install 2>&1 | tail -n 1)
# Prebuild writes app.json's buildNumber into Info.plist as a literal, so the build setting does not reach it.
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$IOS_DIR/$APP/Info.plist"
lap

# EXPO_PRECOMPILED_FLAVOR=release as on Linux. Expo's precompiled modules were not found on the MacBook ("prebuilt config
# not found" in pod-install.log), so the Expo pods compile from source here and end up in the executable.
step "3. pod install"
(cd "$IOS_DIR" && EXPO_PRECOMPILED_FLAVOR=release pod install > "$OUT/pod-install.log" 2>&1) ||
  { tail -n 40 "$OUT/pod-install.log" >&2; exit 1; }
lap

step "4. xcodebuild archive"
# Progress: the log goes to a file, the console gets the target being built, warnings about signing and errors.
progress() {
  awk '
    /^\*\* / || /error:/ || /[Pp]rovisioning [Pp]rofile|Signing Identity/ { print; fflush(); next }
    match($0, /\(in target .[^'"'"']+/) {
      t = substr($0, RSTART + 12, RLENGTH - 12)
      if (!(t in seen)) { seen[t] = 1; print "   " t; fflush() }
    }'
}
if [ "$MANUAL" = 1 ]; then
  step "3b. manual signing for $APP and $WIDGET"
  # Per target, so each gets its own profile; command-line build settings would apply one profile to both.
  ruby -rxcodeproj -e '
    proj = Xcodeproj::Project.open(ARGV[0])
    { ARGV[1] => ARGV[2], ARGV[3] => ARGV[4] }.each do |name, profile|
      target = proj.targets.find { |t| t.name == name } or abort("no target #{name}")
      target.build_configurations.each do |c|
        s = c.build_settings
        s["CODE_SIGN_STYLE"] = "Manual"
        s["CODE_SIGN_IDENTITY"] = "Apple Distribution"
        s.delete("CODE_SIGN_IDENTITY[sdk=iphoneos*]")
        s["DEVELOPMENT_TEAM"] = ARGV[5]
        s["PROVISIONING_PROFILE_SPECIFIER"] = profile
      end
    end
    proj.save' "$IOS_DIR/$APP.xcodeproj" "$APP" "$EXPORT_PROFILE" "$WIDGET" "$EXPORT_WIDGET_PROFILE" "$TEAM_ID"
fi
xcodebuild archive -workspace "$IOS_DIR/$APP.xcworkspace" -scheme "$APP" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/$APP.xcarchive" ${AUTH[@]+"${AUTH[@]}"} \
  DEVELOPMENT_TEAM="$TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  > "$OUT/xcodebuild-archive.log" 2>&1 < /dev/null &
build=$!
tail -n +1 -F "$OUT/xcodebuild-archive.log" 2> /dev/null | progress &
follow=$!
if ! wait "$build"; then
  sleep 1; kill "$follow" 2> /dev/null || true
  grep -E 'error:|\*\* ARCHIVE FAILED' "$OUT/xcodebuild-archive.log" | head -n 20 >&2
  echo "archive failed; full log: $OUT/xcodebuild-archive.log" >&2
  exit 1
fi
sleep 1; kill "$follow" 2> /dev/null || true
lap

step "5. xcodebuild -exportArchive (app-store-connect)"
# Manual (EXPORT_PROFILE + EXPORT_WIDGET_PROFILE): the same App Store profiles and Apple Distribution identity as the
# archive. Automatic export needs a cloud-managed distribution certificate, which
# the API key on the MacBook may not create ("Cloud signing permission error").
if [ "$MANUAL" = 1 ]; then
  SIGNING="<key>signingStyle</key><string>manual</string>
  <key>provisioningProfiles</key><dict>
    <key>$BUNDLE_ID</key><string>$EXPORT_PROFILE</string>
    <key>$WIDGET_BUNDLE_ID</key><string>$EXPORT_WIDGET_PROFILE</string>
  </dict>"
else
  SIGNING="<key>signingStyle</key><string>automatic</string>"
fi
cat > "$OUT/ExportOptions.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>$TEAM_ID</string>
  $SIGNING
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>stripSwiftSymbols</key><true/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST
xcodebuild -exportArchive -archivePath "$OUT/$APP.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" ${AUTH[@]+"${AUTH[@]}"} > "$OUT/xcodebuild-export.log" 2>&1 ||
  { tail -n 30 "$OUT/xcodebuild-export.log" >&2; exit 1; }
IPA=$OUT/$APP.ipa
cp "$OUT/export/$APP.ipa" "$IPA"
lap

step "6. Check the IPA"
CHECK=$OUT/ipa
rm -rf "$CHECK" && mkdir -p "$CHECK" && unzip -q "$IPA" -d "$CHECK"
APPDIR=$CHECK/Payload/$APP.app
plist() { /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2> /dev/null; }
fail() { echo "CHECK FAILED: $*" >&2; exit 1; }

[ "$(plist "$APPDIR/Info.plist" CFBundleIdentifier)" = "$BUNDLE_ID" ] || fail "bundle id is not $BUNDLE_ID"
[ "$(plist "$APPDIR/Info.plist" CFBundleVersion)" = "$BUILD_NUMBER" ] || fail "CFBundleVersion is not $BUILD_NUMBER"
sdk=$(plist "$APPDIR/Info.plist" DTSDKName)
case $sdk in iphoneos2[6-9]* | iphoneos[3-9]*) ;; *) fail "built with $sdk, App Store Connect wants the iOS 26 SDK or later" ;; esac
# A binary linked against the iOS 27 SDK that has no UIScene manifest is aborted at launch by iOS 27 (TestFlight, 2026-10-16/17:
# EXC_BREAKPOINT in UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption, the Linux builds made with Xcode 27's SDK).
case $sdk in
  iphoneos2[7-9]* | iphoneos[3-9]*)
    plist "$APPDIR/Info.plist" UIApplicationSceneManifest > /dev/null ||
      fail "built with $sdk but the app does not adopt the UIScene lifecycle (no UIApplicationSceneManifest): iOS 27 aborts it at launch" ;;
esac

# Entitlements and profile: an App Store profile has no device list and no get-task-allow.
security cms -D -i "$APPDIR/embedded.mobileprovision" > "$OUT/profile.plist"
[ -z "$(plist "$OUT/profile.plist" ProvisionedDevices)" ] || fail "embedded profile lists devices (not an App Store profile)"
codesign -d --entitlements :- "$APPDIR" > "$OUT/entitlements.plist" 2> /dev/null
[ "$(plist "$OUT/entitlements.plist" get-task-allow)" = false ] || fail "get-task-allow is not false"
# Push (Keluarga alerts): prebuild writes aps-environment development, the export must have signed production.
[ "$(plist "$OUT/entitlements.plist" aps-environment)" = production ] || fail "aps-environment is not production"
for key in com.apple.developer.healthkit com.apple.developer.applesignin; do
  plist "$OUT/entitlements.plist" "$key" > /dev/null || echo "   note: entitlement $key is not signed in (the Linux IPA has what app.json asks for)"
done
codesign --verify --deep --strict "$APPDIR" || fail "code signature does not verify"
authority=$(codesign -dvv "$APPDIR" 2>&1 | sed -n 's/^Authority=\(Apple Distribution.*\)/\1/p')
[ -n "$authority" ] || fail "not signed with an Apple Distribution identity"
echo "   $BUNDLE_ID $(plist "$APPDIR/Info.plist" CFBundleShortVersionString) ($BUILD_NUMBER), $sdk, $authority"

# The Live Activity extension (targets/rest-timer, ActivityKit): same version, same signer, App Store profile. It needs no
# capability and no App Group, so only the basics are checked.
APPEX=$APPDIR/PlugIns/$WIDGET.appex
[ -d "$APPEX" ] || fail "no PlugIns/$WIDGET.appex in the app: the Live Activity extension was not embedded"
[ "$(plist "$APPEX/Info.plist" CFBundleIdentifier)" = "$WIDGET_BUNDLE_ID" ] || fail "extension bundle id is not $WIDGET_BUNDLE_ID"
[ "$(plist "$APPEX/Info.plist" CFBundleVersion)" = "$BUILD_NUMBER" ] || fail "extension CFBundleVersion is not $BUILD_NUMBER"
[ "$(plist "$APPEX/Info.plist" CFBundleShortVersionString)" = "$(plist "$APPDIR/Info.plist" CFBundleShortVersionString)" ] ||
  fail "extension and app versions differ"
[ "$(plist "$APPEX/Info.plist" NSExtension:NSExtensionPointIdentifier)" = com.apple.widgetkit-extension ] || fail "extension point is not WidgetKit"
security cms -D -i "$APPEX/embedded.mobileprovision" > "$OUT/extension-profile.plist"
[ -z "$(plist "$OUT/extension-profile.plist" ProvisionedDevices)" ] || fail "extension profile lists devices (not an App Store profile)"
codesign -d --entitlements :- "$APPEX" > "$OUT/extension-entitlements.plist" 2> /dev/null
[ "$(plist "$OUT/extension-entitlements.plist" get-task-allow)" = false ] || fail "extension get-task-allow is not false"
codesign --verify --strict "$APPEX" || fail "extension code signature does not verify"
codesign -dvv "$APPEX" 2>&1 | grep -q '^Authority=Apple Distribution' || fail "extension is not signed with an Apple Distribution identity"
echo "   $WIDGET_BUNDLE_ID ($BUILD_NUMBER) embedded and signed"

# app.config freshness: Constants.expoConfig reads the embedded app.config at run time (cloud URLs in `extra`).
(cd "$JS_DIR" && bunx expo config --type public --json) > "$OUT/expo-config.json"
node -e '
  const fs = require("fs");
  const want = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).extra ?? {};
  const have = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).extra ?? {};
  const stale = Object.keys(want).filter((k) => JSON.stringify(have[k]) !== JSON.stringify(want[k]));
  if (stale.length) { console.error("EXConstants app.config is out of date with app.json (extra: " + stale.join(", ") + ")"); process.exit(1); }
' "$OUT/expo-config.json" "$APPDIR/EXConstants.bundle/app.config" || fail "stale app.config"

# Bundle sanity: Metro with a bad cache bundled the router with no routes (about 1000 modules instead of 1600, no error).
# The watch module's name is in app code only (requireNativeModule): a bundle without it has no app in it.
[ -f "$APPDIR/main.jsbundle" ] || fail "no main.jsbundle in the app"
LC_ALL=C grep -aq HuaweiWear "$APPDIR/main.jsbundle" || fail "main.jsbundle holds no app code (Metro bundled without the routes)"
echo "   main.jsbundle $(stat -f %z "$APPDIR/main.jsbundle") bytes, app code present"
ls -l "$IPA" | awk '{print "   ipa " $5 " bytes"}'
lap

echo "ipa: $IPA"

if [ "$mode" = --upload ]; then
  step "7. Upload to App Store Connect (altool)"
  # altool reads AuthKey_<id>.p8 from ~/.appstoreconnect/private_keys; ASC_KEY_PATH has to be there.
  [ "$(cd "$(dirname "$ASC_KEY_PATH")" && pwd)" = "$HOME/.appstoreconnect/private_keys" ] ||
    { echo "altool needs the key in ~/.appstoreconnect/private_keys" >&2; exit 1; }
  xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1
  echo "uploaded: $APP $BUILD_NUMBER"
  lap
fi
