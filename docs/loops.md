# Loop baru dari rumah (Routes, `/routes/loop`)

A new round trip of a chosen size from the phone's position or a saved Home point, drawn dotted over the streets the person has
already walked, with the share of it that is on streets they have not. Walking and running, Indonesian and English, JS only
(no native change, no new dependency: OTA-able to any binary that already has the MapLibre map).

Code: `src/features/loops/`. Screen: `ui/LoopScreen.tsx`, route file `src/app/routes/loop.tsx`, entry button "Loop baru dari rumah"
in the route library.

## What the person sees

- Tabs **Langkah / Jarak / Waktu / Kalori**, a big number (`10.000 langkah`), the same loop in the other three units
  (`≈ 7,2 km · 1 j 34 mnt · 415 kcal`) and a ruler (`TargetRuler`): ticks scroll under a fixed marker, the value snaps to each tick,
  Android gives a short vibration per tick (iOS has no short tick in React Native's `Vibration`, so none; `expo-haptics` would be a
  native change). A screen reader gets an adjustable slider.
- Walk or run, start from **Lokasiku** or **Rumah**. Home is set from the current location, by tapping the map or after a place
  search, and stored on the phone only.
- **Cari rute** builds a batch, then **Ganti rute** shows the next loop of the batch (a new batch only when all were shown).
  The chip on the map says `91% jalan baru`; the sheet says `Loop 7,0 km, 91% lewat jalan yang belum kamu lalui`.
- **Simpan** (route library, source "Gambar"), **Kirim ke jam** (saves first when needed, then the existing `useRoutePush` and its
  outcomes from `pushOutcome.ts`; "already on the watch" and "name too long" send the person to the route page to rename), **Mulai**
  (opens the phone recorder on a walk or a run, `/workouts/record?sport=`; to follow the line on the watch the route is sent first).
- The map shows the person's past walks and runs as thin lines, the loop as dots, the start as a dot labelled `Start · Rumah`.

## Where the loop comes from (routing source)

Researched 2026-10-19:

| Option | Round trip | Key | Verdict |
|---|---|---|---|
| OpenRouteService `directions/foot-walking` with `options.round_trip` | yes (`length`, `points`, `seed`; round trip up to 100 km) | free key, per-key daily/minute quotas ([restrictions](https://openrouteservice.org/restrictions/)) | needs an owner key and a proxy |
| GraphHopper `algorithm=round_trip` (`round_trip.distance`, `round_trip.seed`) | yes ([docs](https://docs.graphhopper.com/openapi/routing/getroute)) | key, free plan 500 credits a day | needs an owner key and a proxy |
| BRouter, public server `brouter.de` (`lonlats=lon,lat,r&roundTripDistance=&roundTripStartDirection=&roundTripPoints=`) | yes, works worldwide (checked live for Jakarta, Yogyakarta, Stockholm) | none | no published terms for the hobby server; the loop length is the radius of a ring, not a length: 1 km radius gave 5.8 to 10 km loops and 1.5 km sometimes a shorter loop than 1 km; a series of back-to-back requests (about one a second) started answering `403` |
| FOSSGIS OSRM `routed-foot` (what **Gambar di peta** already uses) | no round-trip call, but one request takes any number of waypoints | none | published policy ([about](https://routing.openstreetmap.de/about.html)): one request per second, a valid User-Agent and Referer, attribution, no heavy use |

**Chosen: FOSSGIS OSRM `routed-foot`, with the loop built in the app.** No key, no owner action, no proxy, and the same client, queue
(1.1 s between requests), identity and credit line as the drawing screen (`routes/map/routingClient.ts`, new `routeVia`: one request
through any number of waypoints, snap distance per waypoint). Variety comes from a seed that we control, and so does the length.

### How a loop is built (`generate.ts`)

1. A ring through the start: centre at a seeded compass bearing from the start, circumference `target / ratio`.
2. 3 or 4 waypoints on the ring, jittered in radius (±15%) and angle (±10°), clockwise or not, from the candidate's seed.
3. One request `start, w1 .. wn, start`. The routed length is measured on the returned line.
4. If it is not within 5% of the target, the ring is rescaled by `target / length` and routed again (at most 3 requests per loop).
   The measured `length / circumference` ratio (about 1.25 in cities) is kept and starts the next loops and the next batch, so most
   loops need one request.
5. A batch is 4 loops with ring centres 90° apart (2 more tries when fewer than 2 came out). About 6 to 10 requests, 6 to 10 s.
   A loop is dropped when a waypoint had to move more than 150 m to reach a road, or its length stays more than 10% off.
6. Ranking: loops within 5% first, then by `score = new share − 2 × repeat share − 0.5 × |length error|`. Without history the
   new share is unknown (`null`), the chip is hidden and the sheet says so; no number is made up.

Live check of the generator against the real service (Jakarta 7 km: 4 loops, 10 requests, 10 s, lengths +0.4% to +8.9%; Stockholm
10 km: 6 requests; Yogyakarta 4 km: 9 requests) is how `INITIAL_RATIO` was set. The loops are real street loops with small spurs
where a waypoint snapped to a dead end.

If FOSSGIS ever becomes unreliable or asks us to stop: swap `routing.routeVia` in `useLoopPlanner.ts`. A keyed provider
(ORS or GraphHopper round trip) needs a session-gated, rate-limited, cached endpoint in `server/` with the key as a Worker
secret, so the key never ships in the app; that is not built because nothing needs a key today.

## Targets and body (`targets.ts`, `body.ts`, `bodyStore.ts`)

```
distance = steps × stride          distance = minutes × 60 / pace × 1000          kcal = MET × kg × hours
```

- **Stride**: median `distance / steps` of the 15 newest walking (walk, hike) or running (run, trail run) workouts that have steps,
  at least 3 of them; else height × 0.415 (walk) or × 0.6 (run). Height comes from Settings, Profile (175 cm when empty).
- **Pace**: median of the same workouts (at least 3, at least 1 km and 10 min, plausible range per activity); else 12:00/km walking,
  6:00/km running.
- **kcal**: the MET of the manual workout of that sport (walk 3.8, run 9.8) × weight (Profile, 70 kg when empty) × hours.
- The sheet says which figures are measured and which are estimates. The ruler of each unit is cut to loops of 1 to 25 km.

## Painted streets and new streets (`painted.ts`, `paintedStore.ts`)

The history is the GPS rows of the person's own walking, hiking and running workouts (`workout_points` joined to `workouts` by
sport type) within 8 km of the start, read from the local database on the phone. Saved route files are not history (a planned or
imported route has not been walked). Cycling is not counted: a street ridden is not a street walked.

- Each track is joined into a line (fixes more than 200 m apart are a signal gap, not a straight line) and written into a set of
  15 m cells. A point is painted when its cell or one of the 8 next to it holds a track: about 15 to 30 m.
- A loop is sampled every 10 m. **New share** = samples not painted / samples. **Repeat share** = samples that retrace an earlier part
  of the same loop at least 100 m back along it, outside 100 m of the start (an out-and-back scores badly, a block loop does not).
- The map draws the tracks thinned to one point per 12 m, at most 12 000 points, newest first.

**Not built: "21% painted" for the neighbourhood.** An honest figure needs the length of every street of the administrative area
(Overpass) and a way to say how much of each street was walked (map matching of the tracks onto OSM ways). Cell counts against
Overpass road length would be a number that looks precise and is not. It is left out rather than guessed.

## Privacy

- Pressing **Cari rute** sends the start point and the ring waypoints (full-precision coordinates, up to a few km from the start)
  to `routing.openstreetmap.de` (FOSSGIS e.V.) in the URL, with `User-Agent: JoyoFit/<version> (https://joyofit.app)` and the IP
  address. No account, no ID, no key; not through our servers. One line in the sheet says so (`loops:privacy`).
- Place search for Home sends the typed text to Nominatim (the same search sheet as the drawing screen, with its own note).
- The workout history never leaves the phone for this feature. The Home point and the last choices live in the key-value store
  (`joyofit.loops.home`, `joyofit.loops.prefs`), are not part of the account sync and are cleared by "delete all local data"
  (`DATA_KEYS` in `db/localData.ts`).
- Location: `ensureLocation` (precise, asked only after an explanation card, only when the person picks Lokasiku) and
  `currentPosition` read when the screen opens or on retry. Home needs no permission at all.
- Updated with this feature: `site/src/Privasi.tsx` (id and en), the Data safety row in `play-store.md`, the App Privacy line in
  `app-store.md`.

## Owner actions

None. No API key, no secret, no migration, no server deploy. FOSSGIS OSRM is a shared public service: a few requests per search
at 1.1 s apart is within its policy, but heavy growth in users would be heavy use; watch for `429`/`403` answers (the screen then
says the service cannot be reached) and move to a keyed provider behind our API as described above.

## Tests

`src/features/loops/*.test.ts` (geometry, painted index and scoring, target conversions and rulers, body derivation, generator with
a fake router, pool, prefs, text), `routes/map/routingClient.test.ts` (`routeVia`). Not covered by tests: the screen and the ruler
(native views), the database readers, the map layers; they were typechecked and linted, not run on a device or emulator.
