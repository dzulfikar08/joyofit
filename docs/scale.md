# Bluetooth bathroom scales

Settings > Timbangan (`/settings/scale`). **This changes native code** (new scale scan and GATT functions in `modules/ble-sensors`, plus the Bluetooth usage strings in `app.json`), so it changes the OTA fingerprint (docs/ota.md): it ships with a store build, never over the air. Everything that knows a scale protocol is TypeScript and can ship over the air afterwards.

## Reality check

Few cheap scales implement the Bluetooth SIG Weight Scale Service (0x181D) or Body Composition Service (0x181B). Most use a vendor protocol, and many cheap ones do not connect at all: they put the weight in the manufacturer data of their advertisement (OKOK / Chipsea, QN broadcast, AiLink, Etekcity, Scale Up, Yunmai X, AAA-series). So the native side has two modes: an unfiltered scan that reports every advertisement, and a GATT link JS drives byte by byte.

Decoders are ported from [openScale](https://github.com/oliexdev/openScale) (GPL-3.0-or-later; JoyoFit is AGPL-3.0, compatible). Every protocol file names its openScale source and keeps its copyright line.

### What the HAN RIVER scale uses

Not established. What was found: the Shopee listing "HAN RIVER Smart Body Fat Scale", model HRTZC01WT (rechargeable, 180 kg, 0.1 kg, up to 10 users, "Body Fat Monitor with App"), sold by HK HAN RIVER (hanriver.asia, a Shenzhen white-label of kitchen and home appliances). None of the listings, the brand site or the two Indonesian video reviews names the phone app, and the Play Store app called "Han River" (`asmart.ad`) is the brand's smart-home app, not a scale app. White-label scales of this price are almost always one of the Chipsea / OKOK, Fitdays (AAA-series, AiLink) or QN families, which are all decoded here, but that is an inference, not a fact. The first thing to do when it arrives is the test below: the recorder tells which family it is.

## Protocols

All ids are in `src/features/scale/registry.ts`. "Vectors" says where the test bytes come from.

| Id | Mode | Brands | Source in openScale (`core/bluetooth/`) | Vectors |
|---|---|---|---|---|
| `standard-weight-profile` | GATT 181D / 181B | Beurer BF105 / BF500 / BF600 / BF720 / BF950, Sanitas SBF7x, A&D UC-352BLE, any SIG scale | `scales/StandardWeightProfileHandler.kt` | real captures from `StandardWeightProfileHandlerTest.kt` |
| `xiaomi-mi-scale` | GATT, v1 and v2 | Xiaomi Mi Smart Scale, Mi Body Composition Scale | `scales/MiScaleHandler.kt`, `libs/MiScaleLib.kt` | name rules, GATT shapes and the 10-byte history layout from `MiScaleHandlerVariantTest.kt`; 13- and 26-byte live frames are built from the layout (not captures) |
| `okok-chipsea-broadcast` | advertisement | OKOK International, Chipsea, Yoda | `scales/OkOkHandler.kt` | built from the handler's layout and checksum (openScale has no test for it): not captures |
| `qn-broadcast` | advertisement | QN, Renpho, FITINDEX FT-26R | `scales/QNHandlerBroadcast.kt` | real FT-26R captures from `QNHandlerBroadcastFT26RTest.kt` |
| `ailink-broadcast` | advertisement | AiLink, eLink, Aicare | `scales/AiLinkBroadcastHandler.kt`, `libs/AiLinkLib.kt` | `AiLinkLibTest.kt`: real cipher over invented readings |
| `aaax-broadcast` | advertisement | Fitdays AAA-series, Posture FG220LB | `scales/AAAxHandler.kt` | `AAAxHandlerTest.kt` |
| `etekcity-fit8s-broadcast` | advertisement | Etekcity / VeSync Fit 8S | `scales/EtekcityFit8SHandler.kt` | built from the documented layout |
| `scaleup-broadcast` | advertisement | Scale Up | `scales/ScaleupHandler.kt` | built from the documented layout |
| `yunmai-x` | advertisement | Yunmai X | `scales/YunmaiXHandler.kt` | `YunmaiXHandlerTest.kt` |
| `qn-scale` | GATT FFE0 | QN-Scale, Yolanda, Renpho (QN), FITINDEX, GE Fit Plus | `scales/QNHandler.kt` | real "Fit Plus" capture and handshake from `QNHandlerProtocolTest.kt` |
| `one-by-one-health-scale`, `eufy-one-by-one` | GATT | 1byone, iWellness, Eufy C1 / P1 / A1 | `scales/OneByoneHandler.kt` | `OneByoneHandlerTest.kt` |
| `one-by-one-new` | GATT | 1byone (new) | `scales/OneByoneNewHandler.kt` | built from the layout |
| `renpho-es-wbe28` | GATT | Renpho ES-WBE28 | `scales/RenphoHandler.kt` | built from the layout |
| `yunmai-mini`, `yunmai-se` | GATT | Yunmai | `scales/YunmaiHandler.kt` | built from the layout comments |
| `inlife`, `senssun-fat`, `excelvan-cf36x`, `hesley-yunchen`, `exingtech-y1` | GATT | Inlife, Senssun, Excelvan / generic "Electronic Scale", Hesley, Exingtech VScale | `scales/{Inlife,Senssun,ExcelvanCF36x,Hesley,ExingtechY1}Handler.kt` | built from the layout |

"Built from the layout" means the decoder matches the openScale source and its checksum rule, nothing more: the first real capture of such a scale may show a difference. Not covered: iComon, Lefu, Huawei, Beurer BF700, Omron, Medisana, Picooc, Huami S400 and the other openScale devices that are not in the table (no verifiable bytes were ported for them). A scale that is not recognised goes through "Rekam data timbangan".

### Body composition

`ScaleReading.reported` carries only what a scale sends itself (the SIG profile does, a few vendors do). Without it, `bodyComposition.ts` estimates fat, water, muscle, bone, visceral fat and BMR from the impedance with the formula openScale uses for that scale family (`registry.ts`, `FORMULA_OF_PROTOCOL`), only when the person has a profile (height, birth year, sex in Settings > Profile). They are shown under "Perkiraan" with a note, apart from "Dari timbangan", and they can differ from the numbers in the scale's own app. No impedance, no profile or no formula for that family means no values. Impedance is not sent to JoyoRogo.

## Where things go

- **Local**: `scale` and `scale_reading` tables (`features/scale/store.ts`, created by `ensureScaleSchema` with the other JS-created schemas).
- **JoyoRogo**: `weight.checkIn` (`packages/api/src/routers/weight.ts` of JoyoRogo): weight to 0.1 kg and the Jakarta day, 25 to 400 kg, one row per user and day, the last write of the day wins. JoyoRogo has **no source field** (so `source: 'scale'` cannot be stored there; the source is kept locally) and **no body-composition fields** (waist is the only other body log), so fat and the rest stay in JoyoFit. A failed or offline push stays `pending` and is retried when the app opens and after the next weigh-in. After a push, the existing diary sync (`bodyMetricsFrom`, `src/features/meals/mealMap.ts`) hands the newest JoyoRogo weight to the watch.
- **Health Connect / Apple Health**: not written. JoyoFit's Health Connect and HealthKit writers (`HealthConnectExporter.kt`, `TYPES`) cover steps, heart rate, SpO2, resting heart rate, distance, active energy, sleep and exercise, not weight, so there is nothing to extend. Writing `WeightRecord` / `BodyFatRecord` needs new permissions and a rationale update in `modules/huawei-wear` and is a separate step.

## Behaviour

- Picking a scale makes it the only one. While the app is open, "Tangkap otomatis" is on (default) and a scale is picked, one `WeighSession` waits for it (slow radio duty cycle on Android). A test weigh-in switches to the fast one.
- Broadcast scale: each advertisement of that address is decoded; a weigh-in is final after two equal stable frames (some formats have no stable flag). Connected scale: it only advertises while awake, so the session waits for the advertisement, connects, runs the protocol, saves, disconnects and waits again.
- The same weight within 2 minutes is not saved again (`gate.ts`), except to add impedance to the weigh-in just saved.
- Multi-user guard (`guard.ts`): a weight more than 6 % (Normal; 12 % Longgar; Mati) from the person's last weight asks "Ini kamu?" before saving. The yardstick is the last local weigh-in (up to 45 days old), else JoyoRogo's latest weight, else the profile weight. "Bukan aku" discards it.
- The scan is shared (`hub.ts`): the picker, the recorder and the live session can run together; the hub runs one native scan for the union of what they ask.

## Permissions

Reuses `ensureSensorPermissions` (`features/sensors/permissions.ts`): Android 12+ `BLUETOOTH_SCAN` (declared `neverForLocation` in `modules/ble-sensors/android/src/main/AndroidManifest.xml`, unchanged) and `BLUETOOTH_CONNECT`; Android 11 and older need precise location to scan. The unfiltered scan works under `neverForLocation` (Android only hides iBeacon-style advertisements). iOS: the existing `NSBluetoothAlwaysUsageDescription` now mentions scales; the prompt appears with the first search. An unfiltered iOS scan works in the foreground only, which is all a weigh-in needs.

## Files

- Native: `modules/ble-sensors/android/.../{ScaleRadio,ScaleLink,ScaleLogic}.kt` (+ `SensorHub.kt`, `BleSensorsModule.kt`, `SensorErrors.kt`), `modules/ble-sensors/ios/{ScaleCentral,ScaleLogic}.swift` (+ `BleSensorsModule.swift`, `SensorCentral.swift`: `requireOn` is no longer private), `modules/ble-sensors/src/{BleSensors.types,BleSensorsModule}.ts`. Tests: `ScaleLogicTest.kt` and `SensorLogicTests/.../ScaleLogicTests.swift` (the Swift package symlinks `ScaleLogic.swift`).
- JS: `src/features/scale/` (`types`, `uuid`, `registry`, `protocols/*`, `bodyComposition`, `body`, `gate`, `guard`, `capture`, `store`, `sync`, `rogoMap`, `hub`, `driver`, `weigh`, `discovery`, `recorder`, `report`, `profile`, `settings`, `ui/*`), `src/state/ScaleProvider.tsx`, `src/app/settings/scale.tsx`, `src/cloud/rogo.ts` (`checkInWeight`), `src/db/appSchema.ts`, i18n namespace `scale`.

## Test script for when the scale arrives

1. Install a build that contains this branch (native change: store build or EAS development build, not OTA). Charge or put batteries in the scale, enable Bluetooth on the phone, sign in to JoyoRogo.
2. Settings > Timbangan > "Lanjut", allow Bluetooth. Step on the scale until its display is on, tap "Cari timbangan". A recognised scale shows with its type and, for advertisement scales, a live "Terbaca ... kg". Tap "Pakai ini".
3. If nothing is recognised: keep the scale awake, scroll to "Rekam data timbangan", tick the device (the scale usually has a short name or none; it is the one whose signal gets stronger when you hold the phone next to it), keep "Sambungkan juga" on, "Mulai merekam", step on the scale for 20 seconds, "Berhenti merekam", "Bagikan rekaman" and send it. The log lines are `scale: ...` (the in-app log, Settings > Log, shows them too).
4. With a recognised scale: tap "Coba timbang", step on, wait for the number to settle: "Tersimpan di riwayat" and a row in "Riwayat timbang" with "Terkirim ke JoyoRogo". Check the weight appears in JoyoRogo's weight log for today (Jakarta day).
5. Step on twice within two minutes: one row. Let someone else step on (or weigh a bag of rice): the "Ini kamu?" dialog appears; "Bukan aku" saves nothing.
6. Airplane mode, weigh in, back online, reopen the app: the row goes from "Menunggu dikirim" to "Terkirim".
7. Fill height, birth year and sex in Profile; a scale that sends impedance then shows "Perkiraan" body values (and says they are estimates).

## Checks

`bunx tsc --noEmit`, `bun test ./src`, `bunx eslint src`, Android `./gradlew :ble-sensors:testDebugUnitTest :ble-sensors:lintDebug` and the Swift package `swift test` in `modules/ble-sensors/ios/SensorLogicTests` (all in CI). The Kotlin and Swift transport code (`ScaleRadio`, `ScaleLink`, `ScaleCentral`) has no unit test: it needs a radio, like `SensorLink`.
