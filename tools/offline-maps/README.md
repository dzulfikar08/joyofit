# Offline maps for the watch (lab)

`build-map.sh` builds an offline map file for Huawei watches (`offvmp` format, `<map id>.bin`) from OpenStreetMap, for JoyoFit's
offline-map lab (Settings → About & advanced → Experimental → "Offline maps on the watch (lab test)"; protocol and findings in
`docs/offline-maps.md`). It is a lab tool: nothing here ships in the app.

```
brew install osmium-tool        # or: apt install osmium-tool
tools/offline-maps/build-map.sh --region asia/indonesia/java --bbox 112.50,-8.05,112.72,-7.88 \
    --id 2000000000000003573 --name "Malang (lab)"
# → tools/offline-maps/out/2000000000000003573.bin, plus its size, header and SHA-256
```

What it does:

1. Clones Me7c7's [HDataResearch](https://codeberg.org/Me7c7/HDataResearch) (MIT) at the pinned commit `c736a1a` into `.cache/`.
   Its `offvmp/converter` turns OSM GeoJSON into the watch's tile format; it was tested by its author on a Watch GT 4 and GT 6 Pro.
2. Downloads the Geofabrik extract once (`--region`, e.g. `asia/indonesia/java`, 857 MB) into `.cache/`, or uses `--pbf`. No Overpass
   queries: the area is cut locally with `osmium extract -b <bbox>`.
3. Filters the tags the converter knows and exports GeoJSON (`extract_geojson.sh`).
4. Builds the map with zooms 10, 12, 14, 16 (a region map), labels in Indonesian (language id `0x20`; the plain `name=*` tag is taken
   as Indonesian) then English, and the region name in the header. The header version is the build time `YYMMDDHH`. Tiles carry the
   default political region (0); the app announces the political view `ID`.

`.cache/` and `out/` are git-ignored.

## Map ids

The watch takes the map id from the file name only (`<id>.bin`, `<id>_contour.bin`, `global.bin`). Huawei's ids come from Huawei's
map server; the 2,275 ids listed in HDataResearch's `offvmp/docs/filenames.md` are all below 2^60 (1,152,921,504,606,846,976) and look
random. JoyoFit's ids are **2,000,000,000,000,000,000 + the BPS region code** (Kementerian Dalam Negeri / BPS kode wilayah): above 2^60, so
they cannot collide with a Huawei id, still below 2^63 (a signed 64-bit long), and readable. The lab map is `2000000000000003573`
(3573 = Kota Malang; the box also covers Kecamatan Dau of Kabupaten Malang). If the watch refuses ids at or above 2^60, rename the same
file to `1000000000000003573.bin` (below 2^60 and not in Huawei's list) and send it again: the content does not depend on the id.

## Sample

The lab map is not committed (above the 5 MB limit for files in this repository); rebuild it with the command above.

| Map | Id | Box (W,S,E,N) | Size | Notes |
|---|---|---|---|---|
| Malang (lab) | `2000000000000003573` | `112.50,-8.05,112.72,-7.88` | see docs/offline-maps.md | Java extract of 2026-10-25 |
| Andorra (control) | `446513991765216720` | `1.40,42.42,1.79,42.66` | 3.1 MB | `--region europe/andorra`; an id Huawei issued, to tell "id refused" from "file refused" |

## Licence

Map data © OpenStreetMap contributors, under the [Open Database License](https://www.openstreetmap.org/copyright) (ODbL 1.0). A `.bin`
built here is a derivative database: credit OpenStreetMap wherever it is offered (the app's lab screen does), and offer the file (or
this script and the extract date) under the ODbL when it is shared. HDataResearch is MIT (`.cache/HDataResearch/LICENSE`). The `offvmp`
format belongs to its owner; HDataResearch re-encodes open data into it from public research.
