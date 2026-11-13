# Huawei Health Service Kit (Health Kit): can JoyoFit read Huawei Health directly?

Research 2026-11-13, so users could sync from Huawei Health without the Privacy Centre ZIP (`docs/huawei-web-import.md`).
Not to be confused with Wear Engine (approved 2026-11-13, `docs/watch-app.md` step 9), which only carries JoyoFit ↔ JoyoNavi
messages and gives no health data.

## Verdict

Our **Individual** developer account can apply, but only for **basic** data:

| Basic (open to individuals) | Advanced (closed to individuals) |
|---|---|
| steps, calories, distance, altitude, active hours, daily activity summary; workout summaries; workout detail (heart rate, speed, cadence, altitude, running form, power); workout location (GPS, cloud API only); history up to 1 year | height, weight, heart rate outside workouts (dynamic, resting, HRV), stress, sleep, SpO2, blood glucose/pressure, body temperature, VO2max, sleep breathing |

[Qualifications](https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/application-qualification-description-0000001425636570)
(updated 2026-06-18): "The app should have been released on AppGallery. Otherwise, Health Service Kit data will not be open to the
app. [...] User data with the advanced openness level is currently not open to individual developers." Companies outside Europe,
Japan and mainland China need paid-up capital ≥ CNY 500,000 (basic) or ≥ CNY 5 million (advanced) and > 1 year of existence.
Data types and levels: [Open Data Overview](https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/data_description-0000001467889369).

## Access path: cloud REST API

- Android SDK: needs HMS Core ≥ 4.0.2.300 and Huawei Health ≥ 11.0.0.512 on the phone, so no Xiaomi-without-HMS, no iPhone.
- **Cloud REST API with HUAWEI ID OAuth**: any phone, iPhone or the web; the user signs in with the HUAWEI ID they use in Huawei
  Health. Only the cloud API gives workout GPS. Data lags minutes to hours. Cross-region requests answer 403 / 121001 with the right
  domain in a header. History: from authorisation onward, or up to 1 year back with the history scope.

## Prerequisites and process

1. **JoyoFit (phone app) released on AppGallery.** Submitted 2026-11-13: version 1.1 (versionCode 1507935, the sideload APK from
   `release-android.yml` run 43364186260, signed with the upload key), all regions except the Chinese mainland, rating 12+. AppGallery's
   payment rule 6.4 only recommends HUAWEI IAP, so the sideload build's web link for Pro stays.
2. HUAWEI ID service approved (applied 2026-11-06, status Submitted).
3. Console > Health Service Kit: agreement, data scopes, "Application Material (for Individual Developers).xlsx". Manual review of
   the test scopes about 10 workdays; test scopes serve only the first 100 users.
4. "Get verified" (expert review, about 15 workdays): release checklist, screen videos including where the privacy statement opens.
   Lifts the 100-user cap. Each rejection costs about the same again.

Common rejections: the privacy policy must list which Huawei Health data is read and why, with developer and app names exactly as on
the developer site; "Huawei Health" / "Huawei watch" may not appear as text at the entry point or in prompts; requested scopes must
match what the app uses.

## Terms

[Health Kit Service Agreement](https://developer.huawei.com/consumer/en/doc/distribution/app/70941808): no advertising, no sale or
sharing with any agency or individual, only purposes the user consented to, encrypted storage, minimum retention, no medical use.
Our reading (not legal advice): encrypted storage on our server, Joyo AI coaching and merging with watch data fit if the privacy
policy says so and the user consents; sending the data to a third-party AI processor needs a closer look at "shared with any agency".

## What it would mean for JoyoFit

Health Kit would replace the ZIP for **workouts (with GPS and workout heart rate) and steps** only. Sleep, all-day heart rate, SpO2,
stress and weight stay on the ZIP import. Realistic lead time: AppGallery release of JoyoFit, then about 6 weeks of Huawei review.

## Sync from the cloud API (lab, built 2026-11-13)

Built behind a lab switch and **not usable until Huawei approves the Health Kit application** (no client credentials yet). It
reads **workouts (summary, GPS track, workout heart rate, speed, cadence, altitude) and steps** from the user's Huawei Health
account, with HUAWEI ID OAuth in the browser, so it works on any phone (iPhone, Android without HMS). No HMS Core SDK.

Where things are:

| Part | File |
|---|---|
| Lab switch (Settings → About & advanced → Experimental, off by default, JS kv-store key `joyofit.huaweiHealthLab`) | `src/app/settings/advanced.tsx`, `src/features/huaweihealth/native.ts` |
| Screen (connect, sync now, disconnect) | `src/app/settings/huawei-health.tsx`, `src/features/huaweihealth/HuaweiHealthSection.tsx` |
| Health Kit calls from the phone, cross-site retry | `src/features/huaweihealth/api.ts` |
| Huawei JSON → workout row and points, steps → minutes and day totals | `src/features/huaweihealth/mapping.ts`, `sports.ts` |
| One sync: windows, scopes, writing | `src/features/huaweihealth/sync.ts` |
| OAuth code exchange, refresh, revoke, grant storage | `server/src/huaweiHealth.ts`, migration `server/migrations/0013_huawei_health.sql` |

### Tokens: on the server, like Strava

The Worker keeps the refresh token (AES-GCM encrypted at rest with a key derived from the `HUAWEI_HEALTH_TOKEN_KEY` secret,
table `huawei_health_connection`); the phone only ever gets the one-hour access token (`POST /v1/huawei-health/token`) and calls
Health Kit itself. This is the Strava split (`docs/strava.md`: secret and long-lived grant on the server, short-lived token on
the phone), and it is the simpler choice here: Huawei's refresh call needs `client_secret`, so a refresh token kept in the phone's
SecureStore would still have to travel to the Worker on every refresh, and disconnect on another phone or account deletion could
not revoke it. No Huawei Health data passes through or is stored on the server.

Routes: `GET /v1/huawei-health` (status), `GET /v1/huawei-health/authorize` (`{ url }`), `POST /v1/huawei-health/token`,
`POST /v1/huawei-health/disconnect` (revokes at Huawei, then deletes the row), public `GET /huawei-health/callback` (HUAWEI ID's
redirect; signed state as for Strava, then `joyofit://settings/huawei-health?status=connected|error&reason=…`). Account deletion
revokes and deletes the grant too. A refresh Huawei answers with 1203 (refresh token expired: password change, sign-out, 180 days)
deletes the row and the app asks to connect again.

### What the sync does

- **Workouts**: `GET /healthkit/v2/activityRecords` in windows of 30 days (Huawei: at most 31) with `detailDataType` for workout
  heart rate, speed, cadence, altitude and location, following `hasMoreData` / `cursor`. Each record becomes a `WorkoutLine` written
  with `writeWorkout` (`importStoreSql.ts`): `imported = 1`, skipped when any workout starts within 120 s (watch data wins), a
  ZIP-imported workout without a track is filled in. Records Huawei marks `duplicate = 1` are skipped; `deletedActivityRecord` is
  ignored (deleting in Huawei Health never deletes here). `summary_json.source` is `huawei-health-kit`, with `huaweiActivityType`
  and `healthKitId`. Location samples with `coordinate` 2 (GCJ-02, mainland China grid) are left out of the route.
- **Sport mapping**: Health Kit's Workout Type Constants (their own numbering, not the export's) → JoyoFit sport bytes
  (`WorkoutSportTypes.kt`) in `sports.ts`; `sports.test.ts` checks the names and kinds against the Kotlin table. Unknown types are
  `EXERCISE` (255), as on the watch.
- **Steps**: `POST /healthkit/v2/sampleSet:polymerize` (`com.huawei.continuous.steps.delta`, 29-day windows; Huawei: at most 30),
  each record spread evenly over the minutes it covers → `writeMinutes`. Then `POST /healthkit/v2/sampleSet:dailyPolymerize` per
  calendar day in the phone's time zone (28-day windows; Huawei: at most 31) → `writeDayTotals`, which only fills what the minutes
  leave, and only for days that ended at least 2 days ago (a total for a day still filling up would count twice once its later
  minutes arrive). Huawei says workout steps are only in the record's statistics, not in the step details; the day total covers them.
- **Windows and history**: the first sync starts one year before the authorization (`historydata.open.year`; month / week /
  none if the user granted less); later syncs start 3 days before where the last one ended (Huawei's data lags minutes to hours),
  which the write rules make safe. A 403 for a window before the authorization ("query time is out of range") is skipped; a 403
  after it stops the sync without saving progress. The screen syncs when opened (if the last sync is over an hour old) and on
  "Sinkron sekarang".
- **Cross-site**: 403 with `error.code` 121001 → the request is repeated once at the `Location` URL, and that host is remembered
  (kv-store). Only `https://health-api.cloud.huawei.{com,eu,asia,ru}` is ever sent the token (app and server check the same list).
- **Scopes**: only those granted are used; detail types without their scope are not requested (Huawei would refuse the whole call).

### Brand and wording

Huawei's review refuses "Huawei Health" or "Huawei watch" as text at the entry point and in prompts. The entry point and every
prompt say **HUAWEI ID** (the name of Huawei's sign-in service), never "Huawei Health"; the screen title is "Sinkron HUAWEI ID (lab)".
iOS shows no Huawei name at all ("Sinkron akun jam (lab)", iOS overlay, `docs/i18n.md`). The privacy page (`site/src/Privasi.tsx`,
"Sinkron dari Huawei Health lewat HUAWEI ID" / "Sync from Huawei Health with HUAWEI ID") names Huawei Health and lists each data type,
the scopes, the purpose, where it is kept and the deletion path, as Huawei's review asks. Check before submitting that the developer
and app names on that page match the HUAWEI Developers account exactly.

### Owner steps once Huawei approves (nothing here was done in any console)

1. AppGallery Connect → JoyoFit (app ID 119686663) → HUAWEI ID: add the **redirect URL**
   `https://api.fit.joyorogo.com/huawei-health/callback` (the Worker derives it from its own host, so only that host works).
2. Health Service Kit card → data scopes: **Activity records > Activity record** (read), **Activity records > Activity** (read),
   **Activity records > Location** (read), **Activity data > Steps** (read), and **read historical data: one year**. Nothing else
   (scopes must match what the app uses). The scope strings the app sends are in `server/src/huaweiHealth.ts` `HUAWEI_HEALTH_SCOPES`.
3. Copy the app's **Client ID** (= App ID) into `server/wrangler.jsonc` `vars.HUAWEI_HEALTH_CLIENT_ID` (the only place it is
   configured; the app receives it from the Worker for the `x-client-id` header).
4. From `server/`: `bunx wrangler secret put HUAWEI_HEALTH_CLIENT_SECRET` (the **Client Secret** of the same app; never in the app
   or the repo) and `bunx wrangler secret put HUAWEI_HEALTH_TOKEN_KEY` (any long random string, for example `openssl rand -base64 32`;
   changing it later drops every stored grant).
5. `bunx wrangler d1 migrations apply joyofit --remote` (0013), then deploy the Worker.
6. In the app: Settings → About & advanced → Experimental → "Sinkron dari akun HUAWEI ID (uji lab)", open the new row, sign in.
   Test scopes serve the first 100 users until "Get verified" passes (see "Prerequisites and process").

### Not testable before approval

Everything that needs Huawei: the real authorize page and its consent screen, the code exchange and refresh (error codes are
taken from the docs), the shape of real answers (fixtures are Huawei's documented examples), whether `cursor` paging keeps the
`detailDataType` list (the docs show `cursor` alone and with other parameters; the app sends it with the detail types), which
sites other than `.eu` the cross-site `Location` names, how late real data arrives, and the history scope taking effect (Huawei
says it may need a re-authorization). The unit and Worker tests cover the mapping, idempotency, watch-data-wins, the windows, the
scope handling, the 121001 retry and the token storage.

### Sources (developer.huawei.com, read 2026-11-13)

- Authentication (authorize and token endpoints, parameters, refresh token 180 days, 1203 / 11205 / 31204):
  <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/auth-example-0000001054581058>
- Account Kit token API and error codes: <https://developer.huawei.com/consumer/en/doc/HMSCore-References/account-obtain-token_hms_reference-0000001050048618>,
  <https://developer.huawei.com/consumer/en/doc/HMSCore-References/server-error-codes-0000001062371380>
- REST API usage and common headers (`x-client-id`, `x-version`, `x-caller-trace-id`):
  <https://developer.huawei.com/consumer/en/doc/HMSCore-References/rest-overview-0000001254420693>,
  <https://developer.huawei.com/consumer/en/doc/HMSCore-References/public-parameter-0000001050202130>
- Querying Created Exercise Records (`activityRecords`, 31 days, `detailDataType`, `hasMoreData` / `cursor`):
  <https://developer.huawei.com/consumer/en/doc/HMSCore-References/activityrecords_list-0000001050114862>
- Data Model (ActivityRecord, SamplePoint times in ns, Value fields, `duplicate`):
  <https://developer.huawei.com/consumer/en/doc/HMSCore-References/data-model-0000001054556973>
- Exercise record data overview (scopes, Workout Type Constants): <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/introduction-fitness-record-data-0000001131831088>
- Running records (summary and detail types) and the read example: <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/running-0000001131918792>,
  <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/running-scene-0000001212292245>; repeated `detailDataType`:
  <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/elliptic-machine-exercise-records-0000001232651133>
- Sampling data types: Location (`com.huawei.instantaneous.location.sample`, `latitude` / `longitude` / `coordinate`)
  <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/location-0000001177423525>, Workout Heart Rate (`bpm`)
  <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/exercise-heart-rate-0000001274012996>, Speed
  <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/speed-0000001131423774>, Step Cadence (`step_rate`)
  <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/cadence-0000001177423523>, Altitude
  <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/altitude-0000001177343443>, Steps (`steps_delta`, `steps`)
  <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/steps-0000001177343435>, Active Calories (`calories_total`, kcal)
  <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/calories-0000001177343441>, Distance (`distance`, m)
  <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/distance-0000001131264000>
- Querying Sampling Data Details (`sampleSet:polymerize`, 30 days): <https://developer.huawei.com/consumer/en/doc/HMSCore-References/sampleset_polymerize_detailed-0000001050114864>
- Querying Sampling Data Statistics of Multiple Days (`sampleSet:dailyPolymerize`, 31 days, `timeZone`):
  <https://developer.huawei.com/consumer/en/doc/HMSCore-References/sampleset_daily_polymerize-0000001078113560>
- Reading Historical Data (`historydata.open.week|month|year`, 403 out of range): <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/historydata-open-0000001209921350>
- Canceling Authorization (`DELETE /healthkit/v2/consents/{appId}?deleteData=false`, the user's own paths):
  <https://developer.huawei.com/consumer/en/doc/HMSCore-References/cancel-scopes-0000001059462192>,
  <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/canceling-authorization-0000001209549384>
- FAQs (403 / 121001 cross-site and `Location`; refresh token validity): <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/faq-0000001476980529>
- Result Codes: <https://developer.huawei.com/consumer/en/doc/HMSCore-References/error-code-0000001054236973>
- Data Query Timeliness (sync on open, manual sync button): <https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/dataquery-timeliness-desc-0000001058864328>

The site renders these pages with JavaScript; the text was read through the doc portal's JSON (`documentPortal/getDocumentById`
with the id after the last `/`). No undocumented endpoint is used (owner decision, `docs/agps.md`).
