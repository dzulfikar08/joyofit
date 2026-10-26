#!/usr/bin/env bash
# Uploads built watch maps to JoyoFit's R2 bucket so the app's offline-map lab can download them (`GET /v1/maps`, server/src/maps.ts).
#
#   tools/offline-maps/publish.sh [--out DIR] <map id> [<map id> ...]
#
# For each id: `<out>/<id>.bin` goes to `joyofit-maps/watch/<id>.bin`; then the catalog `watch/catalog.json` is read, the ids' entries
# (`<out>/<id>.json`, written by build-map.sh) replace the old ones, and it is written back last, so the catalog never lists a file that is
# not there yet. The bucket also holds the bike computer's PMTiles (docs/bike-computer.md); this script only touches `watch/`.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="$here/out"
BUCKET="${MAPS_BUCKET:-joyofit-maps}"
# wrangler is logged into several accounts and fails non-interactively without this (the JoyoFit account).
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-b7e6f8457bd39fa37a7eea5249799754}"

die() { echo "publish: $*" >&2; exit 1; }
[ "${1:-}" = "--out" ] && { out="$2"; shift 2; }
[ $# -gt 0 ] || { sed -n '2,8p' "$0"; exit 1; }
wrangler() { (cd "$here/../../server" && bunx wrangler "$@"); }

for id in "$@"; do
  [[ "$id" =~ ^[0-9]{1,20}$ ]] || die "not a map id: $id"
  [ -s "$out/$id.bin" ] && [ -s "$out/$id.json" ] || die "missing $out/$id.bin or $out/$id.json (run build-map.sh)"
done

for id in "$@"; do
  echo "publish: uploading $id.bin ($(wc -c < "$out/$id.bin" | tr -d ' ') bytes)"
  wrangler r2 object put "$BUCKET/watch/$id.bin" --file "$out/$id.bin" --content-type application/octet-stream --remote
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if ! wrangler r2 object get "$BUCKET/watch/catalog.json" --file "$tmp/old.json" --remote >/dev/null 2>&1; then
  echo '{"maps":[]}' > "$tmp/old.json"
fi
python3 - "$tmp/old.json" "$tmp/catalog.json" "$out" "$@" <<'PY'
import json, sys
old, new, out, ids = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
try:
    maps = json.load(open(old)).get("maps", [])
except ValueError:
    maps = []
maps = [m for m in maps if m.get("id") not in ids]
maps += [json.load(open(f"{out}/{i}.json")) for i in ids]
maps.sort(key=lambda m: m["name"])
json.dump({"maps": maps}, open(new, "w"), indent=1)
print("publish: catalog now lists " + ", ".join(f"{m['name']} ({m['id']})" for m in maps))
PY
wrangler r2 object put "$BUCKET/watch/catalog.json" --file "$tmp/catalog.json" --content-type application/json --remote
echo "publish: done. Check: curl -s https://api.fit.joyorogo.com/v1/maps"
