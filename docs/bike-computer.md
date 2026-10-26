# Bike computer mode

Written 2026-10-18. Branch `bikecomp`, created from `origin/sensors` (so it carries the sensors, phone recorder, GPS warm-up and cycling metrics: `docs/sensors.md`, `docs/cycling-metrics.md`, `docs/multi-watch.md`). Another branch, `ride-game`, is the indoor game; this is the outdoor counterpart and touches none of it.

**Goal.** While the phone records a ride it behaves like a dedicated bike computer (Garmin Edge, Wahoo ELEMNT, iGPSPORT, Bryton), for riders who do not own one. It is a mode: Settings > Bersepeda has the switch and every page's setting, and the record picker shows a switch when the sport is Ride. With the mode off, the existing live screen is unchanged.

Status words in the tables: **Now** = already in JoyoFit before this branch; **Phase 1** = built on this branch; **Later** = designed here, not built; **Not feasible** = cannot be done on a phone with the tools JoyoFit has, reason given.

Evidence tags: [DOC] a vendor page read on 2026-10-18 (link at the end), [KNOWLEDGE] what I know of the product and did not re-check today, [REPO] read in this repository, [INFERENCE] my reading, not measured.

## 1. Decisions in one screen

| Topic | Decision |
| --- | --- |
| Where it lives | `src/features/bikecomputer/` (pure engines + UI), wired into the existing recorder (`features/record`) through small, tested hooks. No second recorder. |
| Map stack | **MapLibre Native through `@maplibre/maplibre-react-native` (already a dependency and an `app.json` plugin) reading a regional PMTiles file** (`pmtiles://file://...`, supported natively since MapLibre Android 11.7 / iOS 6.10; the installed library bundles Android 13.6.1 and iOS 6.31.0). Tiles in the OpenMapTiles schema, built with Planetiler from Geofabrik extracts, hosted on our own R2 bucket. The existing `maplibreStyle()` (src/features/map/palette.ts) draws them unchanged. **No new native dependency for the map.** |
| Without a downloaded region | The same style over OpenFreeMap, as today's route map (online only). The page says so. |
| Navigation | Follow a saved route (GPX/TCX library, `features/routes`): route line, progress, off-course alert, turn cues generated from the geometry, distance to turn, ClimbPro-style upcoming climbs. Rerouting is **Later**, online only (the repo already has an OSM routing client for the route editor). |
| Live tracking | Cheap: a few Worker endpoints and one D1 table on the existing `joyofit-api` (no Durable Object needed), a public read-only page. Phase 1 (deployed 2026-10-18). |
| Crash detection | **Later** and needs an accelerometer module (`expo-sensors`, native). Plan and the false-alarm design are in 7. The automatic delivery path is server email/push through the live-tracking session, not SMS (section 7). Owner decision. |
| Native work | Phase 1 adds **nothing native for maps or screens**. Two optional native items are specified (lock-screen Pause/Lap actions, a GPS interval for battery saver) and one standard Expo module is added for screen dimming and orientation; all are flagged in section 10 and ship only in a store build (the branch already changes the OTA fingerprint through `sensors`). |
| Theme | A ride-only palette pair (day = white, night = black), not a fourth app theme: the ride screen must not change when the person's theme changes, and its contrast is tested (`ridePalette.test.ts`). |

## 2. Feature matrix

Competitor cells marked [DOC] come from the pages linked in section 12; the rest are [KNOWLEDGE] and are the ones to re-check before any of this is quoted in marketing. JoyoFit cells are [REPO].

| Feature | Garmin Edge 540 / 840 | Edge 1050 | Wahoo ELEMNT Bolt / Roam | iGPSPORT (BSC300T) | Bryton (Rider 750) | JoyoFit before | Bike mode |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Display | 2.6 in, buttons (540) / touch + buttons (840) [DOC] | 3.5 in touch [KNOWLEDGE] | 2.2 in mono (Bolt), 2.7 in colour (Roam) [KNOWLEDGE] | 2.4 in colour touch [DOC] | colour [KNOWLEDGE] | phone screen | phone screen, 2 themes |
| Speed, avg, max, distance, time, clock | yes | yes | yes | 130+ metrics [DOC] | yes | speed, distance, time | **Phase 1** (all of them, as fields) |
| Heart rate + zone, cadence | yes | yes | yes | yes | yes | HR, zone, cadence tiles | **Phase 1** |
| Power: real | yes | yes | yes | yes | yes | tile | **Phase 1** |
| Power: 3 s, 10 s, avg, NP, lap, zone, W/kg | yes | yes | yes | yes [KNOWLEDGE] | partly | none live (analysis after the ride only) | **Phase 1** (3 s, 10 s, avg, NP, zone); lap power and W/kg **Later** |
| Power: estimated (no meter) | no | no | no | no | no | none | **Phase 1**, labelled "perkiraan": speed + grade + weight model (extends `virtualSpeedMs`) |
| Elevation, ascent, descent, grade | barometer [KNOWLEDGE] | barometer | barometer | barometer [KNOWLEDGE] | barometer | recorded only | **Phase 1** from GPS altitude, smoothed (no barometer in `expo` without a module, so grade is noisier; see 9) |
| Temperature | sensor on device [KNOWLEDGE] | yes | Roam / Bolt: no, from sensor or phone [KNOWLEDGE] | yes [KNOWLEDGE] | yes [KNOWLEDGE] | none | **Not feasible** from the phone (no ambient sensor exposed); a weather-API value is not a measurement, so it is not offered |
| Gear (Di2 / eTap) | yes | yes | yes | Di2 [DOC] | yes | none | **Later** (needs proprietary-profile work) |
| Customisable data pages, field picker | yes (several pages, up to ~10 fields) [KNOWLEDGE] | yes | yes | yes | yes | one fixed layout | **Phase 1**: pages of 1, 2, 4, 6 or 8 fields, field picker, persisted |
| Map page | yes, offline maps | yes | yes (Roam), Bolt breadcrumb | yes, offline [DOC] | yes, OSM [DOC] | route map in the library | **Phase 1**: offline PMTiles region + route + position |
| Offline maps | preloaded / regional download [KNOWLEDGE] | yes | regional packs [DOC: "Manage Maps"] | yes [DOC] | yes [DOC] | no | **Phase 1** (Java / Bali regions) |
| Turn-by-turn from a course | yes | yes | yes + LED + beep [KNOWLEDGE] | yes | yes | route sent to a watch | **Phase 1**: cues from geometry, distance to turn |
| Off-course alert | yes (can be paused) [DOC] | yes | yes | yes | yes | none | **Phase 1** |
| Routing / reroute, popularity routing | yes [DOC] | yes | yes (Roam) | yes | yes | OSM routing in the route editor | **Later** (online reroute); popularity routing **Not feasible** (Garmin's heatmap data) |
| ClimbPro / climb page | yes, also free-ride [DOC] | yes | Climb page [KNOWLEDGE] | climb assist [KNOWLEDGE] | yes [KNOWLEDGE] | climbs after the ride (`cycling/climbs.ts`) | **Phase 1**: climbs of the followed route, remaining ascent and grade, profile |
| Auto-pause | yes | yes | yes | yes | yes | recorder pause only | **Phase 1** (speed threshold, hysteresis) |
| Auto-lap, manual lap | distance or position, manual [KNOWLEDGE] | yes | yes | yes | yes | manual lap | **Phase 1**: distance and start position |
| Alerts: HR / cadence / power zone, time, distance | yes | yes | yes | yes | yes | none | **Phase 1** |
| Eat / drink reminders | yes [DOC: "notifications when it's time to refuel or rehydrate"] | yes | yes [KNOWLEDGE] | yes [KNOWLEDGE] | partly | none | **Phase 1** (time and distance) |
| Sound / vibration for alerts | beeps (540/840), speaker (1050) [KNOWLEDGE] | speaker | beeps + LEDs | beeps [KNOWLEDGE] | beeps | none | **Phase 1** vibration + sound (section 6) |
| Live tracking link | LiveTrack [DOC] | yes | Live Track [DOC] | yes [KNOWLEDGE] | yes [KNOWLEDGE] | none | **Phase 1** (code, not deployed) |
| Incident / crash detection | yes, all cycling [DOC] | yes | yes (via the phone app) [KNOWLEDGE] | no [KNOWLEDGE] | no | none | **Later** (needs accelerometer module + owner decision) |
| Varia radar / lights | yes | yes | yes | radar [DOC] | partly | none | **Later** (BLE radar profile; not standard GATT) |
| Phone notifications on the unit | yes | yes | yes | yes | yes | n/a (it is the phone) | **Not needed** |
| Strava live segments, workouts, coaching, Power Guide | Power Guide, adaptive coaching [DOC] | yes | partly | no | no | analysis after the ride | **Later**, out of scope |
| Battery | 26 h demanding, 42 h saver (540/840 non-solar) [DOC] | ~20 h [KNOWLEDGE] | 15-17 h [KNOWLEDGE] | 20 h [DOC] | ~20 h [KNOWLEDGE] | n/a | **Phase 1**: estimate before the ride, saver mode; a phone will not reach those hours (see 8) |
| Export to Strava / FIT | yes | yes | yes | yes | yes | yes | **Now** |

## 3. Offline maps

### Requirements

No API key and no cost that needs approval; works with no signal; region download by the rider; honest attribution; our own hosting if bulk files are involved; fast enough to follow a moving dot.

### Options looked at

| Option | What it is | Verdict |
| --- | --- | --- |
| A. OpenFreeMap online (what the route map uses now) | Free OpenMapTiles vector tiles, no key. Online only. | Keep as the online fallback. Bulk-downloading its tiles for offline packs is not what a free public service is for. |
| B. MapLibre `OfflineManager` packs over OpenFreeMap | Native tile cache for a bbox. | Rejected as the main path: it still pulls every tile from a third party's public servers, packs are capped by MapLibre's tile-count limit, and PMTiles sources do not support offline packs or caching at all [DOC: MapLibre Android PMTiles example]. |
| C. **PMTiles regional file read natively by MapLibre** | One file per region, in the OpenMapTiles schema, `pmtiles://file://...`. | **Chosen.** Native 60 fps rendering, no new native module, one file per region, offline from the first launch after the download, and the same file can be streamed with `pmtiles://https://...` when the rider has not downloaded it. |
| D. JS SVG renderer (`TileMap`, the existing pure-JS map) over a JS PMTiles reader | Pure JS. | Fine for a static route preview (it is what the library uses), too slow to follow a moving position at ride speed. Kept for previews only. |
| E. Protomaps basemap schema | Daily planet PMTiles; needs a different style. | Not chosen: our style tables, palette tests and both renderers are OpenMapTiles (`ROAD_GROUPS`, `maplibreStyle`). Switching schema means rewriting and re-testing both. |
| F. Mapbox / MapTiler / Stadia offline | Hosted, keyed. | Needs an account, a key and a bill. Excluded by the brief. |

### Chosen pipeline

1. **Source data:** Geofabrik extracts of Indonesia (ODbL). The Java extract is 898,255,683 bytes ([REPO: local watch-map research, 2026-10-18]; all of Indonesia 1,739,165,010 bytes). Bali is not inside the Java extract; it sits in Geofabrik's Nusa Tenggara extract [INFERENCE, to confirm in the build script's download step].
2. **Build:** Planetiler (Apache-2.0) with its bundled OpenMapTiles profile, `--bounds` per region, zoom 0-14 (MapLibre overzooms to 17), layers the style does not draw excluded. Output MBTiles, converted to PMTiles with the `pmtiles` CLI. Needs Java 21+. Script: `scripts/maps/build-region.sh` (runs under `lowprio`, scratch under `/run/media/dzul/ioswork/`).
3. **Host:** our own R2 bucket (public, custom domain), `maps/index.json` (regions, bbox, bytes, version, attribution) + `maps/<region>-<version>.pmtiles`. R2 serves byte ranges, which is also what streaming needs. Script: `scripts/maps/publish-region.sh` (dry run by default; `--remote` and the lead's OK needed).
4. **Client:** Settings > Bersepeda > Peta offline lists the regions, with size, "Unduh", progress, "Hapus", storage left. Download with `expo-file-system` (resumable, Wi-Fi advised, checks free space first); after the download the PMTiles header (magic bytes `PMTiles`, spec version 3) and the byte size are checked against the index. The file lives in the app's document directory (`maps/`), not the cache, so the OS does not evict it.
5. **Draw:** `BikeMap` builds a MapLibre style object from `maplibreStyle()` with the source URL replaced by the local file (or the https PMTiles URL for streaming); the map remounts when the source changes (a known MapLibre RN behaviour: source URL changes are not re-applied in place; Critterpass hit the same and fixed it with a `key` [DOC: github.com/critterpass decision note]). A doubled scheme (`pmtiles://file://file:///...`) fails with a misleading "path not found", so the path helper strips one.
6. **Labels:** none in Phase 1 (the existing style has no glyphs, and text needs glyph PBFs hosted next to the tiles). Street names are **Later**: a glyph set is a few MB on the same bucket.

### Licences

- **OpenStreetMap data: ODbL 1.0.** A tile image on screen is a Produced Work (attribution suffices). A **PMTiles file we host for download is a Derived Database**: it must be offered under ODbL, with the notice "Contains information from OpenStreetMap, ODbL" and the licence link, and the share-alike obligation applies to the file (our own app code is not affected). `maps/index.json` carries the licence URL and the app shows it on the download screen and as the map attribution.
- **OpenMapTiles schema / tiles: CC-BY 4.0** attribution "(c) OpenMapTiles Data from OpenStreetMap" (the string the app already shows for OpenFreeMap).
- **Planetiler:** Apache-2.0, a build tool, no obligation on the output beyond the schema's attribution.
- **Geofabrik:** extracts are free; they ask for reasonable use. We download each extract once per build.
- Not legal advice. The attribution text is shown inside the map and on the region screen.

### Region UX and sizes (measured)

Regions are Indonesian provinces or island groups, so one file is something a rider can fetch on mobile data. Built on 2026-10-18 with Planetiler 0.10.2 (Temurin JDK 21, `--threads=3`, `-Xmx4g`, under `lowprio`) from Geofabrik extracts, zoom 0-14, layers landcover, landuse, park, water, waterway, aeroway, building, transportation, boundary (poi, housenumber, place labels, mountain peaks and name layers dropped: the style draws none of them). All pass `pmtiles verify` and decode with `src/features/map/decodeTile`.

| Region | Bytes | Size | Planetiler wall time | Peak RSS | sha256 (first 12) |
| --- | --- | --- | --- | --- | --- |
| `bali` | 25,485,846 | 24.3 MiB | 8 m 23 s (4 m 34 s of it the one-time 1.3 GB download of ocean polygons and Natural Earth) | 2.8 GB | d0a60d181d08 |
| `jawa-barat` (Jawa Barat + Banten + Jakarta) | 183,491,356 | 175 MiB | 13 m 50 s | 3.6 GB | 3291df8e285a |
| `jawa-tengah` (Jawa Tengah + DIY) | 160,051,624 | 153 MiB | 10 m 33 s | 3.6 GB | dce289ef73d2 |
| `jawa-timur` | 129,769,675 | 124 MiB | 8 m 44 s | 3.1 GB | fa357611cd4d |

All four together: 498.8 MB on the bucket. A calibration build of DIY alone (not published, it overlaps Jawa Tengah) was 33.8 MB at 10.8 KB per km2 of land, 2.5 times denser than Bali (4.4 KB/km2); the three Java regions came out at 3.9 to 4.4 KB/km2, so dense urban cores run well above the rural rate. z14 is 67 to 73 % of every file: a **z13 build** would be about 70 % smaller (Bali 6.8 MB, Jawa Barat about 50 MB) and lose detail past z13; decision (lead, 2026-10-18): **ship z14**, offer z13 later as a "Hemat ruang" option if storage complaints come.

### Hosting (live)

Bucket `joyofit-maps` on Cloudflare account b7e6f845 (the JoyoFit account: `joyofit-api`, `joyofit-imports`, zone `joyorogo.com`), public through the custom domain **https://maps.fit.joyorogo.com** (not r2.dev, which Cloudflare limits to development). Objects: `<region>-20261018.pmtiles` (cache-control `public, max-age=31536000, immutable`) and `index.json` (`max-age=300`, regions with bbox, bytes, version, sha256, url, attribution, licence). Verified from the public URL: `GET index.json` 200, a `Range: bytes=0-126` request answers 206 with `Content-Range: bytes 0-126/25485846` and the `PMTiles` magic, and the full download of `bali` has the sha256 the index lists. The owner approved hosting on the paid Workers plan (2026-10-18). `cf-cache-status` reads DYNAMIC (R2 custom domains are not edge-cached unless a Cache Rule says so): harmless for correctness, since egress is free; a Cache Rule on `maps.fit.joyorogo.com` would take load off R2 and is an owner-side dashboard step.

The same bucket holds the offline watch maps of the offline-map lab under `watch/` (`watch/catalog.json`, `watch/<id>.bin`; `tools/offline-maps/publish.sh`, served by the Worker at `/v1/maps`, docs/offline-maps.md "Lab"). Keep the two prefixes apart.

Scripts (`scripts/maps/`): `regions.json` (catalog proposals and Geofabrik sources), `build-region.sh <id>` (JDK, Planetiler jar and `pmtiles` CLI cached under `/run/media/dzul/ioswork/tools`, scratch under `maps-work`, output `maps-out`), `publish-region.sh [--yes] <id>` (dry run by default; `wrangler r2 object put --remote`, index last; needs `CLOUDFLARE_ACCOUNT_ID=b7e6f845...` because wrangler is logged into three accounts). `wrangler r2 object put` caps at 300 MiB; all regions are under it. A single all-Java file (about 430 MB) would need a multipart S3 client and is not in the catalog.

### Cost

R2 (verified 2026-10-18 on developers.cloudflare.com/r2/pricing): storage $0.015 per GB-month, 10 GB-month free, **egress free**, a whole-file download is one Class B operation ($0.36 per million, 10 million free). The four regions are 0.5 GB: inside the free tier, **$0 a month**; a download costs no bandwidth. The only recurring cost is the owner's time to rebuild a region when OSM data should be refreshed (9 to 14 minutes of Planetiler per Java region on this machine).

## 4. Navigation

Reuses the route library: `listRoutes` / `loadRoute` (stored `RoutePoint[]`, at most 5000 points), GPX/TCX import, the route editor. Pure engine: `navigation/`.

| Piece | How | Status |
| --- | --- | --- |
| Pick a route before the ride | Record picker (Ride, mode on): "Rute" row opens the route library; the chosen route id is kept in the recorder session | Phase 1 |
| Progress along the route | Project each fix onto the polyline with a forward-biased window (never jumps back past the last matched segment unless the rider is clearly elsewhere), distance done / to finish, ETA from the moving average | Phase 1 |
| Off-course | Perpendicular distance to the route over 50 m (setting 30-200 m) for 10 s, hysteresis to clear at 0.6 x the threshold, alert once per excursion, cleared on return | Phase 1 |
| Turn cues | Generated from the geometry: bearing change over a 30 m look-around, merged into cues, classified (slight / left / right / sharp / U-turn), roundabouts not detected; minimum spacing; the same `Cue[]` structure can later take GPX `<rtept>` names or TCX CoursePoints | Phase 1 (geometry); named GPX/TCX cues Later |
| Distance to turn / next cue | field + a banner at 300, 100, 30 m | Phase 1 |
| Climb profile ahead | `detectClimbs`-style ClimbPro rules over the route's altitude (`cycling/climbs.ts` rules: 500 m, 3 %, score 1,500); upcoming climb: distance to start, length, average grade, ascent left, profile strip | Phase 1 (needs altitude in the route; a route without altitude shows no climbs and says so) |
| Reroute | needs an engine; online (the OSM routing client of the route editor) is possible, offline is not cheap (Valhalla / GraphHopper tiles are another data pipeline) | Later |
| Search, POI, address | needs a geocoder and POI data; Nominatim exists in the editor (online) | Later |

## 5. Data screens

A ride page is a grid of 1, 2, 4, 6 or 8 fields, or one of the special pages (map, climb, laps). Pages are swiped; the layout is edited in Settings > Bersepeda > Halaman data (and from a long press on the ride screen when stopped), stored as JSON under `joyofit.bike.layout` in the key-value store; invalid or unknown fields are dropped on read and the default layout is the fallback. A field whose source is missing shows `--`, never a made-up number.

Fields (id: meaning): speed, avgSpeed, maxSpeed, lapSpeed; cadence, avgCadence; hr, avgHr, hrZone (number + colour); power, power3s, power10s, avgPower, normPower, powerZone, estPower; distance, lapDistance, distanceToFinish, distanceToTurn; movingTime, elapsedTime, lapTime, timeOfDay, eta; altitude, ascent, descent, grade, climbRemaining; calories; battery (phone). Not offered: temperature (no sensor), gear (Later).

Default layout: page 1 six fields (time, speed, distance, heart rate, cadence, power), page 2 four (avg speed, max speed, ascent, grade), page 3 map, page 4 climb, page 5 laps. The climb page is left out of the default when no route is set (the map page stays: it shows the position and the track).

## 6. Ride features

| Feature | Design | Status |
| --- | --- | --- |
| Auto-pause | Stopped when the instantaneous speed (wheel sensor, else GPS) stays under 1.0 m/s (the same constant as the ride analysis, `STOP_SPEED_MS`) for 3 s; resumes when it is over 1.5 m/s for 1 s. Uses the recorder's own `pause` / `resume`, so the clock, GPS anchor and wheel baseline behave exactly as for a manual pause. Switch in settings; default on for rides in bike mode. | Phase 1 |
| Auto-lap | Off, by distance (1-100 km, default 5), or at the start position (lap when back within 30 m of where the ride started after at least 200 m away). A lap is `recorder.lap`, so FIT export and the detail view already show it. Manual lap button stays. | Phase 1 |
| Alerts | Zone alerts (HR zone limits from the profile's max HR; power from FTP zones; cadence low/high), each with a 10 s dwell before firing and a 30 s repeat; eat / drink reminders by time (every N min) or distance (every N km); off-course; low phone battery; lost sensor; GPS lost. Each alert: banner on the ride screen + vibration pattern + optional sound; only the banner is shown with the screen off in the pocket (vibration still fires). | Phase 1 |
| Sound | RN `Vibration` (core, no module) for the pattern. Sound: Phase 1 posts a high-importance local notification (`expo-notifications`, already in the app) on its own channel when the alert should be heard; **`expo-audio` for in-app beeps and speech is Later** and a native dependency. | Phase 1 (vibration + notification sound); in-app beeps Later |
| Lock-screen controls | Android: `RecordingService` notification gets Pause / Lap actions (native Kotlin, `ble-sensors`); iOS has no equivalent without a Live Activity (native + widget extension). | Pause / Resume / Lap buttons on the Android notification: done (`docs/sensors.md`, lock screen section); a Live Activity on iOS stays Later |
| Live tracking | See below. | Phase 1 (code, not deployed) |
| Incident detection | See 7. | Later |

### Live tracking link: cheap on what exists

Infra today [REPO]: `joyofit-api` is a Cloudflare Worker with D1 (`joyofit`), R2 (`joyofit-imports`), cron, an `EMAIL` send binding, JoyoRogo session auth, and Family push through the Expo push service. No Durable Object, no KV.

Built and **deployed 2026-10-18** (migration `server/migrations/0007_live_tracking.sql` applied to the remote D1; `joyofit-api` version 301731f8-bc98-4c64-84c7-cc78f1808b03): `POST /v1/live` (session user; one active session per user, starting another ends the previous; at most 10 starts an hour) returns `{id, viewUrl, token, writeKey}` once; `POST /v1/live/:id/points` takes 1 to 30 points with the write key as Bearer (so a backgrounded phone with an expired cookie still posts), rate limited to 12 requests a minute per session; `POST /v1/live/:id/end`; `GET /v1/live/:token` is public and read-only (the unguessable 128-bit token is the capability, only SHA-256 hashes are stored) and answers `live`, `ended`, `expired` or 404; `GET /live/:token` is a small HTML page (inline CSS and JS, nonce CSP, `noindex`, no map tiles on purpose: an SVG track, speed, "diperbarui X menit lalu", and a link to OpenStreetMap) that polls every 15 s. The link stops answering 12 h after the last point or when the rider ends the ride (only the `live` state returns a position; an ended link returns only times); the existing nightly purge deletes sessions and points 24 h after, and account deletion removes them. The phone side is `live/tracker.ts` (one point per 5 s, batches every 20 s, backoff 5, 15, 45 s capped at 60 s, a 600-point buffer, resume after an app restart within 12 h).

Cost, from Cloudflare's current D1 and Workers pricing pages (single-ride estimates from the local D1 meta, not a production measurement): a 3 h ride is about 2,160 points, about 543 Worker requests, about 3,250 rows written during the ride and 2,160 more when the purge deletes the points (about 5.4k per ride, about $0.005 on the paid plan at $1.00 per million rows written); the free plan's 100,000 rows written a day would hold about 18 rides a day. Each open viewer page adds about 720 requests and 40k rows read per 3 h. Sampling every 10 s instead of 5 s cuts the writes to about 3.2k per ride. Deploy was: apply `0007_live_tracking.sql` to the remote D1, then `wrangler deploy` in `server/` from a clean worktree of master with `CLOUDFLARE_ACCOUNT_ID=b7e6f845...`; no new secrets, no `wrangler.jsonc` change. Smoke test on production: `/v1/me` and `/v1/sync` still answer 401 without a session, `POST /v1/live` 401 without a session, an unknown link 404; with a test session row inserted straight into D1 (removed afterwards): points 200 `{stored: 2}`, wrong key 401, public view `live` with the track, end 200, view `ended` without a position, points after the end 409, a session whose last point is 13 h old answers `expired` and refuses points (409).

Privacy: opt-in per ride with a one-line explanation and "Lanjut" before the first start, the link is only created when the rider turns "Bagikan lokasi" on, ending the ride or turning it off revokes it, and nothing is shared with the mode off. The Worker never logs coordinates beyond the D1 rows.

## 7. Incident (crash) detection: marked carefully

What the competitors do [DOC: Garmin manual + press release]: detect an incident in outdoor cycling and send an automated message, the LiveTrack link and GPS position to emergency contacts.

Phone-only version, **not built in Phase 1**:

- **Signal:** accelerometer magnitude peak (a crash is a short spike well above riding vibration, then the phone stops moving) + the GPS speed before the spike > 10 km/h + stillness after (both accelerometer variance and GPS speed under 1 m/s for 10 s). GPS speed drop alone is not usable: hard braking is routinely 3-4 m/s^2 and would fire at every red light.
- **False alarms:** countdown of 30 s with full-screen alert, strong vibration and sound, one big "Aku baik-baik saja" button (glove-size); no send until the countdown ends; a phone dropped while stopped (speed before < 10 km/h) never triggers; a sensitivity setting; a test button; a log of triggers to tune thresholds with real rides. No threshold is shipped before it has been measured on real rides, which cannot be done on this machine.
- **Delivery:** SMS cannot be sent silently on iOS and Android's `SEND_SMS` is a restricted Play permission, and an opened composer needs a tap from someone who may be injured, so SMS and WhatsApp share are not the automatic path. The workable path is the live-tracking session: the server emails (the `EMAIL` binding) and pushes the emergency contact the track link and last position. That needs live tracking deployed, contacts stored server-side with their consent (like Family), and email copy reviewed.
- **Native:** `expo-sensors` (Accelerometer) is a native module not in the app; Android also needs the foreground service to keep sampling with the screen off, which `RecordingService` already is.
- **Owner decisions:** whether to ship it at all (liability and Play / App Store health-safety review: the Family docs already treat SpO2 claims carefully), the countdown length, who the contacts are, and email versus push for them.

## 8. Robustness

| Requirement | Design | Status |
| --- | --- | --- |
| Screen on, with dimming | The recording screen already holds the screen on (`holdScreenOn('recording')`). Bike mode adds dimming after N seconds without a touch (default 20 s, to ~10 % brightness), wake on touch or on an alert, restored on leave. Uses `expo-brightness` (standard Expo module, native; absent in older binaries: lazy require with a no-op fallback, the same pattern as `keepAwake.ts`). | Phase 1 (module flagged) |
| Lock-screen controls | see 6 | Later (native) |
| App kill and restore | Already built (`journal.ts`, `controller.restore`). Bike mode persists its own small state (route id, laps counters, auto-lap origin) in the same journal meta so a restored ride keeps following the route; the paused-after-restore behaviour is unchanged. | Phase 1 |
| Low battery | Battery saver profile: map page off, dimmer screen, fewer alert sounds; automatic proposal at 20 %, forced at 10 % unless dismissed. **GPS interval** needs a native option (`gpsIntervalMs` on `WorkoutSessionOptions`: Android `LocationRequest` interval, iOS `distanceFilter`); until then GPS stays at 1 s and the saving comes from the screen and map. | Phase 1 (screen, map, alerts); GPS interval Later (native) |
| Battery estimate per hour, shown before the ride | A model (`batteryEstimate.ts`): hours left = (battery % - reserve) / (drain % per hour). Drain = base + GPS + screen (brightness and dim) + map + sensors + live tracking, each coefficient an [INFERENCE] until measured; the model **calibrates itself** from the person's rides (percent lost per hour with the same profile, stored per ride and blended in), so the first rides are estimates, the later ones are measured. Shown on the Ready screen with a warning when the route needs more time than the battery allows. | Phase 1 |
| Sensor reconnect | The sensors module already reconnects with backoff (`docs/sensors.md`). Bike mode shows a lost-sensor banner and fires the alert; no new native code. | Phase 1 (UI) / Now (reconnect) |
| GPS loss | The recorder already ignores fixes over 35 m and the snapshot reports fix age. Bike mode shows "GPS hilang" over the map after 10 s without a fix, keeps the last known position greyed, and navigation freezes (off-course is suppressed while the fix is stale). | Phase 1 |
| Sunlight theme | White background, black text, saturated data colours, the heaviest weight of the app font, no thin strokes, no translucency; night theme: black, white text. Chosen by setting (auto follows the app's scheme). Contrast of every pair tested (>= 7:1 for the numerals, >= 4.5:1 for labels, data colours >= 3:1 on the background). | Phase 1 |
| Gloves | Controls >= 64 dp, no interactive control inside a field cell (the cell is the swipe surface), lap / pause / finish only in the bottom bar, finishing needs the confirm dialog that exists. | Phase 1 |
| Landscape and portrait | Layouts adapt to `useWindowDimensions` (the grid picks columns by aspect; the control bar moves to the side in landscape). `app.json` now says `orientation: default` (so the iOS plist and the Android manifest allow rotation) plus the `expo-screen-orientation` plugin with initial orientation PORTRAIT; the root layout calls `lockPortrait()` at start so every other screen stays portrait, and the ride screen unlocks while it is open and locks again when it closes. **This needs the store build** (config + native module); in a binary without the module the calls do nothing and the app keeps its old portrait manifest. Not verified on a device. | Phase 1 (layout), unlock needs the native build |

## 9. Honest limits

- A phone is not a Garmin: it will not run 20 hours. A typical modern phone with GPS and a dimmed screen is of the order of 8-12 % an hour and with the map at full brightness 15-25 % [INFERENCE, to be replaced by the model's own measurements]; the Ready screen says how long the battery will last for the chosen profile.
- Grade and ascent come from GPS altitude, which is noisier than a barometer. Fields smooth it (150 m window) and show `--` under 5 km/h; the ride detail already corrects for it afterwards.
- The map is OpenStreetMap: cycling paths in Indonesia are inconsistently tagged, and no street names in Phase 1.
- Turn cues from geometry are not Garmin's: roundabouts and complex junctions are announced as turns.
- None of the native paths ran on a device (see docs/sensors.md section 7 for the status of the recorder itself).

## 10. What needs native, and CI

| Item | Native? | Where | Needed for |
| --- | --- | --- | --- |
| MapLibre PMTiles map | **no** (library already installed and in `app.json` plugins) | n/a | map page, offline regions |
| `expo-brightness` | yes, one standard Expo module | `package.json`, plugin none | screen dimming |
| `expo-screen-orientation` | yes, one standard Expo module + `app.json` (`orientation: default`, plugin `initialOrientation: PORTRAIT`) | `package.json`, `app.json`, `_layout.tsx` | landscape rotation on the ride screen |
| Lock-screen Pause / Lap | yes, Kotlin in `modules/ble-sensors` (`RecordingService` actions + an event) | CI Android build + `testDebugUnitTest` | robustness; Later |
| `gpsIntervalMs` | yes, Kotlin + Swift in `modules/ble-sensors` | CI | battery saver; Later |
| `expo-sensors` | yes | CI | crash detection; Later |
| Worker endpoints + migration | no | `server/`, deployed by the lead | live tracking |

All of it changes the OTA fingerprint, which the `sensors` branch already does, so it ships with the same store build as `multi-watch` and `sensors` and never over the air (docs/ota.md). The JS in `features/bikecomputer` degrades when a module is missing (lazy require + no-op), so a binary built before the modules still opens the app.

## 11. Build status, tests, decisions for the owner

### What is built (branch `bikecomp`)

| Phase 1 item | Where | State |
| --- | --- | --- |
| 1. Ride screen, swipeable pages, field customisation, persisted | `ui/BikeRideView`, `RideFrame`, `FieldGrid`, `LayoutEditor`, `FieldPicker`; `fields/values.ts` (32 fields), `fields/layout.ts`, `settings.ts` | built; mounted in `RecordScreen` instead of `LiveView` when the mode is on and the sport is Ride |
| 2. Sunlight theme, screen on with dimming, glove controls, landscape | `ui/ridePalette.ts` (day / night, contrast tested), `ui/useDim.ts` + `dimMachine.ts` + `brightness.ts`, `ControlBar` (>= 64 dp), `gridShape.ts`, `RideFrame` landscape column | built; dimming and rotation need the store build |
| 3. Auto-lap, alerts with sound / vibration, auto-pause | `ride/autoLap.ts`, `ride/alerts.ts`, `ride/autoPause.ts`, `alertPresenter.ts`, `session.ts` | built |
| 4. Map page, route following, off-course, offline regions | `map/` (BikeMap on MapLibre, `resolveMapStyle`, regions index, resumable download, storage, `OfflineMapsSection`, `pmtilesReader`), `nav/follower.ts`; 4 regions built and hosted | built; not run on a device |
| 5. Turn cues and distance to turn | `nav/cues.ts`, fields `distanceToTurn` and the map page strip, `turn` alerts at 300, 100 and 30 m | built |
| 6. Live tracking link | `server/src/live.ts` + `livePage.ts` + migration `0007`, `live/` client, `ShareSection` | built and deployed |
| 7. Battery estimate before the ride | `ride/batteryEstimate.ts`, `batteryHistory.ts`, `record/BikeReadyPanel.tsx`; saver `ride/saver.ts` | built |

Also: climb page with the route's ClimbPro-style climbs (`nav/climbsAhead.ts`), laps page, route picker on the record picker (`record/BikeSetupPanel.tsx`, `RoutePickerSheet`), the settings screen (`src/app/settings/bikecomputer.tsx`, linked from Settings > Bersepeda), `BikeRideProvider` (builds the session per ride, feeds it from `RecordingController.observe`, presents alerts, records the ride's battery drain for the next estimate).

Recorder changes (additive): `Recorder.samplesSince`, `instantSpeedMps`, `latestPosition`; `RecordingController.observe`; `RecorderProvider` exposes `observe`.

### Multi-device sync

Four preferences follow the account through `registerSyncedPref` in `src/cloud/syncInventory.ts` (docs/multi-device.md): `ftp`, `wheel`, `bike.settings` (mode, theme, dimming, auto-pause, auto-lap, alerts, off-course distance, live share switch) and `bike.layout` (the pages). Never synced: the live tracking consent, downloaded regions, the battery history, the chosen route and the per-ride e-bike mark. The setters call `notePrefChanged`; a pulled value goes through `replace` and is repaired by `sanitizeSettings` / `normalizeLayout`.

### Tests

`bun test ./src/` passes (2314 pass, 13 skip, 0 fail at the last full run; the bike computer folders alone hold about 600 tests). By area: field formatting `fields/values.test.ts`, page layout and persistence model `fields/layout.test.ts` (11) and `settingsModel.test.ts`, auto-pause (25), auto-lap (17), alerts (64), metrics (37), battery estimate (29) + history (5) + saver (5), off-course and route following `nav/follower.test.ts`, turn cues `nav/cues.test.ts`, climbs `nav/climbsAhead.test.ts`, route projection `nav/routeIndex.test.ts`, session wiring with a real `Recorder` `session.test.ts` (10: metrics, auto-pause, manual pause kept, auto-lap, route following, off-course once, low battery, restore), ride palette contrast and dimming `ui/*.test.ts` (81), map regions index, PMTiles reader, download state machine, storage, style resolution `map/*.test.ts` (113), live client and tracker (39), server `server/test/live.test.ts` (44; the whole server suite passes, 195 tests). `bunx tsc --noEmit`, `bun scripts/i18n-check.ts` (0 missing, 0 orphan, 0 literals) and `eslint src/features/bikecomputer` are clean.

### Screenshots

`docs/screenshots/bike-ride-day-portrait.png`, `bike-ride-night-landscape.png`, `bike-ride-alert-night.png`, `bike-ride-day-fours.png`, `bike-climb-day.png`, `bike-laps-night.png`, `bike-editor.png`, `bike-picker.png`, `bike-settings.png`: a web render of the real `RideFrame` / `FieldGrid` / editor components with sample data, not a phone. The map page is not in them (MapLibre is native).

### What needs native, and CI

See section 10: no native work for the map. New native dependencies: `expo-brightness`, `expo-screen-orientation` (and the `app.json` orientation change); both are lazy-required. CI should build the Android APK once with them. Later items (lock-screen actions, `gpsIntervalMs`, crash detection) are specified, not built.

### Decisions and costs for the owner

| Topic | State |
| --- | --- |
| Tile hosting | Done and approved: bucket `joyofit-maps` on the JoyoFit Cloudflare account, https://maps.fit.joyorogo.com, 4 regions, 0.5 GB, **$0 a month** (inside R2's free tier; egress free). The Cache Rule on the hostname is a dashboard step (the CLI's OAuth token has no ruleset permission): Caching > Cache Rules > Create rule, name `maps`, expression `(http.host eq "maps.fit.joyorogo.com" and http.request.uri.path ne "/index.json")`, eligible for cache, Edge TTL ignore origin and use 1 year, browser TTL respect origin; a second rule or the default for `/index.json` (origin `max-age=300`). A refresh of OSM data is a rebuild with `scripts/maps/build-region.sh` (9 to 14 min per Java region) plus a new dated file and index. Licence: the files are an ODbL derived database; the index carries the attribution and licence URL and the app shows them. Decision for later: z13 "Hemat ruang" builds (-70 %). |
| Live tracking | Deployed (see section 6). Cost about $0.005 a ride on the paid plan; free plan about 18 rides a day. Privacy: opt-in per ride, link revoked when the ride ends or after 12 h, data deleted after 24 h. |
| Crash detection | **Not built.** Needs `expo-sensors` (native), threshold tuning on real rides, server-side emergency contacts with consent, and a decision on liability and store health-safety review (section 7). The automatic delivery is the live session's email or push, not SMS. |
| Battery numbers | The model's constants are unmeasured defaults; each ride adds a measurement. A device run should compare the estimate with `dumpsys batterystats` over a real ride. |

### Not verified (needs a device)

Nothing here ran on hardware: MapLibre drawing a `pmtiles://file://` source, the download of a 124 to 175 MiB file over a mobile network, the foreground service with the bike screen, dimming through `expo-brightness`, rotation, vibration and the notification sound on a Xiaomi / Samsung, the live link from a phone to the deployed Worker. The PMTiles files were checked with `pmtiles verify`, decoded through the repo's MVT decoder and fetched back from the public URL (206 and sha256), not rendered by MapLibre.

### Device test script (owner)

1. Settings > Bersepeda > Komputer sepeda: switch the mode on. Settings > Peta offline: download Bali on Wi-Fi, then turn flight mode on.
2. Workouts > Rekam latihan > Sepeda luar ruangan: the mode switch and route row show; pick an imported GPX route. Ready screen: battery estimate and route; Mulai.
3. Ride 15 minutes: swipe the pages, open the map (offline in flight mode), leave the route by 100 m (off-course banner and vibration), stop at a light (auto-pause, resume), turn the phone sideways (needs the store build), wait 20 s (dim, touch wakes).
4. Set an HR or cadence alert in Settings; confirm the vibration; set a drink reminder at 2 minutes.
5. Lock the screen for 5 minutes (the notification keeps counting), kill the app, reopen: the ride comes back paused and still follows the route.
6. With live tracking deployed: turn on Bagikan lokasi ("Lanjut"), open the link in a browser on another phone, confirm the dot moves; end the ride and confirm the link stops.

## 12. Sources

- Garmin, "Edge 540 and Edge 840 Series" press release, 2023-04-11 (garmin.com/en-US/newsroom/...): 2.6 in display, buttons / touch, ClimbPro ascent planner, Power Guide, LiveTrack, group messaging, incident detection for all cycling activities, refuel / rehydrate notifications, off-course notifications that can be paused, battery 26 h / 42 h non-solar.
- Garmin Edge 840 owner's manual, incident detection and ClimbPro chapters (search result excerpt, 2026-10-18).
- Wahoo, "Live Track for ELEMNT ACE, ROAM 3 and BOLT 3" (support.wahoofitness.com): phone relays location, private session, link expires after 12 h of inactivity.
- iGPSPORT BSC300T product page: 2.4 in colour touch, offline navigation, 20 h, 130+ metrics, Bluetooth and ANT+, Di2, radar, lights, e-bike, 8 / 32 GB.
- Bryton 2021 spec comparison chart (row names: built-in map, OpenStreetMap, offline navigation, ...).
- MapLibre Native PMTiles docs (Android example, iOS article): `pmtiles://https://` and `pmtiles://file://`, no offline pack support for PMTiles sources.
- Critterpass decision note "MapLibre RN + PMTiles on R2" (github.com/critterpass): Planetiler OpenMapTiles extract, local-file source, doubled-scheme and remount findings.
- Cloudflare R2 pricing, updated 2026-10-01.
- Local research: `watch-map-research.md` (Geofabrik sizes, OpenFreeMap sample).
