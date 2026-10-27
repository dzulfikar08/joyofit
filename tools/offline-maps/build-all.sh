#!/usr/bin/env bash
# Builds the offline watch map of every Indonesian Kabupaten/Kota (regions.json) from the Geofabrik Indonesia extract. Linux or macOS;
# the full run belongs on a Linux box with enough RAM and disk (README.md, "All regions"). Publish afterwards with publish.py --all.
#
#   tools/offline-maps/build-all.sh [--pbf FILE | --no-refresh] [build_all.py options]
#
#   --pbf FILE     use this extract instead of downloading https://download.geofabrik.de/asia/indonesia-latest.osm.pbf
#   --no-refresh   use the cached extract as it is (default: ask Geofabrik for a newer one first; unchanged = no download)
#   --jobs N       conversions at once (default: half the CPUs)          --only 3573,3515   only these BPS codes
#   --province P   only this province ("Jawa Timur")                     --force            rebuild up-to-date regions too
#   --max-mib M    split maps above M MiB (default 64)                   --keep-work        keep cuts and logs in out/work/
#   --batch N      regions per osmium pass (default 16; ~1.3 GB each on Linux)   --pre-cut   cut the selection's box first (with --province)
#   (all options: build-all.sh --help)
#
# Output in tools/offline-maps/out/: <id>.bin, <id>.json (catalog entry), state/<code>.json, report.json.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
. "$here/lib.sh"
pbf="" refresh=1 rest=()
while [ $# -gt 0 ]; do
  case "$1" in
    --pbf) pbf="$2"; shift 2 ;;
    --no-refresh) refresh=0; shift ;;
    -h|--help) sed -n '2,15p' "$0"; rest+=(--help); shift ;;
    *) rest+=("$1"); shift ;;
  esac
done
om_require osmium python3 git curl
converter="$(om_converter)"
python="$(om_python)"
[ -n "$pbf" ] || pbf="$(om_extract asia/indonesia "$refresh")"
[ -s "$pbf" ] || om_die "no such extract: $pbf"
exec "$python" "$here/build_all.py" --pbf "$pbf" --converter "$converter" --converter-commit "$HDR_COMMIT" ${rest[@]+"${rest[@]}"}
