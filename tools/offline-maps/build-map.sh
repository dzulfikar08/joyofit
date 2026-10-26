#!/usr/bin/env bash
# Builds one offline map for Huawei watches (`offvmp`, `<id>.bin`) from OpenStreetMap, for JoyoFit's offline-map lab (docs/offline-maps.md).
# Every Kabupaten/Kota at once: build-all.sh.
#
# Usage:
#   tools/offline-maps/build-map.sh --region asia/indonesia/java --bbox 112.50,-8.05,112.72,-7.88 \
#       --id 2000000000000003573 --name "Malang (lab)" [--poly area.poly] [--out tools/offline-maps/out] [--pbf <local .osm.pbf>]
#
#   --region  Geofabrik path of the extract to download once (https://download.geofabrik.de/<region>-latest.osm.pbf); skipped with --pbf.
#   --pbf     A local .osm.pbf instead of downloading.
#   --bbox    west,south,east,north in degrees: the map's area (cut with `osmium extract`) and the catalog entry's bbox.
#   --poly    Cut with this polygon (.poly or GeoJSON) instead of the bbox.
#   --id      The map id, decimal: the watch reads it from the file name only. JoyoFit ids are 2000000000000000000 + the BPS region code
#             (>= 2^60, so they can never collide with Huawei's ids, which are all below 2^60); see README.md.
#   --name    The region name written into the file header.
#   --out     Output directory (default tools/offline-maps/out, git-ignored).
#
# Needs: osmium-tool, python3, git, curl (README.md, Setup). The converter is Me7c7's HDataResearch (MIT,
# https://codeberg.org/Me7c7/HDataResearch), cloned at a pinned commit into tools/offline-maps/.cache/ (lib.sh). Labels: Indonesian first
# (language id 0x20), then English; zoom levels 10, 12, 14, 16.
#
# The data is OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0): the .bin is a derivative database; credit OSM wherever it is offered.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
. "$here/lib.sh"
region="" pbf="" bbox="" poly="" id="" name="" out="$here/out"
usage() { sed -n '2,21p' "$0"; exit 1; }
while [ $# -gt 0 ]; do
  case "$1" in
    --region) region="$2"; shift 2 ;;
    --pbf) pbf="$2"; shift 2 ;;
    --bbox) bbox="$2"; shift 2 ;;
    --poly) poly="$2"; shift 2 ;;
    --id) id="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$bbox" ] && [ -n "$id" ] && [ -n "$name" ] || usage
[ -n "$region" ] || [ -n "$pbf" ] || om_die "give --region or --pbf"
[[ "$id" =~ ^[0-9]{1,20}$ ]] || om_die "--id must be a decimal number"
[[ "$bbox" =~ ^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$ ]] || om_die "--bbox is west,south,east,north"
[ -z "$poly" ] || [ -s "$poly" ] || om_die "no such polygon: $poly"
om_require osmium python3 git curl
mkdir -p "$out"

# 1. The converter, pinned. 2. The OSM extract, downloaded once per region.
converter="$(om_converter)"
[ -n "$pbf" ] || pbf="$(om_extract "$region")"
[ -s "$pbf" ] || om_die "no such extract: $pbf"

# 3. Cut the area, filter the tags the converter knows, export GeoJSON.
work="$out/work-$id"
mkdir -p "$work"
if [ -n "$poly" ]; then
  echo "build-map: cutting $(basename "$poly") from $(basename "$pbf")"
  osmium extract --overwrite --strategy complete_ways -p "$poly" -o "$work/area.osm.pbf" "$pbf"
else
  echo "build-map: cutting $bbox from $(basename "$pbf")"
  osmium extract --overwrite --strategy complete_ways -b "$bbox" -o "$work/area.osm.pbf" "$pbf"
fi
"$converter/scripts/extract_geojson.sh" "$work/area.osm.pbf" "$work/area.geojson"

# 4. Build the map: zooms 10/12/14/16, Indonesian labels first (the plain name=* tag is Indonesian), English second.
bin="$out/$id.bin"
python3 "$converter/build_country.py" "$work/area.geojson" --out "$bin" --country "$name" \
  --zooms 10,12,14,16 --langs id,en --default-lang id

# 5. What the app's lab screen will show, and the catalog entry publish.py uploads (`<id>.json`, the server's `GET /v1/maps` shape).
osm_date="$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$pbf" 2>/dev/null || true)"
python3 "$here/mapinfo.py" "$bin" --id "$id" --bbox "$bbox" --osm-date "$osm_date"
echo "build-map: done. Data © OpenStreetMap contributors (ODbL)."
