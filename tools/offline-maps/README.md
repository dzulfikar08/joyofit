# Offline maps for the watch (lab)

`build-map.sh` builds an offline map file for Huawei watches (`offvmp` format, `<map id>.bin`) from OpenStreetMap, for JoyoFit's
offline-map lab (Settings → About & advanced → Experimental → "Offline maps on the watch (lab test)"; protocol and findings in
`docs/offline-maps.md`). It is a lab tool: nothing here ships in the app.

```
brew install osmium-tool        # or: apt install osmium-tool
tools/offline-maps/build-map.sh --region asia/indonesia/java --bbox 112.50,-8.05,112.72,-7.88 \
    --id 2000000000000003573 --name "Malang (lab)"
# → tools/offline-maps/out/2000000000000003573.bin and .json (catalog entry), plus its size, header and SHA-256
tools/offline-maps/build-map.sh --region asia/indonesia/java --bbox 112.57,-7.37,112.87,-7.17 \
    --id 2000000000000003578 --name "Surabaya (lab)"
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

## Publishing (what the app downloads)

```
tools/offline-maps/publish.sh 2000000000000003573 2000000000000003578
curl -s https://api.fit.joyorogo.com/v1/maps
```

`publish.sh` uploads `out/<id>.bin` to the R2 bucket `joyofit-maps` at `watch/<id>.bin` (`wrangler r2 object put --remote`, account
`b7e6f845…`), then merges `out/<id>.json` (written by `build-map.sh`: id, name, bbox, size, SHA-256, header version, build time, OSM extract
time) into `watch/catalog.json` and uploads it last. JoyoFit's Worker serves the catalog at `GET /v1/maps` and the files at
`GET /v1/maps/<id>.bin` (`server/src/maps.ts`); the app's lab screen downloads from there and checks size and SHA-256 before it keeps a file.
The bucket also holds the bike computer's PMTiles (`docs/bike-computer.md`); this script only writes under `watch/`.

## Map ids

The watch takes the map id from the file name only (`<id>.bin`, `<id>_contour.bin`, `global.bin`). Huawei's ids come from Huawei's
map server; the 2,275 ids listed in HDataResearch's `offvmp/docs/filenames.md` are all below 2^60 (1,152,921,504,606,846,976) and look
random. JoyoFit's ids are **2,000,000,000,000,000,000 + the BPS region code** (Kementerian Dalam Negeri / BPS kode wilayah): above 2^60, so
they cannot collide with a Huawei id, still below 2^63 (a signed 64-bit long), and readable. The lab maps are `2000000000000003573`
(3573 = Kota Malang; the box also covers Kecamatan Dau of Kabupaten Malang), `2000000000000003578` (3578 = Kota Surabaya). The Fit 4 Pro
accepted an id above 2^60 on 2026-10-26 (docs/offline-maps.md, "Results").
Had the watch refused ids at or above 2^60, the fallback was to rename the same
file to `1000000000000003573.bin` (below 2^60 and not in Huawei's list) and send it again: the content does not depend on the id.

## Sample

The lab maps are not committed (above the 5 MB limit for files in this repository); rebuild them with the commands in the table.

| Map | Id | Box (W,S,E,N) | Size | Notes |
|---|---|---|---|---|
| Malang (lab) | `2000000000000003573` | `112.50,-8.05,112.72,-7.88` | 9.2 MiB (9,616,061 bytes) | Java extract of 2026-10-24T20:20Z; 34 s to build |
| Surabaya (lab) | `2000000000000003578` | `112.57,-7.37,112.87,-7.17` | 45 MiB (47,244,748 bytes) | Java extract of 2026-10-24T20:20Z; 4 min to build; about 10 min to send at 75 kB/s |
| Andorra (control) | `446513991765216720` | `1.40,42.42,1.79,42.66` | 3.1 MB | `--region europe/andorra`; an id Huawei issued, to tell "id refused" from "file refused" |

## Licence

Map data © OpenStreetMap contributors, under the [Open Database License](https://www.openstreetmap.org/copyright) (ODbL 1.0). A `.bin`
built here is a derivative database: credit OpenStreetMap wherever it is offered (the app's lab screen does), and offer the file (or
this script and the extract date) under the ODbL when it is shared. HDataResearch is MIT (`.cache/HDataResearch/LICENSE`). The `offvmp`
format belongs to its owner; HDataResearch re-encodes open data into it from public research.
