# JoyoFit cloud (Cloudflare Worker)

A small backend for the JoyoFit app: it accepts JoyoRogo sign-ins and stores what the app uploads in
D1, with a raw-file endpoint into R2 for the future Huawei-export importer.

- Hono + TypeScript on Workers, D1 (`DB`), R2 (`IMPORTS`, and `MAPS` for the public offline maps).
- Auth: the app sends its JoyoRogo better-auth session cookies; the Worker asks
  `${JOYOROGO_AUTH_URL}/api/auth/get-session` who they belong to. See
  [`JOYOROGO_PATCH.md`](JOYOROGO_PATCH.md) for the one change JoyoRogo needs and why.
- Every row is keyed by the JoyoRogo user id; one user can never read or overwrite another's.

## API

All endpoints need `Cookie: <JoyoRogo session cookies>`; without a live session they answer `401`
(`503` when JoyoRogo itself cannot be reached).

Uploading is a JoyoRogo Pro benefit. `POST /v1/sync` and `POST /v1/imports` ask JoyoRogo's oRPC
`fitness/cloudAccess` (with the forwarded session cookies) and answer `402 {"error":"founder_required","paywall":true}`
unless the account is Pro, or the JoyoRogo server has no paywall (self-host: the same `premiumUnlocked` rule
JoyoRogo uses for its own Pro features). Reads (`GET`) stay open, so existing data is never locked away. If
JoyoRogo cannot answer (including a `404` from a JoyoRogo that predates the procedure) the answer is `503`, never
a guess. Deploy JoyoRogo with `fitness.cloudAccess` before this Worker.

| Endpoint | What it does |
|---|---|
| `GET /v1/me` | `{ user: {id, email, name}, rev, lastSyncAt, cloud: { unlocked } }`; `unlocked` says whether uploads are accepted |
| `POST /v1/sync` | Batched upsert. JSON body, at most 3 MB: `stepSamples` (≤ 5 000), `sleepSegments` (≤ 2 000), `workouts` (≤ 50, each with `points`, ≤ 30 000), `devices` (≤ 10). Validated with zod (`400` with the issues, `413` too big). Idempotent: a row identical to the stored one is not rewritten. Answers `{ rev, written }`. |
| `GET /v1/sync?since=<rev>&limit=<n>` | Pull for other devices: rows changed after `since`, oldest change first, across all tables (`limit` ≤ 1 000, workouts ≤ 25 per page). Answers the four arrays plus `cursor` (the next `since`) and `hasMore`. |
| `GET /v1/restore?table=steps\|sleep&from=<unix s>&after=<cursor>&limit=<n>` | Windowed history for a new phone, open to every signed-in account (no Pro gate). Rows with key time ≥ `from` (steps: `timestamp`; sleep: `end`), ordered by primary key (steps by `timestamp`, sleep by `start, type`) and paged by a keyset cursor: `after` is the previous page's `cursor` (steps: last timestamp; sleep: `start:type` of the last row). `limit` default 2 000, max 5 000. Answers `{ rows, cursor, hasMore }` with the pull's camelCase row shapes (steps: `timestamp, steps, calories, distance, heartRate, spo2, restingHeartRate, device`; sleep: `start, end, type, stage, device`). `400` for a bad `table`/`from`/`after`/`limit`, and for `from` older than 400 days. One primary-key range query per page; sleep scans `start >= from - 1 day` and filters `end >= from`, so a segment longer than a day that began before that is not returned. |
| `POST /v1/imports?filename=<name>` | The request body is the file, streamed straight into R2 at `imports/<userId>/<uuid>` (needs `Content-Length`, at most `MAX_IMPORT_BYTES`, default 100 MiB). Records an `imports` row (`uploading` → `uploaded`, or `failed`). Answers `201 {id, status, size, ...}`. |
| `GET /v1/imports` | The caller's 50 newest imports. |
| `DELETE /v1/data` | Wipes what the app uploaded for the caller (steps, sleep, devices, workout rows of older builds, import files and rows, the watch face library, live tracking sessions and points). Keeps the Strava connection and family links. No Pro gate (data is never locked in). Answers `{deleted: true}`. |
| `DELETE /v1/account` | Everything above plus the Strava connection and family links; the app calls it before it deletes the JoyoRogo account. |
| `GET /v1/strava`, `GET /v1/strava/authorize`, `POST /v1/strava/token`, `POST /v1/strava/disconnect` | Strava connection of the signed-in user, **free while slots are spare** (the same for every user, no plan check; JoyoRogo manages the 10 shared slots and releases accounts that stopped using Strava, `slotsFull`/`released` in the status, `authorize` answers 409 `slots_full` when every slot is taken; docs/strava.md 2a): status, authorize URL (scope `activity:write` plus whatever the athlete already granted JoyoRogo), a fresh short-lived access token, unlink. The Strava application is shared with JoyoRogo and Strava keeps one token per athlete, so the tokens live in **JoyoRogo's D1** (`strava_account`) and this Worker calls JoyoRogo's `/internal/joyofit/strava/*` with the Strava client credentials as HTTP Basic; the refresh token and client secret never reach the phone. The old table `strava_connection` is dropped by [`migrations/0004_drop_strava_connection.sql`](migrations/0004_drop_strava_connection.sql). |
| `GET /strava/callback`, `GET\|POST /strava/webhook` | Public, called by Strava: the OAuth redirect (JoyoRogo exchanges the code and stores the tokens; redirects to `joyofit://settings/strava`) and the webhook (subscription validation; a deauthorization event is forwarded to JoyoRogo, which deletes that athlete's tokens for both products, `503` when the forward fails so Strava retries). |

| `POST /v1/waitlist` | Public (no session, CORS for `https://fit.joyorogo.com`): the /strava and /iphone invite forms. Body `{ kind: "strava" \| "iphone", email, stravaProfile?, watchModel?, note?, website? }`; `website` is a honeypot (filled = `200`, nothing stored). Upserts by `(kind, email)` (status and `created_at` kept), at most 5 submissions per IP per hour (`429` + `Retry-After`; only a one-hour salted hash of the IP is stored, table `waitlist_rate`). Table `waitlist` ([`migrations/0003_waitlist.sql`](migrations/0003_waitlist.sql)). |
| `GET /v1/app-config` | Public (no session), `Cache-Control: public, max-age=60`. The launch-time update gate: `{ android: { minBuild, latestBuild, storeUrl }, ios: { ... }, message }`, read from table `app_config` ([`migrations/0011_app_config.sql`](migrations/0011_app_config.sql)); an empty table means every `minBuild` is 0 (gate off). Set it with `scripts/app-min-build.sh`; see [`../docs/force-update.md`](../docs/force-update.md). |
| `GET /v1/agps/hw-agnss` | Public (no session, no parameters), `Cache-Control: public, max-age=900`. The experimental `HW_AGNSS_RTCM_33` satellite file (RTCM 3 frames 1019/1020/1042/1046): fetched from BKG's `BRDC00WRD_S_...rnx.gz` (today's, plus yesterday's in the first 4 h of the UTC day), built with `../packages/agps-rtcm`, checked (CRC-24Q of every frame, 512 B to 16 KiB, at least 20 satellites) and kept in the Cache API for 15 minutes; `Last-Modified` is the build time. `503 { error: "agps_unavailable" }` (`no-store`, `Retry-After: 60`) when no valid file can be built; the failure is remembered in the Cache API for 60 s so BKG is not asked again by every caller. See [`../docs/agps.md`](../docs/agps.md). |
| `GET /v1/maps` | Public (no session), `Cache-Control: public, max-age=300`, `ETag` (hash of the answer; `If-None-Match` → `304`). Offline watch maps for every Indonesian Kabupaten/Kota (docs/offline-maps.md): the entries of `watch/catalog.json` in the R2 bucket `MAPS` (`joyofit-maps`, shared with the bike computer's PMTiles; written by `tools/offline-maps/publish.py`): `id` decimal u64 string, `name`, `code` (4-digit BPS code), `province`, `kind` (`kota` \| `kabupaten`), `part?` `{ index, count }` for a split region, `bbox` [west,south,east,north], `sizeBytes`, `sha256`, `version`, `builtAt`, `osmDate`, each plus `attribution: "© OpenStreetMap contributors, ODbL 1.0"`. Optional query: `province` (exact, any case), `q` (part of the name or province, or the code), `limit` 1..1000; anything malformed → `400 { error: "invalid_query" }`. The parsed catalog is kept per isolate and re-read only when the R2 object's etag changes. Invalid entries are dropped and logged; a missing or broken catalog is `[]`. No position filter on purpose: Workers Logs (observability on) records request URLs, so coordinates in a query would sit in the account's logs; the app sorts by distance on the phone. |
| `GET /v1/maps/:id.bin` | Public. The `offvmp` file `watch/<id>.bin` streamed from `MAPS`: `application/octet-stream`, `Content-Length`, `ETag`, `Cache-Control: public, max-age=3600`; `If-None-Match` → `304`. Unknown or malformed id → `404 { error: "not_found" }`. |
| `GET /v1/waitlist?kind=&status=` | Owner only: `Authorization: Bearer $WAITLIST_ADMIN_TOKEN` (Worker secret, `503` when unset). Easiest: `scripts/waitlist.sh [strava\|iphone]` from the repo root, which reads the token from `~/.config/joyofit/waitlist-admin-token`. |

Strava needs the `STRAVA_CLIENT_ID` var (in `wrangler.jsonc`) and two secrets, `STRAVA_CLIENT_SECRET` (the same value as on
JoyoRogo's Worker) and `STRAVA_WEBHOOK_VERIFY_TOKEN`; without the client secret the Strava routes answer `503 strava_not_configured`.
`STRAVA_MANUAL_UPLOAD` (var in `wrangler.jsonc`, `"on"` by default; only `"off"` turns it off) becomes `manualUpload` in every
`GET /v1/strava` answer and tells the app to offer the manual Strava upload, the workaround for everyone while Strava capacity
is limited. Turn it off when Strava grants extended capacity (9,999); turn it back on if the slots fill up ([`../docs/strava.md`](../docs/strava.md) 2a).
Owner setup (callback domain, webhook registration, the shared application, review): [`../docs/strava.md`](../docs/strava.md).

`rev` is a per-user change counter: each row a request creates or changes gets its own increasing value,
which is what `since` filters on. D1 schema: [`migrations/0001_init.sql`](migrations/0001_init.sql)
(`step_samples`, `sleep_segments` with `stage`, `workouts`, `workout_points`, `device`, `user_state`,
`imports`).

### Ride relay ("Main di web")

Rooms for the browser ride game, with the JoyoFit phone as the sensor bridge; code in `src/ride/`, the protocol in `../src/features/ride/protocol.ts`, the whole feature in [`../docs/ride.md`](../docs/ride.md). Two SQLite-backed Durable Object classes (`RideRoom`, `RideIndex`, migration `ride-v1`), no D1.

| Endpoint | What it does |
|---|---|
| `POST /ride/rooms` | Public (no session, CORS `*`, 10 per address per 10 minutes, `429` + `Retry-After`). Answers `{ roomId, code, token, codeExpiresAt }`: a six digit code valid 10 minutes and the web token for the socket. |
| `POST /ride/rooms/join` | Body `{ code }`, JoyoRogo session. Answers `{ roomId, token }` (the phone token). `400` malformed, `404` unknown or expired code, `409` another user is the room's phone, `429` rate limited (10 per user, 30 per address, 5 minutes). Free for every account. |
| `GET /ride/rooms/:roomId/ws?role=phone\|web&token=...` | WebSocket (hibernatable). `401` wrong token, `404` no such room, `429` room full (8 web sockets) or rate limited. Frames: 2 KB at most, validated, stamped with `rt` and relayed; a room idle for 3 hours is closed. |

### Gear sync

Shoes and bikes (and which workout used which) travel as one JSON document per user, table `gear_doc`
([`migrations/0006_gear.sql`](migrations/0006_gear.sql)); code in `src/gear.ts`.

| Endpoint | What it does |
|---|---|
| `GET /v1/gear` | `200 { rev, doc }`; `rev: 0, doc: null` when the user has none. Open to every signed-in account, like `GET /v1/sync`. |
| `PUT /v1/gear` | Body `{ baseRev, doc }`, at most 1 MiB (`413`). **Pro only** (`402 { error: "founder_required", paywall: true }`, same gate as `POST /v1/sync`). The doc is validated with zod (`400`): `version: 1`, `gear` ≤ 200, `defaults` ≤ 20, `assignments` ≤ 50 000; unknown extra keys are kept, a missing `notified` becomes `0`. The stored JSON is the validated doc re-serialised. |

`rev` is the optimistic-concurrency counter. A write lands only when `baseRev` equals the stored `rev` (`0` when the
user has no doc): it stores the doc, sets `rev = rev + 1` and answers `200 { rev }`. Otherwise nothing is stored and
the answer is `409 { error: "conflict", rev, doc }` with the current server state, for the client to merge and retry
with the new `rev`. The check and the write are one conditional D1 statement, so two concurrent writers with the same
`baseRev` cannot both win. `DELETE /v1/data` and `DELETE /v1/account` remove the row.

Each table is written as one JSON bind parameter expanded with `json_each`, so a request costs a handful of
D1 statements however large it is (D1 allows 100 bound parameters and, on the free plan, 50 queries per
invocation). A table whose JSON would pass 1 MB is split over several statements (D1 refuses one value over 2 MB).

D1 limits (100 bound parameters, 100 KB statement text, 2 MB per value, 50-byte LIKE patterns) are named in
`src/d1.ts`, with `chunk` for anything built from a list. The tests run against a D1 wrapper (`test/d1Guard.ts`) that
fails a statement production would refuse; the local D1 already enforces all but the 2 MB value.

### Live tracking link

Bike computer mode can share the phone's position while a ride is recorded (`docs/bike-computer.md`, "Live tracking link"); code in
`src/live.ts` (routes, purge) and `src/livePage.ts` (the page), tables in [`migrations/0007_live_tracking.sql`](migrations/0007_live_tracking.sql).
Three kinds of caller, three secrets, all 128-bit random; only SHA-256 hashes are stored, so a leaked database holds no usable link or key.

| Endpoint | Auth | What it does |
|---|---|---|
| `POST /v1/live` | JoyoRogo session | Body `{ title? }` (trimmed, at most 80 characters). Starts a session and answers `201 { id, viewUrl, token, writeKey }`: the only time the token and the write key exist in the clear. One active session per user (a partial unique index): starting another ends the previous in the same batch. At most 10 starts per user per hour (`429`). |
| `POST /v1/live/:id/points` | `Authorization: Bearer <writeKey>` (not the cookie, so a backgrounded phone with an expired session keeps posting) | Body `{ points: [{ ts, lat, lon, alt?, speed?, hr? }] }`, 1 to 30 points, at most 8 KiB. `ts` is Unix ms, strictly increasing inside the batch, within 6 h in the past and 10 min in the future of the server clock; `lat` -90..90, `lon` -180..180, `alt` -1000..12000 m, `speed` 0..120 m/s, `hr` integer 0..255. Anything else is `400 invalid_body` (the app drops that batch). `INSERT OR IGNORE` on `(session_id, ts)`, so a retried batch is harmless. Answers `{ stored }`. `401` for a wrong key, `409 ended` / `409 expired` (12 h after the last batch) / `409 session_full` (20 000 rows), `429` with `Retry-After` past 12 requests per session per minute. |
| `POST /v1/live/:id/end` | Bearer write key | Sets `ended_at`; repeatable. |
| `GET /v1/live/:token` | none (the token is the capability) | `Cache-Control: no-store`. `{ state: "live" \| "ended" \| "expired" \| "unknown", title, startedAt, lastAt, last: { lat, lon, speed, hr, ts } \| null, track: [[lat, lon], ...] }`, the track downsampled to at most 300 points keeping the first and the last. Only `live` carries a title, position or track: ending the ride revokes the link (`ended` keeps the times), and a link 12 h past its last batch is `expired`. An unknown or malformed token is `404` with `state: "unknown"` and nulls, identical for both. `?track=0` skips the track (one D1 row read instead of the whole ride; the page uses it for most polls). |
| `GET /live/:token` | none | The page people open: HTML with inline CSS and JS only, a per-request nonce CSP (`default-src 'none'`, `connect-src 'self'`, no images, no frames), `noindex`, `Referrer-Policy: no-referrer`, Indonesian or English by `Accept-Language`. It polls the JSON every 15 s and draws the track as an inline SVG polyline with the last position marked, plus speed, "diperbarui X menit lalu", banners for ended/expired links and a link "Buka di OpenStreetMap" with the attribution. **No map tiles, on purpose**: a tile server would learn the viewer's address and, through the tile requests, where the rider is, and the page would need a tile provider's terms and key. The title is only ever written with `textContent`; the first answer is embedded as a JSON data block with `<`, `>`, `&` escaped. |

The nightly purge (`0 20 * * *`, the family cron's `purge`) deletes sessions and their points 24 h after `COALESCE(ended_at, last_at)`;
`DELETE /v1/data` and `DELETE /v1/account` delete a user's sessions and points. The Worker never logs coordinates. The migration needs to be
applied before the routes are deployed (`bun run db:migrate:remote`); no new secrets or wrangler changes.

## JoyoFit web app (`apps/fit`)

The JoyoFit web app (`apps/fit`) does not call this API from the browser. It goes through the JoyoRogo API proxy `/api/fit/*`, which forwards
server to server with the session cookies, because the JoyoRogo session cookie is host-only on `api.joyorogo.com` (a browser would not send it to
`api.fit.joyorogo.com`). So there is no browser CORS policy here (`/v1/waitlist` keeps its own for `https://fit.joyorogo.com`, `/ride/*` keeps `*`).
The routes below are unchanged by that: session-verified like every `/v1` route, Pro-gated for `POST`. Two pieces serve the web app: `GET /v1/sleep` and the watch face library.

### `GET /v1/sleep?from=YYYY-MM-DD&to=YYYY-MM-DD`

Sleep per **WIB** calendar day (a session belongs to the day it **ends** on), `from` and `to` inclusive, 1 to 92 days (`400 {"error":"invalid_range","maxDays":92}`
for a missing, malformed, reversed or wider window). Session cookie only: no Pro check (a read, like `GET /v1/restore`), only the caller's rows.

```jsonc
{ "from": "2026-10-15", "to": "2026-10-20",
  "days": [ {                       // oldest day first, only days that have sleep
    "day": "2026-10-17",
    "asleepSec": 31800,             // night + naps, overlaps counted once
    "napSec": 3600,
    "night": null | {               // null on a day with only naps
      "start": 1792166400, "end": 1792195200,   // unix seconds
      "asleepSec": 28200, "awakeSec": 600,
      "stages": { "awake": 600, "rem": 10200, "light": 10800, "deep": 7200, "asleep": 0 },   // seconds; `asleep` = recorded without a stage
      "hasStages": true, "awakenings": 1,
      "periods": [ { "start": 1792166400, "end": 1792177200, "stage": "light" } ]   // non-overlapping, oldest first, same-stage neighbours merged
    },
    "naps": [ { "start": 1792206000, "end": 1792209600, "asleepSec": 3600 } ]
  } ] }
```

The grouping is a port of the phone's rules into pure TypeScript (`src/sleepDays.ts`, no Worker imports), constant for constant:
`src/features/today/stats.ts` (`SESSION_GAP_SEC` 3 h, `withoutStrayUnstaged`, `withoutBlips` 1 h / 5 min), `src/features/sleep/cleanSleep.ts`
(`cleanUnstagedSleep`: 15 steps a minute, 20 min runs, `breakBefore`) and `src/features/sleep/nights.ts` (`buildNights`, `MIN_NIGHT_SEC` 3 h: less sleep than that is a
nap). Segments from several watches (column `device`) overlap freely: the earlier-starting segment keeps the overlap, so a night two watches recorded counts once.
Rows are read from `sleep_segments` with a 36 h margin around the window so a session that straddles its edge is whole.

Intentional differences from the phone, also written at the top of `sleepDays.ts`:

- **WIB, not the device's time zone** (the server has none). A phone in another zone can file a night ending between 00:00 and 07:00 WIB under another day.
- **Stage-less cleaning has less evidence.** The phone subtracts workouts, spot HRV readings and minutes with 15+ steps. Here there are no HRV readings; workouts
  come only from the legacy `workouts` table (builds before the cloud-workouts release) and steps from `step_samples`. Staged nights are identical.
- **`stage` text** other than `awake|rem|light|deep` is read as stage-less.
- **One night per day.** The longest session of the day (the later one on a tie) is `night` when it has 3 h of sleep or more, every other session is a `nap`, however long
  (the Today summary's rule, `lastSleepSession`). The phone's per-day total `sleepByDay` would call a second session of 3 h or more a night; `asleepSec` is the same either way.
- **Evening doze.** A session with under 3 h of sleep that starts between 19:00 and 06:00 WIB joins the session after it when that starts within 8 h of its end (`EVENING_JOIN_GAP_SEC`): one night from the doze's start, the time between one `awake` period, dated by the wake day. A workout between the two keeps them apart; an afternoon nap is unchanged.

### Watch face library: `/v1/watchfaces`

A per-user library shared by the web app and the phone. The files live in the R2 bucket `IMPORTS` under `watchfaces/<userId>/<id>` (the bucket the
Worker already has for imports: a face is a user-owned upload like an import, needs no public URL, and `DELETE /v1/data` and `DELETE /v1/account` already
sweep a per-user prefix there); one row per face in D1 `web_watchfaces(id, user_id, name, filename, size, sha256, created_at)`
([`migrations/0010_web_watchfaces.sql`](migrations/0010_web_watchfaces.sql), unique on `(user_id, sha256)`). Apply the migration before deploying
(`bun run db:migrate:remote`). Code: `src/watchfaces.ts`, validation `src/hwtValidate.ts`. Behind `requireUser`; **uploading is Pro** (`requireFounder`:
`402 {"error":"founder_required","paywall":true}`), listing, downloading and deleting are open to every signed-in account.

| Endpoint | What it does |
|---|---|
| `POST /v1/watchfaces?filename=face.hwt` | The body is the `.hwt`. `Content-Length` required (`411`), at most 8 MiB (`413 {"error":"too_large","maxBytes":8388608}`), empty is `400 empty_body`, a body of another length than declared is `400 length_mismatch`. The file is buffered (validation needs every byte) and checked (below): not a face is `400 {"error":"invalid_hwt","reason":"..."}`. A user holds at most 40 faces: `409 {"error":"library_full","max":40}` (the check is part of the `INSERT`, so concurrent uploads cannot overshoot). The same file (SHA-256) uploaded again by the same user stores nothing and answers `200` with the existing record, also when the library is full. Otherwise `201 { id, name, filename, size, sha256, createdAt }`: `name` is the `<title>` of the face's `description.xml` (control characters dropped, whitespace collapsed, 80 characters), else the filename without its last extension; `filename` is `filename` cleaned like imports (no `/`, `\`, control characters, 255 characters), `watchface.hwt` when missing; `sha256` lower-case hex; `createdAt` is unix **milliseconds**. |
| `GET /v1/watchfaces` | `{ "watchfaces": [ { id, name, filename, size, sha256, createdAt } ] }`, newest first. |
| `GET /v1/watchfaces/:id/file` | The stored bytes: `Content-Type: application/octet-stream`, `Content-Length`, `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<exact>`, `Cache-Control: private, no-store`. `404 {"error":"not_found"}` for an id that is not yours (or whose file is gone). |
| `DELETE /v1/watchfaces/:id` | `{ "deleted": true }`: removes the R2 object and the row; `404` when not yours. |

What the upload check (`checkHwt`, reusing the codec in `packages/hwt`, pure `Uint8Array` code plus `fflate`, so it runs in the Worker) verifies, in order:
zip magic; the central directory declares at most 32 MiB unzipped in total (read before inflating, for the nested zip too: a small upload cannot become a memory bomb);
every entry inflates to its declared size; `description.xml` exists with a `HwTheme`/`HnTheme` root and a `<screen>`; the watchface entry (`com.huawei.watchface`,
`com.honor.watchface` for Honor) exists and, when it is itself a zip (the nested form), holds `watchface.bin`; the binary parses and `verifyWatchface` passes: header lengths add up to the file size,
the image table tiles the bin area exactly, every image blob carries the ARGB8888 magic, the protobuf layout decodes. All 10 committed fixtures in `packages/hwt/fixtures` pass.
Not checked: the screen code against a watch model (a face for another Huawei watch is a valid face), Huawei's Fit 4 size limits, whether a watch accepts it. The server imports the codec
from `../packages/hwt/src`, so building the Worker needs the repo's root `bun install` (it provides `fflate`).

`DELETE /v1/data` and `DELETE /v1/account` remove the user's `web_watchfaces` rows and every object under `watchfaces/<userId>/`, like imports.

### Studio cloud projects: `/v1/studio/projects`

JoyoFit Studio's "save to db" (Pro). A project is a Studio `.project.json` document (`{ "format": "joyofit-studio-project", "project": { "version": n, ... }, "assets": { id: { name, dataUrl } } }`) plus metadata.
One row per project in D1 `studio_projects(id, user_id, name, rev, size, thumb, doc_key, created_at, updated_at)`
([`migrations/0012_studio_projects.sql`](migrations/0012_studio_projects.sql), index `(user_id, updated_at DESC)`); the document lives in R2 `IMPORTS` under `studio/<userId>/<id>/<uuid>`,
where `<uuid>` is fresh for every document version and `doc_key` names the current one, so a stale writer never overwrites the stored file. Apply the migration before deploying
(`bun run db:migrate:remote`). Code: `src/studio.ts`. Behind `requireUser`; **writing is Pro** (`requireFounder`: `402 {"error":"founder_required","paywall":true}`), listing, reading and
deleting are open to every signed-in account, so a lapsed Pro keeps what it saved. The browser reaches it only through JoyoRogo's `/api/fit/studio/projects` proxy. Every query is scoped to the caller: another user's id is `404`.

Meta, everywhere: `{ id, name, rev, size, createdAt, updatedAt, thumb }` (`size` is the bytes of the stored document, `thumb` a `data:image/(png|jpeg|webp);base64,...` string or `null`, times in ms).

| Endpoint | What it does |
|---|---|
| `GET /v1/studio/projects` | `{ "projects": [Meta], "max": 100, "maxBytes": 5242880 }`, `updatedAt` descending (id as tiebreak). Never carries documents. |
| `POST /v1/studio/projects` | Body `{ name, thumb?, document }` -> `201 Meta` at `rev` 1. `Content-Length` required (`411`), the whole body at most 5 MiB (`413 {"error":"too_large","maxBytes":5242880}`, also when the stream is longer than declared). A user holds at most 100 projects: `409 {"error":"library_full","max":100}` (the cap is part of the `INSERT`, so concurrent creations cannot overshoot; the refused document's object is deleted). |
| `GET /v1/studio/projects/:id` | `200 { ...Meta, document }`, `Cache-Control: private, no-store`; `404 {"error":"not_found"}` for an id that is not yours (or whose document is gone). |
| `PUT /v1/studio/projects/:id` | Body `{ rev, name?, thumb?, document? }` (`rev` is the revision the client last saw, at least one of the other three; `thumb: null` clears it) -> `200 Meta` with `rev + 1` and `updatedAt` now. A stale `rev` is `409 {"error":"rev_conflict","rev":<current>,"updatedAt":<ms>}` and nothing changes. A new document is written to a fresh R2 key first, the conditional `UPDATE ... WHERE id AND user_id AND rev` then switches `doc_key`, and the losing object is deleted (the new one on a conflict, the old one on success). A rename or thumbnail change keeps the object. Same body limits as `POST`; `404` when not yours. |
| `DELETE /v1/studio/projects/:id` | `{ "deleted": true }`: removes the row, then every object under `studio/<userId>/<id>/`; `404` when not yours. |

Validation (`400 {"error":"invalid_body"}`; a body that is not JSON is `400 invalid_json`): `name` is trimmed, 1 to 80 characters; `document` is an object with `format === "joyofit-studio-project"`, a `project` object with a numeric
`version`, and `assets` absent or an object (shallow on purpose: the client validates the rest); `thumb`, when a string, matches `^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$` and is at most 16 KiB long.
Limits live in `src/limits.ts` (`MAX_STUDIO_BODY_BYTES`, `MAX_STUDIO_PROJECTS_PER_USER`).

`DELETE /v1/data` and `DELETE /v1/account` remove the user's `studio_projects` rows and every object under `studio/<userId>/`, like watch faces.

### Run it locally with a local JoyoRogo

For the web app (`apps/fit`, port 3003; its server reaches this API through the JoyoRogo proxy `/api/fit/*`) against JoyoRogo on port 3000; the API listens on **3004**. From the repo root once, `bun install` (the Worker imports `packages/hwt`, which needs `fflate`),
then:

```bash
cd server
bunx wrangler d1 migrations apply joyofit --local        # same as `bun run db:migrate:local`; rerun after pulling new migrations
bunx wrangler dev --port 3004 --var JOYOROGO_AUTH_URL:http://localhost:3000
```

`--var` replaces the `vars` of `wrangler.jsonc` for this run; instead you can put `JOYOROGO_AUTH_URL=http://localhost:3000` into `server/.dev.vars` (ignored by git) and run
`bunx wrangler dev --port 3004`. D1 and R2 are local (`server/.wrangler/state`), so uploads never touch production. The JoyoRogo proxy then points at `http://localhost:3004`. The Pro check calls JoyoRogo's `/rpc/fitness/cloudAccess`
on the local JoyoRogo, so uploads are accepted when that server says the account is Pro (or has no paywall).

## Setup (you run these)

You need a Cloudflare account and `wrangler` login (`bunx wrangler login`). From this directory:

```bash
bun install

# 1. D1 + R2
bunx wrangler d1 create joyofit          # prints database_id
bunx wrangler r2 bucket create joyofit-imports
# joyofit-maps (MAPS) already exists: the bike computer's PMTiles (docs/bike-computer.md) and the watch maps under watch/ (docs/offline-maps.md)
```

Edit `wrangler.jsonc`: put the printed `database_id` in `d1_databases[0].database_id` (the
`0000…` value is a placeholder), and the bucket name if you chose another. Then:

```bash
# 2. Schema
bun run db:migrate:remote                # wrangler d1 migrations apply joyofit --remote

# 3. JoyoRogo origin (default https://api.joyorogo.com) — change in wrangler.jsonc `vars` if needed:
#    "JOYOROGO_AUTH_URL": "https://api.joyorogo.com"

# 4. Deploy
bun run deploy                           # wrangler deploy; prints https://joyofit-api.<subdomain>.workers.dev
```

Then apply [`JOYOROGO_PATCH.md`](JOYOROGO_PATCH.md) to JoyoRogo and redeploy it, and build the app with the
printed URL: `EXPO_PUBLIC_JOYOFIT_CLOUD_URL=https://joyofit-api.<subdomain>.workers.dev` (or set
`expo.extra.cloudUrl` in the app's `app.json`).

Local development: `bun run db:migrate:local && bun run dev`.

## Develop

```bash
bun run test         # vitest + @cloudflare/vitest-plugin (miniflare): auth, idempotency, user isolation, imports
bunx tsrs --noEmit
bun run types        # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

The tests replace JoyoRogo with a fake `get-session` and `fitness/cloudAccess` (a stubbed `fetch`, and a fake `AUTH_SERVICE` binding
for the service-binding path).

## Language of the text the Worker writes

Push and email copy go to someone else's phone or inbox, so they follow the **recipient's** language: `locale` (`id` or `en`) from
JoyoRogo's `/internal/joyofit/family/users` answer (`RogoUser.locale`; anything else or missing is `id`). `src/i18n/` holds
`serverT(locale)` (`{{param}}` interpolation, `_one`/`_other` plurals by `Intl.PluralRules`) and
`locales/{id,en}/{push,email,errors}.json`; `id` is the source. There is no per-isolate "current language": callers pass the `Locale`
down (`EvalInput.locale`, `deliver(..., locale, ...)`, `sendFamilyEmail(env, to, locale, ...)`).

- Alert titles and bodies are written when the alert is decided and stored in `family_alert_log` as written; a queued alert or digest
  item goes out in that language. The digest title and the email disclaimer follow the watcher's language at send time.
- A poke goes to the monitored person, so it uses *their* locale.
- API errors stay machine codes (`invite_invalid`, ...); the app words them. The only localized API text is the inviter fallback name in
  `GET /v1/family/invites/:code` (header `x-locale`, else the caller's JoyoRogo locale) and the Strava fallback page (`Accept-Language`).
- `bun run server/scripts/i18n-keys.ts` (from the repo root) checks that `en` has every `id` key, once per plural category, with no orphans.

## Notes

- Sessions are cached per isolate for 60 s; a session revoked in JoyoRogo keeps working here for up to
  that long. Failures are never cached. The Pro answer is cached the same way (60 s when unlocked, 10 s
  when locked, so a fresh purchase is noticed quickly).
- Workouts moved to JoyoRogo: app builds from the cloud-workouts release on keep their workouts (summary, every sample stream, the analysis) in JoyoRogo's D1 and R2, Pro only, restorable on a new phone and shown on joyorogo.com (design in JoyoRogo's `docs/watch-workout-cloud.md`). They no longer send `workouts` to `POST /v1/sync`. The `workouts` and `workout_points` tables and the workout part of `/v1/sync` stay only for older installed builds; drop them in a migration once those are gone.
- Deleting: the app deletes nothing row by row. `DELETE /v1/data` wipes everything it uploaded, `DELETE /v1/account` additionally drops Strava and family links.
- The importer for the Huawei export does not exist yet; `imports.r2_key` and `status` are where it will
  pick files up (`uploaded` → its own states).
- `device` (nullable `TEXT`, max 64 chars) on `step_samples`, `sleep_segments` and `workouts` holds the id of the watch that produced a row (multi-watch). `POST /v1/sync` accepts it optionally on those items (a changed value counts as a change and bumps `rev`), `GET /v1/sync` and `GET /v1/restore` return it (`null` when absent); builds that send none keep working. Migration [`migrations/0008_device_column.sql`](migrations/0008_device_column.sql) is numbered 0008 on purpose: `0007_live_tracking` lives on the unmerged `bikecomp` branch.
