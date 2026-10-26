# Bluetooth bathroom scales

Settings > Timbangan (`/settings/scale`). **This changes native code** (new scale scan and GATT functions in `modules/ble-sensors`, plus the Bluetooth usage strings in `app.json`), so it changes the OTA fingerprint (docs/ota.md): it ships with a store build, never over the air. Everything that knows a scale protocol is TypeScript and can ship over the air afterwards.

## Reality check

Few cheap scales implement the Bluetooth SIG Weight Scale Service (0x181D) or Body Composition Service (0x181B). Most use a vendor protocol, and many cheap ones do not connect at all: they put the weight in the manufacturer data of their advertisement (OKOK / Chipsea, QN broadcast, AiLink, Etekcity, Scale Up, Yunmai X, AAA-series). So the native side has two modes: an unfiltered scan that reports every advertisement, and a GATT link JS drives byte by byte.

Decoders are ported from [openScale](https://github.com/oliexdev/openScale) (GPL-3.0-or-later; JoyoFit is AGPL-3.0, compatible). Every protocol file names its openScale source and keeps its copyright line. The exception is `protocols/tuyaBeacon.ts`, reverse engineered from the owner's scale (no openScale source).

### What the HAN RIVER scale uses

Established on the owner's own scale (HRTZC01, Tuya product `bbrs03yc`): it advertises encrypted **Tuya BLE beacons** (manufacturer data, company id 0xD007) and never connects. The weight is `u16be / 10` kg in the decrypted `broadcast_data` DP; nothing else in the frame changes between weigh-ins (2.5 to 108.6 kg), so the scale is **weight only** for JoyoFit (the body fat its own app shows is not in the beacon). Protocol `tuya-beacon-broadcast`, see below. Other HAN RIVER / white-label scales that use another chip may still be one of the Chipsea / OKOK, Fitdays (AAA-series, AiLink) or QN families: that is an inference, the recorder tells.

## Website list

fit.joyorogo.com/timbangan (`site/src/Timbangan.tsx`) lists the protocols in `registry.ts`: `site/scripts/timbangan.ts` reads the registry for labels and brands and writes `site/src/timbangan.ts` (`bun run timbangan`, also the first step of `bun run build`). The grouping by brand and the "what you get" tag (weight only, scale-reported body values, estimated body values, depends on model) are editorial and live in `GROUPS` in that script. A new protocol makes the build and `bun test scripts` fail until it is added there, so the page cannot silently miss a scale. Three protocol fields come from the registry, not from `GROUPS`: `weightOnly` (the script refuses an entry tagged anything but "berat"), `realScaleTested` (the row shows "Sudah diuji di timbangan asli" and the banner names it) and `secret` (the row shows "Perlu kunci timbangan"). Set `realScaleTested` only for a protocol checked against a real scale in hand (today only `tuya-beacon-broadcast`), then run `bun run timbangan` in `site/`; the banner copy follows the registry. The site FAQ, `seo.ts` and `llms.txt` also state how many are tested.

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
| `tuya-beacon-broadcast` | advertisement, encrypted, weight only | HAN RIVER HRTZC01, Tuya Smart / Smart Life beacon scales | none (not openScale; reverse engineered, see `protocols/tuyaBeacon.ts`) | the owner's HRTZC01 recording (values, sn and timing; display locked at 108.6 kg) re-encrypted under a fake key, its own local key is not in the repo |
| `yunmai-x` | advertisement | Yunmai X | `scales/YunmaiXHandler.kt` | `YunmaiXHandlerTest.kt` |
| `qn-scale` | GATT FFE0 | QN-Scale, Yolanda, Renpho (QN), FITINDEX, GE Fit Plus | `scales/QNHandler.kt` | real "Fit Plus" capture and handshake from `QNHandlerProtocolTest.kt` |
| `one-by-one-health-scale`, `eufy-one-by-one` | GATT | 1byone, iWellness, Eufy C1 / P1 / A1 | `scales/OneByoneHandler.kt` | `OneByoneHandlerTest.kt` |
| `one-by-one-new` | GATT | 1byone (new) | `scales/OneByoneNewHandler.kt` | built from the layout |
| `renpho-es-wbe28` | GATT | Renpho ES-WBE28 | `scales/RenphoHandler.kt` | built from the layout |
| `yunmai-mini`, `yunmai-se` | GATT | Yunmai | `scales/YunmaiHandler.kt` | built from the layout comments |
| `inlife`, `senssun-fat`, `excelvan-cf36x`, `hesley-yunchen`, `exingtech-y1` | GATT | Inlife, Senssun, Excelvan / generic "Electronic Scale", Hesley, Exingtech VScale | `scales/{Inlife,Senssun,ExcelvanCF36x,Hesley,ExingtechY1}Handler.kt` | built from the layout |
| `huawei-hagrid` | GATT 181C / 1805 / 181B (vendor characteristics), encrypted, needs 3 keys | HUAWEI Scale 3 Pro, Scale 3, Scale 2 Pro, HONOR Scale 2 | `scales/HuaweiHagridWspHandler.kt`, `libs/HuaweiHagridWspLib.kt` | `HuaweiHagridWspLibTest.kt` and `HuaweiHagridWspHandlerTest.kt` (fake keys); five frames of openScale's real Scale 3 capture (write and notification CRCs, the realtime frame under its session work key) |

"Built from the layout" means the decoder matches the openScale source and its checksum rule, nothing more: the first real capture of such a scale may show a difference. Not covered: iComon, Lefu, Huawei watches' own link (fe86), Beurer BF700, Omron, Medisana, Picooc, Huami S400 and the other openScale devices that are not in the table (no verifiable bytes were ported for them). A scale that is not recognised goes through "Rekam data timbangan".

### Tuya beacon scales (weight only, needs the local key)

Protocol `tuya-beacon-broadcast` (`protocols/tuyaBeacon.ts`, the same layer as the other decoders: XXTEA, CRC-8 and the parser are ported there, no native code). Frame: manufacturer data 0xD007, `0x05 | mac[6] | sn[4 BE] | enc[16]`; `enc` is one XXTEA block under the 16 ASCII characters of the device's Tuya `local_key`; plaintext `sn | dp 1 raw len 7 | value[7] | crc8 | 00`; weight = `u16be(value[0..2]) / 10` kg. A wrong key or a damaged frame fails the echoed sn or the CRC and reads nothing. Head `0x01` frames (idle, sn 0..2) do not decrypt and carry no reading; they only make the picker list the scale.

- **Settle rule**: there is no stable flag. The scale follows the weight while the person settles and then repeats the value with a higher `sn`, so a frame is final when the frame before it (lower `sn`, within 5 minutes) had the same weight. The same advertisement arriving again keeps its verdict. The decoder has memory, so it is built per listening session (`createDecoder`, `weigh.ts`), and `WeighSession` takes its stable flag as final at once (the gate's usual "two equal stable frames" would be a second, redundant rule). One weigh-in saves one row: frames less than 2 minutes apart (`SESSION_GAP_MS`; the owner's recording has sn steps 37, 19, 71, 58 and 17 s apart, so 71 s is the longest wait seen) are one weigh-in. The scale can sit on a value for two frames before the person has finished settling (107.9, 107.9, 107.9, 107.5, 108.6, 108.6 kg in the capture), so the first settled value is saved at once (the app may be closed right after) and a later settled value of the same weigh-in, within 3 kg, arrives marked `revision` and replaces that row (`reviseWeighIn`; the row goes back to `pending` for JoyoRogo, which keeps the last weight of the day). A lower sn, a silence over 2 minutes or a weight more than 3 kg away (someone else) starts a new weigh-in.
- **Key**: Settings > Timbangan shows "Kunci timbangan (lanjutan)" once a scale of this protocol is picked: 16 printable ASCII characters (surrounding whitespace is dropped), explained as coming from the Tuya developer platform (iot.tuya.com: cloud project, link the app account the scale is paired in, copy the device's `local_key`). It is kept per scale in `expo-secure-store` (`features/scale/secret.ts`, key `joyofit.scale.secret.<scale id with : as _>`), the same place as the sign-in token; not in the scale table, the log or the recording. Forgetting the scale, picking another one or "Hapus kunci" deletes it. Until it is saved, nothing listens for the scale and "Coba timbang" is disabled. A scale is bound by its address (Android MAC, which the beacon repeats; iOS peripheral id): the session only decodes advertisements of that id.
- **Weight only**: `weightOnly` on the protocol. `bodyOf` and `capture.ts` drop any impedance or body value for such a protocol, the UI says "berat saja" (picker, scale card), and the "fill in your profile for estimates" hint is not shown. The weight goes through the usual path: local history, the "Ini kamu?" guard, JoyoRogo's weight log.
- **Over the air**: JS only (`expo-secure-store` is already in the binary), so it ships with `scripts/ota.sh` to any build that already has the scale scan (the 2026-10-19 scale build). No native or `app.json` change.

### HUAWEI Scale 3 Pro / 3 / 2 Pro (Hagrid WSP, needs 3 keys)

Protocol `huawei-hagrid`: `protocols/hagridLib.ts` (framing, CRCs, crypto, payloads) and `protocols/huaweiHagrid.ts` (the session), derived from openScale's `HuaweiHagridWspLib.kt` and `HuaweiHagridWspHandler.kt` at `87edad4813e400cd4871109fc72a0bcf4d13f336` (GPL-3.0-or-later, "Copyright (C) 2026 openScale contributors", kept in the file headers). Picked by name like openScale: the advertised name contains `HUAWEI Scale 3 Pro`, `HUAWEI Scale 3`, `HUAWEI Scale 2 Pro`, `HONOR Scale 2`, a codename (`HAG-B19`, `Hagrid-B29`, `HEM-B19`, `LUP-B19`, `DOBBY-B19`, ...) or a product id (`M00F`, `M00D`, `M0CJ`, `N001`, `007B`). It sits before the SIG profile in `registry.ts` (these scales have 181B too).

**What a user's Scale 3 Pro showed** (iOS, App Store 1.1, 2026-10-26, four recordings): advertisement `HUAWEI Scale 3 Pro-241`, service `fff0`, no service or manufacturer data; a recorder that only listens gets nothing and the scale drops the link after about 22 s. The scale only talks after the handshake below, on these characteristics (all write + indicate):

| Service | Characteristic | Use |
|---|---|---|
| `181c` | `02b2a08e-f8b0-4047-b1fd-f4e0efeee679` request-auth | empty write; the scale indicates a 16-byte challenge randA (some firmwares add a status byte) |
| `181c` | `32330a04-15d9-421a-91c5-2a2d5c7525c9` auth-token | `randB | HMAC-SHA256(rand, HMAC-SHA256(rand, CAK | "1123"))`; the scale answers `HMAC(rand, HMAC(rand, CAK | "9856"))` |
| `181c` | `a3d330f8-b84f-4f48-a78c-f8d1e33b597a` send-work-key | a random work key, `iv | AES-128-CTR(root key)`; ack status 0 |
| `181c` | `42596cbe-d291-4da3-8ca6-d1ae5d1c9174` bind-request | only listened to (its frames are realtime weights); JoyoFit never binds |
| `181c` | `8cc61d7d-66c0-4802-89c3-38c5a163592e` set-user-info | 69 bytes under the work key: account id from manager info (or `joyofit:<address>`), uid `u:00000001`, sex, age, height, weight 0 |
| `181c` | `4338c65e-ed8e-4085-bbea-a25e33ca6b54` get-manager-info | the scale owner's account id, read before the user info |
| `1805` | `2a2b` current time | local time after the work key |
| `1805` | `75143e79-…de7e` product info, `1f5d3d5c-…9741` version, `7e6dbc73-…4695` unit | read once ready, logged |
| `1805` | `bfc36f6e-4150-4a4b-9052-3d359e52962e` / `ba216311-1787-472b-bef6-3eb29e62293e` measurement status | polled every 3 s (30 at most); 0 = measurement done, 1 = measuring |
| `181b` | `46797c17-d639-488d-9476-4789e8472878` realtime weight | 26 / 38 bytes: weight /100, fat /10, local time, 6 low-frequency impedance samples, heart rate, 6 high-frequency samples (38 bytes, the 3 Pro) |
| `181b` | `0212f42a-5f19-4bc1-ba52-d7ec7ccb71a4` history | the realtime layout plus two flags; each record is acknowledged with `00` until the last one (64 at most) |
| `181d` / `181b` | `2a9d` / `2a9c` | SIG weight / body composition, when sent unframed |

Framing: phone writes `DB` (plain) / `DC` (encrypted) `| len+3 | (total-1)<<4 | index | ≤15 bytes | CRC-16 LE` (polynomial 0x1021, init 0, over the frame with the CRC bytes zero); the scale sends `BD` / `CD` frames with CRC-16/MODBUS. Encrypted messages are `iv(16) | AES-128-CTR`. Root key = `SHA-256/16((SHA-256/16(C1 << 4 ^ C2) >> 6) ^ C3)`, C3 = the scale's Bluetooth address as 12 upper-case ASCII hex digits plus `0000`. Crypto is `@noble/ciphers` (AES) and `@noble/hashes` (SHA-256, HMAC), pure JS and audited, already in the bundle through better-auth and now direct dependencies; random bytes come from `expo-crypto` `getRandomBytes` (both in the binary).

Weigh-in: Scale 3: its realtime frame is the result (published at once, phone time). Scale 2 Pro / 3 Pro: realtime frames are shown live; when the status says done, the history read brings the result with the scale's time. A history record taken more than 2 minutes before this connection (`HISTORY_SLACK_MS`, weigh-ins the scale kept while the phone was away) is logged and not saved, since a weigh-in is stored at the time it arrives. A reading carries the weight, the body fat the scale sent (when 0 < fat < 80), `impedanceOhm` (the first valid high-frequency sample, else the low one) and `impedanceLowOhm` (the first valid low-frequency sample; the Scale 3 sends it in tenths of an ohm). The six low- and six high-frequency samples (the high band only on the 3 Pro; what each sample measures is not documented) and the heart rate go to the support log as raw values only. No estimate formula (`FORMULA_OF_PROTOCOL` has none for it); openScale's Scale 3 body-composition model (`libs/HuaweiScale3BodyComposition.kt`, a regression fitted to the vendor app's output) is not ported.

- **Keys (policy)**: the scale needs three 16-byte keys, CAK, C1 and C2, typed as 32 hex digits each. JoyoFit does not ship, embed, fetch or derive them and does not say how or where to get them; the app text only says "Timbangan ini butuh 3 kunci (CAK, C1, C2) sebelum mau mengirim data." No code from Huawei's apps is in JoyoFit. openScale's test with real C1 / C2 values (its "PoC capture" root key) is not ported for the same reason; root key, auth token and AES are checked against `node:crypto` with made-up keys instead. The keys are kept like the Tuya key (`secret.ts`, `expo-secure-store`, per scale, JSON `{cak, c1, c2, address}`), never in the database, the log or a recording, never sent anywhere. The trace of a weigh-in logs the writes made from them (auth token, work key, user info) by length only (`GattAction.redact`), and the session's notes never contain a key, the root or work key or the account id; `hagridWeighIn.test.ts` checks the trace and a parallel recording.
- **iOS address**: the root key needs the Bluetooth address, which iOS never gives an app (the scale id there is a per-phone UUID; the user's recording only has `F94E2300-DE49-926E-4EEA-6288AAF9A621`). Nothing the scale sends before the handshake is known to be its address: its Device Information System ID (`2a23` = `6beeca00001eb2c8`) sits among placeholder strings, the name suffix `-241` is three digits at most, and openScale reads the address from Android only. Guessing would derive a wrong root key, so on iOS the key form also asks "Alamat Bluetooth timbangan (12 digit hex)" (`SecretField.onlyWithoutAddress`); on Android the scale id is the address and the field is not shown.
- **Without keys**: the picker lists the scale with its model and "Perlu kunci timbangan"; once picked, the scale card says to enter the key and "Kunci timbangan (lanjutan)" shows the sentence above with the fields. Nothing connects until the keys are saved. "Rekam data timbangan" still records the scale as before (advertisements, GATT table, every indication, no writes).
- **Wrong keys**: an auth answer that does not match the CAK, or a refused work key, ends the connection (`GattStep.rejected`); the app stops listening and the key section says "Timbangan menolak kunci yang tersimpan. Hapus kunci, lalu isi lagi." A wrong C1, C2 or address is not caught by the scale's answers: the measurements then decrypt to noise, which the weight range, the history time check and "Ini kamu?" mostly stop.
- **Timers**: openScale's delays are deadlines in the session (`onTick`, called every second by `GattRun` while connected): manager info 2.5 s, user info ack 3 s, status poll 3 s (30 times, then the history read), and a status poll every 3 s after a Scale 3 weigh-in to notice the next one.
- **Over the air**: JS only. `@noble/*` are JS-only dependencies and `expo-crypto` / `expo-secure-store` are already in the binary, so the runtime fingerprint is unchanged (`expo-updates runtimeversion:resolve`: ios `dbe7aff58af45ad0b7cd989e1510416cba613938`, android `181bc001fc16bf4eb337900c131c37bb155d2690`, the same as master at 8b356b81); it ships with `scripts/ota.sh` to the builds of that runtime. Not tested on a real scale yet.

### Body composition

`ScaleReading.reported` carries only what a scale sends itself (the SIG profile does, a few vendors do). Without it, `bodyComposition.ts` estimates fat, water, muscle, bone, visceral fat and BMR from the impedance with the formula openScale uses for that scale family (`registry.ts`, `FORMULA_OF_PROTOCOL`), only when the person has a profile (height, birth year, sex in Settings > Profile). They are shown under "Perkiraan" with a note, apart from "Dari timbangan", and they can differ from the numbers in the scale's own app. No impedance, no profile or no formula for that family means no values. Impedance is not sent to JoyoRogo.

## Where things go

- **Local**: `scale` and `scale_reading` tables (`features/scale/store.ts`, created by `ensureScaleSchema` with the other JS-created schemas).
- **JoyoRogo**: `weight.checkIn` (`packages/api/src/routers/weight.ts` of JoyoRogo): weight to 0.1 kg and the Jakarta day, 25 to 400 kg, one row per user and day, the last write of the day wins. JoyoRogo has **no source field** (so `source: 'scale'` cannot be stored there; the source is kept locally) and **no body-composition fields** (waist is the only other body log), so fat and the rest stay in JoyoFit. A failed or offline push stays `pending` and is retried when the app opens and after the next weigh-in. After a push, the existing diary sync (`bodyMetricsFrom`, `src/features/meals/mealMap.ts`) hands the newest JoyoRogo weight to the watch.
- **Health Connect / Apple Health**: not written. JoyoFit's Health Connect and HealthKit writers (`HealthConnectExporter.kt`, `TYPES`) cover steps, heart rate, SpO2, resting heart rate, distance, active energy, sleep and exercise, not weight, so there is nothing to extend. Writing `WeightRecord` / `BodyFatRecord` needs new permissions and a rationale update in `modules/huawei-wear` and is a separate step.

## Behaviour

- Picking a scale makes it the only one. While the app is open, "Tangkap otomatis" is on (default) and a scale is picked, one `WeighSession` waits for it (slow radio duty cycle on Android). A test weigh-in switches to the fast one.
- Broadcast scale: each advertisement of that address is decoded; a weigh-in is final after two equal stable frames (some formats have no stable flag). A protocol with its own settle rule (Tuya beacon) is final at once on the frame it marks stable. Connected scale: it only advertises while awake, so the session waits for the advertisement, connects, runs the protocol, saves, disconnects and waits again.
- The same weight within 2 minutes is not saved again (`gate.ts`), except to add impedance to the weigh-in just saved.
- Multi-user guard (`guard.ts`): a weight more than 6 % (Normal; 12 % Longgar; Mati) from the person's last weight asks "Ini kamu?" before saving. The yardstick is the last local weigh-in (up to 45 days old), else JoyoRogo's latest weight, else the profile weight. "Bukan aku" discards it.
- The scan is shared (`hub.ts`): the picker, the recorder and the live session can run together; the hub runs one native scan for the union of what they ask.

## Permissions

Reuses `ensureSensorPermissions` (`features/sensors/permissions.ts`): Android 12+ `BLUETOOTH_SCAN` (declared `neverForLocation` in `modules/ble-sensors/android/src/main/AndroidManifest.xml`, unchanged) and `BLUETOOTH_CONNECT`; Android 11 and older need precise location to scan. The unfiltered scan works under `neverForLocation` (Android only hides iBeacon-style advertisements). iOS: the existing `NSBluetoothAlwaysUsageDescription` now mentions scales; the prompt appears with the first search. An unfiltered iOS scan works in the foreground only, which is all a weigh-in needs.

## Files

- Native: `modules/ble-sensors/android/.../{ScaleRadio,ScaleLink,ScaleLogic}.kt` (+ `SensorHub.kt`, `BleSensorsModule.kt`, `SensorErrors.kt`), `modules/ble-sensors/ios/{ScaleCentral,ScaleLogic}.swift` (+ `BleSensorsModule.swift`, `SensorCentral.swift`: `requireOn` is no longer private), `modules/ble-sensors/src/{BleSensors.types,BleSensorsModule}.ts`. Tests: `ScaleLogicTest.kt` and `SensorLogicTests/.../ScaleLogicTests.swift` (the Swift package symlinks `ScaleLogic.swift`).
- JS: `src/features/scale/` (`types`, `uuid`, `registry`, `protocols/*` (with `hagridLib`, `huaweiHagrid`), `secret`, `bodyComposition`, `body`, `gate`, `guard`, `capture`, `store`, `sync`, `rogoMap`, `hub`, `driver`, `weigh`, `discovery`, `recorder`, `report`, `profile`, `settings`, `ui/*`), `src/state/ScaleProvider.tsx`, `src/app/settings/scale.tsx`, `src/cloud/rogo.ts` (`checkInWeight`), `src/db/appSchema.ts`, i18n namespace `scale`.

## Test script for when the scale arrives

(For a Tuya beacon scale: pick it, "Kunci timbangan (lanjutan)" asks for the local key; with it saved, "Coba timbang" and step on. It reads weight only. For a HUAWEI Scale 3 / 3 Pro / 2 Pro: pick it, the same section asks for CAK, C1 and C2, and on iOS the scale's Bluetooth address; with them saved, "Coba timbang" and step on; the trace in Settings > Log shows `hagrid: ...` lines for each handshake step.)

1. Install a build that contains this branch (native change: store build or EAS development build, not OTA). Charge or put batteries in the scale, enable Bluetooth on the phone, sign in to JoyoRogo.
2. Settings > Timbangan > "Lanjut", allow Bluetooth. Step on the scale until its display is on, tap "Cari timbangan". A recognised scale shows with its type and, for advertisement scales, a live "Terbaca ... kg". Tap "Pakai ini".
3. If nothing is recognised: keep the scale awake, scroll to "Rekam data timbangan", tick the device (the scale usually has a short name or none; it is the one whose signal gets stronger when you hold the phone next to it), keep "Sambungkan juga" on, "Mulai merekam", step on the scale for 20 seconds, "Berhenti merekam", "Bagikan rekaman" and send it. The log lines are `scale: ...` (the in-app log, Settings > Log, shows them too).
4. With a recognised scale: tap "Coba timbang", step on, wait for the number to settle: "Tersimpan di riwayat" and a row in "Riwayat timbang" with "Terkirim ke JoyoRogo". Check the weight appears in JoyoRogo's weight log for today (Jakarta day).
5. Step on twice within two minutes: one row. Let someone else step on (or weigh a bag of rice): the "Ini kamu?" dialog appears; "Bukan aku" saves nothing.
6. Airplane mode, weigh in, back online, reopen the app: the row goes from "Menunggu dikirim" to "Terkirim".
7. Fill height, birth year and sex in Profile; a scale that sends impedance then shows "Perkiraan" body values (and says they are estimates).

## Checks

`bunx tsrs --noEmit`, `bun test ./src`, `bunx eslint src`, Android `./gradlew :ble-sensors:testDebugUnitTest :ble-sensors:lintDebug` and the Swift package `swift test` in `modules/ble-sensors/ios/SensorLogicTests` (all in CI). The Kotlin and Swift transport code (`ScaleRadio`, `ScaleLink`, `ScaleCentral`) has no unit test: it needs a radio, like `SensorLink`.
