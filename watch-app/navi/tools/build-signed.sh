#!/usr/bin/env bash
# Signed JoyoNavi build on Linux without DevEco Studio (docs/watch-app.md, "Signing").
# Builds in a temporary copy of the project so build-profile.json5 in git never holds signing paths or passwords.
#
#   watch-app/navi/tools/build-signed.sh [debug|release]   -> prints the path of the signed .hap
#
# Expects:
#   $JOYONAVI_SIGNING (default ~/.config/joyofit/joyonavi-signing): joyonavi.p12, keystore-password,
#     joyonavi-<mode>.cer and joyonavi-<mode>.p7b from AppGallery Connect.
#   $HMOS_CLT (default ~/.local/share/harmonyos-cli/command-line-tools): Command Line Tools for HarmonyOS 6.0.1.
#   $JAVA_HOME (default ~/.local/share/jdk17): a JDK 17.
set -euo pipefail

MODE=${1:-debug}
K=${JOYONAVI_SIGNING:-$HOME/.config/joyofit/joyonavi-signing}
CLT=${HMOS_CLT:-$HOME/.local/share/harmonyos-cli/command-line-tools}
export JAVA_HOME=${JAVA_HOME:-$HOME/.local/share/jdk17}
export DEVECO_SDK_HOME=$CLT/sdk
export PATH=$CLT/bin:$JAVA_HOME/bin:$PATH

SRC=$(cd "$(dirname "$0")/.." && pwd)
for f in joyonavi.p12 keystore-password "joyonavi-$MODE.cer" "joyonavi-$MODE.p7b"; do
  [ -f "$K/$f" ] || { echo "missing $K/$f" >&2; exit 1; }
done

# hvigor only takes passwords encrypted against a material/ folder next to the keystore (DevEco's format).
ENC=$(node "$SRC/tools/signing-material.cjs" "$K" "$K/keystore-password")

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
(cd "$SRC" && tar --exclude=./entry/build --exclude=./.hvigor --exclude=./build --exclude=./oh_modules -cf - .) | tar -xf - -C "$WORK"

python3 -I - "$WORK/build-profile.json5" "$K" "$MODE" "$ENC" <<'EOF'
import json, pathlib, sys
path, k, mode, enc = sys.argv[1:]
cfg = {"name": "default", "type": "HarmonyOS", "material": {
    "certpath": f"{k}/joyonavi-{mode}.cer", "storePassword": enc, "keyAlias": "joyonavi", "keyPassword": enc,
    "profile": f"{k}/joyonavi-{mode}.p7b", "signAlg": "SHA256withECDSA", "storeFile": f"{k}/joyonavi.p12"}}
f = pathlib.Path(path)
s = f.read_text()
assert '"signingConfigs": []' in s, "build-profile.json5 already has signingConfigs"
f.write_text(s.replace('"signingConfigs": []', '"signingConfigs": [' + json.dumps(cfg) + ']'))
EOF

cd "$WORK"
ohpm install >/dev/null
hvigorw assembleHap --mode module -p product=default -p "buildMode=$MODE" --no-daemon >&2

OUT_DIR="$K/builds"
mkdir -p "$OUT_DIR"
REV=$(git -C "$SRC" rev-parse --short HEAD)
git -C "$SRC" diff --quiet HEAD -- . || REV="$REV-dirty"
OUT="$OUT_DIR/joyonavi-$MODE-$REV.hap"
cp entry/build/default/outputs/default/entry-default-signed.hap "$OUT"
java -jar "$CLT/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar" verify-app -inFile "$OUT" \
  -outCertChain "$WORK/chain.cer" -outProfile "$WORK/profile.p7b" >&2
echo "$OUT"
