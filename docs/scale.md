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

"Built from the layout" means the decoder matches the openScale source and its checksum rule, nothing more: the first real capture of such a scale may show a difference. Not covered: iComon, Lefu, Huawei, Beurer BF700, Omron, Medisana, Picooc, Huami S400 and the other openScale devices that are not in the table (no verifiable bytes were ported for them). A scale that is not recognised goes through "Rekam data timbangan".

### Tuya beacon scales (weight only, needs the local key)

Protocol `tuya-beacon-broadcast` (`protocols/tuyaBeacon.ts`, the same layer as the other decoders: XXTEA, CRC-8 and the parser are ported there, no native code). Frame: manufacturer data 0xD007, `0x05 | mac[6] | sn[4 BE] | enc[16]`; `enc` is one XXTEA block under the 16 ASCII characters of the device's Tuya `local_key`; plaintext `sn | dp 1 raw len 7 | value[7] | crc8 | 00`; weight = `u16be(value[0..2]) / 10` kg. A wrong key or a damaged frame fails the echoed sn or the CRC and reads nothing. Head `0x01` frames (idle, sn 0..2) do not decrypt and carry no reading; they only make the picker list the scale.

- **Settle rule**: there is no stable flag. The scale follows the weight while the person settles and then repeats the value with a higher `sn`, so a frame is final when the frame before it (lower `sn`, within 5 minutes) had the same weight. The same advertisement arriving again keeps its verdict. The decoder has memory, so it is built per listening session (`createDecoder`, `weigh.ts`), and `WeighSession` takes its stable flag as final at once (the gate's usual "two equal stable frames" would be a second, redundant rule). One weigh-in saves one row: frames less than 2 minutes apart (`SESSION_GAP_MS`; the owner's recording has sn steps 37, 19, 71, 58 and 17 s apart, so 71 s is the longest wait seen) are one weigh-in. The scale can sit on a value for two frames before the person has finished settling (107.9, 107.9, 107.9, 107.5, 108.6, 108.6 kg in the capture), so the first settled value is saved at once (the app may be closed right after) and a later settled value of the same weigh-in, within 3 kg, arrives marked `revision` and replaces that row (`reviseWeighIn`; the row goes back to `pending` for JoyoRogo, which keeps the last weight of the day). A lower sn, a silence over 2 minutes or a weight more than 3 kg away (someone else) starts a new weigh-in.
- **Key**: Settings > Timbangan shows "Kunci timbangan (lanjutan)" once a scale of this protocol is picked: 16 printable ASCII characters (surrounding whitespace is dropped), explained as coming from the Tuya developer platform (iot.tuya.com: cloud project, link the app account the scale is paired in, copy the device's `local_key`). It is kept per scale in `expo-secure-store` (`features/scale/secret.ts`, key `joyofit.scale.secret.<scale id with : as _>`), the same place as the sign-in token; not in the scale table, the log or the recording. Forgetting the scale, picking another one or "Hapus kunci" deletes it. Until it is saved, nothing listens for the scale and "Coba timbang" is disabled. A scale is bound by its address (Android MAC, which the beacon repeats; iOS peripheral id): the session only decodes advertisements of that id.
- **Weight only**: `weightOnly` on the protocol. `bodyOf` and `capture.ts` drop any impedance or body value for such a protocol, the UI says "berat saja" (picker, scale card), and the "fill in your profile for estimates" hint is not shown. The weight goes through the usual path: local history, the "Ini kamu?" guard, JoyoRogo's weight log.
- **Over the air**: JS only (`expo-secure-store` is already in the binary), so it ships with `scripts/ota.sh` to any build that already has the scale scan (the 2026-10-19 scale build). No native or `app.json` change.

### HUAWEI Scale 3 Pro: link probe in the recorder (not supported yet)

A user's recording (iOS, App Store 1.1, 2026-10-26, four sessions): advertises `HUAWEI Scale 3 Pro-241` with service `fff0` only, no service or manufacturer data, so no broadcast weight. GATT: `180a` (placeholder strings, PnP `2a50` = `01 a706 0000 1001`), `181c` (12 vendor 128-bit characteristics, write + indicate), `1805` (`2a2b` + 14 vendor ones), `181b` (3 vendor ones), `fff0/fff1`, `1880` (`1881`..`1888`, `188a` + 3 vendor), `18a0/18a1`, and **`fe86`: `fe01` write without response, `fe02` notify**, the Huawei link our watches use. A recorder that only listens gets nothing and the scale drops the link after about 22 s, every time.

So the recorder (`recorder.ts`, only while recording with "Sambungkan juga" on) asks any device with `fe86/fe01` + `fe02` one question before it subscribes to anything else: link parameters, service `01` command `01`, the frame `5a000b0001010100020003000400f13b` written to `fe01`. It is a query and changes nothing on the device. The notifications on `fe02` are logged raw as always and, once a whole frame is in, decoded on an `info` line (`huawei-link <id> frame service=01 command=01 crc ok link params: protocolVersion=… authVersion=… bondState=… mtu=… sliceSize=… deviceSupportType=… authAlgo=… encryptMethod=… interval=… other={…}`). A link that closes without an answer logs `huawei-link <id>: no answer to the link params request`. The current time is **not** written to `1805/2a2b`: it changes the device and is not needed to learn the handshake.

`huaweiLink.ts` is written from our own Watch Fit 4 Pro capture (`modules/huawei-wear/ios/HuaweiProtocol/Tests/HuaweiProtocolTests/Fixtures/real-ble-frames.txt`) and tested against its frames (request bytes, CRC-16/XMODEM of every frame, the decoded answer). It does not use the huawei-wear link layer: that layer lives in another native module bound to the paired watch, and it derives from Gadgetbridge. JS only: the native scale link already writes without response, so the probe ships over the air to every build with the scale recorder (`docs/ota.md`, publish for the runtime of the binary the user runs).

What the next recording has to show: whether the scale answers on `fe02`, and with what (protocol version, auth version, bond state, max frame). An answer means the watch-style handshake (auth, then the weight commands) is the next step; no answer, or the same drop at 22 s, points to one of the vendor services (`181c`, `1880`, `fff0`) instead.

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
- JS: `src/features/scale/` (`types`, `uuid`, `registry`, `protocols/*`, `secret`, `bodyComposition`, `body`, `gate`, `guard`, `capture`, `store`, `sync`, `rogoMap`, `hub`, `driver`, `weigh`, `discovery`, `recorder`, `huaweiLink`, `report`, `profile`, `settings`, `ui/*`), `src/state/ScaleProvider.tsx`, `src/app/settings/scale.tsx`, `src/cloud/rogo.ts` (`checkInWeight`), `src/db/appSchema.ts`, i18n namespace `scale`.

## Test script for when the scale arrives

(For a Tuya beacon scale: pick it, "Kunci timbangan (lanjutan)" asks for the local key; with it saved, "Coba timbang" and step on. It reads weight only.)

1. Install a build that contains this branch (native change: store build or EAS development build, not OTA). Charge or put batteries in the scale, enable Bluetooth on the phone, sign in to JoyoRogo.
2. Settings > Timbangan > "Lanjut", allow Bluetooth. Step on the scale until its display is on, tap "Cari timbangan". A recognised scale shows with its type and, for advertisement scales, a live "Terbaca ... kg". Tap "Pakai ini".
3. If nothing is recognised: keep the scale awake, scroll to "Rekam data timbangan", tick the device (the scale usually has a short name or none; it is the one whose signal gets stronger when you hold the phone next to it), keep "Sambungkan juga" on, "Mulai merekam", step on the scale for 20 seconds, "Berhenti merekam", "Bagikan rekaman" and send it. The log lines are `scale: ...` (the in-app log, Settings > Log, shows them too).
4. With a recognised scale: tap "Coba timbang", step on, wait for the number to settle: "Tersimpan di riwayat" and a row in "Riwayat timbang" with "Terkirim ke JoyoRogo". Check the weight appears in JoyoRogo's weight log for today (Jakarta day).
5. Step on twice within two minutes: one row. Let someone else step on (or weigh a bag of rice): the "Ini kamu?" dialog appears; "Bukan aku" saves nothing.
6. Airplane mode, weigh in, back online, reopen the app: the row goes from "Menunggu dikirim" to "Terkirim".
7. Fill height, birth year and sex in Profile; a scale that sends impedance then shows "Perkiraan" body values (and says they are estimates).

## Checks

`bunx tsrs --noEmit`, `bun test ./src`, `bunx eslint src`, Android `./gradlew :ble-sensors:testDebugUnitTest :ble-sensors:lintDebug` and the Swift package `swift test` in `modules/ble-sensors/ios/SensorLogicTests` (all in CI). The Kotlin and Swift transport code (`ScaleRadio`, `ScaleLink`, `ScaleCentral`) has no unit test: it needs a radio, like `SensorLink`.
