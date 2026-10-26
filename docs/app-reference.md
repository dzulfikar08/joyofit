# App reference

Detail for the JoyoFit features that live on the phone: permissions, Health Connect, cloud sync, Strava, gear, imports, workout analysis, fitness metrics, sharing, social, routes and where data is stored. The overview is in the [README](../README.md); watch protocol and watch-side features are in [watch-reference.md](watch-reference.md). Strength training and the coach have their own pages: [strength.md](strength.md), [coach.md](coach.md).

## Permissions

| Permission | Why |
|---|---|
| `BLUETOOTH_CONNECT` (`BLUETOOTH` / `BLUETOOTH_ADMIN` up to API 30) | list bonded watches and open the RFCOMM or Bluetooth LE (GATT) link; no scan or location permission is needed for either, JoyoFit connects to a device you already paired |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE` | the background service (Android 14 requires the typed permission) |
| `POST_NOTIFICATIONS` | show the service notification (runtime prompt on Android 13+) |
| `RECEIVE_BOOT_COMPLETED` | restart background mode after a reboot or app update |
| `WAKE_LOCK` | keep the CPU awake while a reconnect or sync runs in the background |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | sideload APK only: the system's "allow JoyoFit to ignore battery optimization" dialog, opened from the battery notice on the Watch screen (More → Watch) or Settings → Sync, so Android does not stop the watch link with the screen off. The Google Play build does not have it and opens Android's battery optimization list instead |
| Notification access (special, granted in Android settings) | read posted notifications to forward them |
| `VIBRATE` | find my phone vibration |
| `READ_PHONE_STATE`, `READ_CALL_LOG`, `READ_CONTACTS` | show incoming calls on the watch: call state, the caller's number, the contact name (runtime prompt from Settings; only the first is required). The Google Play build has only `READ_PHONE_STATE`: the watch shows "Incoming call" without a caller |
| `ANSWER_PHONE_CALLS` | accept or reject a call from the watch (runtime prompt from Settings) |
| `android.permission.health.WRITE_STEPS`, `WRITE_DISTANCE`, `WRITE_ACTIVE_CALORIES_BURNED`, `WRITE_HEART_RATE`, `WRITE_RESTING_HEART_RATE`, `WRITE_OXYGEN_SATURATION`, `WRITE_SLEEP`, `WRITE_EXERCISE`, `WRITE_EXERCISE_ROUTE` | write the watch data to Health Connect (the last one attaches a workout's GPS route to its session) (asked from Settings through Health Connect's own dialog; write only, no read) |
| `INTERNET` | fetch the weather and search cities from Open-Meteo; sign in with JoyoRogo and upload to the JoyoFit cloud server (Settings → Health & cloud → Cloud) |
| `SEND_SMS` | send the SOS text the watch asks for, only with Settings → Safety → "Send SOS texts for the watch" switched on (runtime prompt from that switch; off by default). Not in the Google Play build, which tells the watch that no SMS was sent |
| `ACCESS_COARSE_LOCATION` | weather for the phone's position (runtime prompt from Settings → Weather; not needed in city mode) |

There is no `QUERY_ALL_PACKAGES`: the app chooser lists launcher apps through a `<queries>` entry.
Internet use: weather (Open-Meteo forecast and city search, only while weather is switched on) and, after you sign in under Settings → Health & cloud → Cloud, JoyoRogo's auth server and your JoyoFit cloud server.

## Health Connect / JoyoRogo

JoyoFit can copy what the watch records into [Health Connect](https://developer.android.com/health-and-fitness/guides/health-connect),
Android's on-device health store, so other apps can read it. It only **writes**: it never reads
Health Connect. JoyoRogo reads `ExerciseSession`, `SleepSession`, `Steps`, `Distance`
and `ActiveCaloriesBurned` (`apps/native/src/lib/health-connect.ts`), and aggregates the cumulative
ones with Health Connect's own `aggregateRecord`, which is why steps, distance and energy are
written per minute rather than as daily totals.

Turn it on in **Settings → Health & cloud → Write to Health Connect**. Android shows the Health
Connect permission dialog; allow every type (JoyoRogo needs `Steps`, `Distance`,
`ActiveCaloriesBurned`, `SleepSession` and `ExerciseSession`). Enabling it also writes everything
already in the local database once; **Write everything again** repeats that. After that every sync
is exported by native code, so the background service feeds Health Connect with the app closed.
Then, in JoyoRogo, grant it read access to the same types and sync.

| Local data (`joyofit.db`) | Health Connect record | Shape |
|---|---|---|
| `step_samples.steps` | `StepsRecord` | one per minute with steps > 0 |
| `step_samples.distance` | `DistanceRecord` | one per minute, metres |
| `step_samples.calories` | `ActiveCaloriesBurnedRecord` | one per minute, kilocalories |
| `step_samples.heart_rate` | `HeartRateRecord` | one series per hour, a sample per minute |
| `step_samples.spo2` | `OxygenSaturationRecord` | one per reading, percent |
| `step_samples.resting_heart_rate` | `RestingHeartRateRecord` | one per local day (the day's latest reading) |
| `sleep_segments` | `SleepSessionRecord` with stages | spans less than 1 h apart form one session; light/deep/REM/awake map to the matching stage, spans without a stage are "sleeping" |
| `workouts` | `ExerciseSessionRecord` | one per completed workout; the type is mapped from the Huawei sport type, distance, energy and heart rate go in the notes |

Units: Gadgetbridge stores the step frame's `distance` as metres (it logs the totals as `m`) and its
`calories` as kilocalories (its workout summaries label the same watch numbers `kcal`; a source
comment there wonders whether they could be small calories, which is unconfirmed on the Fit 4).
They are written as metres and kcal. A workout's own energy is not written a second time: the
per-minute energy already covers it, and a second record would be counted twice by readers that sum it.

Re-syncs are idempotent. Each record has the client record id `joyofit:<kind>:<time or day>` and a
client record version equal to the export time, so Health Connect replaces the earlier record
instead of adding another. Records are written with the watch as the device (Huawei, the product
model the watch reported). Switching the export off keeps what was written; delete it in Health
Connect. Types you do not allow are skipped, and the last error and counts are shown in Settings.
The export needs Health Connect: built into Android 14+, a Play Store app on Android 10 to 13.

JoyoFit also sends the energy of each watch workout straight to JoyoRogo's diary (`exercise.upsertJoyofit`, external id `watch:<start>`,
see [strength-cloud.md](strength-cloud.md)), so burned calories reach JoyoRogo even when JoyoRogo has no read access to Health Connect;
JoyoRogo's server stores a workout that arrives both ways once. Status and "Kirim sekarang": Settings → Koneksi → JoyoRogo.

JoyoFit also sends the watch's **all-day active energy** to JoyoRogo with the daily scores (`fitness.upsertScores`, field `activeKcal`,
whole kcal per day, 0..20000). It is the day's sum of the watch-recorded per-minute `step_samples.calories` (`imported = 0`, small
calories / 1000: the same data written to Health Connect as ActiveCaloriesBurned), per local (WIB) calendar day, for today and the
two days before it (`src/features/today/rogoActive.ts`, `useRogoActiveKcal`, `rogoScoreDays`), so a total that grew after the last
push is corrected. A day with no samples or a 0 total leaves the field out (JoyoRogo keeps what it stored; the server keeps the larger
of the old and new value). JoyoRogo counts it in Sisa as exercise credit (its own percentage and cap). Pure JS: no native change.

JoyoFit also sends the **hours slept** (`sleepHours`, 0..24, rounded to 0.1 h) with the daily scores: today's with the body metrics, and
each of the six days before it as an entry of its own (`rogoSleepHoursByDate`, `ROGO_SLEEP_DAYS`), the day being the night that ended on it
plus that day's naps. A night the phone read after that day's last push, and a day before this was sent at all, still reach JoyoRogo; a day
with only naps sends nothing. JoyoRogo shows the hours as that day's "Tidur" (Beranda tile, Tidur screen) unless the person logged the night by hand.
Pure JS: no native change.

## Cloud sync

Settings → Health & cloud → **Cloud sync** signs in with your **JoyoRogo account**. Steps and sleep go to a separate
Cloudflare Worker you deploy yourself ([`server/`](../server/README.md): Hono, D1, R2); workouts go to JoyoRogo and come
back onto a new phone after sign-in. The Huawei history import (below) runs on the phone and does not use the server's
`POST /v1/imports` endpoint; imported workouts are kept in the JoyoRogo cloud with the rest, imported steps and sleep
rows are never uploaded.

Uploading is a **JoyoRogo Pro** benefit. The Worker asks JoyoRogo (`fitness.cloudAccess`, with your session) and
answers `402` with `paywall: true` to accounts that are not Pro; JoyoRogo servers without a paywall (self-host)
count everyone as unlocked. Reads stay open. The app then shows that backup is part of Pro and stops uploading
(no retry loop; coming back to the app or **Sync now** asks again). The self-build links to
`joyorogo.com/pro`; the Play build shows the same text without a purchase link, as JoyoRogo's own Play build
does.

```mermaid
flowchart LR
  APP[JoyoFit app<br/>src/cloud · CloudProvider] -- "sign in (better-auth + expo)" --> JR[JoyoRogo api.joyorogo.com<br/>/api/auth]
  APP -- "POST /v1/sync · Cookie: session" --> W[JoyoFit Worker<br/>server/]
  APP -- "PUT /api/watch-workouts · rpc watchWorkout" --> JR
  W -- "GET /api/auth/get-session" --> JR
  W --> D1[(D1: step_samples, sleep_segments, device)]
  W --> R2[(R2: raw imports)]
```

- **Sign-in.** `@better-auth/expo` against JoyoRogo's server (default `https://api.joyorogo.com`, the URL JoyoRogo's
  own app uses; override with `EXPO_PUBLIC_JOYOROGO_URL` or `expo.extra.joyorogoUrl`). It opens JoyoRogo's Google
  sign-in in the browser and returns to the `joyofit://` scheme. The session cookies live in `expo-secure-store`
  (Android Keystore) and are read from JS only: **native code, including the background service, cannot use
  them, so uploads run from the JS app, not the service.** JoyoRogo must trust the `joyofit://` scheme, see
  [`server/JOYOROGO_PATCH.md`](../server/JOYOROGO_PATCH.md).
- **Server URL.** Deploy `server/` and build the app with `EXPO_PUBLIC_JOYOFIT_CLOUD_URL=https://…` (or
  `expo.extra.cloudUrl` in `app.json`). Without it the Cloud section says so and nothing is uploaded.
- **What is uploaded, and when.** Step samples, sleep segments and the device row go to the Worker. **Workouts go to
  JoyoRogo instead**, one gzip document per workout (see below), and only for Pro accounts. A sync runs 2 s after
  every sync the app sees, when the app returns to the foreground, and on **Sync now**; rows the background service
  stored while the app was closed go up at the next of those. Settings → Cloud sync shows the account, the last sync,
  the workouts in the cloud with their size, what is waiting (an estimate in MB) and the progress of a backfill.
  **Wi-Fi only** (off by default) keeps the automatic runs off mobile data; **Sync now** then asks before using it.
  **Automatic sync** (on by default) turns the automatic runs off. Both live in the app's key-value store.
- **Incremental by cursor (steps and sleep).** Migration 4 adds a `rev` column to `step_samples`, `sleep_segments` and
  `workouts` and triggers that stamp every insert or update (from JS or native) with the table's next
  `cloud_cursor.seq`. `cloud_cursor.uploaded` is the last `rev` the server accepted; an upload sends `rev > uploaded`
  in batches (2 000 samples, 500 sleep segments) and moves the cursor only after each batch succeeded. `cloud_state`
  keeps the account, the last sync time and the last error. Signing in as another JoyoRogo account resets the cursors,
  forgets `cloud_workout` and the workout pull cursor, so that account gets everything.
- **Workouts (JoyoRogo Pro).** The contract is `docs/watch-workout-cloud.md` in the joyorogo repo. Each workout, whatever
  its source (watch, FIT file, Huawei export, complete or not), is one gzip JSON document: the `workouts` row, every
  `workout_points` column (GPS, heart rate, altitude, speed, cadence, stride, power, delta coded) and the analysis the
  workout screen computes (`src/cloud/workoutDoc.ts`, `workoutAnalysis.ts`). Migration 13 adds `cloud_workout`, one row
  per uploaded or restored workout (`rev` and `engine_rev` it was built from, server `version`, `hash`, `bytes`). A
  workout is pending when it has no row, its `workouts.rev` moved, or its `engine_rev` is below `ANALYSIS_ENGINE_REV`
  (`src/features/workouts/analysis/engineRev.ts`, bumped when the analysis numbers change). `src/cloud/workoutSync.ts`
  uploads the pending ones newest first, one at a time (`PUT /api/watch-workouts/<start>` with the session cookie) and
  records each in `cloud_workout` before the next, so the backfill of an existing history resumes after any
  interruption. `402` means not Pro (stops, shows the benefit); `410` means the workout was deleted from the cloud, so it
  is deleted here; `400` counts the workout as refused (shown with the last error, retried after the next app update);
  `413 quota` stops with the server's message.
- **Restore.** Before each upload the app pulls `watchWorkout.changes` from the cursor in `cloud_state`
  (`workout_pull_cursor`). A workout the phone does not have is downloaded and inserted (`INSERT OR IGNORE` on `start`,
  never over a local row) with its points and a `cloud_workout` row, so it is not uploaded again; a tombstone deletes the
  local copy. Reading is not locked, so an account without Pro restores too.
- **Delete cloud data.** Calls `watchWorkout.wipe` and the Worker's `DELETE /v1/data`, clears `cloud_workout` and the
  cursors, and turns automatic sync off. The phone's data and the account stay.
- **Retries.** Network errors, timeouts, 408/425/429 and 5xx are retried 3 times with backoff (1 s, 2 s, 4 s,
  or the server's `Retry-After`); a failed run leaves the cursors where they were. A step or sleep row the server
  rejects as invalid (400) is isolated by halving the batch and skipped so it cannot block the rest.
- **Idempotent.** The Worker upserts steps and sleep on `(user, key)` and ignores identical rows, so replays and the 1 h
  overlap of each watch sync cost nothing. JoyoRogo keeps one document per `(user, start)` and answers `unchanged` for
  the same bytes (the gzip header carries no clock, so the same workout always compresses to the same bytes).
- **Not synced:** deletions made on the phone, the profile, alarms and settings.

## Deleting a workout

Workout screen → ⋮ → **Hapus latihan**, or a long press on a card in the Workouts list (also offered as a screen reader action). A dialog says what goes and that the activity on Strava stays; when the workout was shared to the JoyoRogo feed it asks whether the post goes too (the person's newest 200 posts are searched for `stats.startedAt`). After **Hapus** the workout leaves the list at once and a snackbar offers **Urungkan** for 5 s; only then is it deleted (`features/workouts/pendingDelete.ts`; leaving the app commits at once, another delete commits the waiting one).

- **Local.** The `workouts` row, its `workout_points`, `workout_sensor`, `cloud_workout`, `workout_gear`, `strava_gear_sent`, `ride_metrics`, `watch_kcal_sent` and `phone_kcal_sent` rows, the heart-rate minutes a phone recording wrote to `step_samples`, the e-bike mark, the replay video cache, the Coach plan link (the session is open again) and the strength record stored as it (a tombstone; strength sync tells the cloud). `strava_upload` stays on purpose, so the workout is never uploaded to Strava twice (`features/workouts/deleteCore.ts`, `deleteWorkout.ts`).
- **Never comes back.** `workout_deleted` (created from JS) keeps the start of every deleted workout. The native watch sync re-downloads everything after the newest workout it knows of, so the deleted one is written again by the next sync; `purgeDeletedWatchRows` removes that copy (only `imported = 0` rows) at start, when the app returns, after every sync and ahead of every push. The cloud pull never restores a deleted start, and a tombstone pulled from the cloud (a delete on another phone or the web) is recorded the same way.
- **Account.** What the account has to be told is stored in the tombstone and retried at every sync (and by the diary push) until it is sent: `watchWorkout.remove` (the cloud tombstone, which other phones pull and answer by deleting their copy; a phone that uploads it later gets `410`), `exercise.removeJoyofit` for `watch:<start>`, `phone:<start>` and `strength:<id>`, and `social.deletePost` for the posts the person agreed to remove. Nothing is sent while nobody is signed in or sync is paused, and a tombstone made under another account waits for that account. A workout JoyoRogo's server absorbed into a Health Connect / Apple Health row has no `joyofit` row to remove.
- **Strava** is left alone.

## Strava

Settings → **Strava** sends watch workouts to the wearer's own Strava account. It is **free while slots are spare**: no
JoyoRogo Pro for uploading, but the Strava application's 10 athlete slots are shared with JoyoRogo, 3 are reserved for
paying users (a free user connects only while more than 3 are free), and a free user idle for 14 days is released. A
user who cannot connect sees "Slot Strava penuh" (after a release "Slot dilepas untuk pengguna Pro"), no connect button,
and is pointed to 'Unggah ke Strava (manual)' on the workout page. JoyoRogo enforces the rule (docs/strava.md 2a).
It does need the JoyoRogo sign-in, because the Strava tokens are kept against that account. JoyoFit shares
its Strava API application with JoyoRogo (which reads the athlete's activities for its burned-calorie diary), and Strava
keeps one token per athlete and application, so **JoyoRogo's Worker owns the tokens** and this Worker (`server/src/strava.ts`)
asks it for them; the phone only ever receives the short-lived access token. The design and its Strava-docs reasoning
are in [`docs/strava.md`](strava.md) section 1.

- **Connect.** The **Connect with Strava** button (Strava's official artwork, `assets/strava/`) asks the Worker for the
  `oauth/mobile/authorize` URL (scope `activity:write`, plus whatever the athlete already granted JoyoRogo, so connecting
  never narrows that grant), opens it in the browser, and Strava redirects to the Worker's `/strava/callback`, which has
  JoyoRogo exchange the code and redirects to `joyofit://settings/strava`. **Disconnect** unlinks JoyoFit; the grant is
  revoked at Strava (`oauth/revoke`) only when JoyoRogo is not using it either. If the athlete removes the app on strava.com,
  Strava's deauthorization webhook (one subscription per application, it points at this Worker) is forwarded to JoyoRogo,
  which deletes the tokens of both products.
- **What is uploaded.** A FIT activity file built on the phone from `workouts`, `workout_points` and the workout's
  `summary_json` (`src/features/strava/activityFile.ts`, binary writer in `fitEncoder.ts`, no dependency): a record for
  every sample from start to end (GPS position, heart rate, altitude, and a cumulative distance that is the watch's
  total spread over the active time: the GPS path shares it out, and the stretches before the first and after the last
  fix move at the average speed, so nothing but the pause reads as stopped; the last record is exactly the watch's
  total), timer start and stop events, one lap and one session with the watch's elapsed
  time, **active time** (`total_timer_time`), distance, calories, average and maximum heart rate, elevation gain and
  loss, average and maximum speed, and, for running, walking and hiking, the step count as strides plus the average
  cadence over the active time, then a mapped FIT sport/sub-sport and `sport_type`. The file names the recording watch (`file_id` and a creator
  `device_info`: Huawei watches as manufacturer 348, the model name, the firmware) and JoyoFit as the writing software; Strava does not show
  a device line for it until Strava adds the model to its device list (docs/strava.md 3a). Records carry speed, cadence and step length where the
  stored points have them (see Workout analysis, cadence). The watch gives no list of pauses: when its elapsed time exceeds its active time by 30 s or more, the pause is written as a
  timer stop and start (`elapsed - active` long, centred on the longest gap between GPS fixes, else between samples),
  because Strava takes a run's moving time from the file's timer events and otherwise recomputes it from the distance
  stream. Strava then keeps the watch's numbers. The upload goes
  straight from the phone to `https://www.strava.com/api/v3/uploads` (`data_type=fit`, a binary multipart body) with
  `external_id = joyofit-<workout start>`, so a workout can never be created twice. Per-workout state is in
  `strava_upload` (`processing`, `done`, `failed`, `rejected`).
- **When.** Workouts that **end after the account connected** are sent after each sync; Huawei-export imports and
  history are never sent automatically. **Send to Strava** on a workout's screen sends any workout, and **View on
  Strava** links to the activity.
  On iOS the automatic pass runs while the app is in front and each time it comes back to the foreground (iOS suspends the app and
  locks the session's keychain item while the phone is locked); the connect page is an `ASWebAuthenticationSession`.
- **Description.** Off by default: **Add fit.joyorogo.com to the description** puts that text (plain, never the title)
  in the activity description.
- **Strava's API Agreement.** The only Strava data JoyoFit reads is the status of its own upload and, once the athlete allows `profile:read_all`, their list of shoes and bikes to link gear; that list is shown only to its owner, and only the linked gear's id (and its name on the phone) is kept. Nothing is used for analytics or AI; JoyoRogo's
  database holds only the athlete id and tokens on its behalf. A workout uploaded here is not imported again by JoyoRogo's Strava
  sync (its `external_id` starts with `joyofit-`); JoyoRogo gets it through Health Connect / Apple Health. Owner setup and
  the Strava review checklist: [`docs/strava.md`](strava.md).

## Gear (Settings → Gear, workout screen, free; cloud copy is a JoyoRogo Pro benefit)

Shoes, bikes and other gear with a lifetime distance and time, a retirement distance and a Strava link, like Garmin Connect's gear.

- **Gear.** Name, brand, model, optional photo (picked with `expo-image-picker`, copied into the app's files; it stays on the phone),
  the distance already done, a retire-at distance. A gear is retired by hand (it is then no longer offered or defaulted) or deleted.
- **Defaults.** Per sport: running → shoes, walking and hiking → shoes, cycling → bike (`gearSport` in `src/features/gear/model.ts`
  groups the Huawei sport types). A default applies to workouts that **start after it was set**, once, when the workout has no choice yet
  (`reconcile` runs when the gear screens open, after a sync and before an upload); changing a default never rewrites older workouts.
- **Per workout.** The workout screen has a Gear row with the choices that fit the sport (shoes for foot sports, bikes for rides, other for any), or "no gear",
  which is final (the default is not applied again).
- **Lifetime.** Starting distance plus the watch's distance of every workout done with it, and their moving time (`workouts.distance`,
  `workoutTimes`, the same figures as the workout screen). Retirement reminders: from 90 % of the retire-at distance and again at 100 %, a
  card on the gear screen and on the workout ("Sepatu kamu sudah 650 km, ..."); **Nanti saja** hides that level (`gear.notified`) until the next one, and
  changing the retire-at distance re-arms it. They are in-app on purpose: an OS notification would be a new use of the notification permission,
  which docs/ota.md keeps out of over-the-air updates.
- **Where it is stored.** Three tables in `joyofit.db` (`gear`, `gear_default`, `workout_gear`, plus `strava_gear_sent`), created by
  `ensureGearSchema` from JS at startup, **not** through `joyofit-db-migrations.json`: that file is shipped inside the native module (the
  Android asset and the OTA fingerprint), so a new entry would need a new binary, and a binary that sees `user_version` above its own list
  refuses the database. The native side never touches these tables. Fold them into the migration list at the next native build.
- **Cloud (Pro).** The Worker keeps one JSON document per JoyoRogo user (`gear_doc`, `GET`/`PUT /v1/gear`, optimistic `rev`, see
  `server/README.md`). The phone merges per record by `updatedAt` (deletions are tombstones) after each cloud sync and when gear changes; a 402
  stops the upload (reads stay open, so a free account restores gear on a new phone). The photo and the Strava gear name stay on the phone.
- **Strava.** Each gear can be linked to one of the athlete's Strava shoes or bikes; the upload then sets `gear_id` on the activity, and a later change
  of a workout's gear is sent too. Needs `profile:read_all` for the picker (a second consent) and `activity:write` for `gear_id`: [`docs/strava.md`](strava.md) 3b.
- **Share card and workout screen** show "Sepatu: Nike Pegasus 41 · 312 km": the gear's name and its lifetime distance now.

## Import from Huawei Health (Settings → Import from Huawei Health, Android, free)

A one-time import of the history Huawei Health holds in your Huawei account, so you do not start from an empty
JoyoFit after switching. It reads Huawei's own **Privacy Centre export**, on the phone, and calls no Huawei server.

1. At `privacy.consumer.huawei.com` (South-East Asia accounts: `privacy-sg.consumer.huawei.com/privacycenter`; or Huawei Health →
   Me → your account → Privacy Center) choose **Request Your Data** (the data copy), tick **Health**, set a **ZIP password**,
   and wait for the email (up to 7 days; the link works 21 days). The file is `HUAWEI_HEALTH_<timestamp>.zip`.
2. Before unbinding the watch from Huawei Health, sync it there once more (data only on the watch is lost on unbind).
3. In JoyoFit pick the ZIP (or open it from the email / Files app and choose JoyoFit), type the password (kept in memory
   only), tap **Import**. **Keep JoyoFit open until it finishes** (minutes for a large export; the screen is held on during the
   import and the screen says so). The ZIP is opened in place, never copied, and every file is streamed.

The ZIP is AES-256 encrypted with that password (WinZip AES, all members); `HuaweiExportZip.kt` reads it with zip4j.
Inside, as the Privacy Centre writes them (checked on a real export, 181 files, Nov 2020 to Oct 2026; folder names are matched
case-insensitively, the typo `SportsHealth data & desciption` is Huawei's):

| Folder | Content | JoyoFit |
| --- | --- | --- |
| `Health detail data & description/*.json` | records `{type, startTime, endTime, timeZone, samplePoints:[{key, startTime, endTime, value}]}`, times in epoch ms | table below |
| `Sport per minute merged data & description/*.json` | one record per day, per-minute `steps`, `distance`, `calorie` (small calories) | `step_samples` |
| `Motion path detail data & description/*.json` | one object per tracked workout: `subType` (sport id), `summaryData` (JSON text: totals, heart-rate figures), `detailData` (track text: GPS, heart rate, cadence, speed) | `workouts`, `workout_points` |
| `Sample sequence data & description/*.json` | records by sequence `type`; strings for numbers | 700013 sleep details → `sleep_scores`; the rest below |
| `SportsHealth data & desciption/SportsHealth-Data.xls` | 77 sheets, mostly account data; sheet `10-user sport daily statistics` has one row per day | the day totals (below), read by `HuaweiXlsReader.kt` (OLE2 + BIFF8, no library) |
| `User int run plan data`, `User route data`, `User run plan data`, `HUAWEI_HEALTH-Agreement Signing-Data`, every `Data Field Description` spreadsheet | plans, routes, consent log, documentation | not read (see "Not imported") |

`Health detail data` keys. The same reading usually comes twice under two numeric `type`s (heart rate `7` and `500023`, blood
oxygen `16` with `avgSaturation` and `400021` with `spo2`, stress `11` and `500026`, resting `7` and `500024`, weight `8` and
`10006`), so a point is recognised by its `key` plus the fields either generation uses, and the first reading per minute (or per
metric and second) wins.

| Huawei export | JoyoFit |
| --- | --- |
| `DATA_POINT_DYNAMIC_HEARTRATE`, `DYNAMIC_HEART_RATE` (`bpm`) | `step_samples.heart_rate` of that minute |
| `DATA_POINT_REST_HEARTRATE`, `DATA_POINT_NEW_REST_HEARTRATE`, `RESTING_HEART_RATE` (`restBpm`, `oldRestBpm`) | `step_samples.resting_heart_rate` |
| `BLOOD_OXYGEN_SATURATION` (`avgSaturation`, `spo2`) | `step_samples.spo2` |
| `PROFESSIONAL_SLEEP_SHALLOW`/`DEEP`/`DREAM`/`WAKE`/`NOON` | `sleep_segments` (raw kinds 0x06, 0x07, 0x5656, 0x5658, 0x5659) |
| `STRESS_DATA` (`score`), `STRESS` (`stressScore`) | `health_metrics` type `emotion` |
| `HEART_RATE_VARIABILITY` (`heartRateVariabilityRMSSD`) | `health_metrics` type `hrv` (ms) |
| `OBSTRUCTIVE_SLEEP_APNEA` (`osaLevel`) | `health_metrics` type `sleep_apnea` |
| `SKIN_TEMPERATURE`, `VASCULAR_HEALTH` (`pulseWaveVelocity`), `ARRHYTHMIA_RESULT` | `health_metrics` types `skin_temperature`, `arterial_stiffness`, `arrhythmia` |
| `WEIGHT_BODYFAT_BROAD` (and any key naming weight, body fat, body composition or BMI; `HuaweiWeightParser.kt`) | `scale_reading`: `scale_id = 'huawei-health-export'`, `weight_kg`, `impedance_ohm`, `reported` = the `ReportedBody` JSON |
| `Sport per minute`: `steps`, `distance`, `calorie` | `step_samples.steps` / `distance` / `calories` (largest value per minute; `calories` in small calories, 1/1000 kcal, like the watch's own; checked: a day's minutes sum to 110 000 for 2 829 steps) |
| `Motion path`: `summaryData` totals, `detailData` lines `tp=lbs` (GPS), `h-r` (heart rate), `s-r` (cadence), `rs` (speed, dm/s from the start), `alti` | `workouts` (`complete = 1`, calories kcal = `totalCalories` / 1000) and `workout_points` |
| `Sample sequence` type 700013 (`sleepScore`, `sleepEfficiency`) | `sleep_scores` (start / end of the record) |
| `NUTRITION_RECORD` (`dietaryEnergy` kcal, macros, `meal` slot code, `mealEatTime`) | JoyoRogo diary through `food.importHistory` (queued first, see "To JoyoRogo") |
| `DRINK_WATER` (`drinkWater` ml per drink) | JoyoRogo water log through `water.importHistory`, glasses of 250 ml per local day |
| `USER_HEIGHT`, and the `height` / `gender` / `age` a weigh-in carries | the profile, only when the phone has none (see "To JoyoRogo") |
| `SportsHealth-Data.xls` sheet 10 (`recordDay`, `timeZone`, `{steps, distance, calorie}`) | the part of each day's total the day's `step_samples` rows do not add up to, as one row from noon (`imported = 1`; an hour chart shows it at 12:00) |

Weigh-ins follow Huawei's `BroadBodyFat` description: `bodyWeight` (kg), `bodyFatRate`, `moistureRate`, `muscleMass`, `boneSalt`,
`basalMetabolism`, `visceralFatLevel`, `proteinRate`, `bodyAge`, `bmi`, `impedance`; fat and water in kilograms, skeletal and
per-limb values, scores and ratios are not `ReportedBody` fields and are dropped, a fraction (0.21) is read as a percentage, a
weight of 10 000-500 000 as grams, a weigh-in without a plausible weight (10-500 kg) is not stored. A real export had 22
weigh-ins, all weight and BMI only (from the phone's manual entry, no scale). They show in the weigh-in history of Settings > Scale
(labelled "From Huawei Health export", 40 at a time with a *Show more* button) and are sent
to JoyoRogo's weight history on their real days (see "To JoyoRogo"). A weigh-in within a minute and 0.3 kg of one already
in `scale_reading` is skipped. The first version of the import wrote its rows `skipped` without an error (not sent on purpose);
`ensureScaleSchema` turns those into `pending` whenever the database opens, so they are sent too.

**To JoyoRogo** (`src/features/huaweiimport/rogoQueue.ts`, server `docs/history-import.md` in the JoyoRogo repo). The native import never calls
the network: it writes weigh-ins into `scale_reading` (`rogo_state = 'pending'`) and meals and water days into `rogo_import_queue`
(`kind`, `key`, `payload`, `state`; created by native code and by `ensureRogoImportQueueSchema`). When an import ends, from the *Send to
JoyoRogo* button, and whenever the person signs in to JoyoRogo or the app opens or returns to the foreground signed in (`ScaleProvider`,
`pushImportedHistory`; a refusal is a line in the Log screen), JS sends what is pending, one run at a time (`syncImportedToRogo`), through `weight.importHistory`, `food.importHistory` and `water.importHistory` (batches of 100,
idempotent, past days only, never over a day or meal the person has; offline or signed out leaves the rows pending, a server answer that is
an error is kept on the rows and shown, for example the 404 of a JoyoRogo not yet updated). The Bluetooth scale's own push
(`pendingWeighIns`, `weight.checkIn`, which writes over a day) skips imported rows. Imported meals and weigh-ins are `source = "huawei"`
there and do not count toward streaks or challenge days; an old weight cannot replace a newer one because every reader takes the newest
day and an imported day is only added where there was none. Meals have no name in the export (it holds kcal and macros), so the diary
row is called "Makanan dari Huawei Health"; the slot comes from `meal` (10 breakfast, 20 lunch, 30 dinner, 11 / 21 / 31 snack, read off the
eaten times of a real export), the day from the record's own `timeZone`. The 1 500 ml entries of `DRINK_WATER` are summed like the
rest (it is not known whether Huawei writes a day's goal there). The profile is filled (`profileFromExport`) only when Settings > Profile was
never saved: height from `USER_HEIGHT`, weight of the newest weigh-in, sex from `gender`, birth year as the year of that weigh-in minus its `age`
(off by one before the birthday); without all of height, weight and birth year nothing is saved. JoyoRogo's own profile height is not
touched: its profile always has one. The iOS ZIP import (`HuaweiImportController.swift`) is a port of the first Kotlin version and has none of
this yet.

Sport ids (`subType`, the `Sport type` sheet): 3 cycling, 4 running, 5 walking, 1 stairs, 2 mountain climbing, 101 indoor
running, 102 pool swimming, 103 indoor cycling, 104 open water, 105-116 racket / ball sports, machines, yoga, pilates, aerobics,
117 free weights (strength training), 118 trail run, 281 indoor walking, 282 hiking, 287-291 diving, and 140-216 and 223 as the
watch's own ids (strength 140, HIIT 143 ...) map to the watch's table; others (a real export has id 283, which Huawei's sheet
does not list) import as an unnamed workout with the Huawei id in `summary_json`.

**Times.** Every Huawei timestamp is epoch milliseconds, so nothing is shifted: a record's `timeZone` (`+0700`) is only the
zone the phone was in, and JoyoFit shows times in the phone's zone like for watch data. The `.xls` day rows are local dates;
their day bounds use the zone in the row.

**When something shows as unreadable.** The summary's *Unreadable skipped* count has a *What was unreadable* breakdown: the
key, why (no time, no number, value out of range, impossible time span, no usable weight), how often and the first
offending value, plus which kinds of unreadable records there were and which sample keys the file has that JoyoFit does not
store (*In the file but not stored by JoyoFit*). The same lines go to logcat under the tag `HuaweiImport`
(`adb logcat -s HuaweiImport`). Only keys, reasons and counts are logged, plus the first offending value per reason.

**Not imported, with the reason** (counted per key in the summary):

| In the export | Why not |
| --- | --- |
| `EMOTION` (valence / arousal, 1 202), `EXERCISE_INTENSITY`, `ACTIVE_HOUR`, `SPORT_GOAL_ACHIEVEMENT_DATA`, `FOUR_LEAF_ACHIEVEMENT_DATA`, `PREDICTED_TIMES`, `TRAINING_RECOVERY_TIME` | Huawei's own scores, rings and predictions: JoyoFit computes its own load, recovery and goals. `emotion` in JoyoFit is the stress score, so the valence of `EMOTION` would not fit it. |
| `BASAL_METABOLISM`, `CURRENT_BASAL_METABOLISM`, `BASAL_METABOLISM_AFTER_EXERCISE` | derived values (in thousandths of a kcal); JoyoFit takes basal energy from the profile. |
| `SLEEP_RECORD`, `SLEEP_ON_OFF_BED_RECORD`, `LOW_BLOOD_OXYGEN`, `BLOOD_OXYGEN_REMIND`, `BREATH_TRAIN` | single-purpose flags and alerts with no screen in JoyoFit (the low-oxygen readings are already in the blood-oxygen series). |
| `DIET_RECORD` | an empty marker (`{"dietRecord":0}`, 123 in a real export) with nothing to import. |
| `Sample sequence` 700021 (RRI beat intervals, 2 886 one-minute windows) | the derived RMSSD of each window is imported (`hrv`); the raw intervals have no consumer. |
| `Sample sequence` ECG and arrhythmia PPG waveforms | no ECG viewer or storage. |
| `User int run plan data` (one 5-week plan), `User run plan data`, `User route data` | training plans and saved routes: JoyoFit has no plan import (its plans are its own). |
| `SportsHealth-Data.xls` sheets other than 10 (weight and goals are the account's current values, device list, medals, health trend reports) | not history; the daily statistics of sheet 9 are aggregates of data imported above. |
| `Health detail` types that are only in newer app versions (blood glucose, blood pressure, ECG ...) | none in the tested export; they would show in the *left out* list. |

How imported data is kept apart: migration `imported` adds `imported INTEGER NOT NULL DEFAULT 0` to `step_samples`,
`sleep_segments` and `workouts`; the importer inserts with `imported = 1`. `health_metrics`, `sleep_scores` and `scale_reading` have no
such column: imported rows there are added with the same insert-or-ignore rules (a watch row of the same type and second, or the
same night start, stays), they follow those tables' own sync (the cloud health sync carries `health_metrics` and
`sleep_scores`), and weigh-ins wait as `pending` for JoyoRogo until JS has sent them (`sent`) or JoyoRogo cannot take the weight (`skipped` with the reason).

- **Watch data wins.** Nothing existing is replaced. A minute the watch stored only gets heart rate, SpO2 and resting heart
  rate filled in where they are NULL; sleep segments that overlap a watch-synced one and workouts starting within two
  minutes of an existing one are skipped. The same export imported twice adds nothing.
- **No upload burst, no Health Connect, no Strava.** The cloud upload (`src/db/cloud.ts`), the Health Connect exporter
  and the Strava upload read `imported = 0` only. The watch's own sync sets `imported = 0` again on any row it writes, so
  a minute, sleep segment or workout the watch later syncs travels like a watch row. `WorkoutStore.syncStart` ignores
  imported workouts when it decides what to ask the watch for.

The format is undocumented; the first version was written from what community converters report (`NOTICE` credits them) and
then corrected against a real export (Oct 2026). That export had been imported with the first version: it read 5 521 readings
as unreadable (every `BLOOD_OXYGEN_SATURATION` record of type `400021` names its field `spo2`, not `avgSaturation`) and stored
the 103 workouts with start, end and heart-rate-less duration only (the real layout is `summaryData` / `detailData` / `subType`,
not `attribute` / `sportType`), with no distance, calories, route or heart rate. Importing the same file again with the
current version fills those workouts in (`workoutsUpdated`) and the per-minute calories of the minutes the first import stored
with 0. `HuaweiRealExportHarnessTest` (set `HUAWEI_EXPORT_DIR` to an extracted export) runs the importer over a real export on
the shipped schema, twice; it is skipped without that variable and nothing of an export is in the repository.

## Workout analysis (Workouts → a workout)

One workout opens a Strava-style analysis, computed on the phone from the stored points and summary (`src/features/workouts/analysis/`: `analyzeWorkout`,
history from `loadAnalysisHistory`; the screen is `src/app/workouts/[id].tsx`, the views are in `analysis/ui/`). The summary card shows at once and the
analysis fills in a moment later. Every figure appears once, in the place it reads best: the header card holds only the sport, the date and one row of
actions (a primary Share button plus icon buttons for Replay, Share to JoyoRogo and Save as route, and the small cloud line); the summary strip is the one
stats grid (distance, moving and elapsed time, pace, elevation, calories, heart rate with its maximum, steps, cadence, step length, power); per-kilometre and
per-sample detail lives in the charts and splits, the watch's training effect in its own section (not repeated in the load card), the heart-rate zone times
in the zones card (the burn section only adds the fat and carbohydrate grams) and the strain in the effort card. The header keeps the totals itself only
for a session that has no analysis card (a logged strength session, or an analysis that failed). Sections, each only when the data exists:

- **Summary strip and map.** Distance, time, moving time, pace or speed, elevation. A tile map of the route (OpenFreeMap vector tiles drawn with
  react-native-svg, no native module, `src/features/map/`; cached on the phone) with km markers: the smallest of every 1, 2, 5, 10, 20, 50 ... km that leaves at most 12
  on screen and none overlapping (`pickKmPills`), so zooming in brings the in-between kilometres back. The line is the recording's own: every cleaned GPS fix
  (`analyze.ts` `analyzeWorkoutWithDetail` → `route.ts` `routeDetail`, with the pills placed on it at the watch's distance), which `TileMap` simplifies per zoom
  (Douglas-Peucker at half a pixel), so a 12 h, 44k-fix ride stays sharp zoomed in at a few milliseconds per redraw. It is phone-only: the analysis' own track (what the
  cloud copy and the posts carry) stays on the 600-sample grid.
- **Scrubber charts.** Pace or speed, heart rate, elevation, cadence, step length and power on one shared time grid; touching a chart moves a dot on the map and fills a
  readout. The screen's scroll freezes while a chart is touched. The analysis' grid has at most 600 steps (the JoyoRogo schema takes 720 and 200 kB), so a ride over 2 h
  gets the phone's own finer grid for these charts and the map dot, one sample per 12 s up to 4 000 samples (12 h is 3 676; `detailGridStep` in `series.ts`), with the
  same total distance; splits, laps, zones and every other figure keep the analysis' numbers, and nothing finer is uploaded (the 157 km, 12 h fixture's document is 43 kB either way).
  A chart path keeps the first, lowest, highest and last sample of each pixel column (`thinRun` in `chartMath.ts`), so a short burst stays visible and the path stays a few hundred vertices.
- **Splits and laps.** Per kilometre (pace, heart rate, climb, cadence, and step length when the row has room) and the watch's or FIT file's laps.
- **Heart-rate zones** follow the person's setting (Settings > Zona HR: max-HR or heart-rate-reserve method, maximum and resting rate, hand-edited limits; docs/hr-zones.md), **pace zones, best efforts** (400 m, 1 km, 1 mile, 5 km, 10 km, half marathon, ranked against the same sport of the last 120 days),
  **effort** (JoyoFit workout strain), **training load** (acute against chronic, with the watch's own training effect and recovery time when it reports them)
  and **comparison** with similar earlier workouts.

Workouts without GPS (gym, jump rope, swimming) keep the heart-rate, zones, effort and load sections.

Data availability:

| Data | Watch sync | FIT import | Huawei export import |
| --- | --- | --- | --- |
| GPS track | yes | yes | yes |
| Heart-rate series | yes, sampled by the watch every few seconds | yes | yes, per sample |
| Altitude | yes, per sample | yes | yes, barometric |
| Speed, cadence, stride, power per sample | yes, for workouts synced after migration 12 | yes | cadence only |
| Laps | no: the Sections response carries per-km style blocks without timestamps (raw kept in `summary.sections`) | yes | no |
| Km splits | computed from the track | computed | computed |
| Pace blocks | yes (watch) | no | no |
| Temperature | not recorded by the watch protocol | the FIT record temperature is not imported | no |
| Swim data | summary only (laps, strokes, SWOLF) | summary | summary |
| Calories | one total from the watch (envelope); fat and carbs are an estimate by JoyoFit | yes | yes |

SQLite migration 12 adds per-sample `speed`, `cadence`, `stride` and `power` to `workout_points`. They are only filled for workouts synced or imported after
that version; older workouts show the analysis without those charts. The migration needs the new native build (the schema is shared with the native module).

**Cadence and step length ("Panjang langkah").** The summary card shows average cadence (steps per minute on foot, rpm on a bike, with the maximum) and,
for runs and walks, the average step length in metres. The chart tab "Kadens" plots the cadence series and "Panjang langkah" the step length (hidden when its series is empty). On foot a workout whose points
carry no cadence gets a real per-minute cadence from the watch's minute step samples (`step_samples`, the day view's data, passed in as `daySamples`;
`analysis/minuteCadence.ts`): only minutes wholly inside the workout, a minute outside 40 to 260 steps stays a gap, nothing is smoothed or filled, and an
average is never drawn as a flat line. The step length series is speed over steps per second per sample (pace and cadence series, same bounds as below); a
per-sample `stride` the source measured wins and is the one optional series field, `series.stride`, which travels in the cloud analysis only when measured
(`ANALYSIS_ENGINE_REV` 6). `analyzeWorkout` (`buildStats`, computed on every
open, so it also fills workouts stored earlier) takes each figure from the first source that has it:

| | Cadence | Step length |
| --- | --- | --- |
| 1 | mean of the per-sample `cadence` (zeros are gaps) | mean of the per-sample `stride` |
| 2 | the summary: a FIT import's session average (per leg on foot, so doubled), else the watch's `summary.samples.avgCadence` / `avgStepRate` | the FIT session's `avg_step_length` (`summary.avgStepLengthM`), else the watch's `samples.avgStepLength` (centimetres) |
| 3 | the watch's per-km `summary.sections[].cadence`, weighted by block length | `sections[].stepLength` the same way |
| 4 | on foot, the workout's step count over its moving time | on foot, average speed over average cadence (`speed / (cadence / 60)`) |

Estimates (3 and 4) are dropped, never clamped, outside 40 to 260 steps per minute and 0.2 to 2.5 m (`analysis/stride.ts`); a speed under 0.5 m/s gives no
step length. The sources are resolved in one place (`analysis/cadence.ts`, `cadenceFigures`), so the card, the share card, the cloud analysis and the Strava
file (`strava/cadenceFields.ts`: session and lap cadence, `avg_step_length`, per-record `step_length` where a point has one) show the same numbers.

- **Watch sync.** Cadence comes from the sample's cadence short and, on foot, from its step-rate byte when the short has no reading
  (`WorkoutBuilder.sampleCadence`); the `samples` averages leave zero readings out (averages stored before that change may include them, and are used
  only when a workout has no per-sample cadence).
- **FIT import.** FIT counts one foot, so a foot sport's cadence (+ `fractional_cadence`, session and lap fractions too) is doubled to steps per minute.
  A per-leg figure above 130 (over 260 steps per minute) is never doubled, and a file whose records carry speed, step length and cadence that agree
  with steps per minute rather than strides (20 records and a clear majority) is read as counting steps (`legFactor` in `parseFit.ts`; the summary then
  holds `cadencePerLeg: false`). A file without step lengths keeps FIT's rule. The session's `avg_step_length` is kept as `summary.avgStepLengthM`.
- **Huawei export import.** Per-sample cadence (`tp=s-r`) is kept; the export has no step length, so the card derives it, and the workout's step count
  covers a workout without samples.
- **Phone recording.** Cadence and steps come from a paired running pod, else from the phone's own step counter (docs/sensors.md); never a per-sample step
  length (derived on the card).
- **Running dynamics (watch runs and walks).** The inner part of a workout data sample (service `0x17`, `WorkoutData`, inner bitmap bits 2, 9, 13, 14, 15) carries ground
  contact time (ms), hang time (ms), vertical oscillation (`vo`, wire / 10), ground contact balance (`gtb`, wire / 100) and vertical ratio (`vr`, wire / 10); the
  sync used to parse them and drop all but the contact time. `RunDynamics` (`RunDynamics.kt`, `RunDynamics.swift`) now stores the means of the readings that exist
  under `summary.samples` (`avgGroundContactTime`, `avgVerticalOscillation`, `avgVerticalRatio`, `avgGroundContactBalance`, `avgHangTimeMs`) and a per-minute series in
  `summary.dynamics` (`start`, `stepSec: 60`, `gct`, `vo`, `vr`, `gtb`, `hang`, null for a gap). The workout screen's "Dinamika lari" card
  (`ui/RunningDynamicsSection.tsx`, `dynamics.ts`) shows the means and one line per metric with at least 3 minutes of readings, and nothing when the watch sent none.
  Phone-only in the screens: the shared (JoyoRogo) analysis, its strict server schema and the share card carry none of it; the values only travel inside `summary_json`, an opaque string to the JoyoFit sync server. Units and the side of `gtb` are read from Gadgetbridge's decoder, not checked
  against Huawei Health [INFERENCE]; impact, swing angle and eversion are averaged natively but not shown (unit unknown). Needs a build with the native change for
  everything but contact time: a workout synced before it has only the old contact-time mean (that mean may include zero readings), so its card shows that one figure.
- **Ambil ulang dari jam (runs synced before the dynamics were kept).** A run or walk the connected watch recorded whose summary has no `dynamics` series and none of the four newer
  means (`lacksDynamics`, `refetchDynamics.ts`) can ask the watch for its sample data again: `HuaweiWear.refetchWorkoutData(starts)` (Kotlin `WorkoutSync.refetchDynamics`, Swift
  port; the protocol is in `protocol/README.md`, "Reading a stored workout again") reads only the `17/0A` frames of each listed workout and merges the running form into
  `summary.samples` and `summary.dynamics`, nothing else (`RunDynamics.merge`, the row is written only when the figures differ). The workout screen shows a small notice with the
  action above the Dinamika lari card (`ui/RefetchDynamics.tsx`) only when the binary has the native function (`hasNative('refetchWorkoutData')`, so an older build hides it), the link is
  connected and idle, and the workout's `device` is the connected watch; Settings > Riwayat jam has the same for every such run ("3 dari 12" while it runs, then `3 lari diperbarui,
  5 sudah tidak ada di jam`). One workout is asked at a time, so a dropped link keeps what was merged. A workout the watch answered `no_dynamics` or `gone` for is remembered in the
  kv-store (`workouts.dynamicsRefetchSettled`) and not offered again; a `failed` one is. Only the summaries that changed move their `rev`, so the cloud upload re-sends exactly those
  workouts, and nothing triggers a full re-upload. How far back the watch keeps workouts is not known (protocol/README.md); runs it rolled off are counted as gone. Tests: Kotlin
  `WorkoutRefetchMergeTest`, `WorkoutSyncTest` (refetch cases), Swift `RunDynamicsMergeTests`, `WorkoutSyncTests` (refetch), `WorkoutStoreTests` (mergeSummary), bun `refetchDynamics.test.ts`.
- **Cloud and share.** The cloud document carries the samples (`cadence`, `stride`) and `summary_json` verbatim, so a restore recomputes the same figures; the
  shared analysis carries `stats.avgCad`, `maxCad`, `avgStrideM` and the cadence series, which JoyoRogo's web feed and fit viewer show in the summary.
- **Not recoverable.** The raw FIT file is not kept. A file imported before per-sample cadence existed has none, and one whose only step length was the
  session's `avg_step_length` lost it before it was stored (the card derives an estimate instead). A GPX file is not a workout import (the route planner
  reads GPX).

Map data © OpenStreetMap contributors, tiles by [OpenFreeMap](https://openfreemap.org); the attribution is drawn on every map.

## Fitness metrics (Today cards, Today → Kebugaran; screens in Indonesian)

Code in `src/features/fitness/`; every formula is a pure function with a unit test next to it. The watch's own value is shown first and labelled "dari jam"; when
the watch gave none, JoyoFit's estimate is shown and labelled "perkiraan". Nothing is shown with too little data: the card says what is missing. Each number has a
"Cara dihitung" accordion that repeats the formula below.

| Metric | Watch value | JoyoFit estimate (reference) | Needs |
|---|---|---|---|
| VO2max | `summary_json.vo2max` of the newest workout in 90 days (`maxMET` × 3.5 ÷ 65536, whole-number division as in Gadgetbridge's `HuaweiWorkoutGbParser`, so up to 1 ml/kg/min below the watch; values outside 10 to 90 are ignored) | Uth-Sørensen 2004: 15.3 × max HR ÷ resting HR (median of the last 14 days' daily lowest resting HR; max HR is 220 − age) | 5 days of resting HR for the estimate |
| Recovery time | largest `recoveryHours` still running among the last 7 days' workouts, counted down from each workout's end | hours from strain: 0 below strain 5, 6 h at 5, linear to 48 h at 21; today's strain counts fully, yesterday's counts down from midnight (own heuristic) | a workout with recovery, or heart rate |
| Training effect, training points | aerobic and anaerobic effect (0 to 5), points and the watch's load, as reported (workout detail) | aerobic only: 5 × (1 − e^(−TRIMP/150)) (own curve) | |
| Training status | | ACWR on TRIMP (Gabbett 2016): mean daily TRIMP of the last 7 days ÷ the last 28; above 1.5 overreaching, 1.1 to 1.5 productive, 0.8 to 1.1 maintaining, 0.5 to 0.8 recovery, below 0.5 detraining. The same ratio feeds the Readiness load signal (`fitness/trainingLoad.ts`; it used to average the saturated 0 to 21 strain instead) | 14 days with heart rate |
| Race predictions | | Riegel 1981: T2 = T1 × (D2/D1)^1.06 from the best 5K, 10K or half effort of the last 90 days' runs (`bestEffortsForHistory` of the workout analysis), the base closest to each target | 3 runs with a 5 km effort (GPS) |
| HRV status | | mean ln(RMSSD) of the last 7 nights against the mean ± 1 SD of the 60 days before them (Plews 2013, Buchheit 2014; spread floor 0.05): inside balanced, below low, above unbalanced | Android night HRV: 14 baseline nights, 3 recent; iPhone shows the "not read on iPhone yet" note |
| Intensity minutes | | Monday to Sunday: minutes in Edwards zones 2 and 3 (60 to 80 % of max HR) count 1, zones 4 and 5 count 2, fixed whatever HR zone method is set; target 150 (WHO 2020, ACSM 2018) | per-minute heart rate |
| Sleep need tonight | | `readiness.ts`: 7 h 30 min + up to 1 h from today's strain ÷ 21 + a quarter of the 7-night sleep debt (at most 1 h) | 3 nights for the debt |
| Sleep of the day | | `stats.ts` `lastSleepSession` (Today summary, readiness sleep signal, JoyoRogo `sleepPct`) and `nights.ts` `sleepByDay` (debt, trend, Sleep screen need %, JoyoRogo `sleepHours`, today's and each earlier day of the week's): night plus naps, a nap belonging to the day it ends on like the main sleep, overlaps counted once; the watch's sleep score, stages and awakenings stay on the main sleep; a day with only naps has no night for debt, trend and `sleepHours` | |
| Energi Tubuh | | 0 to 100, own model: wake level 30 + 60 × min(1, asleep ÷ need) + up to ±10 from the HRV z-score, minus 0.8 per hour awake, minus up to 55 from strain since waking, minus up to 1 per hour from stress above 40, plus 5 per hour of naps and 0.4 per hour of still minutes near resting HR; clamped | last night's sleep |

Max heart rate is `userMaxHr()` everywhere (Sleep, Today, workouts and these metrics), from the profile's birth year, or 220 − 35 without one. The watch's
`workoutLoad` and `trainingPoints` units are not verified against hardware, so they are shown as reported and never combined with TRIMP.

## Share a workout or your day (Share on a workout, share icon on Today)

A story card rendered on the phone as a 1080 px PNG (`src/features/share/`, `react-native-view-shot`): 9:16 story or 1:1 square, on a dark JoyoFit
card (with the GPS route as an SVG polyline when the workout has one), over your own photo, or as a transparent sticker. A workout card shows type,
date, distance, moving time, pace or speed, average heart rate, calories and elevation; the Today card shows steps, sleep, recovery, strain and
readiness (whatever is computed; nothing is shown as a dash). Four targets sit under the preview:

| Target | What it does |
| --- | --- |
| Instagram | Only shown when Instagram is installed (`Share.isPackageInstalled` on Android, `canOpenURL('instagram://app')` on iOS; the `instagram` and `instagram-stories` schemes and the `com.instagram.android` query come from the `react-native-share` plugin in `app.json`). With a Facebook App ID it opens Instagram's Story composer directly (sticker as `stickerImage`, route and photo cards as `backgroundImage`). Without one it hands the PNG to the Instagram app's share target, where you pick Story or post |
| Copy | PNG to the clipboard (`expo-clipboard`), toast "Copied" |
| Save | PNG to Photos / Pictures (`expo-media-library`). iOS asks for add-only access after an in-app "Continue" dialog; Android 11+ needs no permission; hidden on Android 10 |
| More | The system share sheet with the PNG and a caption |

The Facebook App ID is public and the App Secret is never used. The App ID is read from
`EXPO_PUBLIC_FB_APP_ID` at build time, else `expo.extra.facebookAppId` in `app.json`; clear both and the Instagram button uses the fallback.
What the App ID buys: Instagram opens straight in the Story editor, and the sticker lands on Instagram's sticker layer over your own photo.
Without it, on iOS the PNG goes through Photos (Instagram opens the saved image; it is flattened to JPEG, so the sticker option uses the system
share sheet instead to keep its transparency), and on Android it opens Instagram's share chooser.

## Social (Social tab, Share to JoyoRogo on a workout, free)

JoyoFit reads and writes JoyoRogo's social backend with the shared JoyoRogo account (`src/cloud/rogo.ts`, `rogo.group.*` and `rogo.social.*`; screens in
`src/app/social/`, pieces in `src/features/social/`). Nothing goes through the JoyoFit Worker.

- **Feed.** Following (you, people you follow, your groups) and Explore (public posts), kudos, comments, and the author's profile. Signed out, every screen
  shows the same JoyoRogo sign-in as Settings.
- **Report and block** (`features/social/ModerationMenu.tsx`, Google Play's rule for apps with user content). Every post (feed, profile, post screen), every comment
  and every public profile has a ⋯ button, except the person's own content and when signed out. *Laporkan* opens a sheet with JoyoRogo's four reasons (spam,
  kasar, salah_info, lainnya) and a note of at most 200 characters, and calls `social.report` with `source: 'joyofit'` (a post, a comment or, new, a member's profile
  by `userId`; 10 reports a day). The sheet then says *Terima kasih, kami tinjau*; closing it hides the content for the reporter (`moderation.ts`, the reported ids
  are kept on the phone, newest 500 of each kind). *Blokir pengguna* asks first (what is hidden, that follows are cut both ways, where to undo it), then calls
  `social.block` and hides the person at once (`moderationCore.visiblePosts` / `visibleThreads`, a profile screen closes); JoyoRogo already filters blocked people out of
  the feed, comments, replies, profiles, follow lists and kudos in both directions. *Settings, Account, Pengguna diblokir* (`app/settings/blocked.tsx`, also in
  My profile) lists `social.blockList` with *Buka blokir* (`social.unblock`). A reported top-level comment with replies stays as a placeholder so the replies keep
  their place. The admin Reports page in JoyoRogo tags these reports *JoyoFit*. Play Console answers for this: `docs/play-store.md`, section 6.
- **Groups.** Your groups, join by invite code, and per group today's Recovery, Strain, Sleep and readiness of each member who opted in. You opt in per group
  with *Share JoyoFit scores* (`group.setShareFitness`); *Share food names* is JoyoRogo's existing switch.
- **Share to JoyoRogo** (workout screen) posts the summary (sport, duration, kcal, distance, average and maximum heart rate) as a `latihan` post, visible to
  your groups or public, with the workout analysis as its detail (`detail.analysis`, at most 200 KB; thinned to a coarser series above 190 KB). The composer has switches for
  *Heart-rate data*, *Show map* (the route: off drops the map track, so the post has no map) and *Comparison with earlier workouts*, which `shareableAnalysis` applies to the full analysis before it
  is sent; turning heart rate off also removes zones, effort, load and per-split heart rate. Workouts without an analysis fall back to the older heart-rate
  series (at most 600 averaged readings) and route (at most 1000 points). Building that input is `features/social/watchPost.ts`.
- **Route map and figures on workout posts.** A post of a workout with GPS shows a route drawing under its title in the feed (`RouteMapPreview`, 2:1) and a larger
  one (4:3, with start and finish labels and a hint) on the post screen (`PostMapSection`), above the analysis. It is a plain SVG polyline on a soft grid, drawn by the
  phone from the post's `mapLine`: a Google encoded polyline (precision 5, at most 100 points) that JoyoRogo builds when the post is created, from the route with the
  first and last 200 m cut, simplified. No map tiles and no network request. `src/features/social/feedRoute.ts` is a verbatim copy of JoyoRogo's
  `packages/api/src/lib/feed-route.ts` (and `feedRoute.test.ts` of its test); change both together. `mapLine` is absent when the workout had no GPS or was too short, or
  when the post's or the account's switch hides it. The author switches one post's map on the post screen (*Show map*, `social.setPostMap`) and every map of the account
  in *My profile* (*Route map on posts*, `social.updateProfile({ shareMaps })`). Other viewers get the shared line in `social.workoutDetail`, never the full track. The
  figures row (`postStats.ts`) is distance, time (moving time when the post has it), pace per km on foot or speed for a ride, elevation gain, then energy and heart rate.
  Renders of `RouteMapPreview` (card and detail size, light and dark): `docs/screenshots/social-route-map-light.png`, `social-route-map-dark.png`.
- **Pro paywall on viewing, not sharing.** Anyone can share the detail. The author always sees their own; another viewer gets the full analysis (map, charts, splits, zones, best efforts and more) only on
  JoyoRogo Pro (`social.workoutDetail` answers `locked: true` otherwise, and the post shows a Pro card). The card's link follows the store rules of
  `proOffer`: a web link outside Google Play, the JoyoRogo Play listing on Play, text only on iOS.
- **Strava.** Imported rows (`workouts.imported = 1`: Huawei export or a FIT file, whose origin the app cannot tell, possibly a Strava download) are never
  offered for sharing, like they stay out of the cloud upload. JoyoFit never reads Strava data, so a watch workout carries none.

## Import a FIT file (Settings → Import a FIT file, Workouts → Import a FIT file, free)

A ride or run recorded by a bike computer or sports watch (iGPSPORT first; Garmin, Wahoo, Bryton, Magene, XOSS and
anything else that writes a standard FIT activity) becomes a full workout: route, heart rate, speed or pace, ascent,
calories, power and cadence. It is JS only (`src/features/fitimport/`): Garmin's `@garmin/fitsdk` decoder reads the file on the
phone, no server is called.

Ways in: the **Choose a .fit file** button (Settings, or on the Workouts tab); on Android also **Open with JoyoFit** from a
file manager and **Share to JoyoFit** from the bike computer's app (intent filters for `content://` VIEW with
`application/vnd.ant.fit` or `application/octet-stream` and a `*.fit` name, and SEND, in `app.json`; the config plugin
`plugins/with-shared-fit.js` turns a shared file into a view intent so Expo Router gets it as a URL, and
`src/app/+native-intent.ts` sends that URL to the import screen). Registering SEND for `application/octet-stream` means
JoyoFit also shows up when you share other binary files; the import then says it is not a FIT file. On iOS the same URL
arrives through the `CFBundleDocumentTypes` entry for `.fit` in `app.json` (not tried on a device yet).

| FIT | JoyoFit |
| --- | --- |
| `file_id.type` must be `activity`, `file_id.manufacturer` names the workout (`Ride (iGPSPORT)`; unknown brands give `Ride`) | `workouts.sport_name` |
| `session` (several, as some head units write after a pause, are added up): start, `total_elapsed_time`, `total_timer_time`, distance, calories, avg/max heart rate, ascent | `workouts.start`, `end`, `duration` (active seconds), `distance`, `calories`, `avg_hr`, `max_hr`, `summary_json` |
| `session.sport` / `sub_sport` | `sport_type`: cycling 3, indoor cycling or virtual 7, running 1, trail run 11, treadmill 5, walking 2, indoor walking 13, hiking 14, anything else 255 (Exercise) |
| avg/max speed, ascent/descent, altitude range, avg/max cadence (per leg on foot), `avg_step_length` (mm), avg/max/normalized power | `summary_json` (`avgCadence`, `maxCadence`, `avgStepLengthM`, ...) |
| `record`: time, position (semicircles to degrees), altitude, heart rate, speed, cadence (+ `fractional_cadence`, doubled to steps per minute on foot), `step_length` (mm), power | `workout_points` (`ts`, `lat`, `lon`, `alt`, `hr`, `speed`, `cadence`, `stride`, `power`) |
| `record.heart_rate`, averaged per minute | `step_samples.heart_rate`, `imported = 1`: Strain, Readiness and Trends read the per-minute heart rate, not `workouts` |

Same rules as the Huawei import: the row has `imported = 1`, so the cloud upload, Health Connect / Apple Health and the
automatic Strava upload skip it (the per-workout **Send to Strava** button stays the user's choice). The same file again adds
nothing (same start). A file whose time overlaps a stored workout by more than half of the file's own span is skipped with a
message and the stored one, the watch's, is kept; a minute already in `step_samples` is never touched. Errors shown: not a
FIT file, damaged (checksum), not an activity file, no session, already imported, watch already recorded it. Tests:
`src/features/fitimport/` (files built with `src/features/strava/fitEncoder.ts` and Garmin's encoder, the real schema in memory).
The importer has not been run on a real iGPSPORT file yet.

## Routes for the watch (More → Watch → Rute, `/routes`; screens in Indonesian)

Plan or import a route, send it to the watch with **Kirim ke jam**, then start it on the watch (Olahraga → outdoor run, ride or
walk → settings → Rute → the route → navigasi olahraga). The watch shows the line and your position; no turn-by-turn
instructions are sent. The P2P push is native (`modules/huawei-wear`, `HuaweiWear.getRoutes()` / `pushRoute()`, see
`protocol/README.md`); everything else is JS in `src/features/routes/`, with every user-facing string in `copy.ts`.

- **Storage.** Files, not SQLite: `Paths.document/routes/<id>.json` (facts and a thumbnail) and `<id>.pts.json` (points, at most
  5000 after Douglas-Peucker simplification). `routeStore.ts` has the calls, `routeStorage.ts` the pure part.
- **Ways to add a route.** Impor GPX/TCX (system file picker, or **Open with** / **Share to JoyoFit**: `app.json` has VIEW and
  SEND filters for `application/gpx+xml`, `application/vnd.garmin.tcx+xml`, `application/xml`, `text/xml`, octet-stream with a
  `.gpx`/`.tcx` name; iOS declares `com.joyodigitama.joyofit.gpx` and `.tcx`; `src/features/sharedfile/` classifies by name,
  MIME type or the first 1 KB), Gambar di peta (`src/features/routes/map/`, OpenFreeMap tiles, FOSSGIS OSRM, Open-Meteo
  elevation), Dari latihan (GPS rows of a stored workout; also a button on the workout screen).
  Loop baru dari rumah (`src/features/loops/`, [loops.md](loops.md)): a round trip (solid outlined line with arrows) of a chosen number of steps, kilometres,
  minutes or kcal from the phone's position or a saved Home point, on streets the person has not walked.
- **Parsers.** `gpx.ts` (track, else `rte`), `tcx.ts` (course, else activity), on a small tolerant scanner (`xml.ts`, no
  dependency, no DTD, namespaces and CDATA handled). Points without a position or at 0,0 and consecutive repeats are dropped; fewer
  than 2 points is an error. Fixtures: `routeFixtures.ts` (Strava, Garmin Connect with extensions, planned route, TCX course and activity).
- **Sending.** `useRoutePush.ts`: at most 3000 points to the bridge, `hasAltitude` only when every point has one, name cut to
  100 UTF-8 bytes, progress from `onUploadProgress`. A route with the same name already on the watch is not sent again
  (`alreadyOnWatch`): the screen offers to rename and send again. Error codes are mapped in `pushOutcome.ts`.
- **Limits.** Only watches that list route support (`getRoutes().deliver`) take routes; the watch simplifies long routes to a few
  hundred points. Not verified on a watch yet. Tests: `src/features/routes/*.test.ts`, `src/features/sharedfile/`.

## Watch faces from the web (Watch → Tampilan jam → Koleksi → "Dari web", Android, free to read)

The Koleksi tab of the watch faces screen has a "Dari web" section with the watch faces the account uploaded at `app.fit.joyorogo.com` (the web upload is a JoyoRogo Pro benefit; reading the list is open to any signed-in account, so the app gates nothing).

- List: `GET /v1/watchfaces` with the session `Cookie` (`cloudRequest`, so the usual retry rules apply) -> `{ watchfaces: [{ id, name, filename, size, sha256, createdAt }] }`, shown newest first with size and date.
- Install: `GET /v1/watchfaces/:id/file` with the same `Cookie` is downloaded into the cache (`File.downloadFileAsync`), then goes through the same step as a picked `.hwt` (`useWatchfaceImport.importPackage`: extension check, native package parse, save to the phone library with the usual same-title replace, then the install prompt and BLE install with its progress and errors).
- States: cloud not set up in the build (explanation), signed out (link to Settings → Akun), loading, error with "Coba lagi", empty (tells to upload at `app.fit.joyorogo.com`), list. A face whose name already matches a face on the watch shows "Terpasang" and is disabled; without a connected watch the buttons are disabled with "Sambungkan jam untuk memasang". The section is hidden where the picker import is unavailable (iOS, old native build).
- Logic without UI: `src/features/watchfaces/webLibraryModel.ts`; the requests: `src/cloud/webWatchfaces.ts`. JS-only.

## Themes and fonts (Settings → Appearance & language → Theme)

Seventeen themes, in `src/theme/themes.ts` (pure data, tested in `themes.test.ts`): Classic, Sport, Ocean (the first three) and AMOLED, Neon, Sunset, Sogan, Retro, Forest, Soft, Mono, then the pastel set Sakura, Lavender, Peach, Rose Gold, Strawberry Milk and Matcha Latte. Each has a light and a dark palette (or one pinned palette: Sport, AMOLED, Neon, Sunset and Rose Gold are always dark, Retro, Peach, Strawberry Milk and Matcha Latte always light; the rest follow the phone), its own radii (card, tile, input, control and the floating tab bar `bar`), a numeral scale and a font pair. `themes.test.ts` runs the contrast rules on every palette of every theme automatically (every `*Text` on its tint and on card >= 4.5, data colors >= 3 on card, hero text >= 4.5 on `hero` **and** on `heroEnd`, body text >= 7), so a new theme only has to be added to `THEMES`.

- **Fonts.** A theme names six roles: `regular`, `medium`, `bold`, `heavy` (the body weights), `numeral` (the face of the big numbers, which must have tabular figures: Fraunces, Quicksand, DM Serif Display and Oswald have none and are not used for numbers) and `headline` (page titles). Families: Plus Jakarta Sans (Classic, Ocean, Sport and Lavender body), Manrope (AMOLED, Sunset, Sogan, Rose Gold), Nunito (Soft, Forest, Peach and Strawberry Milk body; Sakura numerals), Archivo (Retro, Forest and Peach numerals), Space Grotesk (Neon, Mono, Ocean, Sunset and Matcha numerals), Bebas Neue (Sport), JetBrains Mono (Neon, Mono numerals), Fraunces (Sogan, Forest titles), Quicksand (Sakura and Matcha body; Lavender, Strawberry Milk and Matcha titles), DM Serif Display (Sakura, Peach and Rose Gold titles; one weight). All are SIL OFL fonts; the 23 files that are not Plus Jakarta are in `assets/fonts` (only the weights a theme uses, about 2.3 MB; licenses in `assets/fonts/licenses`) and are registered at runtime by `expo-font` in `src/theme/fonts.ts`, never by the config plugin, so adding or changing a theme or font is an OTA update. A launch registers only the active theme's four to six families (`themeFontMap` into the root `useFonts`); the picker registers the rest when it opens (`loadAllThemeFonts`) to draw each preview in its own face. `AppText` (`display`, `figure`, `title`), `Metric` and the bike-computer figures read `fonts.numeral` / `fonts.headline`; tabular figures (`fontVariant`) are on wherever numbers change.
- **Applying a theme.** Picking one asks "Terapkan tema …? Aplikasi akan dimuat ulang", then `ThemeProvider.applyThemeAndRestart` writes the kv-store key `app_theme`, stamps the synced preference (`notePrefChanged('theme')`) and restarts the JS app (`src/theme/restart.ts`: `Updates.reloadAsync()` in release builds, `DevSettings.reload()` where updates are disabled). The provider reads the stored choice synchronously before its first render and pins or releases the phone's scheme in the same step, and the root layout sets the root view color before the splash is hidden, so the restarted app draws its first frame in the new theme. A theme pulled from the account is the one case shown live (its fonts are registered first); the next launch starts clean in it.
- **Why a restart.** Everything that holds a theme's values (navigator options, native header configs, `StyleSheet`s, the system bars) would have to be told about a live switch, and one that is missed keeps the old look. Two causes were found: expo-router mounts the navigation container with React Navigation's stock light theme and never reads ours (`src/theme/NavigationTheme.tsx` now provides the palette and fonts to every navigator), and on Android the system navigation bar's light/dark appearance (the scrim and the button color of the 3-button bar) is set once, when the activity is created, from the phone's night mode (React Native's `enableEdgeToEdge`); the activity declares `uiMode` in `configChanges`, so a runtime scheme change never re-applies it. No JavaScript API in this build can set it (that needs `expo-navigation-bar` or a small native module, which changes the fingerprint), so a pinned theme on a phone set to the opposite scheme can show a nav bar of the other kind until a native build ships.
- **Hero gradient.** `Colors.heroEnd` equals `hero` except in Sunset and Rose Gold, where the big hero panels (Today watch panel, watch status card, live recording card, strength summary) draw a `hero` to `heroEnd` gradient (`src/components/HeroGradient.tsx`, react-native-svg). Small `hero` surfaces (toasts, pills, banners) stay flat.
- **Header decorations.** A theme may name a `decoration` (`DecorationId`): Sogan a kawung batik (a lattice of circles overlapping in pairs, turned 45 degrees: outlined lenses, filled seeds with a gold dot), Sakura cherry blossoms and loose petals, Forest a leafy branch, Neon the bend of a running track. The geometry is drawn in `src/theme/decorations.ts` (pure, tested in `decorations.test.ts`: plain circles, arcs and bezier curves, merged into a few dozen SVG paths by tone and opacity step), rendered by `src/components/ThemeDecoration.tsx` (react-native-svg). `Screen` draws it with `decorated` (the three Today variants) as the first child of the scroll content: it sits in the top-right corner of the content, 232 by 168 dp, behind the title, caption and share button, scrolls away with the header, fades toward the left and the bottom (each piece's opacity falls with its distance from the corner) and is covered by the hero panel, so no text sits on it. It is static, with no animation, so reduced motion needs no special case; dark palettes draw it at 0.8 strength. The picker previews draw it in a 120 by 64 corner of each miniature, behind a mini page header.
- **Titik.** Black and off-white (light and dark follow the phone), greys for everything and one red (`primary`, heart, awake stage) for what is live. Figures and titles are Doto 900 (OFL, monospaced at 0.6 em, so it has tabular digits; its dots need size, so the smallest numeral is 20), body is Space Grotesk. Two theme flags: `outlined` (`Card`, `groupedRowStyle` and `StatTile` draw a hairline border around a canvas-colored fill; other card-like surfaces keep the fill only, which is a shade off the canvas) and `dottedRings` (`Ring` draws a ring of dots: the track as dots, the progress as a solid arc masked by the same dot pattern, so it still animates and is static under reduced motion; it lights whole dots only, at least one for any progress and all of them only at the goal, `components/ringMath.ts`). Doto is as wide as its character count, so `Metric` shrinks a figure to the room it has (`fit` for the ring centre, `numeralFit.ts`; `adjustsFontSizeToFit` for the rest): 100,000 steps stay inside the hero ring and the tiles. The `dots` decoration is a grey dot grid in the Today header. Bar charts and the sleep, strain and route graphics stay thin solid. `docs/screenshots/titik-preview.png` is an HTML render of the theme data (not an app screenshot).
- **Preview.** `docs/screenshots/themes-preview.png` is a render of the theme data (palette, radii, font pair, hero panel, tab bar) for every theme and scheme, not a screenshot of the app.

## Tab bar

Four tabs and a centre button, in this order: **Hari ini** (Today), **Latihan** (Workouts), the raised **Mulai latihan** button, **Sosial** (Social) and **Lainnya** (More; English: Today, Workouts, Start workout, Social, More). They are drawn by our own `FloatingTabBar` (`src/components/FloatingTabBar.tsx`), wrapped in `TabBarWithLive` (`src/app/_layout.tsx`, which puts `LivePill` above it): a rounded pill (`colors.card`, 1 px `colors.hairline`, corner `radius.bar`, one restrained shadow / elevation 6) inset 16 dp from the screen edges and lifted 8 dp above the bottom inset. The active tab shows a `colors.muted` background (radius concentric with the bar) and `colors.primary` tint; it fades in within 140 ms (instant under reduced motion) and an item scales to 0.96 while pressed. The pill is absolutely positioned over the screens (no band behind it): content scrolls behind and below it to the bottom of the screen. `TabBarWithLive` measures what it covers (centre button rise, pill, gap below, bottom inset and the live pill when shown; 0 where the bar is hidden) and publishes it through `TabBarInsetProvider` (`src/components/tabBarInset.tsx`); `useContentPadding` and `Screen` (and `footer`) add `useTabBarInset()` to the end of the content, and any other bottom-pinned element of a tab screen must do the same. Never add `insets.bottom` to a screen under the bar. `src/components/tabBarMetrics.ts` sizes everything from what is drawn: 5 dp item padding, 28 dp icon box, a fixed 16 dp label line scaled by the system font size (capped at 1.3), 6 dp pill padding and 1 dp border. Footprint = 20 (`CENTER_RAISE`, the centre button's rise above the pill) + pill height + 8 (gap below) + `insets.bottom` (`floatingTabBarFootprint`; hook `useFloatingTabBarFootprint`, used by `DeleteSnackbar` and `Toast` to sit above the bar). A label that is still too wide for its item shrinks to at most 70 % rather than ending in an ellipsis. The bar is not drawn while the focused route sets `tabBarStyle: { display: 'none' }` (static for `onboarding` and `workout-live`; `useHideTabBar` in `src/components/navigation.ts` for the loop planner and the bike computer ride view) and, on Android, while the keyboard is open. Tests: `src/components/tabBarMetrics.test.ts`, `src/components/tabBarRoutes.test.ts`.

**Where the bar shows.** Only on the roots of the four tabs: Today (`/`), the Workouts list (`/workouts`), the Social feed (`/social`) and the More list (`/settings`). Anything pushed on a tab's stack (workout, post, group and challenge details, comments, exercise and strength screens, sleep/heart/day screens, every settings page, the Watch hub and its pages, Rute, Family, Coach) is a detail screen without the bar, which comes back with the back gesture/button. `TabBarWithLive` decides centrally with `isTabRoot(tab, focusedChild)` (`src/components/tabBarRoutes.ts`; `focusedChild` from `getFocusedRouteNameFromRoute`): the focused tab must be `index`, `workouts`, `social` or `settings` and its stack must be on `index`. The hidden tabs (`watch`, `routes`, `family`, `coach`, `strength`, `sleep`, ...) never show it. While it is hidden the published inset (`useTabBarInset`, so `useContentPadding` and `Screen`) is 0 and `useFloatingTabBarFootprint` (toast, delete snackbar) is just the safe-area bottom inset; the screens keep their safe-area bottom padding. The per-screen `useHideTabBar` is still how a root-level screen (the live record screen, Loop) hides it.

**Centre button.** A 56 dp circle in `colors.primary` with a play glyph in `colors.primaryForeground`, inside a 4 dp ring in the pill's colour that notches the pill, raised 20 dp above it (the one element with the stronger shadow, elevation 10). The pill reserves a 72 dp slot between the two halves of the tabs. It is not a tab: a tap opens the one "Mulai latihan" sheet (`StartWorkoutSheet`: record on the phone, strength logger, workout by hand, FIT file, Loop) over whatever screen is showing, through `useStartWorkout()` from `StartWorkoutProvider` (`src/features/workouts/StartWorkoutProvider.tsx`, mounted above the tab navigator; it owns the sheet, the FIT file picker and its error dialog). The Workouts list has no start button of its own. Its accessibility label is `nav.start`. The button lives in the strip above the pill, not inside it: Android only delivers touches inside a parent's bounds, so the raised half has to lie inside the absolutely positioned strip, whose top padding is the rise (same approach as JoyoRogo's camera button). There is no long-press action (JoyoFit stores no last-used sport to start).

**More (`settings` route).** The fourth tab is the Settings stack, so `/settings` and every `/settings/*` link are unchanged. Its index lists the account row first, then **Target & tubuh** (Goals & body, with **Zona HR**), then one **Jam** (Watch) row whose subtitle is the watch's name and link state ("Seiya-B29F · Terhubung", or "Belum ada jam") and which opens the Watch hub (the connected-watch card, faces, photo face, alarms, Rute and the other watch pages live there; More shows no watch card), then **Pengaturan jam** (sync, notifications, weather, safety, meals) and the other settings groups. The Watch hub (`/watch`, `/watch/*`) is a hidden tab route reached from there; it, Rute (`/routes`), Family and the Today cards editor are detail screens without the bar, and the tabs navigator uses `backBehavior="history"` so back returns to where the screen was opened from. The old Watch tab had no badge or dot, so none moved. In the docs below, "Settings → X" means More → X.

## Deep links (`joyofit://`)

Every URL that opens the app goes through `src/app/+native-intent.ts` before Expo Router matches it. `src/features/deeplink/mapDeepLink.ts` normalises `joyofit:` links only (https links, the dev client launcher and `content://`/`file://` files are handled elsewhere or left alone):

- `joyofit://strength` (host form), `joyofit:///strength` (path form) and a trailing slash all open `/strength`. In the host form "strength" is the URL host, not a path; the router handles both.
- `joyofit://?open=strength` opens `/strength` too. JoyoRogo uses this form: a JoyoFit bundle that has no `/strength` yet (an install that has not applied its over-the-air update, which takes the second launch) shows Today for it, while `joyofit://strength` there is the router's "Unmatched Route" page, and because that open succeeds JoyoRogo never falls back to the plain `joyofit://` link.
- A link no screen answers to (checked against the route files in the bundle, read from the router's own file list) opens Today, query dropped. In-app navigation to a missing route is not a system URL, so it still ends in `src/app/+not-found.tsx` ("Halaman tidak ditemukan" with a button home).

Tests: `src/features/deeplink/` run the real Expo Router URL parsing and matcher over the route files, with Bun's `URL` and the phone's (`whatwg-url-minimum`).

## A damaged database ("database disk image is malformed")

**Why it happens.** `joyofit.db` is opened by two SQLite engines in one process: expo-sqlite's own build (3.50, JS side) and Android's `android.database.sqlite` (the framework's SQLite, 3.3x on Android 12, the native sync writer). SQLite's own list of ways to corrupt a database names this case ([howtocorrupt, 2.3](https://www.sqlite.org/howtocorrupt.html)): each copy keeps its own table of open files, so a `close()` in one cancels the POSIX locks the other holds on the same file, and both can then write the WAL or checkpoint at once. Nothing else in the code touches the file (no `deleteDatabase`, no file copy, no VACUUM, `allowBackup` is off, there is no restore flow). It cannot be proven from a damaged file we do not have; it is the one cause the architecture permits. A second hazard sat next to it: the framework's default `DatabaseErrorHandler` deletes the file (and its WAL) when the native connection meets corruption, under the JS connection that still holds it (`DefaultDatabaseErrorHandler` in AOSP); `SyncStore.kt` now passes a handler that only records it.

**What the app does** (`src/db/recovery/`, JS only, no native call needed):

- *Detect.* Any rejection that says the file is corrupt (`isCorruptionError`: "database disk image is malformed", "file is not a database", `SQLITE_CORRUPT`, also inside native "Caused by" text) from a query on the app's handle (`serialize.ts`), from the native sync (`WatchProvider` `runSync`), or while the database opens starts the repair. `errorMessage()` never shows SQLite's words for it.
- *Open.* `DatabaseGate` builds the schema on a connection of its own before `SQLiteProvider` opens the app's handle (the provider keeps a failed open for good, so it cannot retry), repairs once when that says corrupt, builds again, and otherwise shows a retry screen.
- *Repair* (`recover.ts`, tested on real damaged files): `PRAGMA integrity_check`; a copy of the file and its WAL to `joyofit.db.corrupt-<ms>` (the repair stops if that copy fails); `REINDEX` when only rows and indexes disagree; `VACUUM INTO`; row salvage into a new database built by `buildAppSchema` (damaged leaves are skipped by an exponential then binary search over rowids, indexes and triggers are rebuilt, trigger-kept `rev` counters are copied as they were); an empty schema when nothing reads. The result goes over the damaged file *in place* with SQLite's online backup, which works under the open connections of both engines (a rename would leave them writing into the old file). Only when that fails and nothing has the file open is it swapped by files, otherwise at the next start (`applyPendingSwap`). The app's own queries wait while it runs (`gate.ts`, 60 s at most).
- *After a loss* the pull cursors of the workouts, health records, step/sleep restore and strength sync are cleared, so the next sync starts from the beginning and the cloud gives back what was not readable; the watch refills `step_samples` and the rest from `device.last_sync` on its next sync. Phone-only data that never reached the cloud (and a lost pairing) is only in the kept `.corrupt-<ms>` file.
- *Tell.* `DbHealthNotice` (id/en, `common:dbRecovery`) says what was saved, what comes back and that the old file is kept; a failed repair offers another try. FIT import repairs and retries the same file once.

Tests: `src/db/recovery/*.test.ts`.

## Where data lives

`joyofit.db` in `<app files>/SQLite` is shared by the screens (expo-sqlite, read) and the native
module (`android.database.sqlite`, write, WAL with a 10 s busy timeout). The schema is one JSON file,
`modules/huawei-wear/schema/joyofit-db-migrations.json`, imported by `src/db/migrations.ts` and shipped
as an Android asset that the native side migrates from, so JS and native cannot drift. Native
upserts the same rows the JS queries used to, and advances `device.last_sync` in the same transaction.
The profile, background and notification settings are in native SharedPreferences (`joyofit_settings`).

Workouts are two more tables from migration 3: `workouts` (one row per session: watch workout number,
start/end, Huawei sport type and GB's name for it, duration, distance, calories, average/max heart
rate, steps, `summary_json` with everything else, `complete`) and `workout_points` (`workout_id`, `ts`,
`lat`, `lon`, `alt`, `hr`; from migration 12 also `speed`, `cadence`, `stride`, `power`). GPS points have lat/lon, heart-rate samples have `hr`; a point has only
what its source had. A workout is replaced as a whole in one transaction, keyed by `start`.

The cycle log is two tables from the cycle migration: `cycle_periods` (`start` and `end` as local `YYYY-MM-DD`, `end` NULL while a period is going on, `modified`
unix seconds) and `cycle_days` (one row per day with `flow` and `cramps` 0 to 3). It never leaves the phone: it is not part of the cloud upload or Health Connect.
The switches of fall detection, the SOS relay, the sleep report and the cycle calendar are in `joyofit_watch_extras` SharedPreferences.

The P2P health metrics are two tables from the `health_metrics` migration: `health_metrics` (`type`, `ts` and `last_ts` in unix seconds, `value` = the number a chart plots or NULL,
`values_json` with every field; one row per dictionary entry, keyed by `(type, ts)`) and `health_metric_status` (per metric: the ExpandCapability gate in words, whether the watch
supports it, the last check / sync, rows stored, a note). Neither is part of the cloud upload yet. Healthy Living and course switches are in `joyofit_p2p` SharedPreferences.

The DataSync features keep their state in `diet_day` (the latest day: `date`, `meals_json`, `goals_json`, `updated_at`, `pushed_at`) and `body_metrics` (key / value: weight, body fat, resting
metabolism, blood pressure, each with its time), both from the `diet_day` migration, so the background service can answer the watch with JS closed. Ring goals and reminders are in
`joyofit_goals` SharedPreferences, the push status in `joyofit_diet`. None of it is part of the cloud upload.

**Forget pairing** deletes the stored auth key. The next connect then does a fresh bind.

