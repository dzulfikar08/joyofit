# Multi-device: one account, two or three phones

Rule: a person signed in on two or three phones (Android and iPhone) sees the same data and the same preferences on every one of them. For JoyoFit that is a JoyoRogo Pro benefit; what a free account keeps only on its phone is listed below and the app says so ("Data ini hanya di HP ini. Pro menyimpannya di cloud.").

This file is identical in the `joyorogo` and `watch-fit` repos (`docs/multi-device.md`). Change both together.

## Vocabulary

- **Server data**: a table of JoyoRogo's D1 (or JoyoFit's own D1 `joyofit`) keyed by the user id. Every phone reads and writes the same rows; nothing to sync on the phone.
- **Record sync**: small JSON documents in D1 `sync_record` (migration 0045), merged per record by the shared engine (below). Used for preferences and small user-made documents.
- **Local only**: stays on the phone that made it.

## 1. Conflict rules and clock safety

| Mechanism | Used by | Rule |
|---|---|---|
| Server rows, last write wins by the server | JoyoRogo food log, weight, water, fasting, exercise, sleep, waist, saved foods, profile, targets, plans, challenges, social | The server stores the write that arrives last. Rows have stable ids; deletes remove the row. |
| `sync_record` (this work) | JoyoRogo preferences (ns `rogo`), JoyoFit preferences, stickers, routes, sensors, small health kinds (ns `fit`) | Per `(ns, kind, id)` the newer `updatedAt` wins, a tie goes to the later push. A **tombstone** (`deletedAt` set, document kept) is ordered by time like any edit, so a delete on phone A removes the record on phone B and an older edit cannot resurrect it. For live-vs-live the higher `rank` (coverage, for example the sample count of a day bundle) wins before time does. One upsert statement decides, so two phones racing cannot both win. |
| `watch_workout` (JoyoRogo D1 + R2) | JoyoFit workouts with samples | Key `(user, start)`, identical gzip bytes = `unchanged`, otherwise replaced with `version + 1`; delete = tombstone (`410 deleted` for later uploads of that start). |
| `strength_record` | JoyoFit strength | Per `(kind, id)` newer `updatedAt` wins; tombstones; `server_at` cursor. |
| `coach_doc` | JoyoFit coach plan | One document per user, optimistic `baseRev`, merged on conflict (`mergeCoachDocs`). |
| `gear_doc` (JoyoFit Worker) | JoyoFit gear | One document per user, `baseRev` (409 returns the server copy), per item newer `updatedAt` wins, `deletedAt` tombstones. |
| `step_samples`, `sleep_segments` (JoyoFit Worker) | JoyoFit steps and sleep | Keyed by minute / `(start, type)`; the last write per key wins; per-user `rev` counter. |

**Clock skew.** A phone's clock can be minutes or days off. Every push carries `clientNow`; the server shifts each record's times by `serverNow - clientNow` and caps them at the server clock (`normalizeTimes`). A record edited offline an hour before the push stays an hour before it, a phone a day ahead cannot sit in the future for good. The phone compares in server time too (`remoteWins` shifts its own not-yet-pushed edits by the skew it learned from the last answer). Tested with phones one hour behind and one day ahead (`packages/api/src/routers/sync.test.ts`).

**Cursors.** `sync/pull` pages by `server_at`, which strictly increases inside a push and is always later than anything the account already has. The phone stores the last `cursor` per account and re-reads 10 seconds before it (re-applying a record is a no-op), so a pull never skips a row.

**Idempotent.** Records have stable ids (preference key, template id, route id, `<start>:<source>`, `<type>:<day>`); pushing the same batch twice stores one row per record and a pull of its own acknowledged record changes nothing.

**Limits.** A record is capped by kind (table in `packages/api/src/lib/sync-record.ts`); 100 records and 2 MB per push; 100 000 records and **50 MB of documents** per account across both namespaces (a push over a cap stores what fits, always lets an existing record shrink, and answers `full` for the record count or `quota` for the bytes; those records stay waiting on the phone, JoyoFit shows "Penyimpanan cloud akunmu penuh"). `sync/status` returns `bytes` and `quotaBytes`. Unknown kinds, oversized and non-object documents are rejected and not retried.

## 2. JoyoRogo (`apps/native`, `apps/web`)

| Data | Lives | Syncs? | For whom | Conflict rule | 2nd phone sign-in | Sign-out | Account switch |
|---|---|---|---|---|---|---|---|
| Food log, scans, saved foods, weight, waist, water, fasting, exercise, sleep, activity, plans, targets, profile, challenges, groups, posts | Server (D1) | Always (not a sync: the server is the store) | All | Server rows by id | Read on demand | Query cache cleared; nothing on the phone to wipe | Cache cleared; the new account's data is read |
| Language | Server `profile.locale` + device copy (SecureStore / localStorage) | Yes | All | Account value wins; a device choice made before an account has one is uploaded once | Applied **before the login screen is left** (`restoreAccountPrefs`, 4 s bound) and on foreground by `LocaleSync` | Device copy kept (it is also a device setting) | The new account's `profile.locale` replaces it |
| Preferences: `theme`, `reminders` (meal, water, weigh-in, window times), `makan.view`, `makan.kind`, `sticker` (hide numbers, show name, watermark), `dismissed.handlePrompt`, `dismissed.stravaRetention7d` | Device storage (SecureStore, web localStorage) + D1 `sync_record` ns `rogo` kind `pref` | Yes, **free for every account** (a few hundred bytes) | All | Newer edit wins per key; a value at its default is a tombstone | Pulled at sign-in before leaving login, on foreground, and 2 s after each change; theme and reminders apply live (reminders reschedule only if notification permission is already granted), the rest at next mount | Device values stay; syncing stops (`forgetPrefsSync`) | Sync state is bound to a user id: a different account starts with its own values and never receives the previous account's prefs |
| Notification permission, location-save switch (follows the OS permission), Health Connect / Apple Health connection and first-sync flag, last-sync timestamps, camera choice, push token, app-update dismissals, widget cache, web iOS-install banner, analytics flags | Device | No, by design | | | Each phone asks again | Kept | Kept |
| Health Connect (Android) and Apple Health (iPhone) imports: workouts, daily activity, sleep | Read on the phone, stored on the server as rows with `source` `health_connect` / `apple_health` | The result is server data; the two sources are **never merged** | All | Day rows: the same source refreshes its own row, the other source replaces it only if it counts at least as many steps (a total never goes down because the other phone synced last). Sleep: the longer night wins, a manual entry is never replaced. Workouts: a workout the other source already stored the same WIB day with the same type and a duration within 2 minutes is not imported again (each stored row absorbs one candidate, two real walks of equal length both stay) | | | |
| Drafts (web workout draft), offline queues | Device | No | | | | | |

JoyoFit data in JoyoRogo (D1 + R2, written by JoyoFit): `watch_workout` (+ R2 `watch/<user>/`), `coach_doc`, `strength_record`, `fitness_score`, `sync_record` ns `fit`; the JoyoRogo web page `/jam` reads the workouts.

## 3. JoyoFit (`watch-fit`)

JoyoFit works without an account: everything is in the phone's SQLite and KV. **Free**: nothing is uploaded (reads of earlier Pro uploads stay open); Settings shows "Data ini hanya di HP ini. Pro menyimpannya di cloud." **Pro**: the rows below sync.

| Data | Local | Cloud | Free / Pro | Conflict rule | 2nd phone first sync | Sign-out | Account switch |
|---|---|---|---|---|---|---|---|
| Workouts + samples (GPS, HR, altitude, speed, cadence, stride, power) + analysis | `workouts`, `workout_points`, `cloud_workout` | JoyoRogo `watch_workout` D1 + R2 | Write Pro, read free | `start` (unix s) is the dedupe key; identical bytes unchanged; delete = tombstone | `watchWorkout/changes` from the start, each document downloaded and inserted (a `start` the phone already has is skipped; `cloud_workout` records it so it is not uploaded again) | See "Sign-out" below | See "Account switch" below |
| Strength: workouts, routines, folders, exercises, rest prefs | `strength_record` | JoyoRogo `strength_record` | Write Pro, read free | newer `updatedAt`, tombstones, `server_at` cursor | `strength/pull` from 0 | " | " |
| Coach plan, done sessions, logs | `coach_doc` | JoyoRogo `coach_doc` | Write Pro, read free | `baseRev` + merge | `coach/getDoc` | " | " |
| Gear (shoes, bikes, defaults, assignments) | `gear`, `gear_default`, `workout_gear` | JoyoFit Worker `gear_doc` | Write Pro, read free | `baseRev`, per item newer, tombstones | `GET /v1/gear` | " | " |
| Steps, HR, SpO2, resting HR (per minute) | `step_samples` | JoyoFit Worker `step_samples` | Write Pro, read free | last write per minute | **Windowed restore: last 90 days** (`GET /v1/restore`, about 108 000 rows), inserted with `imported = 1`; resumable per account | " | " |
| Sleep segments and stages | `sleep_segments` | JoyoFit Worker `sleep_segments` | Write Pro, read free | last write per `(start, type)` | Same window | " | " |
| HRV readings | `hrv_readings` | `sync_record` kind `hrv`, id `<start>:<source>` | Write Pro | newer wins; overlapping nights on two phones: more beats wins | Pulled | " | " |
| Sleep scores | `sleep_scores` | kind `sleepscore`, id = start | Write Pro | newer wins | Pulled | " | " |
| Other health metrics reported by the watch (stress, SpO2, blood pressure, ...) | `health_metrics` | kind `metric`, one record per type per UTC day (`<type>:<yyyy-mm-dd>`, split by hour above 48 KB) | Write Pro | higher `rank` (row count) wins, so a fuller day beats a newer partial one; rows merge per `(type, ts)` | Pulled | " | " |
| Cycle: periods and daily entries | `cycle_periods`, `cycle_days` | kinds `cycleperiod`, `cycleday` | Write Pro **and** the switch "Sinkron data siklus" (default on; off deletes the cloud copy and stops push and apply) | newest `modified` wins; tombstones | Pulled if the switch is on | " | " |
| Routes library | files `routes/<id>.json` + `<id>.pts.json` | kind `route` (meta + thumbnail + points, at most 256 KB; larger routes are skipped with a log) | Write Pro | newer wins; delete = tombstone; `lastSentAt` (last push to the watch) stays local | Pulled | " | " |
| Sticker Studio templates | KV `joyofit.stickers.user.*` | kind `sticker` (at most 64 KB each) | Write Pro | newer wins; tombstone | Pulled | " | " |
| Preferences (account-following) | native settings and KV | kind `pref`, id = key | Write Pro | newer wins per key; reset to default = tombstone | Pulled; the account's value wins where it has one, keys only this phone set are pushed | " | " |
| Sensors and bike-computer settings (FTP, wheel size, sensor list, page layouts) | `bikecomp` / `sensors` branches | not in master yet: one `registerSyncedPref` call per setting, kind `sensor` for the list (see "Adding a setting") | | | | | |
| Joyo AI (formerly Tanya coach) conversations | KV `joyofit.ai.chats` and `joyofit.ai.chat.<id>` (up to 30 chats of 80 messages; the earlier `joyofit.coach.chat` is moved in on first read) | **No, by design** | | | Starts empty on a new phone | Removed by "Hapus dari HP ini" (`deleteAllLocalData`); kept by "Simpan di HP"; removed by "Hapus catatan dan percakapan" | Removed with "Hapus data lama dari HP ini", kept with "Simpan terpisah" |
| Joyo AI settings: engine, provider, model per provider, custom endpoint, consent per provider (version, time, host), insight switches, daily call ceiling | KV `joyofit.ai.settings` | **No, by design**: they name the provider the person trusts and record their consent on this phone | | | Starts at the defaults (hosted engine, insights off, no consent); set up again on the new phone | Removed by "Hapus dari HP ini" (`deleteAllLocalData` calls `aiDeleteEverything`) and by the Joyo AI "delete everything" action; kept otherwise | Same as the chat history |
| Joyo AI API key (own-key engine) | Secure store `joyofit.ai.key.<provider>`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; the kv-store only holds a `keySaved` flag | **Never**: device only, never sent to JoyoRogo or the JoyoFit Worker, never in a sync record or the cloud log | | | Paste the key again on the new phone | Removed by "Hapus kunci", by "delete everything" and by "Hapus dari HP ini"; kept otherwise | Same as the chat history |
| Joyo AI notes ("Catatan coach", at most 20 x 200 characters) | KV `joyofit.ai.notes` | **No, by design**: free text about injuries and goals | | | Starts empty | Removed by "Hapus catatan dan percakapan", "delete everything" and "Hapus dari HP ini"; kept otherwise | Same as the chat history |
| Joyo AI insights (daily and Monday texts), usage counters (calls and tokens of today), cached JoyoRogo profile for the age gate | KV `joyofit.ai.insight`, `joyofit.ai.usage`, `joyofit.ai.person` | **No, by design**: generated from this phone's data with this phone's key | | | Generated again if the switch is on | Removed by "delete everything" and "Hapus dari HP ini" (insights also by "Hapus kunci" and "Hapus catatan dan percakapan"; the cached profile stays for those two because the age gate needs it, and is dropped at the next read while signed out) | Same as the chat history |
| Watch pairing (BLE keys `authkey`, `bonded`, fake MAC / android id, per-watch prefs), `device` table | Phone | **No, by design** | | | History shows; the watch must be paired on this phone. The UI says so | Kept | Kept |
| Raw RR intervals `rri_samples`, `health_metric_status` | Phone | No: one row per heartbeat, too large; the derived `hrv_readings` are synced. Status describes what this watch supports | | | | | |
| Notification toggles and permission state, background service, force BLE, sync interval, Android phone features (calls, find phone, SOS relay), alarms, fall detection, sensor alerts, watch faces | Phone / watch | No: act through this phone's permissions, SIM or the connected watch | | | | | |
| Wi-Fi only, automatic sync, update dismissals, family device id/token, Health Connect / Apple Health connection and export state | Phone | No: per phone data plan, per install, or per OS | | | | | |
| Strava link | Server (`strava_account`) | Server data | Free while slots are spare | | Re-read | | |
| Family links and alerts | JoyoFit Worker | Server data | | | Re-read | | |

### Preferences that follow the account (JoyoFit, kind `pref`)

`theme`, `locale`, `goals` (ring goals and reminders), `profile` (height, weight, birth year, sex, daily step goal), `cycle` (calendar switch and reminder switches), `weather` (unit and the city's name; the phone looks the place up again), `hrzones` (heart-rate zones: method, maximum and resting heart rate, hand-edited limits, limit alert), `sleepreport`, `healthyliving`, `sync.cycle`. A preference is synced only if it reads and writes with no watch connected, on both platforms, and says the same thing on every phone. Written through the native module without a watch they persist locally and reach the watch on the next connection. The list and each exclusion with its reason is in `src/cloud/syncInventory.ts`.

### Sign-out, sign-in, account switch (JoyoFit)

JoyoFit never deletes local data silently.

- **Sign-out** shows a dialog. Pro with everything uploaded: "Hapus data dari HP ini?" with **Hapus dari HP ini** (default) or **Simpan di HP**; the data stays in the cloud and comes back at the next sign-in. Free, or anything still pending upload: it warns that the data exists only on this phone, **default is keep** (`Simpan di HP`), the delete button says it cannot be undone. Delete = `deleteAllLocalData` after the session is closed (watch pairing and BLE keys are kept). A failed sign-out deletes nothing. A phone with no data gets the plain confirmation.
- **First sign-in of a phone that has no account yet** keeps its own data and uploads it to that account (stated once in the sign-in copy).
- **Signing in to a different account** on a phone that still holds the previous account's data pauses all cloud sync (no push, no pull) until the person chooses: **Simpan terpisah** (default; `detachLocalData`: that data is never uploaded to the new account) or **Hapus data lama dari HP ini** (`deleteAllLocalData`, then the new account's data restores); cancel signs out again. Nothing is merged into the new account silently. Limit: there is one local database per phone, so "kept apart" data stays visible next to the new account's restored data.
- **Same account again**: no dialog; sync resumes from the stored per-account cursors.

### Sign-out and account switch (JoyoRogo)

Sign-out clears the query cache and scheduled reminders, keeps device preferences (they are device settings too) and stops pref sync; there is no account-owned local data to delete (everything is on the server). A different account starts with its own server data and its own prefs.

## 4. iOS and Android differences

- **Health Connect (Android) and Apple Health (iPhone) are two different sources and are never cross-synced.** What a phone reads from its own source is imported to the server as rows tagged with that source. When two phones of one person import the same day the server keeps the larger step count and the longer sleep, and does not import a workout the other source already stored (section 2).
- JoyoFit: rows restored from the cloud are inserted with `imported = 1`. The native exporters to Health Connect and Apple Health, the family summaries and the uploader all read `imported = 0` only, so restored rows are never written back into a health platform, never re-uploaded and never raise family alerts. A watch that later reports the same minute turns the row into the phone's own data (the native upsert sets `imported = 0`) without a second row.
- Exception, decided on purpose: restored **workouts** keep the `imported` flag of the cloud copy (a watch workout stays a watch workout, so strength linking, Strava and sharing keep working). If the person has switched on the Health Connect / Apple Health export on the new phone, that exporter writes the restored watch workouts into **that phone's own** health store, never into another phone's or the other platform's. Skipping restored workouts in the exporters needs a native change (a flag column), left for the `sensors` branch.
- Android-only features (notification forwarding, calls, find my phone, SOS relay, background service) are not preferences of the account and do not sync. iOS cannot switch them on.
- Watch pairing is device-bound on both: the BLE auth key lives on the phone that paired (Keystore on Android, Keychain on iOS).
- iOS and Android store the same SQLite schema and the same JSON documents, so a record written on one reads on the other.

## 5. Cost of the new cloud data

Measured on production (2026-10-18): JoyoRogo D1 101 users, `watch_workout` 2, `strength_record` 0, `coach_doc` 1, 2.4 MB. JoyoFit D1 `joyofit`: 4 users, 10 103 `step_samples` (3 users, about 1 100 to 1 400 rows per user per day), 356 `sleep_segments`, 2.0 MB, which is about 200 bytes per step row with its index.

| Data | Volume | Estimate |
|---|---|---|
| Preferences | about 10 to 40 records per account, 0.2 to 2 KB each | under 50 KB per account |
| Routes | 5 to 30 routes; a route is at most 256 KB, typical 20 to 120 KB | 0.5 to 4 MB per account (cap 256 KB x number saved) |
| Sticker templates | 0 to 20, at most 64 KB each, typical 2 to 10 KB | under 0.2 MB |
| HRV, sleep scores | a few readings and one score per day, under 1 KB each | about 0.5 MB per account per year |
| Cycle | 1 period per month, at most 1 day record per day, under 1 KB | under 0.4 MB per account per year |
| Health metrics | 1 record per type per day, 45 bytes per sample | 1 to 12 MB per account per year (the 64 KB cap bounds one record) |
| Steps and sleep (existing, now also restorable) | 1 100 to 1 400 rows per day at about 200 bytes | about 85 MB per account per year. 100 watch-Pro accounts is about 8.5 GB after a year, about $2.6 per month beyond D1's 5 GB included ($0.75 per GB-month) |
| Restore on a new phone (90 days) | about 108 000 step rows plus sleep, 7 to 8 MB of JSON in 2 000-row pages | rows read are far below D1's 25 billion free reads per month; no R2 cost (routes and templates are inline in D1) |

New `sync_record` data is a small fraction of the steps data that is already stored. No R2 storage is added. The 50 MB quota per account bounds the new data (steps and sleep are separate tables).

## 6. Tests

- `packages/api/src/routers/sync.test.ts`: two simulated phones against the real router and the real D1 migrations (in-memory libSQL): create on A appears on B, edit on B updates A, delete is a tombstone, concurrent edits (later wins), clocks one hour behind and one day ahead, first sign-in restore across pages, sign-out wipes the phone only, another account sees nothing, a free account is `locked` and can still read, coverage rank, idempotent pushes, rejected kinds, wipe, account deletion.
- `packages/api/src/routers/rogo-prefs-sync.test.ts`, `lib/rogo-prefs.test.ts`: the JoyoRogo preference adapter against the real router, account switch, sign-out keeps device prefs.
- `packages/api/src/routers/activity-sleep-sources.test.ts`, `lib/import-dedupe.test.ts`: two health sources on one day.
- JoyoFit: `src/cloud/syncItems.test.ts`, `prefsSync.test.ts`, `contentSync.test.ts`, `healthSync.test.ts`, `recordSyncCore.test.ts`, `src/db/localData.test.ts` (two phones against `FakeSyncServer`, which follows the same rules as the real server), `server/test/restore.test.ts` (the JoyoFit Worker).
- Production check with `qa@joyorogo.com` acting as two devices through the API (see the release notes of this change).

## 7. Adding a setting

JoyoFit: call `registerSyncedPref({ key, read, write, clear })` from `src/cloud/prefsSync.ts` (put it in `src/cloud/syncInventory.ts` with its reason). `read()` returns `undefined` while the setting is at its default; `write()` must work with no watch connected. Keys are `[a-z0-9._-]`, at most 64. JoyoRogo: add the key and its sanitizer to `packages/api/src/lib/rogo-prefs.ts` and call `notePrefChanged(key, value)` from the setter. A new kind needs an entry in `SYNC_KINDS` (`packages/api/src/lib/sync-record.ts`) and a Worker deploy before apps send it.

## 8. Known limits

- Watch workouts already on a phone are not replaced when the cloud copy is re-analysed by a newer engine on another phone (the analysis is derived from the same samples).
- Steps and sleep restore is a 90-day window (older history stays in the cloud and on the original phone); `GET /v1/restore` refuses a start older than 400 days.
- Two watches paired to one account (multi-watch branch) share one per-minute key; the Worker now stores an optional `device` column for them, merging by device is that branch's work.
- Bike computer, sensor, FTP and wheel size settings live on unmerged branches and join through `registerSyncedPref`.
- Joyo AI (chat history, own-key settings, key, notes, insights) is phone-only. The hosted engine stores no messages on the server; with the own-key engine JoyoRogo never sees the key, the messages or the data digest, because the phone calls the provider directly (`docs/coach.md`, "Joyo AI (own key)"). A new phone starts with no key, no consent and no notes.
- An account that stops being Pro keeps what it uploaded and can read it on any phone; new changes stay on the phone until Pro is active again.
