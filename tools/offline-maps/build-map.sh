#!/usr/bin/env bash
# Builds an offline map for Huawei watches (`offvmp`, `<id>.bin`) from OpenStreetMap, for JoyoFit's offline-map lab (docs/offline-maps.md).
#
# Usage:
#   tools/offline-maps/build-map.sh --region asia/indonesia/java --bbox 112.50,-8.05,112.72,-7.88 \
#       --id 2000000000000003573 --name "Malang (lab)" [--out tools/offline-maps/out] [--pbf <local .osm.pbf>]
#
#   --region  Geofabrik path of the extract to download once (https://download.geofabrik.de/<region>-latest.osm.pbf); skipped with --pbf.
#   --pbf     A local .osm.pbf instead of downloading.
#   --bbox    west,south,east,north in degrees: the map's area (cut with `osmium extract`).
#   --id      The map id, decimal: the watch reads it from the file name only. JoyoFit ids are 2000000000000000000 + the BPS region code
#             (>= 2^60, so they can never collide with Huawei's ids, which are all below 2^60); see README.md.
#   --name    The region name written into the file header.
#   --out     Output directory (default tools/offline-maps/out, git-ignored).
#
# Needs: osmium-tool (`brew install osmium-tool` / `apt install osmium-tool`), python3, git, curl. The converter is Me7c7's HDataResearch
# (MIT, https://codeberg.org/Me7c7/HDataResearch), cloned at a pinned commit into tools/offline-maps/.cache/. Labels: Indonesian first
# (language id 0x20), then English; zoom levels 10, 12, 14, 16.
#
# The data is OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0): the .bin is a derivative database; credit OSM wherever it is offered.
set -euo pipefail

HDR_REPO="https://codeberg.org/Me7c7/HDataResearch.git"
HDR_COMMIT="c736a1a"

here="$(cd "$(dirname "$0")" && pwd)"
region="" pbf="" bbox="" id="" name="" out="$here/out"
while [ $# -gt 0 ]; do
  case "$1" in
    --region) region="$2"; shift 2 ;;
    --pbf) pbf="$2"; shift 2 ;;
    --bbox) bbox="$2"; shift 2 ;;
    --id) id="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    *) sed -n '2,21p' "$0"; exit 1 ;;
  esac
done
die() { echo "build-map: $*" >&2; exit 1; }
[ -n "$bbox" ] && [ -n "$id" ] && [ -n "$name" ] || { sed -n '2,21p' "$0"; exit 1; }
[ -n "$region" ] || [ -n "$pbf" ] || die "give --region or --pbf"
[[ "$id" =~ ^[0-9]{1,20}$ ]] || die "--id must be a decimal number"
[[ "$bbox" =~ ^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$ ]] || die "--bbox is west,south,east,north"
for tool in osmium python3 git curl; do command -v "$tool" >/dev/null || die "$tool not found"; done

cache="$here/.cache"
mkdir -p "$cache" "$out"

# 1. The converter, pinned.
hdr="$cache/HDataResearch"
if [ ! -d "$hdr/.git" ]; then
  git clone -q "$HDR_REPO" "$hdr"
fi
git -C "$hdr" fetch -q origin 2>/dev/null || true
git -C "$hdr" -c advice.detachedHead=false checkout -q "$HDR_COMMIT"
converter="$hdr/offvmp/converter"

# 2. The OSM extract: downloaded once per region (Geofabrik asks for no repeated bulk downloads; -C - resumes).
if [ -z "$pbf" ]; then
  pbf="$cache/$(echo "$region" | tr '/' '_')-latest.osm.pbf"
  if [ ! -s "$pbf" ]; then
    echo "build-map: downloading https://download.geofabrik.de/$region-latest.osm.pbf"
    curl -fL -C - -o "$pbf" "https://download.geofabrik.de/$region-latest.osm.pbf"
  fi
fi
[ -s "$pbf" ] || die "no such extract: $pbf"

# 3. Cut the area, filter the tags the converter knows, export GeoJSON.
work="$out/work-$id"
mkdir -p "$work"
echo "build-map: cutting $bbox from $(basename "$pbf")"
osmium extract --overwrite --strategy complete_ways -b "$bbox" -o "$work/area.osm.pbf" "$pbf"
"$converter/scripts/extract_geojson.sh" "$work/area.osm.pbf" "$work/area.geojson"

# 4. Build the map: zooms 10/12/14/16, Indonesian labels first (the plain name=* tag is Indonesian), English second.
bin="$out/$id.bin"
python3 "$converter/build_country.py" "$work/area.geojson" --out "$bin" --country "$name" \
  --zooms 10,12,14,16 --langs id,en --default-lang id

# 5. What the app's lab screen will show, and the catalog entry `publish.sh` uploads (`<id>.json`, the server's `GET /v1/maps` shape).
osm_date="$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$pbf" 2>/dev/null || true)"
python3 - "$bin" "$id" "$bbox" "$osm_date" <<'PY'
import datetime, hashlib, json, struct, sys
path, map_id, bbox, osm_date = sys.argv[1:5]
data = open(path, "rb").read()
assert data[:6] == b"offvmp", "no offvmp header"
version, index = struct.unpack_from("<II", data, 6)
region = data[0x3F:0x3F + 511].split(b"\0", 1)[0].decode()
flags = struct.unpack_from("<I", data, index)[0]
zooms = [z for z in range(32) if flags >> z & 1]
size = len(data)
sha = hashlib.sha256(data).hexdigest().upper()
print(f"{path}: {size} bytes ({-(-size // 1048576)} MB announced), offvmp version {version}, region {region!r}, zooms {zooms}")
print(f"sha256 {sha}")
entry = {
    "id": map_id,
    "name": region,
    "bbox": [float(v) for v in bbox.split(",")],
    "sizeBytes": size,
    "sha256": sha,
    "version": version,
    "builtAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "osmDate": osm_date,
}
with open(path[:-4] + ".json", "w") as f:
    json.dump(entry, f, indent=1)
    f.write("\n")
print(f"catalog entry {path[:-4]}.json")
PY
echo "build-map: done. Data © OpenStreetMap contributors (ODbL)."
