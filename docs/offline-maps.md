# Offline maps on the watch: feasibility (JRG-425) and lab (JRG-426)

Status: **feasibility study 2026-10-25 (JRG-425; no request was sent to Huawei's map servers), then a lab build (JRG-426, section "Lab")
that sends an OSM-built map to the owner's Fit 4 Pro; its result is under "Lab", "Results".** Question: Huawei Health (HH) 17.0.8.300 offers
"Offline maps" for the Watch Fit 4 Pro (firmware 6.1.0.117): Petal Maps data downloaded on the phone and sent to the watch, so workouts and
routes show a map. Can JoyoFit offer the same?

Sources: HH 17.0.8.300 decompiled (`~/re/agps/jadx`, `~/re/agps/hh.apk`; the map code is Huawei's own SDK `com.huawei.maps.offlinedata`
6.20.0.313, mostly in `jadx/c12`), HH's offline-map H5 mini-program `com.huawei.health.h5.offline-map` 6.23.0.300 (fetched once from the
public CDN HH loads it from, for reading only; not in this repo), HH's logcat with this watch (`~/re/agps/logcat_e2e.txt`, 2026-10-25),
Gadgetbridge master `7adfb4e8` (2026-10-25), huac `67a9d53` and HDataResearch `c736a1a` (both by Me7c7, the author of GB's map code).
File and line references to the decompile are for analysis; no Huawei code or file is copied here.

## Short answer

- **Huawei's maps: no-go.** HH gets them from a private Huawei API that admits only Huawei Health itself: every call carries HH's
  AppGallery Connect API key, and `authenticate` sends HH's package name and signing-certificate fingerprint. JoyoFit would have to
  impersonate HH, which `LEGAL.md` rules out and Huawei's Map Service Agreement forbids (no extraction, storage, bulk download or
  redistribution of map content). Reusing a file HH downloaded is not possible either: it sits in HH's private storage and HH deletes it
  after the transfer.
- **JoyoFit's own maps from OpenStreetMap: go, behind a lab spike.** The watch's map format (`offvmp`) is not encrypted or signed as
  far as the public research shows, and Me7c7's converter (MIT) builds working country maps from OSM (tested on a Watch GT 4 and GT 6 Pro;
  Gadgetbridge 0.93.0 can upload such files). The phone-to-watch protocol is fully known: it is a P2P module on the transport JoyoFit
  already uses for courses and routes. What is not known is whether the **Fit 4 Pro** renders such files, whether it takes a map id Huawei
  never issued, and how long a transfer takes. A 2 to 3 day lab spike answers all three; the feature is about 4 weeks of work after that.

## The watch

| ExpandCapability bit | HH name (`consts/a.java:7`) | Fit 4 Pro |
|---|---|---|
| 201 | `IS_SUPPORT_OFFLINE_MAP` (data type `watch_map`) | set |
| 202 | `IS_SUPPORT_CONTOUR_MAP` (`watch_map_contour`) | set |
| 284 | `IS_SUPPORT_AUTO_DOWNLOAD_MAP` (the watch asks for the map around it) | set |
| 317 | `IS_SUPPORT_SKI_MAP` (`watch_map_ski`) | not set |

Decoded with HH's rule (`byte[i / 8] & (1 << (i % 8))`, `jadx/c0/.../defpackage/egs.java:12`) from the 40-byte Fit 4 Pro blob JoyoFit
logged (`FF7F01EA2E…0404`, `protocol/README.md` "Routes", `DataSyncCodecTest.kt`). Gadgetbridge gates on the same bits
(`HuaweiState.supportsOfflineMap` = 201, `supportsOfflineContourMap` = 202). HH's logcat with this watch shows the watch's map app answering:
on every connect HH sends a mapkit data message and the watch replies (`logcat_e2e.txt:50518` connect, `:52203` `sendMsgToDevice3 msgId 41
sendData true`, `:52580` `onReceiveDeviceCommand`), the "political view" sync below.

## What Huawei Health does

### Entry and gates

Device page, Offline maps (`huaweischeme` deep link `pageType=2`) → `OfflineMapPretreatmentService` (`jadx/c3/.../hwofflinemapmgr/`):
the watch must set bit 201 or 202, and Huawei's remote feature config `com.huawei.health.offlinemap` must allow the account's country (or,
signed out, the phone locale's country) (`jadx/c39/.../defpackage/mni.java:224-267`); a watch in "MCU mode" gets a hint instead. Then the
H5 mini-program opens from `<contentcenter domain>/cch5/mapopen/` (`jadx/c17/.../defpackage/rxa.java:250`), for this region
`https://contentcenter-dra.dbankcdn.com/cch5/mapopen/com.huawei.health.h5.offline-map/com.huawei.health.h5.offline-map-<version>.hpk`
(the `-version.json` next to it said `6.23.0.300`; 867 kB zip of a Vue app). The H5 page drives everything through JS bridges
(`configHolder`, `repository`, `downloadHandler`, `decompressHandler`, `deviceClient`, `AuthClient4H5`; `service/init/a.java:116`).
At start the SDK asks the watch's bits 201, 202, 317 and 284 (`service/init/a.java:69`, via `rwv.queryDeviceCapability` → `egs.e`).

### Cloud: region list, download URL, auth

- Host from GRS service `commonService.maps.offlinedata` (`GrsMapClient.java:18`, `assets/grs_sdk_global_route_config_offlinedata.json`),
  key `ROOT`: `https://map-dra.platform.dbankcloud.com` for group DR2 (Asia/Africa/Latin America, includes `ID`); DR1 China
  `map-drcn.platform.dbankcloud.cn`, DR3 Europe `map-dre.platform.dbankcloud.com`, DR4 Russia `map-drru.map.dbankcloud.ru`. HH's logcat shows the
  DR2 host resolved and its TLS certificate `CN=petalmaps.com` right before the first mapkit message.
- All calls are `POST <ROOT>/open-service/v1/offline-data/<name>` with a JSON body (`network/a.java:37`, `service/cloud/c.java`):
  `authenticate`, `getWorldMap`, `getCountryMapList`, `getRegionMapList`, `getDownloadUrl`, `getRegionsByLatLngs` (the H5 page also knows
  `getNaviVoiceList`, `getRegionByLatLng`, `getStyle4Watch`, the last two unused stubs).
- Headers: `Authorization: Bearer <HH's AppGallery Connect client/api_key>` (`network/a.java:56`; the H5 page sets the same with axios),
  `offlineClientVersion: 62000313` (SDK 6.20.0.313), a generated `requestId` in header and body.
- `authenticate` body (`service/cloud/c.java:126-142`): `appId` (HH's AGC app id), `packageName` (`com.huawei.health`), `certificateFingerprint`
  (hash of HH's installed signing certificate), `deviceModel`, network / SIM / locale / vendor country. Answer (`AuthResponseDTO`): `p` (a token sent
  as `p` in every later call), `politicalView`, `reviewNumberOfWatchMap` (the map approval number shown with the map), `watchMapVersion`,
  `watchMapContourVersion`, `watchMapSkiVersion`, `enableAutoUpdates`. **No Huawei ID is needed; the gate is HH's own identity.**
- List calls send `p`, `deviceType: "watch"`, `language`, `dataType` (`watch_map`, `watch_map_contour`, `watch_map_ski`) and `countryIds`. Items
  (`MapOfflineDataItemEntity`): `id`, `countryId/Name`, `regionId/Name`, `cityId/Name` (the map id), `political`, `fileId` (a path), `version`,
  `packageSize`, `originalSize` (**MB**; the H5 page formats it with `size.mb`), `fileCheck` (SHA-256), `lastModifiedTime`, bounds.
- `getDownloadUrl {fileId}` → `{url, backupUrl}`; the zip is fetched with HH's download manager, SHA-256 checked (`service/download/a.java:78`),
  into `<HH filesDir>/offlineData/download/`, unzipped (at most 5 GB, 1000 entries; `DecompressHandler.java:18`) into
  `<HH filesDir>/offlineData/decompress/`, where exactly one file is expected (`TransmitRequest.java:31`). After a successful transfer HH deletes
  that directory (`service/device/d.java:153`).

### Transfer to the watch: P2P module `mapkit`

Phone side `hw.unitedevice.mapkit` (fingerprint `UniteDeviceManagement`, `EngineLogicBaseManager.java:38,341`), watch side `in.huawei.mapkit`
(fingerprint `SystemApp`, `OfflineMapWearEngineManager.java:17`). Messages are P2P data (`34/01`, JoyoFit's `P2pStack`): **one type byte, then
Huawei TLV** (tag byte, 7-bit varint length, big-endian values; `service/device/tlvtools/c.java`). `msgId` is a counter mod 10000. Types
(`service/device/consts/b.java`):

| Type | Direction | Body (tag: content) |
|---|---|---|
| `01` free space | phone → watch | `01`: 0 |
| `01` | watch → phone | `01`: free space (HH compares it with sizes in MB; huac reads it as KiB; UNVERIFIED) |
| `02` political view | phone → watch, on every connect | `02`: political view (ASCII, from `authenticate`), `14`: review number (ASCII), `13`: msgId (`d.java:393`) |
| `02` | watch → phone | `02`: `"0"` ok / `"1"` failed (HH retries after 3 s, 3 times), `13`, `14` |
| `03` maps on the watch | phone → watch | `13`: msgId |
| `03` | watch → phone | `13`, `04` frames, `05` frame index, `06` count, list `87{88{09 map id u64, 0A map type, 0B version, 16 download type}}` (multi-frame) |
| `04` transfer handshake | phone → watch | `02` political view (HH falls back to `CN`), `14` review number, `0D` size in MB (2 bytes), `0A` map type, `0E` 0 new / 1 update, `13` msgId (4 bytes), `16` download type (0 user, 1 asked by the watch) (`d.java:480-505`) |
| `04` | watch → phone | `0C`: 0 go on, 1 no space, 2 no update, 3 map in use, 4 device error; `13` |
| (file) | phone → watch | the unzipped file over `28` (below) |
| `08` parsed | watch → phone | `09` map id, `0A` map type, `15` code (0 = the watch parsed it) (`receivers/k.java`) |
| `05` delete | phone → watch | `04` frames, `05` index, `06` count (4 bytes), `13` msgId (4 bytes), list `90{91{09 map id u64, 0A type, 0B 4}}` |
| `05` | watch → phone | the same frame fields, `90{91{09, 0A, 12 result (0 ok)}}` (GB, huac) |
| `09` size for my position | watch → phone | `17` longitude f64, `18` latitude f64, `16` download type; HH looks the region up (`getRegionsByLatLngs`); without network it answers `04 {13, 0C 5, 16 1}` (`receivers/b.java:78`) |
| `0A` | phone → watch | `0D`: size in MB (0 = nothing / not on Wi-Fi) |
| `0B` download for me | watch → phone | HH downloads that region and sends it with download type 1; without network the same `04 {13, 0C 5, 16 1}` (`receivers/d.java:134`) |
| `06`, `07` | | ping; the watch asking for the political view again (answered with `02`) |

Map types: 0 country/region map, 1 contour, 2 world overview (`global`), 3 world ski (H5 `getMapType`). The auto-download switch is a DataSync
config, id `900200042`, data TLV `19`: on/off, from `hw.unitedevice.mapkit` to `in.huawei.mapkit` (`d.java:566`).

**The file.** HH hands the file to its common file manager (`rxa.java:153`), which sends P2P files over the FileUpload service `28` with file
type **7** and the source/destination packages and fingerprints in `28/02` (`yml.java:249-257`; Huawei's logs call the commands `5.40.x`),
exactly as JoyoFit sends courses and routes (`FileUploader.kt`, `P2pRoute`). File name `<map id>.bin`, `<map id>_contour.bin` or `global.bin`
(the id is only in the name, not in the content). Large files can move to a Wi-Fi P2P channel (service `2C`, `5.44.x`) on watches that
support Wi-Fi file transfer; the Fit 4 Pro has no Wi-Fi [INFERENCE from the product specs], so it is Bluetooth only. Verification is the
usual `28/03` SHA-256 and `28/07` result, then the watch's own `08` after parsing. The H5 page budgets **5 s per MB** for that parse
(`Math.ceil(originalSize / 0.2) + 30` seconds).

## The on-watch format (`offvmp`)

Not visible in HH (the phone never opens the file). From Gadgetbridge (`HuaweiFwHelper.parseAsOfflineMap`) and Me7c7's HDataResearch
(`offvmp/src`, decoded from files captured over Bluetooth):

- Header `0x440` bytes: magic `offvmp`, `u32 LE` version at 6, `u32 LE` index offset at 10, country/region name (UTF-8, 511 bytes) at 63.
- Index: `u32` zoom bitmap, then per zoom `{x1, y1, x2, y2, count, offset}` (`u32 LE`), and a `u32` offset table (several slots may share a tile).
  Zooms 10, 12, 14, 16 for a region map, 14 for contours, 0 to 9 for `global.bin`.
- Tiles: a chain of records, 9-byte header `{2 unknown, 1 last-record flag, u16 political region (two ASCII letters, or 0 = default), u32
  length}` and a vector-tile body in Huawei's own encoding (not Mapbox MVT / protobuf): geometry plus style ids such as `,100000:1,` (sea) and
  label strings tagged with a language id (`0x20` Indonesian).
- No compression, encryption, checksum or signature was found. Files built from OSM load on a GT 4 and GT 6 Pro (GB issue #5750, 2026-05-04).
  Me7c7's caveats: some fields are still unknown, and formats may differ between watch OS versions.

## Gadgetbridge and the other open implementations

- **Gadgetbridge**: "Huawei: Basic support for offline maps" in 0.93.0, commit `f3dbdafb5e` (2026-07-06).
  `HuaweiP2PMapkitService` (setup = type `02`, free space, list, delete, handshake, upload as P2P file type 7) and an install path for a
  user-picked `.bin` with a valid `offvmp` header and a numeric name. It downloads nothing and has no map management UI ("Maps management is
  not implemented but all protocol related functions are present", issue #5750, 2026-07-10). Open issue #6909: a 206 MB map crashed it with
  out-of-memory (the install handler read the whole file); the answers there also stress the file name rule.
- **huac** (Linux, AGPL-3.0, `devices/huawei/src/services/p2p_service.cpp:3964-4560`): full management: ping must answer `0xca`, free-space check,
  list, "update" flag when the id is already on the watch, handshake, upload, parse result, delete; answers the watch's `09` with size 0 and
  its `0B` with "no network".
- **HDataResearch** (MIT, `offvmp/`): reader (C++) and converter (Python + `osmium-tool`; optional `pyhgtmap` for contours): Geofabrik extract
  → GeoJSON → `<id>.bin` and `<id>_contour.bin`; `global.bin` from Natural Earth + GeoNames; OSM tag → style id tables; per-region
  splitting for large countries; labels per language (`--langs id,en`). Its id list (`docs/filenames.md`, taken from HH traffic) has **no
  Indonesian ids**.

## JoyoFit's options

| Option | Verdict | Why |
|---|---|---|
| A. Download Huawei's maps from `map-dra.platform.dbankcloud.com` | **No** | Needs HH's API key and HH's package/certificate identity (impersonation; `LEGAL.md`: no Huawei servers, no impersonating Huawei's apps). Huawei Map Service Agreement §2.4 (no extracting, storing, rehosting, bulk download of content), §2.13 (no retrieval tools), §2.16 (no redistribution), §2.8 (no reverse engineering of Map Kit); the data is licensed from TomTom (§2.23). No request was sent. |
| B. Send a map HH already downloaded | **No** | JoyoFit has no HH account or session; the file lives in HH's private `filesDir` and is deleted after the transfer; copying Huawei's files is excluded by `LEGAL.md`. |
| C. Build maps from open data and send them with JoyoFit | **Yes, after the lab spike** | Protocol known and close to code JoyoFit has; format re-encodable from OSM (no signature found); data licences are open (ODbL, public domain, CC BY). |

**Blockers and risks for C.**

1. Fit 4 Pro acceptance is unproven: the converter was tested on GT 4 / GT 6 Pro only. A rejected or half-understood file could crash the
   watch's map app (README: watch code is safety-critical), so the feature starts behind an experimental switch.
2. Map ids: HH's ids come from Huawei's cloud. JoyoFit needs its own numeric ids; whether the watch accepts an id Huawei never issued is
   unknown (the converter's docs warn it "may refuse").
3. Size and time: the Geofabrik Java extract alone is 857 MB of PBF (Indonesia 1.7 GB), so maps must be per province or smaller. Bluetooth
   throughput on this watch was never measured; at an assumed 30 to 60 kB/s [INFERENCE] a 50 MB province takes 15 to 30 minutes plus about
   4 minutes of parsing.
4. `FileUploader` (Kotlin and Swift) holds the whole file in memory (`UploadFile(data: ByteArray)` and a SHA-256 over it): fine for faces, not for
   100 MB maps. It needs a file-backed source and a streaming hash (GB hit exactly this, #6909).
5. Licences: show "© OpenStreetMap contributors" where maps are offered; the `.bin` files are a derivative database under ODbL (publish them
   under ODbL, or publish the build scripts, which the AGPL repo does anyway); GeoNames needs credit if `global.bin` is built; for contours use
   NASA SRTM (public domain) rather than the viewfinderpanoramas default of `pyhgtmap`, whose terms are unclear. Not legal advice.
6. Political view: tiles can carry per-country variants of disputed borders; JoyoFit's own maps have one variant, and the value sent in
   `02`/`04` (HH: from Huawei's server, fallback `CN`; GB: `UA`; huac: the user's country) is untested. Use `ID`.
7. A watch firmware update could add a signature check; nothing indicates one today.

## Plan and effort for option C (one developer, Android and iOS)

| Step | Days |
|---|---|
| 0. Lab spike, Android only (steps below): minimal mapkit service + upload of two converter-built files, measure | 2-3 |
| 1. `MapkitService` (Kotlin + Swift): political view on connect, free space, list (multi-frame), delete, handshake with update flag, upload, `08` result, answers to the watch's `09` / `0B` (size 0 / no network, as huac), golden-byte tests | 4-5 |
| 2. Streaming upload: file-backed `UploadFile`, streaming SHA-256, both platforms | 2 |
| 3. Map build pipeline: monthly job (GitHub Actions or a VM; the Worker cannot run osmium) Geofabrik Indonesia → per-province extracts → HDataResearch converter (pinned) with Indonesian labels and style overrides → R2 + manifest (id, name, version, size, SHA-256); optional `global.bin` and contours | 5-7 |
| 4. App: region list with sizes, download, send with progress and parse wait, list/delete on the watch, update, attribution, `id`/`en` strings, release entry | 4-5 |
| 5. Tests on the Fit 4 Pro (and any other watch with bit 201) | 2-3 |

About 17 to 22 days after a successful spike. Stop after step 0 if the Fit 4 Pro does not report `08` code 0 for a converter-built file or
does not draw it.

## Lab (JRG-426)

Branch `lab/jrg-426-offline-map` (draft PR, not to be merged) adds what the spike needs, nothing more:

- **The map.** `tools/offline-maps/build-map.sh` (README next to it): Geofabrik extract → `osmium extract -b <box>` → HDataResearch's converter
  (MIT, pinned `c736a1a`) with zooms 10/12/14/16, labels Indonesian (language id `0x20`) then English, the region name in the header, header
  version = build time `YYMMDDHH`, tiles with the default political region. The lab map is **Malang (lab)**, box `112.50,-8.05,112.72,-7.88` (Kota
  Malang and Kecamatan Dau, where the owner runs), from the Java extract of 2026-10-25: `2000000000000003573.bin` (size: see "Results"). Not committed
  (over 5 MB); the README has the one command that rebuilds it.
- **The map id.** The watch takes the id from the file name only. Huawei's 2,275 known ids (HDataResearch `docs/filenames.md`) are all below
  2^60 and look random; JoyoFit uses **2,000,000,000,000,000,000 + the BPS region code** (3573 = Kota Malang): above 2^60, so it can never
  collide with a Huawei id, below 2^63, readable. Fallbacks for the lab: the same file renamed `1000000000000003573.bin` (below 2^60, not in
  Huawei's list) answers "does the watch refuse ids at or above 2^60?", and an Andorra map under Huawei's own Andorra id `446513991765216720`
  (3.1 MB, `--region europe/andorra --bbox 1.40,42.42,1.79,42.66`) answers "is it the id or the file?".
- **The app.** Settings → About & advanced → Experimental → **Offline maps on the watch (lab test)** (Indonesian: Pengaturan → Tentang & lanjutan →
  Eksperimental → **Peta offline di jam (uji lab)**), off by default. When on, and the watch sets ExpandCapability 201, JoyoFit registers the
  mapkit module on every connect (ping, political view `ID`) and answers the watch's own asks as huac does (`07` → `02`, `09` → size 0,
  `0B` → "no network"). A row under the switch opens the lab screen: **Peta di jam** (list `03`, with **Hapus** = delete `05` per map),
  **Ruang kosong** (`01`), **Pilih .bin** (the picker; the file is checked for the `<id>.bin` name and the `offvmp` header and shown: region,
  zooms, size, SHA-256) and **Kirim ke jam**: free space → list (update flag when the id is there) → handshake `04` → the file over `28` as
  P2P file type 7 named `<id>.bin` → the watch's `08`, awaited for 5 s per MB + 30 s. Frames: `protocol/README.md`, P2P "(e) Offline maps".
  Code: `MapkitWire`, `MapkitService`, `OfflineMapLab` (Kotlin and Swift twins, frames tested against `Fixtures/mapkit.json` on both).
  Limit: the upload holds the file in memory (`FileUploader`), so the lab takes files up to 64 MiB; a real feature needs the streaming upload.

### Lab procedure (Android, watch bound to JoyoFit; do not rebind to Huawei Health)

1. Build the map (or take the copies in `~/re/offmaps/out/` on the build machine) and put it on the phone:
   `adb push tools/offline-maps/out/2000000000000003573.bin /sdcard/Download/` (and, for the fallbacks, `1000000000000003573.bin` and
   `446513991765216720.bin`).
2. Install the lab APK, connect the watch (the normal link, not the developer LE switch), clear the log: `adb logcat -c`.
3. Pengaturan → Tentang & lanjutan → Eksperimental → switch **Peta offline di jam (uji lab)** on, then tap the **Peta offline di jam (uji lab)** row.
4. Tap **Peta di jam**, then **Ruang kosong**. Then **Pilih .bin** → Download → `2000000000000003573.bin`; the screen shows "Malang (lab)",
   zooms 10, 12, 14, 16. Tap **Kirim ke jam** and wait for the result notice (upload plus parse; minutes).
5. `adb logcat -d -s JoyoFit:V | grep -E "Mapkit|Upload:" > mapkit_lab.txt`
6. On the watch: start an Outdoor run (or open the map view from the workout's pre-start settings / swipe to the map page during the run) in
   Malang and photograph the map at two zoom levels: roads, rivers, land use, Indonesian labels. Then stop the workout without saving.
7. Back in the lab screen: **Peta di jam** (the id should be listed), **Kirim ke jam** again (update path, `0E=01`), then **Hapus** (`12=00`).
8. Only if step 4 failed: send `1000000000000003573.bin`, then `446513991765216720.bin` (Andorra, parse result only; the watch is not in Andorra).

### What to look for (log lines, in order)

| Step | Expected | If not |
|---|---|---|
| connect | `Mapkit: ExpandCapability 201 (offline map)=true 202 (contour)=true 284 (auto download)=true 317 (ski)=false`, `Mapkit: registered hw.unitedevice.mapkit -> in.huawei.mapkit; political view ID`, `Mapkit: tx 02 political view: 02="ID" 14=() 13=…` | no `registered` line: the switch is off or bit 201 unset |
| ping | `Mapkit: ping of in.huawei.mapkit answered 0xca` | another code: the map app is not there; stop |
| political view | `Mapkit: rx 02 political view: 02=30 …` (`30` = "0", ok) | `02=31` ("1") three times: the watch refuses view `ID`; try `CN` (Huawei Health's fallback) |
| free space | `Mapkit: rx 01 free space: 01=…` | note the number next to the watch's storage screen (settles KiB vs MB) |
| list | `Mapkit: rx 03 map list: 04=01 05=00 06=00 …` (no maps yet) | |
| handshake | `Mapkit: tx 04 transfer handshake: 02="ID" 14=() 0D=00NN 0A=00 0E=00 13=… 16=00`, `Mapkit: handshake (…) -> 0C=0 (go on)` | `0C=1` no space, `0C=4` device error: stop and report |
| file | `Upload: start 2000000000000003573.bin: type=7 size=…`, `Upload: FileInfoSend: watch answered 100000`, `Mapkit: upload … bytes after … s`, `Upload: complete … result status=1`, `Mapkit: upload finished in S s (R B/s)` | a `28/02` refusal: the watch's file service refuses the P2P file (the log has its code) |
| parse | `Mapkit: rx 08 parse result: 09=1BC16D674EC80DF5 0A=00 15=00`, `Mapkit: parse result after X s: map 2000000000000003573 type 0 code 0 (the watch took the map)` | `15` ≠ 0: the watch could not read it; no `08`: inconclusive |

**Go / no-go.** Go: `08` code 0 **and** the watch draws the Malang map. Id problem: our id fails but `1000000000000003573` or Andorra parses
→ use ids below 2^60. No-go for now: every file fails to parse, or parses but nothing is drawn (then the converter's tile encoding does
not fit this firmware; report upstream with the log). Also record: throughput (B/s from the `upload finished` line) and parse time, which
size the per-province maps.

### Results

Pending: the lab APK and the device run on the owner's Fit 4 Pro (firmware 6.1.0.117).

## Evidence index (decompile paths are under `~/re/agps/jadx/`)

- Capability bits: `c12/sources/com/huawei/maps/offlinedata/consts/a.java:7`, `.../service/init/a.java:69`; HH gate
  `c39/sources/defpackage/mni.java:224-267`; bit check `c0/sources/defpackage/egs.java:12-37`; per-index query `c17/sources/defpackage/rwv.java:36`.
- Cloud: `.../service/cloud/GrsMapClient.java:18`, `.../network/a.java:37-56`, `.../service/cloud/c.java:126-222`, `.../service/cloud/a.java:35`,
  `.../service/download/a.java:78`, `.../handler/DecompressHandler.java:18`, `.../handler/dto/device/TransmitRequest.java:31`,
  `.../service/storage/a.java:96`; GRS table `hh.apk:assets/grs_sdk_global_route_config_offlinedata.json`.
- Device protocol: `.../health/p2p/OfflineMapWearEngineManager.java:12-17`, `.../service/device/consts/a.java`, `.../consts/b.java`,
  `.../service/device/d.java:153,379,393,463,480-505,510,553,566`, `.../tlvtools/c.java:126`, receivers `b.java:100`, `c.java:31`, `e.java:18`,
  `j.java:92-115`, `k.java:39`; `c17/sources/defpackage/rxa.java:86,153,250`;
  `c21/sources/com/huawei/unitedevice/manager/EngineLogicBaseManager.java:38,341`; `c21/sources/defpackage/yml.java:249-265`.
- H5 6.23.0.300: `entry/assets/index-legacy-DWOJPkOm.js` (`offlineMapApi`, `getTransmitRequest`, `getMapType`, axios `Authorization`,
  parse-time budget), `preRequests.json`.
- HH with this watch: `~/re/agps/logcat_e2e.txt:50518,52203,52580` (and the same pattern at 11:28 and 11:31).
- Gadgetbridge `7adfb4e8`: `service/devices/huawei/p2p/HuaweiP2PMapkitService.java`, `HuaweiFwHelper.java:100-173`,
  `devices/huawei/HuaweiState.java:855-864`, `CHANGELOG.md` (0.93.0); issues #5750 and #6909.
- huac `67a9d53`: `devices/huawei/src/services/p2p_service.cpp:3964-4560`, `validators/map_validator.cpp`.
- HDataResearch `c736a1a`: `offvmp/README_CONVERTER.md`, `offvmp/src/data_offvmp.h`, `offvmp/src/main.cpp`, `offvmp/src/data_vtile.h`,
  `offvmp/docs/filenames.md`.
- Terms: [HUAWEI Map Service Agreement](https://terms-drcn.platform.hicloud.com/agreementservice/developer/getAgreementTemplate?agrType=1070&country=ove&language=en_us&version=2020011405)
  §2.4, 2.8, 2.13, 2.16, 2.23; [OSM copyright and ODbL](https://www.openstreetmap.org/copyright); Geofabrik
  [Indonesia](https://download.geofabrik.de/asia/indonesia.html) sizes (2026-10-25).
