# JoyoFit on iOS: the Huawei watch link

The iOS side of `modules/huawei-wear` speaks the same protocol as the Android module, over CoreBluetooth, and exposes the same
JS API (`modules/huawei-wear/src/HuaweiWearModule.ts`). Building the app is in [ios-linux.md](ios-linux.md). Status: pairing, connect,
battery and the activity/sleep sync were run on a real iPhone with the Huawei Watch Fit 4 Pro. **Everything added after that (find my
watch, notifications through ANCS, watch faces, workouts, alarms, health sensor switches, stress, HRV, weather, and the second parity round:
activity goals, body metrics, full history, morning sleep report, fall detection, meals, cycle, live workout, Healthy Living, running courses,
the Huawei Health export import) is tested only on this Linux box (Java golden vectors, Kotlin test vectors, fake watches, SDK type-check)
until it is run on the iPhone**; see the last section.

## Layout

```
modules/huawei-wear/
  expo-module.config.json         platforms android + ios (ios.modules, appDelegateSubscribers)
  ios/
    HuaweiWear.podspec            ONE pod, ONE Swift module `HuaweiWear`: ios/*.swift + HuaweiProtocol/Sources/**
    HuaweiProtocol/               SwiftPM package, pure Swift, no dependencies, builds on Linux and macOS/iOS
      Sources/HuaweiProtocol/     crypto, TLV, framing, session, packets, authenticator, initializer, syncs
      Tests/HuaweiProtocolTests/  716 tests; Fixtures/*.json are generated from the Java the Android app runs
      GoldenGen/                  run.sh + Golden*.java: regenerates the fixtures (JDK 17, no Android SDK needed)
    BleTransport.swift ...        CoreBluetooth central, Keychain store, SQLite sync store, HealthKit writer, Expo module
    ModuleLogicTests/             SwiftPM package compiling the same sources as one module; 434 logic tests on Linux
    scripts/                      check-api.mjs (JS API coverage), gen-migrations.mjs (embeds schema/joyofit-db-migrations.json)
```

The protocol is a port of the vendored Gadgetbridge Java (`android/src/main/java/nodomain/**`, AGPL-3.0-or-later, see NOTICE) and of the
Kotlin session layer (`com/joyodigitama/huaweiwear/*.kt`), quirks included. The crypto (SHA-256, HMAC, HKDF, PBKDF2, AES-CBC, AES-GCM
with 16-byte IVs) is written out in the package because CryptoKit rejects what the watch sends and CommonCrypto is not on Linux.

## What is ported

| Layer | Swift | Evidence |
|---|---|---|
| CRC16, TLV/VarInt, slicing, reassembly, TLV encryption | `Packet.swift`, `TLV.swift`, `CRC16.swift` | byte for byte against the Java (`framing.json`, `primitives.json`) |
| Crypto and HuaweiCrypto digests, key derivation | `AES.swift`, `SHA256.swift`, `HuaweiCrypto.swift` | byte for byte against the Java |
| Session (request/response, subscriptions, MTU split) | `Session.swift` | fake watches |
| DeviceConfig packets (LinkParams, SecurityNegotiation, PinCode, HiChain, Auth, Bond, ProductInfo, battery, capabilities...) | `Packets/DeviceConfigPackets.swift` | Java golden |
| HiChain3 / HiChain / HiChain Lite / normal auth, first bind and reconnect | `HuaweiAuthenticator.swift` | fake watch (both sides derived from the Kotlin); real LinkParams, SecurityNegotiation and PinCode frames (`RealWireTests`) |
| Init (product info, time, battery, services, commands, ExpandCapability, account, settings, ...) | `HuaweiInitializer.swift` | fake watch |
| Activity sync: step frames, sleep frames, totals | `Packets/FitnessDataPackets.swift`, `ActivitySync.swift` | Java golden, fake watch |
| Sleep files: 2C/0A downloads, sequence data, dictionary sleep and TruSleep parsers | `FileDownloader.swift`, `SleepSync.swift`, parsers | Java golden (about 3,700 summary cases), fake watch |
| DataSync (0x37): config command, then the whole framework (config/event/point/dictionary builders and parser, capability gates, handler dispatch) | `Packets/DataSyncPackets.swift` (golden), `DataSyncWire.swift`, `DataSyncService.swift` | Java golden for the config command; Kotlin test vectors and a fake watch for the rest |
| Find my watch (DataSync config 900100002, ExpandCapability 79 and 83) | `FindWatch.swift`, `PhoneFeatures.swift` | Java golden, fake watch |
| FileUpload (0x28), watch faces (0x27): list, install a `.hwt`, activate, delete; face customization; photo face | `FileUploader.swift`, `WatchfaceOps.swift`, `WatchfacePackage.swift`, `ZipReader.swift`, `WatchfaceCustomizer.swift`, `PhotoFace*.swift`, `PngDecoder.swift`, `ios/WatchfaceController.swift`, `ios/PhotoFaceController.swift` | Java golden for the GB packets, Kotlin test translations, 10 real `.hwt` files, fake watches |
| Workouts: 17/07..16 packets, GPS file, record builder, sync phase, `workouts` and `workout_points` rows, Apple Health `HKWorkout` + route | `Packets/WorkoutPackets.swift`, `WorkoutSync.swift`, `WorkoutRecord.swift`, `HuaweiGpsParser.swift`, `ios/WorkoutStore.swift`, `HealthKitWriter.swift` | Java golden, fake watch, SQLite tests, plan tests |
| Alarms (08/01-04), health sensor switches (continuous HR, SpO2, TruSleep, alerts), heart-rate zones, live heart rate, automatic stress, HRV spot measure | `Alarms.swift`, `HealthSensors.swift`, `HeartRateZones.swift`, `StressSwitch.swift`, `HrvSpotCodec.swift`, `ios/WatchSettingsFeatures.swift` | Java golden (the stress model bit for bit), Kotlin test translations, scripted watch |
| Weather (0x0F, current + 24 h + 8 days, GPS, unit) over Open-Meteo, CoreLocation, URLSession | `Packets/WeatherPackets.swift`, `HuaweiWeather.swift`, `OpenMeteo.swift`, `ios/WeatherController.swift`, `ios/CoreLocationSource.swift` | Java golden, recorded Open-Meteo answers, scripted watch |
| Notifications: the watch's own switch (02/04) and `CBPeripheral.ancsAuthorized` | `Packets/NotificationPackets.swift`, `ios/WatchNotifications.swift`, `BleTransport.swift` | Java golden, scripted watch |
| Strava (Settings → Strava, Send to Strava, automatic upload): JS only, no native call; the native side is the shared SQLite schema: `workouts.imported`, `strava_upload` (migrations 10 and 11) | `WearMigrations.swift`, `ios/WorkoutStore.swift` | SQLite tests: the JS candidate query on rows the Swift store wrote, upgrade of the build 202610160151 database |
| FIT file import (Settings → Import a FIT file): JS only (`@garmin/fitsdk`, `expo-file-system`), `imported = 1` rows kept out of exports; Info.plist document type for `.fit` (not tried on a device) | `src/features/fitimport/`, `app.json` | bun tests with FIT files from the app's own encoder and the shared schema in SQLite |
| GPX and TCX routes (Watch → Rute → Impor GPX/TCX, share sheet, Open in): JS only (`src/features/routes/`, files in `Paths.document/routes`); Info.plist document types and imported UTIs `com.joyodigitama.joyofit.gpx` and `.tcx` (not tried on a device) | `src/features/routes/`, `src/features/sharedfile/`, `app.json` | bun tests with Strava-style and Garmin-style GPX and TCX fixtures |

Second round (every row: Java golden where the Java has the packet, Kotlin test vectors translated where only the Kotlin has it, fake or scripted watches):

| Layer | Swift | Evidence |
|---|---|---|
| Activity-ring goals (8 DataSync configs, also the profile step goal) and body metrics (weight, resting metabolism, the watch's weight and Health Glance requests, `body_metrics` table) | `ActivityGoalsCodec.swift`, `BodyMetricsCodec.swift`, `ios/ActivityGoals.swift`, `ios/BodyMetrics.swift` | Java golden, Kotlin `BodyAndGoalsTest`, fake watch |
| `syncFullHistory`: activity, sleep and workouts pulled again from the beginning, sliced; not night HRV (iOS has no night HRV sync) | `WearLink.runSync(fullHistory:)`, `SyncStore.syncSlices` | fake watch |
| Morning sleep report (event 80030001) and fall detection (config 900500038, query on connect); the watch's SOS event is answered "not sent" | `SleepReport.swift`, `SafetyPayloads.swift`, `ios/SleepReportFeature.swift`, `ios/SafetyFeatures.swift` | Kotlin test translation, scripted watch |
| Meals / calorie intake (configs 900300023/22, meal slots, the watch's quick-log with `onWatchMealLogged`, `diet_day` table) | `Diet.swift`, `ios/DietSync.swift` | Kotlin `DietSyncTest` vectors, scripted watch |
| Menstrual cycle (service 0x32, flow dictionary 400018, log, estimates; `cycle_periods`/`cycle_days`) | `CycleModel.swift`, `MenstrualCodec.swift`, `Packets/MenstrualPackets.swift`, `ios/MenstrualFeature.swift`, `ios/CycleStore.swift` | Java golden, Kotlin `MenstrualTest`, scripted watch |
| Live workout (reverse linkage, 17/11 reports, 17/03 poll, phone-side session on the realtime heart rate, phone GPS to the watch as 18/03 fixes while the app is open) | `LiveWorkoutCodec.swift`, `ios/LiveWorkout.swift`, `ios/WorkoutLink.swift`, `ios/CoreLocationStream.swift` | Java golden, Kotlin `LiveWorkoutTest`, scripted watch |
| P2P stack, Healthy Living (health metric sync), running courses (28/xx file push), Track-watch HR zones | `P2PManager.swift`, `P2PDictionarySync.swift`, `HealthModel.swift`, `CourseProtobuf.swift`, `HealthMetricsSync.swift`, `ios/P2pController.swift` | Java golden (`p2p.json`), Kotlin `P2pTest` vectors, scripted watch |
| Route navigation on the watch (P2P `fitness` handshake type 5 and file type 6, Huawei Health's "Send to wearable"; byte-exact port of Gadgetbridge's `HuaweiConvertTrack`, Java `StrictMath` sin/cos/atan2 as `FdLibm.swift`) | `RouteFile.swift`, `FdLibm.swift`, `CourseProtobuf.swift` (`FitnessCourseService` route answers), `ios/P2pController.swift` (`routesStatus`, `pushRoute`) | Java golden (`route.json`, 9 converted files byte for byte), Kotlin `RouteFileTest`, scripted watch |
| Huawei Health export import (Privacy Centre ZIP, streamed, WinZip AES and ZipCrypto, `imported = 1` rows kept out of exports) | `ZipArchive.swift`, `ZipCrypto.swift`, `HuaweiExport*.swift`, `HuaweiMotionPathParser.swift`, `HuaweiHealthDetailParser.swift`, `ios/HuaweiImportController.swift`, `ios/HuaweiImportStore.swift` | archives written by zip4j (the library Android uses), Kotlin test vectors |

Not ported: night HRV (`NightHrv.kt`; the app says "Night HRV is not read on iPhone yet" on Recovery, Readiness and Trends instead of
waiting for a night that never arrives, and the iOS support report has a `Night HRV: not read on iPhone` line) and the once-a-day "Morning
summary" local notification (it needs the notification permission prompt; not part of this round), Android's ongoing live-workout
notification (same reason). What iOS cannot do at all: forwarding other apps'
notifications and the per-app list (see below), find my phone, calls and call control, SOS text messages.

## Features iOS cannot do, and what the app says

- **Notifications.** iOS gives an app no access to other apps' notifications, so there is no forwarding and no per-app list. The watch reads
  the iPhone's notifications itself over ANCS once the user allows it (Settings > Bluetooth > the watch > Show Notifications, or the system
  prompt). JoyoFit switches the watch's own notification setting (02/04, only after the user chose in the app, so a switch set elsewhere is
  left alone) and shows `CBPeripheral.ancsAuthorized` as "iPhone shares notifications with the watch" (log line `ANCS ... authorized`).
- **Find my phone, calls, call control.** iOS suspends the app and gives it no call access, so the Settings screen explains this instead of
  offering switches. **SOS text messages**: iOS does not let an app send an SMS by itself.
- **Per-app notification filter.** There is no watch-side command for it: the 02 service has only the on/off switch (02/04), constraints,
  capabilities and per-notification push/remove/reply (`Notifications.java`); Android's per-app choice is purely phone-side, applied before
  forwarding. On iOS the filter is iOS's own (Settings > Notifications > each app), so the app list stays an explanation.
- **SOS text messages.** The watch's SOS request is still answered ("nothing was sent", status 1) so the person is not left waiting.
- The morning summary notification shows "not available on iOS yet".

## The JS API on iOS

All 98 members of the Android module's TS interface exist (`node modules/huawei-wear/ios/scripts/check-api.mjs` prints the split): 87
implemented, 3 inert getters (morning summary, notification apps, SOS relay test), 1 no-op, 5 off-switches (`false` resolves, `true` rejects:
find my phone, calls, call control, SOS relay, morning summary) and 2 that reject `ERR_UNSUPPORTED` (the Android notification access screen and
the per-app switch). The screens of those say why on iOS instead of offering the control (`src/components/IosUnavailable.tsx`). Nothing
claims to have reached the watch unless it did.

## iOS specifics

- **Finding the watch (JRG-173).** FE86 is not advertised, so there is no service filter: a foreground scan (duplicates on, so a name or `0xFDEE`
  service data that comes in a later packet still counts) matches the advertised name (`HUAWEI WATCH FIT 4 Pro-xxx`, same stem rule as Android)
  or the `0xFDEE` service data. The Watch tab list (`bondedDevices`, `refreshBondedDevices`) is the union of: the remembered watch; the Huawei and
  Honor watches iOS **already holds a connection to** (paired in Settings > Bluetooth, held by ANCS or another app), which never advertise and so
  no scan shows them: `retrieveConnectedPeripherals(withServices:)` with a broad probe list (`BleUUID.systemConnectedProbe`: FE86, the Honor
  service, FDEE and the standard services the Fit 4 Pro's GATT database holds, 1800, 1801, 3802, 180F, 180D, 1812, its vendor service, plus
  180A and 1805), kept only when named Huawei/Honor or the remembered identifier; and a 4 s scan. Rows carry `nearby` and `systemConnected`.
  The system list is asked every time; the scan result is cached 30 s but an empty scan is never cached, and Refresh (`refreshBondedDevices`,
  pull to refresh) ignores the cache and scans 8 s. The identifier is remembered and later connects use `retrievePeripherals` first, then the
  system-connected list by identifier and by the full Bluetooth name (iOS hands a re-paired watch a new identifier; connecting by the remembered
  identifier keeps the stored key, so a same-named watch under a new identifier is one row, never a second one that would bind again).
- **A watch linked to another phone does not advertise.** The Android phone running JoyoFit in background mode (or Huawei Health) holds the watch's
  one link; the iPhone cannot see it and nothing in the app can change that. When no listed watch is `nearby`, the Watch tab says "Watch not
  found. If it is still connected to another phone, disconnect it there first. Make sure the watch is on and close to this phone, then tap
  Refresh" and a failed connect (`ERR_CONNECT_FAILED`, `ERR_TIMEOUT`, `ERR_DISCONNECTED`, `ERR_AUTH_FAILED`) shows the same advice with a
  **Retry** button (`src/features/device/connectFailure.ts`, shared with Android).
- **A watch that connects and then says nothing** (`Authentication timed out: LinkParams: no response (service 0x01, command 0x01) within 10000 ms`,
  reported by an iPhone owner with a Fit 4, no log). Where it sits: `BleTransport.open()` connects, discovers the services and characteristics
  and returns only after `didUpdateNotificationStateFor` confirmed the FE02 subscription (GB queues `notify(read, true)` before the first write
  too), then the 16-byte LinkParams frame goes to FE01 as a write without response (GB's `HuaweiLESupport.getSendWriteRequestResponse()` is
  `false`; the Fit 4 Pro's FE01 only allows that type) and no notification comes back. `BleTransport.kt` does the same steps, plus
  `requestMtu(512)`. What only iOS adds: the link can be shared with the system or another app, iOS caches the GATT table of a bonded
  peripheral, and a write without response never reports an error. Causes, none confirmed (no capture): (1) the Huawei session on that link
  is not ours: Huawei Health on this iPhone or Settings > Bluetooth holds the link (`cancelPeripheralConnection` only drops JoyoFit's claim,
  the log says `iOS already holds a connection to this watch before JoyoFit opens its own`), or another phone's Huawei Health or JoyoFit owns
  the watch's one session; an authenticated session ignores a plaintext LinkParams; (2) FE01 wants an encrypted link: the dropped write
  has no ATT error, and iOS starts pairing only when an operation fails with insufficient authentication, while every Android run so far was
  from a phone with a Classic bond (the README's "not tested" line); (3) a stale cached GATT table (unlikely, the CCCD write was accepted);
  (4) the watch itself (just restarted, in a pairing or reset state, power saving), which only a restart shows. Not the cause: the service
  choice (FE86 is what the Fit 4 Pro answers on; missing FE01/FE02 fails earlier with "no Huawei GATT characteristics"), the MTU, the order of
  subscribe and write. In code (`HuaweiAuthenticator.requestLinkParams`, `BleTransport.recoverLink`; native, needs the next iOS build):
  LinkParams is asked up to three times (waits 10 s, 8 s, 8 s; 1 s and 2 s quiet before the 2nd and 3rd). Before the 2nd the notifications are
  switched off and on and the services are discovered again; before the 3rd the GATT link is closed and opened anew, discovered again, and the
  other write type is used if FE01 allowed both. Every step logs a `link before LinkParams attempt N: ...` line (peripheral state,
  notifying, write types, `canSendWriteWithoutResponse`, ANCS, whether iOS already held the link) to the support report, and the last error
  keeps the `LinkParams: no response` text. In the app (JS, over the air): a LinkParams timeout is `kind: 'silent'` in `connectFailure.ts`;
  the Watch tab shows `SilentWatchHelp` (disconnect from Huawei Health and other phones, forget the watch in Settings > Bluetooth on iOS,
  restart the watch, toggle Bluetooth) with **Coba lagi** and **Kirim laporan** (share sheet with the support report, so the BLE log), and Today
  shows the short line; the native English error of the state event no longer replaces what the failed `connect()` worded.
- **MTU.** iOS negotiates it. Writes are cut to `maximumWriteValueLength(for: .withoutResponse)` with write-without-response flow
  control; notifications of any size are reassembled. The negotiated length and every chunk size are logged (tag `JoyoFitBle`, support report).
- **First bind replaces the existing binding.** The watch keeps one credential. A first bind needs two confirmations (ACCEPT on the watch and
  iOS's system pairing dialog, which appears by itself; the transport never requests encryption or disconnects meanwhile) and its waits are 120 s.
  The bind-or-reconnect decision comes from SecurityNegotiation tag 0x02 (authType 5 = the watch does not know this phone, 6 = known). A
  background reconnect never starts a bind (`firstBindAllowed: false`): it logs and stops. An interactive `connect()` does not bind by itself
  either: it stops at the same point (before the PinCode request, nothing on the watch changes) and rejects `ERR_BIND_CONFIRMATION`; the Watch
  tab then shows its own confirmation ("Pair this watch with this phone?", button Continue) saying the other phone's or app's pairing will be
  replaced, and only Continue calls `confirmBind(address)` (single use, per watch, cleared by the connect it belongs to, by disconnect and by
  forget) and connects again. Android behaves the same. Android-side findings behind this are in `protocol/README.md` (the 2026-10-16
  observations).
- **Background.** `setBackgroundEnabled` means: reconnect the remembered watch when iOS wakes the app for the `bluetooth-central` session
  (pending connect + state restoration), then authenticate, sync and read the battery inside a background task. Nothing runs while the process
  is suspended.
- **Reconnect when the app opens.** With background mode off nothing holds the link once the app is suspended or closed, so on the next open the app connects the
  remembered watch by its stored identifier by itself (`src/state/useAutoReconnect.ts`, JS only; see "Reconnecting a known watch" in `docs/watch-reference.md`): the
  native connect already tries `retrievePeripherals` before any scan, and a first bind is never started (it stops with `ERR_BIND_CONFIRMATION` and the app stays quiet
  until a tap on Connect). It does not run after the person tapped Disconnect. No Swift change, no new build.
- **Family monitoring upload** (`FamilyUploader.swift`, `FamilySummary.swift`, `FamilySettings.swift`, `FamilyBackgroundSession.swift`; contract in
  `docs/family-monitoring.md` section 10). `familyConfigure` keeps the scopes in UserDefaults (`joyofit_family`) and the bearer token in the Keychain
  (after first unlock); `null` removes both with the last result, the last payload and any queued body. After every successful background sync
  (`BackgroundController.cycle`, after the battery read) the summary of the granted categories is built from `joyofit.db` (three local days,
  `imported = 0` rows only, a category whose scope is off is never queried), written to `<Caches>/family-ingest/ingest-<ms>.json` and handed to a
  background `URLSession` (`com.joyodigitama.joyofit.family-ingest`, not discretionary) as `PUT <baseUrl>/v1/family/ingest`, so the system finishes
  the upload if iOS suspends the app right after the sync. The answer arrives through the session delegate, in this process or in the one iOS
  relaunches (`handleEventsForBackgroundURLSession` in `HuaweiWearAppDelegateSubscriber`): 2xx is `sent` (the body becomes `lastPayload`), 401/403
  `rejected` (the config is dropped), anything else `failed` (the next sync retries). One request per 10 minutes unless forced, except when the
  watch synced again since the last one. `familyUploadNow` sends in the foreground and always. expo-file-system's app delegate subscriber keeps the
  system completion handler of every background session until one of its own finishes, so `releaseFileSystemHandler` tells it ours is done.
  No new background mode or `BGTaskScheduler` entry: a refresh task would need `fetch` and `BGTaskSchedulerPermittedIdentifiers` in Info.plist and
  could only upload what the last sync already queued.
  What iOS does not do, for the in-app honesty card: nothing runs after the user force-quits JoyoFit (no Bluetooth wake, and iOS cancels that
  app's background transfers) until JoyoFit is opened again; after a restart nothing runs before the first unlock; a sync happens only when iOS wakes
  the app because the watch came into range (a pending connect to the remembered watch, or state restoration), never on a timer while suspended, so
  a watch out of range or Bluetooth off means no new data; iOS decides when a queued upload goes out (Low Power Mode, Low Data Mode, no signal
  and the cellular switch of JoyoFit delay it, and a body that could not go out within 2 hours is dropped for the next sync's); the result shows in
  the app only once iOS delivers it, possibly at the next app open.
- **Storage.** The auth key, fake MAC and fake id are Keychain items (after first unlock). Sync rows go to the same SQLite file and schema the JS
  reads (`<Documents>/SQLite/joyofit.db`, migrations embedded from `schema/joyofit-db-migrations.json`; `gen-migrations.mjs` regenerates them).
- **Apple Health.** Steps, heart rate, SpO2, resting heart rate, distance, active energy and sleep stages are written with
  `HKMetadataKeySyncIdentifier`/`SyncVersion` so a re-export replaces instead of duplicating (the counterpart of Health Connect's
  `clientRecordId`). Sleep has no session record, so the writer removes this app's overlapping sleep samples first. JoyoFit never reads Health.

## Commands

```bash
export PATH=$HOME/.local/swift-6.4/usr/bin:$HOME/jdk17/bin:$PATH
bun run test:ios-protocol            # swift test in HuaweiProtocol (716 tests)
bun run golden:ios                   # regenerate the Java golden fixtures (then re-run the tests)
cd modules/huawei-wear/ios/ModuleLogicTests && ./link-sources.sh && JOYOFIT_REPO_ROOT=$PWD/../../../.. swift test   # 434 tests
scripts/build-ios-linux.sh --dev     # signed JoyoFit-dev.ipa (docs/ios-linux.md)
```

The package also type-checks against the iPhoneOS SDK (`swiftc -typecheck -sdk <iPhoneOS27.0.sdk> -target arm64-apple-ios16.0
-resource-dir <darwin toolchain>/usr/lib/swift`), and the whole pod compiles and links in the pipeline.

## Needs the real iPhone (untested)

- Install and launch the dev ipa; Bluetooth, HealthKit and (first bind) system pairing prompts.
- Everything in the "What is ported" rows after the sleep files: each was checked only against the Java golden vectors, fake watches and the
  SDK type-check. In particular: whether the Fit 4 Pro reports ExpandCapability 79 and 83 (support report line `ExpandCapability: ...`) and
  rings; that the watch's notification switch (02/04) makes it show the iPhone's notifications once ANCS is authorized (the log shows
  `ANCS ... authorized: yes/no` on connect); a Fit 4 Pro removes unsigned watch faces (100014), signed ones need the `signature` argument;
  the HealthKit workout, heart-rate series and route (`HKWorkoutBuilder`, `HKWorkoutRouteBuilder`) were never run; CoreLocation's when-in-use
  prompt for weather; the stress calibration's last-bit agreement of Apple's libm with the Java (Linux glibc matches on all vectors).
- Second round, all untested on a watch: the DataSync configs of goals, body metrics, meals, fall detection and the cycle (service 0x32 and
  dictionary 400018 have never been on a wire, not even from Android); the sleep report; live workout: whether the Fit 4 Pro asks for GPS over
  18/02 and takes fixes from a foreground `CLLocationManager` (fixes stop when the app is backgrounded; the system location prompt can appear
  the first time the watch asks for the phone's GPS); P2P Healthy Living and the course push (experimental on Android too); the Huawei export
  import on a real multi-GB archive from the Files app (security-scoped access, memory, speed).
- Scanning and connecting to the watch from CoreBluetooth; the real negotiated MTU and chunk sizes; notification delivery order.
- JRG-173, none of it run on the iPhone yet: that `retrieveConnectedPeripherals` with the probe list returns a Fit 4 Pro that iOS holds through
  Settings > Bluetooth (the Fit 4 Pro's service list comes from an Android GATT read, not from iOS's cache); connecting such a watch from the app;
  the "Watch not found" advice while the Android phone holds the watch; the bind confirmation before a first bind and none on a reconnect.
- The LinkParams retry and recovery (`BleTransport.recoverLink`: notifications off and on, services discovered again, the link closed and
  opened anew, the other write type): the retry loop is tested against a scripted watch (`AuthFlowTests`), but the `BleTransport.swift` part is
  CoreBluetooth-only, so it was never compiled on Linux and never run on an iPhone. Whether any of it makes a watch that is silent on first
  contact answer is open: the cause of the 2026-10-18 report is unknown until its support report arrives.
- A reconnect with a key bound from iOS (HiChain op2) and a first bind over LE (op1 steps 2 to 4 are unproven on any client; only step 1 was
  seen, from Android, which loses the 514-byte reply on Android 14+).
- State restoration and the background wake path; the Keychain after reinstall; HealthKit replacement on a repeated sync identifier; expo-sqlite
  sharing the database file with the native writer (the connection is kept open for the process lifetime because expo-sqlite links its own SQLite).
- Family upload, none of it run on an iPhone: that the background `URLSession` finishes an upload after the app is suspended and relaunches the app
  with the result (`handleEventsForBackgroundURLSession`), that the system's completion handler is released through `releaseFileSystemHandler`
  (it calls expo-file-system's `invokeCompletionHandlerForSessionIdentifier:` by selector), how long iOS defers the transfer in Low Power Mode, and
  whether a bluetooth wake after a restart or a memory kill reaches `BackgroundController.cycle`.
- Strava: the connect page in `ASWebAuthenticationSession` and its return to `joyofit://settings/strava` (the Worker side was probed over HTTP,
  the in-app part never ran on an iPhone); an upload of a Swift-written workout to Strava (the FIT builder and the rows are checked, Strava's
  answer is not); that the automatic pass sends a workout the watch synced while the app was in the background once the app is opened.
- `ITSAppUsesNonExemptEncryption=false` is set; the protocol link implements AES/HMAC itself (not through Apple's OS crypto), so the owner has to
  confirm that answer before App Store submission. The `expo-image-picker` and `expo-media-library` plugin entries in `app.json` set the photo library, photo-add and camera strings
  (camera: "Take photo" on the workout share screen) and drops the microphone string; `expo-secure-store` still adds a default Face ID string
  that JoyoFit does not need.
