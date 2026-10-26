# Shared by build-map.sh and build-all.sh (sourced, not run): the pinned converter, the Python environment and the Geofabrik extract.
# Everything lands in tools/offline-maps/.cache/ (git-ignored).

# Me7c7's HDataResearch (MIT): its offvmp/converter turns OSM GeoJSON into the watch's tile format.
HDR_REPO="https://codeberg.org/Me7c7/HDataResearch.git"
HDR_COMMIT="c736a1a"
# Polygon buffering, simplifying and splitting in regions.py / build_all.py (the converter itself needs only the standard library).
SHAPELY_VERSION="2.2.0"

om_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
om_cache="$om_here/.cache"
mkdir -p "$om_cache"

om_die() { echo "offline-maps: $*" >&2; exit 1; }

om_require() {
  local tool
  for tool in "$@"; do command -v "$tool" >/dev/null || om_die "$tool not found (tools/offline-maps/README.md, Setup)"; done
}

# Clones the converter once and checks out the pinned commit; prints the converter directory.
om_converter() {
  local hdr="$om_cache/HDataResearch"
  [ -d "$hdr/.git" ] || git clone -q "$HDR_REPO" "$hdr" >&2
  if [ "$(git -C "$hdr" rev-parse --short=7 HEAD 2>/dev/null)" != "$HDR_COMMIT" ]; then
    git -C "$hdr" fetch -q origin >&2 || true
    git -C "$hdr" -c advice.detachedHead=false checkout -q "$HDR_COMMIT" >&2
  fi
  echo "$hdr/offvmp/converter"
}

# A virtualenv with shapely; prints its python.
om_python() {
  local venv="$om_cache/venv"
  [ -x "$venv/bin/python" ] || python3 -m venv "$venv" >&2
  if ! "$venv/bin/python" -c "import shapely, sys; sys.exit(shapely.__version__ != '$SHAPELY_VERSION')" 2>/dev/null; then
    "$venv/bin/pip" install -q "shapely==$SHAPELY_VERSION" >&2
  fi
  echo "$venv/bin/python"
}

# Downloads https://download.geofabrik.de/<region>-latest.osm.pbf into the cache; prints its path. With refresh=1 it asks Geofabrik
# for a newer file (conditional GET on the local file's time, so an unchanged extract is not downloaded again). Geofabrik asks for no
# repeated bulk downloads: one extract per run, never per region.
om_extract() {
  local region="$1" refresh="${2:-0}"
  local pbf="$om_cache/$(echo "$region" | tr '/' '_')-latest.osm.pbf"
  local url="https://download.geofabrik.de/$region-latest.osm.pbf"
  if [ ! -s "$pbf" ]; then
    echo "offline-maps: downloading $url" >&2
    curl -fLR -C - -o "$pbf.part" "$url" >&2
    mv "$pbf.part" "$pbf"
  elif [ "$refresh" = 1 ]; then
    echo "offline-maps: checking $url for a newer extract" >&2
    rm -f "$pbf.part"
    curl -fLR -z "$pbf" -o "$pbf.part" "$url" >&2
    if [ -s "$pbf.part" ]; then mv "$pbf.part" "$pbf"; else rm -f "$pbf.part"; fi
  fi
  echo "$pbf"
}
