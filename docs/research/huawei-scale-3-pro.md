# HUAWEI Scale 3 Pro: how JoyoFit can get its readings

Research for FIT-144 (atur, workspace `joyofit`): a JoyoFit user (Threads @rhiskiapril, iPhone, App Store 1.1) asked for HUAWEI Scale 3 Pro
support. Written 2026-11-17. "Confirmed" means seen in this repo, in our own recordings, or stated by the cited source; "not confirmed"
means nobody has checked it against real data yet.

## Summary

| Path | Data | Automatic? | Platform | Needs from the user | State in JoyoFit | Effort left |
|---|---|---|---|---|---|---|
| A. Direct BLE (Hagrid WSP) | weight, body fat % from the scale, impedance; the rest of the body composition only through an estimate | yes, live | Android, iOS | the scale's 3 keys (CAK, C1, C2), on iOS also its Bluetooth address | **built** (`huawei-hagrid`, PR #33), shipped OTA 2026-10-26, never run against a real scale | test on hardware; small fixes |
| B. Huawei Privacy Centre export | every field Huawei Health stores (`WEIGHT_BODYFAT_BROAD`: weight, fat %, muscle, water, bone, visceral fat, BMR, protein, body age, BMI, impedance) | no, one file at a time, up to 7 days per request | Android, iOS (web converter) | ask Huawei for the export | **built** (`HuaweiWeightParser`, web import) | none to try; field names for a Scale 3 Pro not confirmed |
| C. Huawei Health Kit cloud (REST, OAuth) | weight and body fat confirmed by a third party; the other fields not confirmed | yes, after each Huawei Health sync | Android, iOS (server side) | sign in with HUAWEI ID once, link "Health Service Kit" in Huawei Health | **not built**: JoyoFit reads no Huawei cloud data today | Huawei data-permission review, then medium server + app work |
| D. Apple Health (iOS) | weight only, by old user reports | yes | iOS only | allow Huawei Health to write to Apple Health | not built: JoyoFit's Apple Health import does not read body mass | small, but native (store build) |
| E. Health Connect (Android) | none | - | - | - | - | Huawei Health does not write to Health Connect |

**Recommendation.**

1. **Now (no code):** path B already gives the user their full body composition history, and path A gives a live weigh-in to anyone
   who has the keys. Neither is confirmed on a Scale 3 Pro: B needs one real export from a scale owner, A needs a real scale.
2. **Start the Huawei Health Kit data-permission application now (path C).** It is the only way to get a Scale 3 Pro's readings
   automatically without keys, and Huawei's review is the long pole, not the code. Ask for read access to weight and body fat (plus
   the other body composition types the console offers) and historical-data scopes. Build the sync only after approval.
3. **Next iOS store build: read body mass (and body fat %, if present) in the Apple Health import (path D).** It is cheap, useful
   beyond this scale, and the Huawei Health → Apple Health weight sync is something iPhone users of this scale already have.

No code change in this PR: path C needs Huawei's approval first, and path D is native, so it is neither small nor testable over the air.
The brief allowed an implementation only if "the cloud path already exposes the data", and JoyoFit has no Huawei cloud data path to extend.

## What JoyoFit has today (confirmed in this repo)

- **Watches over BLE**: `modules/huawei-wear` speaks the Huawei watch link (service `fe86`, `5A`-framed packets). The Scale 3 Pro also
  exposes `fe86` (FIT-144 recording), but the PR #29 probe was replaced in PR #33 once openScale showed the weigh-in runs on vendor
  characteristics under `181c` / `1805` / `181b`, not on `fe86` (FIT-144 comments). So the watch stack is **not** reused for the scale.
- **Scales over BLE**: `modules/ble-sensors` (scan + GATT link) and `src/features/scale/` (protocols in TypeScript, see
  [docs/scale.md](../scale.md)). The `huawei-hagrid` protocol (`protocols/hagridLib.ts`, `protocols/huaweiHagrid.ts`) is a port of
  openScale's `HuaweiHagridWspHandler.kt` / `HuaweiHagridWspLib.kt` and matches the Scale 3 / 3 Pro / 2 Pro and HONOR Scale 2 by
  advertised name (`HUAWEI Scale 3 Pro-241` in the user's recording).
- **"HUAWEI ID"**: JoyoFit stores only the 17-digit account id from the `userId` cookie of `cloud.huawei.com`
  (`src/features/watchfaces/huaweiAccount.ts`, `HuaweiWear.setHuaweiAccount`). The watch handshake and watch faces use it. **JoyoFit
  does not sign in to any Huawei data API and syncs no health data from Huawei's cloud.** Its "cloud sync" is to JoyoRogo's own server.
- **Huawei history import**: the Privacy Centre export, read on the phone (Android, `HuaweiExportImporter.kt`) or in the browser
  (JoyoFit web, both platforms; [huawei-web-import.md](../huawei-web-import.md)). Weigh-ins go to `scale_reading`
  (`scale_id = 'huawei-health-export'`) with the `ReportedBody` fields, and on to JoyoRogo's weight history.
- **Apple Health import** (iOS, `AppleHealthImporter.swift`): reads steps, heart rate, resting heart rate, SpO2, active energy, sleep
  and workouts. **No body mass, body fat or BMI.**
- **Health Connect / HealthKit writing**: no weight or body composition (docs/scale.md, "Where things go").

## Path A: direct BLE (Hagrid WSP)

**Protocol (confirmed by openScale's source and our port; the user's recording matches the GATT map, but no handshake has run yet).**
The scale advertises `HUAWEI Scale 3 Pro-<n>` with service `fff0` and no manufacturer data, so there is no broadcast weight. A
recorder that only listens gets nothing, and the scale drops the link after about 22 s (four recordings, 2026-10-26). It only talks
after an authenticated, encrypted session:
request-auth → HMAC-SHA256 auth token from **CAK** → random work key sent AES-128-CTR-encrypted under a root key built from **C1**,
**C2** and the scale's **Bluetooth address** → time, manager info, user info → realtime weight frames, status polling, history read.
The full characteristic table is in [docs/scale.md](../scale.md#huawei-scale-3-pro--3--2-pro-hagrid-wsp-needs-3-keys).

**Is it the watch protocol?** No. Same vendor and the same `fe86` service is present, but the weigh-in uses its own framing (`DB`/`DC`
and `BD`/`CD` frames, CRC-16 variants) and key scheme on the vendor characteristics, not the watch's `5A` link and its auth.
Nothing in `modules/huawei-wear` applies.

**What it gives.** Per weigh-in: weight (/100 kg), body fat % the scale computes itself (/10), the scale's time, 6 low-frequency
impedance samples, heart rate, and on the 3 Pro 6 high-frequency samples (38-byte frame). Muscle, water, bone, visceral fat, BMR and
protein are **not** in the frame; Huawei Health computes them. openScale has a regression fitted to the vendor app
(`libs/HuaweiScale3BodyComposition.kt`) that JoyoFit has not ported. So over BLE, JoyoFit shows weight and body fat from the scale,
plus impedance-based estimates only if a formula is added.

**The blocker: the keys.** Every scale needs its own CAK, C1 and C2, and openScale does not ship them. By policy (docs/scale.md), JoyoFit
does not ship, fetch or derive them and does not explain how to get them. The user types them in. On iOS the user must also type the
scale's Bluetooth address, which iOS never exposes. That makes path A an advanced feature for a few people, not a fix for this user.

**Other sources checked.** Gadgetbridge: Huawei *watch/band* support since 0.78 ([release notes](https://gadgetbridge.org/blog/release-0_78_0/));
no mention of any Huawei scale found in its changelog or release posts ([0.87](https://gadgetbridge.org/blog/release-0_87_00/),
[CHANGELOG](https://github.com/Freeyourgadget/Gadgetbridge/blob/master/CHANGELOG.md)). Not confirmed either way; openScale is the only
public implementation we found.

**Effort left:** small once someone with a scale and its keys runs the test script in docs/scale.md. Risks: firmware differences (openScale's
capture is a Scale 3, ours targets the 3 Pro's 38-byte frame and history read), the 22 s link timeout, unconfirmed fat scaling on the
3 Pro.

## Path B: Huawei Privacy Centre export

**Already works end to end for the data it was tested with.** Weigh-ins are read from `Health detail data` points whose key names
weight / body fat / body composition / BMI (`WEIGHT_BODYFAT_BROAD`), with the fields of Huawei's `BroadBodyFat` description: `bodyWeight`,
`bodyFatRate`, `muscleMass`, `moistureRate`, `boneSalt`, `basalMetabolism`, `visceralFatLevel`, `proteinRate`, `bodyAge`, `bmi`,
`impedance` (docs/app-reference.md, `HuaweiWeightParser.kt`). The web converter makes it work on iOS too.

**Not confirmed:** the only real export we have had 22 weigh-ins, all manual entries (weight and BMI, no scale). The field names a Scale
3 Pro writes, and whether its 8-electrode segment values appear, are not confirmed. The parser keeps unknown keys out and reports them
in `unmappedKeys`, so one export from a Scale 3 Pro owner settles it, with no hardware on our side.

**Limits:** manual, up to 7 days per request (link valid 21 days), so it is a backfill, not a sync. JoyoRogo has no body composition
fields, so fat and the rest stay in JoyoFit (docs/scale.md).

## Path C: Huawei Health Kit cloud API

**Feasible (confirmed by a third party).** Intervals.icu shipped a Huawei integration on 2026-01-23 that receives "wellness data (steps,
sleep, resting HR, weight, body fat, blood pressure, menstrual cycle and VO2 max)". Users authorise it from Intervals.icu and link
"Health Service Kit" under third-party services in Huawei Health. Data reaches it by webhook after a Huawei Health sync, plus polling.
History goes back 1 year. On 2026-02-14 users reported that body fat was wrong because Intervals.icu "treats Huawei's body fat as body fat
percentage data"; it was fixed on 2026-02-16 ([forum thread](https://forum.intervals.icu/t/huawei-support-available/120529)). **So the
unit of body fat in the API is not what the name suggests: check it on real data.**

Huawei's scales put their weigh-ins in Huawei's cloud: with Wi-Fi configured, "measurement data is automatically uploaded to the cloud"
([Huawei support: pairing a body fat scale](https://consumer.huawei.com/uk/support/content/en-gb15770554/)). Otherwise the data goes up
through Huawei Health on the phone.

**What it needs (confirmed in outline, details not):**
- A Huawei developer app with **Health Kit data permissions approved per data type** before any user can grant them. Without
  approval the API returns nothing or error 50005 ([FAQ on authorization errors](https://segmentfault.com/a/1190000041849011/en),
  [Terra](https://tryterra.co/integrations/huawei): each app needs its own approval).
- Huawei's application guide for **enterprise** developers asks for a detailed use case per data type and mentions a credit review. Its
  own example is a body-fat-scale app ([Huawei Developer (Enterprise) Application, PDF](https://hihealthbase-drcn.things.hicloud.com/healthkit/fileServer/getFile/protected/ApplicationMaterialsForEnterpriseDevelopersEn/000/001/044/1000000000000001044.20250828122123.90852301985329881315235957538965:20750816122314:100005355:AB2ABBF1FF1990E982D13E3D175554B1B915CC9C77DBC898678B98A8F72E6993.pdf)).
  **Not confirmed:** whether JoyoDigitama's AppGallery Connect account (JoyoFit is published on AppGallery) is verified as an
  enterprise, and whether individual developers can apply.
- The Health Kit service agreement lists body fat percentage, BMI, muscle mass, water percentage and visceral fat level as regular
  (not restricted) health data ([agreement](https://terms-drcn.platform.hicloud.com/agreementservice/developer/getAgreementTemplate?agrType=1086&country=ove&language=en_us&version=2019122501)).
  Whether each one is a readable REST data type is **not confirmed**. Weight is `com.huawei.instantaneous.body_weight` and "can be
  obtained from Huawei and other compatible body fat scales" (Huawei's Health Kit data-type page, seen in search results; the page
  itself returned HTTP 503 when fetched:
  [Data Openness of Huawei Wear and Huawei Health](https://developer.huawei.com/consumer/en/doc/development/HMS-Plugin-Guides-V1/read-sport-health-datatype-0000001073827835-V1)).
  The Android SDK has `DT_INSTANTANEOUS_BODY_FAT_RATE`
  ([forum](https://forums.developer.huawei.com/forumPortal/en/topic/0201326975480310022)); its REST name is not confirmed.
- Only data created after the user authorises can be read, unless the app also has the history scopes
  (`https://www.huawei.com/healthkit/historydata.open.week` / `.month` / `.year`)
  ([REST FAQ](https://xdaforums.com/t/faqs-about-using-health-kit-rest-apis.4529265/)).

**Shape of the build (after approval):**
1. Server (`server/`, Cloudflare Worker): HUAWEI ID OAuth (authorization code, refresh token stored encrypted per JoyoRogo user),
   a webhook endpoint and/or a scheduled poll of `https://health-api.cloud.huawei.com/hihealth/v1/` for the body types, mapped to the
   `ReportedBody` fields with the unit checks above.
2. App: Settings > Timbangan gets a "Huawei Health (cloud)" source next to BLE scales. Readings land in `scale_reading` with their
   own `scale_id`, deduplicated against BLE and export rows the way the export import already is (same minute and within 0.3 kg), and go
   to JoyoRogo like any weigh-in. JS only after the server exists (OTA-able).
3. Policy and wording: privacy policy, the AppGallery listing and the Huawei review all need to name the data. On iOS the brand rules
   in the iOS overlay apply.

**Effort:** application and review: unknown and not in our control (weeks is a guess, not confirmed). Code: medium (about one week:
OAuth + token storage + sync + mapping + UI + tests). The JS mapping can be tested against recorded API responses without hardware.

**Risks:** approval refused, or limited to enterprise accounts; data types or units that differ from the docs (Intervals.icu's body fat
bug); only weight and fat exposed, not muscle and the rest; webhook availability per region (China vs global accounts not checked);
the user must keep Huawei Health and its cloud sync, which some JoyoFit users left on purpose.

## Path D: Apple Health (iOS)

Huawei Health on iPhone can write to Apple Health, but user reports say **only weight** arrives, not body fat or BMI
([Apple Community, about 2022](https://discussions.apple.com/thread/254263147),
[Huawei Community, Scale 3 on iOS 14.6](https://consumer.huawei.com/en/community/details/HuaweiHealth-Apple-HealthKit-Synching-of-BMI-Lean-Body-Mass-and-Body-Fat-Percentage/topicId-159030/)).
These reports are years old: whether current Huawei Health versions write body fat is **not confirmed**. JoyoFit's Apple Health import
does not read body mass today. Adding `bodyMass` (and `bodyFatPercentage`, `leanBodyMass`, `bodyMassIndex` in case they appear) to
`readTypes` and writing them like the export's weigh-ins is small, but it is Swift plus a new read permission, so it ships with a store build.

## Path E: Health Connect (Android)

Huawei Health has no native Health Connect support (Steppi help, updated 2026-04-06:
[article](https://steppi.crisp.help/en/article/how-do-i-connect-huawei-health-on-android-phones-samsung-153ejzl/)). Third-party bridges
such as [Health Sync](https://healthsync.app/about/) read Huawei Health through Health Kit and can write to Health Connect, but that
depends on another paid app. JoyoFit also does not read Health Connect weight today. Not recommended.

## What needs a physical scale (or a scale owner)

| Check | Needs |
|---|---|
| Path A handshake, weigh-in, history read, fat scaling, 3 Pro's 38-byte frame, the 22 s timeout | a Scale 3 Pro **and** its keys (docs/scale.md test script) |
| iOS address entry for path A | the same, on an iPhone |
| Path B field names for a Scale 3 Pro | one Privacy Centre export from an account that has Scale 3 Pro weigh-ins (no scale on our side) |
| Path C data types, units, webhook timing | Health Kit approval plus an account with scale weigh-ins (a manual weight entry in Huawei Health covers weight only) |
| Path D: does body fat reach Apple Health | an iPhone with Huawei Health paired to the scale |

## Step plan

1. **This week (no code):** reply on FIT-144: path B already imports Huawei Health's weigh-ins with body composition (web import, iOS
   too), and path A needs the scale's keys. Ask the FIT-144 user for one export or its `unmappedKeys` summary, to confirm the Scale 3 Pro
   fields. Make no "supported" claim, and no `[Konten]` issue (AGENTS.md): nothing is tested on a real scale.
2. **This week:** check in AppGallery Connect whether the JoyoFit app can apply for Health Kit data permissions (enterprise
   verification status, form). If yes, apply for read access to weight, body fat and the other body composition types, plus history scopes.
3. **Next iOS store build:** path D, Apple Health body mass (and body fat, if present) in the Apple Health import, with tests in
   `AppleHealthImportPlanTests.swift`.
4. **After Huawei approves:** build path C (server OAuth + sync, app source, dedup, tests on recorded responses). Then test with an account
   that has scale data before any user-visible claim.
5. **Whenever a scale with keys is available:** run the path A test script, and fix what the trace shows.
6. Optional: port openScale's `HuaweiScale3BodyComposition.kt` as the `huawei-hagrid` estimate formula, shown under "Perkiraan". Only
   worth it if path A gets real users.

## Sources

- openScale (Hagrid WSP handler, GPL-3.0-or-later): https://github.com/oliexdev/openScale
- FIT-144 and its comments (atur), PR #29 and PR #33 (this repo)
- Intervals.icu Huawei integration: https://forum.intervals.icu/t/huawei-support-available/120529
- Huawei, pairing a body fat scale: https://consumer.huawei.com/uk/support/content/en-gb15770554/
- Health Kit authorization FAQ: https://segmentfault.com/a/1190000041849011/en
- Health Kit REST FAQ (history scopes): https://xdaforums.com/t/faqs-about-using-health-kit-rest-apis.4529265/
- Terra, Huawei integration: https://tryterra.co/integrations/huawei
- Huawei enterprise developer application guide (PDF): linked above
- Health Kit service agreement: https://terms-drcn.platform.hicloud.com/agreementservice/developer/getAgreementTemplate?agrType=1086&country=ove&language=en_us&version=2019122501
- Health Kit data types: https://developer.huawei.com/consumer/en/doc/development/HMS-Plugin-Guides-V1/read-sport-health-datatype-0000001073827835-V1
- Health Kit DataController (Android types): https://forums.developer.huawei.com/forumPortal/en/topic/0201326975480310022
- Apple Community: https://discussions.apple.com/thread/254263147
- Huawei Community: https://consumer.huawei.com/en/community/details/HuaweiHealth-Apple-HealthKit-Synching-of-BMI-Lean-Body-Mass-and-Body-Fat-Percentage/topicId-159030/
- Steppi, Huawei Health and Health Connect: https://steppi.crisp.help/en/article/how-do-i-connect-huawei-health-on-android-phones-samsung-153ejzl/
- Health Sync: https://healthsync.app/about/
- Gadgetbridge: https://gadgetbridge.org/blog/release-0_78_0/, https://gadgetbridge.org/blog/release-0_87_00/
