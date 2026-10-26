# JoyoFit on the App Store: listing copy and answers

What was entered in App Store Connect for app 6823324343 (version 1.0). Regenerate the screenshots with `node .tmp/storeframes/render.mjs` from the repo root
(frames in `.tmp/storeframes/frame.html`, source captures in `.tmp/storeframes/shots/`, output 1242x2688 for APP_IPHONE_65).

The screenshots are real captures of the app's own screens (the JS UI is shared with Android), framed with a drawn iPhone status bar. They are not iPhone captures: replace them with real ones when convenient.

## Names, URLs, keywords

| | id (primary) | en-US |
|---|---|---|
| Name | JoyoFit: Sinkron Jam Pintar | JoyoFit: Smartwatch Sync |
| Subtitle | Langkah, tidur, olahraga | Steps, sleep, workouts |
| Keywords | jam pintar,smartwatch,langkah,tidur,detak jantung,olahraga,strava,apple health,bluetooth,sinkron | smartwatch,steps,sleep,heart rate,workout,strava,apple health,fitness,bluetooth,sync,tracker |
| Promotional text | Sinkron langkah, tidur, detak jantung, dan olahraga dari jam Huawei ke iPhone-mu. Datanya tetap di HP. | Sync steps, sleep, heart rate and workouts from your Huawei watch to your iPhone. Your data stays on your phone. |

Privacy policy https://fit.joyorogo.com/privasi; support and marketing URL https://fit.joyorogo.com. Category Health & Fitness. Free, all territories (base IDN). Age rating 4+ (health topics only).
"Huawei" is kept out of the name, subtitle and keywords (guideline 5.2); the description uses it only for compatibility and says JoyoFit is not affiliated.

## Description (id)

```
JoyoFit menyambungkan jam Huawei langsung ke iPhone-mu lewat Bluetooth, tanpa akun Huawei dan tanpa server perantara. Data jam disimpan di iPhone-mu.

YANG BISA DILAKUKAN
• Sinkron langkah, jarak, kalori, detak jantung, SpO2, tidur, dan olahraga dari jam, lengkap dengan rute GPS dan tahap tidur.
• Lihat hari ini, tidur semalam, tren 30 dan 90 hari, kesiapan, beban latihan, dan riwayat olahraga dalam satu aplikasi.
• Simpan ke Apple Health (hanya menulis; JoyoFit tidak pernah membaca data Health-mu): langkah, jarak, energi aktif, detak jantung, SpO2, tidur, dan olahraga beserta rutenya.
• Kirim olahragamu ke Strava (opsional, gratis selama slot masih ada; unggah manual selalu bisa).
• Pasang dan ganti watch face, atur alarm, tampilkan cuaca di jam (dari Open-Meteo, opsional), dan nyalakan pengukuran detak jantung, SpO2, dan stres otomatis di jam.
• Cadangan cloud opsional, baru aktif setelah kamu masuk dengan akun JoyoRogo.

PRIVASI
• Data jam disimpan di iPhone-mu. Tidak ada iklan, tidak ada analitik, data tidak dijual.
• Cloud JoyoFit dan Strava bersifat opsional dan baru aktif setelah kamu sendiri menyalakannya.
• Kebijakan privasi: https://fit.joyorogo.com/privasi

CATATAN
• Butuh jam Huawei. Diuji dengan Huawei Watch Fit 4 Pro; jam lain belum dicoba di iPhone. Daftar jam: https://fit.joyorogo.com/jam
• Karena batasan iOS, JoyoFit tidak bisa meneruskan notifikasi aplikasi lain, mencari iPhone dari jam, mengatur panggilan, atau mengirim SMS SOS. Untuk notifikasi, jam membacanya langsung dari iPhone lewat pengaturan bawaan iOS. Fitur siklus, makanan, dan beberapa lainnya belum ada di iPhone.
• Tampilan aplikasi saat ini berbahasa Inggris.
• JoyoFit bukan produk Huawei dan tidak berafiliasi dengan Huawei. Huawei adalah merek dagang pemiliknya.
• JoyoFit bukan alat medis. Jangan dipakai untuk diagnosis atau pengobatan.

Open source (AGPL-3.0): https://github.com/dzulfikar08/joyofit
```

## Description (en-US)

```
JoyoFit connects your Huawei watch straight to your iPhone over Bluetooth, with no Huawei account and no middleman server. Your watch data stays on your iPhone.

WHAT IT DOES
• Syncs steps, distance, calories, heart rate, SpO2, sleep and workouts from the watch, with GPS routes and sleep stages.
• Shows today, last night's sleep, 30 and 90 day trends, readiness, training strain and workout history in one app.
• Saves to Apple Health (write only; JoyoFit never reads your Health data): steps, distance, active energy, heart rate, SpO2, sleep and workouts with their routes.
• Sends your workouts to Strava (optional, free while slots are spare; manual upload always works).
• Installs and switches watch faces, sets alarms, shows weather on the watch (from Open-Meteo, optional) and turns on automatic heart rate, SpO2 and stress measurement on the watch.
• Optional cloud backup, which only starts after you sign in with a JoyoRogo account.

PRIVACY
• Watch data is stored on your iPhone. No ads, no analytics, your data is not sold.
• The JoyoFit cloud and Strava are optional and only start after you switch them on yourself.
• Privacy policy: https://fit.joyorogo.com/privasi

NOTES
• You need a Huawei watch. Tested with the Huawei Watch Fit 4 Pro; other watches have not been tried on iPhone. List: https://fit.joyorogo.com/jam
• Because of iOS limits, JoyoFit cannot forward other apps' notifications, find your iPhone from the watch, handle calls or send SOS texts. For notifications, the watch reads them from the iPhone itself through the built-in iOS setting. A few other features are not on iPhone yet.
• JoyoFit is not a Huawei product and is not affiliated with Huawei. Huawei is a trademark of its owner.
• JoyoFit is not a medical device. Do not use it for diagnosis or treatment.

Open source (AGPL-3.0): https://github.com/dzulfikar08/joyofit
```

## App Review notes

```
JoyoFit is a companion app for Huawei smartwatches (tested with the Huawei Watch Fit 4 Pro). Pairing and syncing need that hardware, which a reviewer normally does not have, so this note says what works without a watch.

NO SIGN-IN, NO DEMO ACCOUNT. Every feature of the app works without an account. Signing in with a JoyoRogo account (Settings, the cloud section) only turns on an optional cloud backup and the optional Strava upload. Leave both off. Nothing in the app is gated behind payment or an account; the app is free and has no in-app purchases or ads.

WITHOUT A WATCH you can still see: the three tabs (Today, Workouts, Social) and More, with their empty states; More's "Connect a watch" prompt, the Watch screen's "Before you connect" steps and the scan, which finds nothing when no watch is in range; every Settings screen (background sync, weather, Strava, Apple Health, profile and daily step goal, About with the privacy policy link, Log). Screens for features iOS does not allow (find my phone, calls, SOS texts) explain that instead of showing controls that would fail.

PERMISSIONS and why:
- Bluetooth: connect to the user's own Huawei watch (prompt appears when the user taps to scan or connect on the Watch screen, More, Watch) and, optionally, to heart rate straps, cycling sensors and running pods the user pairs under More, Watch, Sensor (the prompt appears after the "Lanjut" explanation).
- Apple Health (write only): saves steps, distance, active energy, heart rate, SpO2, sleep and workouts (with routes) recorded by the watch. JoyoFit never reads Apple Health. The prompt appears only when the user switches the export on in Settings.
- Location (when in use): optional, for weather on the watch (coordinates are rounded to about 1 km before they go to Open-Meteo), for sending your position to the watch while a workout you started on the watch is running and the app is open, and for recording the route of an outdoor workout the user starts on the phone (Workouts, Rekam latihan). Never leaves the phone otherwise (it is part of the workout, which stays on the phone unless the user turns on the optional cloud backup or Strava upload).
- Background mode bluetooth-central: reconnect and sync with the remembered watch when iOS wakes the app; keep receiving a paired heart rate strap or cycling sensor during a workout recorded on the phone.
- Background mode location: only while a workout the user started on the phone with the GPS is running (the blue status-bar indicator is shown); it records the route with the screen locked. It stops when the workout is finished or discarded.
- Background mode audio: only for the metronome's click during a workout (Workouts, Rekam latihan, start a run, Metronome switched on with "Sound" or "Both"); it keeps the click audible with the screen locked, mixed with whatever music is playing. Nothing plays when the metronome is off or set to "Vibration" (the default). The app never records audio and has no microphone access.
- Encryption: the protocol with the watch implements AES and HMAC itself; ITSAppUsesNonExemptEncryption is false (the encryption only protects the Bluetooth link to the user's watch; it is not used for anything else).

TRADEMARK: JoyoFit is an independent, open-source app (AGPL-3.0, https://github.com/dzulfikar08/joyofit). It is not affiliated with Huawei; "Huawei" appears only to say which watches it works with. The app name and icon do not use Huawei marks.

DEMO VIDEO: a screen recording of pairing and syncing a watch from an iPhone is available on request at dzulfikar@joyorogo.com.

The app UI is in English. Privacy policy: https://fit.joyorogo.com/privasi.
```

FAMILY MONITORING (optional, off until used): a person can share a few daily numbers from their own watch (steps, resting heart rate, last night's sleep, optional SpO2, last watch connection and battery) with a family member who has JoyoFit and signed in. The watched person gets an invite link or code, sees a consent screen with a switch per category, and can pause or stop at any time; stopping deletes the shared history at once. There is no hidden mode: the watched person always sees who can view their data and when. The screens say it is not real-time and not an emergency or medical tool, and the app makes no diagnosis. To review it: Settings, Keluarga (needs two signed-in accounts and a watch, so a screen recording is available on request).

Contact: Dzulfikar Ats Tsauri, +6285156160345, dzulfikar@joyorogo.com. No demo account.

## App Privacy (published)

Collected, all for App Functionality only, no tracking: Name, Email Address, User ID, Device ID (the watch's Bluetooth address), Health, Fitness, Precise Location (workout GPS tracks): linked to the user, and only after the user signs in to the optional JoyoRogo cloud.
Precise Location (the start point and nearby waypoints of a loop route, sent to the FOSSGIS OSRM routing service only when the user taps Cari rute in Routes, Loop baru dari rumah; not stored by us): not linked, App Functionality, no tracking. Coarse Location (weather position rounded to about 1 km, sent to Open-Meteo): not linked. The optional AI connection (JoyoRogo Pro; Claude, ChatGPT or another MCP app the user connects, read-only, only when the user asks a question there, never GPS routes or Strava data) lets the AI provider the user chose read their diary, weight, workouts, sleep and recovery data: decide in App Store Connect whether the label needs a third-party row for it [INFERENCE: not checked]. Apple Health data is written only and never read, so it is not a collected row.

## Family monitoring (disclosure checklist)

Checked against the guideline text we use; confirm in App Store Connect when you submit.

- **5.1.3(i) Health data:** daily summaries go only to the person the user chose, never to ads, data brokers or analytics, and only after the watched person's explicit consent per category (steps, resting heart rate, sleep, SpO2, watch status). Say so in the review notes (done above).
- **5.1.1 Data collection and consent:** consent screen with a switch per category, a way to withdraw (pause or stop, which deletes the history), and in-app account deletion that removes every link and summary (already exists). The app works without family monitoring.
- **1.4.1 Physical harm:** no diagnosis and no accuracy claims. Not-real-time and not-emergency text on the first-run screen and each family screen; alerts say "bukan diagnosis dokter" and point to calling the person or 112. Do not describe the feature as detecting falls, heart attacks or emergencies in the listing or screenshots.
- **App Privacy label:** add Health and Fitness data as shared with another user at the user's request (linked to the user, App Functionality, not tracking). Add Push Notification token under Device ID (App Functionality) once alerts ship.
- **Push:** adds the Push Notifications capability (APNs entitlement). No feature may require the user to enable push.
- **Background upload:** the daily upload on iOS is best effort (iOS decides when background tasks run), so the in-app text says data can be late. Do not promise timeliness in the listing.
- **Listing line (id):** "Opsional: bagikan kabar harianmu (langkah, tidur, detak istirahat) ke keluarga yang kamu izinkan. Bukan pantauan langsung dan bukan alat darurat."
- **Listing line (en):** "Optional: share a few daily numbers (steps, sleep, resting heart rate) with family you choose. Not real-time and not an emergency tool."
- **Privacy policy:** `https://fit.joyorogo.com/privasi#keluarga` has the Family monitoring section.

## Review 2026-10-26: rejection of 1.0 (202610160830)

Submission `bf3d4eb5-74af-4016-898a-e4fef19aaa27` (submitted 2026-10-17, App Store version record `1.0`, state REJECTED / UNRESOLVED_ISSUES), reviewed on an iPad Air 11-inch (M3) and an iPhone 17 Pro Max. Three issues: 2.1(a) crash on launch, 4.1(b) Copycats ("content that resembles Huawei"), 2.1 Information Needed (demo video on a physical device). Everything below was checked through the App Store Connect API and the CI artifacts on 2026-10-26 unless marked [INFERENCE]; nothing was changed in App Store Connect.

### 1. Crash on launch (2.1(a))

**Cause (confirmed on the same build).** The attached build is `0.1.0 (202610160830)`, one of the IPAs made by the Linux pipeline (`docs/ios-linux.md`): it is stamped `iphoneos27.0` / `DTXcode 2700` and has no `UIApplicationSceneManifest`. iOS 27 aborts such an app before the first frame. TestFlight testers sent the crash for this very build (iPhone 13 and iPhone 11, iOS 27.0.1, "crash!! tidak bisa dibuka"), and every Linux build of 10-16 and 10-17 shows it:

```
Exception Type:  EXC_BREAKPOINT (SIGTRAP)
Thread 0 Crashed:
0  UIKitCore  ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke + 700
3  UIKitCore  -[UIApplication workspace:didCreateScene:withTransitionContext:completion:] + 324
...
25 UIKitCore  UIApplicationMain(_:_:_:_:) + 104
```

TestFlight usage of that build: 13 installs, 67 sessions, **25 crashes**. Both review devices run iOS/iPadOS 27 in October 2026 [INFERENCE: Apple does not state the OS version in the rejection], so the crash is not iPad-specific: the iPhone 17 Pro Max hit it too. The same Linux builds also failed on iOS 17 (`DYLD 1 Library missing: SwiftUICore.framework`, build 202610170244), because the iOS 27 SDK links SwiftUICore, which exists only from iOS 18.

| Build | Made by | SDK | Installs / sessions / crashes (TestFlight) |
|---|---|---|---|
| 0.1.0 (202610160830), the rejected one | Linux | iphoneos27.0, no scene manifest | 13 / 67 / 25 |
| 1.0 (202610170244), (202610170306) | Linux | iphoneos27.0 | 10 / 6 / 11 and 8 / 21 / 12 |
| 1.0 (202610190340) | Mac CI run 10 | iphoneos26.5 | 18 / 98 / 28: a different crash, see below |
| 1.0 (202610191525) | Mac CI run 13 | iphoneos26.5 | 20 / 84 / 0 |
| 1.0 (202610201528) | Mac CI run 16 | iphoneos26.5 | 31 / 230 / 1 (external group, beta review approved) |
| 1.1 (202610250133), (202610250846) | Mac CI runs 17, 18 | iphoneos26.5 | **0 / 0 / 0**: internal testing only, nobody has installed them |

**Why the Mac builds do not crash.** iOS 27 enforces the scene lifecycle only for apps linked against the iOS 27 SDK. `release-ios.yml` builds with Xcode 26.6 (`iphoneos26.5`, checked in the log of run 40177755321), and since 8d3143ed `scripts/ios/mac-build.sh` fails any iOS 27 SDK build that has no `UIApplicationSceneManifest`. The Info.plist of 1.1 (202610250846), taken from the run's IPA artifact: `UIDeviceFamily [1]` (iPhone only), `MinimumOSVersion 16.4`, `UIBackgroundModes bluetooth-central, location`, usage strings for Bluetooth, Location (when in use), Motion, Health share and update, Camera, Photos, Face ID; entitlements HealthKit (`access []`), Sign in with Apple, push; SwiftUI linked, SwiftUICore not linked directly. Nothing in it crashes on first access: every protected API the app touches has its usage string. Before the day the Mac runner's `latest-stable` becomes Xcode 27 (or Apple requires the iOS 27 SDK), JoyoFit has to adopt the UIScene lifecycle; until then the check stops such a build instead of shipping it.

**The other crash (202610190340, iOS 26.0).** SIGABRT about 6 s after launch, an `NSException` raised on a serial dispatch queue from the main binary. Symbolicating against that run's IPA (UUID `A2A2E09C-...` matches; symbols are stripped, so only ObjC metadata was usable) puts the frames in the code around `EXUpdatesErrorRecovery`, which re-raises a fatal JavaScript error at startup [INFERENCE]. It stopped with the next builds (0 crashes in 84 sessions on 202610191525, which carries 0a378929 "DB repair is foreground-only and iOS-safe ... HuaweiWear proxy only on Android"). Symbols are uploaded since 2026-10-21, so a crash on a later build comes back symbolicated.

**iPad.** The app is already iPhone only (`supportsTablet: false`, `UIDeviceFamily [1]`). Apple still runs iPhone apps on iPad in compatibility mode during review, which cannot be switched off, so keep it iPhone only and make sure the build launches; no iPad-specific setting (`UIRequiresFullScreen`, iPad orientations, HealthKit on iPad) is involved in this crash.

**The crash logs App Review attached.** The App Store Connect API has no endpoint for Resolution Center messages or their attachments, and `diagnosticSignatures` / `perfPowerMetrics` for 202610160830 are empty (they fill only from App Store users). To get the files: App Store Connect, Apps, JoyoFit, sidebar **App Review** (under General), open the submission with the "Unresolved Issues" status (ID `bf3d4eb5-...`), open the message from App Review, click each attached crash log (`.txt` or `.ips`) and save them in `~/Downloads/joyofit-review-2026-10-26/`. The "View in App Store Connect" link in the rejection email lands on the same page. Then `grep -l NoSceneLifecycleAdoption ~/Downloads/joyofit-review-2026-10-26/*` should name every file; a file that does not match is a different crash and needs a look. The TestFlight crash logs used above are at `bun scripts/testflight-feedback.ts --app 6823324343 --name joyofit --all --dry` (they land in `tf-feedback/joyofit/crashlogs/`).

### Which build to resubmit

- **Never 202610160830** (or any `0.1.0` / Linux build): it cannot launch on iOS 27.
- **Recommended: a new build from master after PR #27** (the permission prompts below), made by **Release iOS** with the default Xcode 26.6, version 1.1. Install it from TestFlight on an iOS 27 iPhone, launch it, and record the demo video with that build, so what Apple sees in the video is exactly what it reviews. Master since 1.1 adds the metronome sound (`UIBackgroundModes audio`), which the review notes below already explain.
- **Acceptable without a new build: 1.1 (202610250846).** Same toolchain as the 230-session build 202610201528, but nobody has installed it yet: open it once on the owner's iPhone before submitting.
- In App Store Connect, rename the version record from `1.0` to `1.1` before attaching a 1.1 build (the store page shows the record's number; the rejected submission paired record 1.0 with a 0.1.0 binary).

### 2. Copycats (4.1(b))

Apple could not get past the launch crash, so the listing and the review notes are all the reviewer saw [INFERENCE]. Inventory:

| Where | Huawei mark or likeness | Verdict |
|---|---|---|
| App name, subtitle, keywords (id, en-US) | none ("JoyoFit: Smartwatch Sync", "JoyoFit: Sinkron Jam Pintar") | fine |
| App icon (`assets/icon.png`, `assets/brand/*.svg`) | JoyoFit ring mark, no watch, no Huawei shape or colour | fine |
| Screenshots in ASC (APP_IPHONE_65, 5 per locale) | the app's own Today, Workouts, Sleep, Readiness, Trends screens; no logo, no watch render; the device name shown is "Seiya-B29F" | fine |
| Promotional text (id, en-US) | first sentence: "from your Huawei watch" | **change**: the most prominent text after the name |
| Description (id, en-US) | first sentence "connects your Huawei watch", "no Huawei account", NOTES "You need a Huawei watch" | **change**: brand only in the compatibility note |
| Review notes | "a companion app for Huawei smartwatches" as the opening line | **change** |
| Bundled assets (`assets/`) | no Huawei logo, product photo, render or watch-face image; only Strava, Apple Health and Health Connect marks (`docs/brand-marks.md`) | fine |
| Watch pictures in the app | `WatchGlyph` is the Ionicons `watch` glyph on a disc; the model catalogue is names only | fine |
| Watch faces | installed faces are listed by the names the watch reports; previews only for faces from JoyoFit's own library | fine |
| iOS permission prompts | Bluetooth: "your Huawei or Honor watch"; Apple Health read: "workouts that Huawei Health saved there" | **changed in PR #27** |
| In-app text (en, 97 strings) | "Huawei" by name: the supported-watch list (`watchFamilies.ts`, product names), the unbind step "Release the watch from Huawei Health", "Import from Huawei Health", Family invites ("through your Huawei watch"), watch-face hints ("official Huawei face", "Huawei Theme Studio Pro"), HR zone defaults ("Huawei Health's default") | nominative, needed to use the app; keep, unless Apple insists (fallback below) |

**Proposed listing text (not entered; owner enters it):**

- Promotional text en-US: `Sync steps, sleep, heart rate and workouts from your smartwatch to your iPhone over Bluetooth. Your data stays on your phone.`
- Promotional text id: `Sinkron langkah, tidur, detak jantung, dan olahraga dari jam pintarmu ke iPhone lewat Bluetooth. Datanya tetap di HP.`
- Description en-US, first paragraph: `JoyoFit connects your smartwatch straight to your iPhone over Bluetooth, with no extra account and no middleman server. Your watch data stays on your iPhone.`
- Description id, first paragraph: `JoyoFit menyambungkan jam pintarmu langsung ke iPhone lewat Bluetooth, tanpa akun tambahan dan tanpa server perantara. Data jam disimpan di iPhone-mu.`
- Description en-US, first NOTES bullet: `Compatible watches: tested with the Huawei Watch Fit 4 Pro; other Huawei and Honor models are experimental. Full list: https://fit.joyorogo.com/jam` and keep the bullet `JoyoFit is an independent app. It is not made, endorsed or sponsored by Huawei and is not affiliated with Huawei. Huawei is a trademark of Huawei Technologies Co., Ltd.`
- Description id, first CATATAN bullet: `Jam yang cocok: diuji dengan Huawei Watch Fit 4 Pro; model Huawei dan Honor lain masih percobaan. Daftar lengkap: https://fit.joyorogo.com/jam` and `JoyoFit adalah aplikasi independen, bukan buatan Huawei, tidak didukung atau disponsori Huawei, dan tidak berafiliasi dengan Huawei. Huawei adalah merek dagang Huawei Technologies Co., Ltd.`
- Apple Health bullet, both locales (1.1 also reads, once, on request; the current text says "write only; JoyoFit never reads"): `Saves to Apple Health: steps, distance, active energy, heart rate, SpO2, sleep and workouts with their routes. If you tap Import history, it reads your past Apple Health data once to bring it into JoyoFit; it stays on your phone.` / `Simpan ke Apple Health: langkah, jarak, energi aktif, detak jantung, SpO2, tidur, dan olahraga beserta rutenya. Kalau kamu ketuk Impor riwayat, JoyoFit membaca riwayat Apple Health-mu sekali untuk dibawa ke JoyoFit; datanya tetap di HP.`
- Screenshots: no change needed. Do not add pictures of a Huawei watch, the Huawei logo or a Huawei watch face to them.

**In the app (PR #27, `fix/ios-review-copycat`).** The two Bluetooth strings now say "your smartwatch or fitness band", the Apple Health read string "workouts your watch's own app saved there". iOS only (`ios.infoPlist`); it changes the native fingerprint, so it ships with the next build, not as an OTA.

**Fallback if Apple still asks for authorization.** JoyoFit has no relationship with Huawei to show, so the answer would be to make the iOS UI brand-free: "compatible smartwatches" in onboarding, the Watch tab, Family and the import screens (an iOS-only i18n override for the 97 strings), the model list replaced by a link to https://fit.joyorogo.com/jam, and "Huawei" removed from the description except the website link. That is a few days of work and makes the app harder to use (the unbind and import steps must say which app to open), so do it only on a second rejection.

**Reply to App Review (Resolution Center), to send with the resubmission:**

```
Hello,

Thank you for the review. We have addressed the three issues.

1. Guideline 2.1(a), crash on launch: the build you reviewed (202610160830) was made with a toolchain that linked it against the iOS 27 SDK without adopting the UIScene life cycle, so iOS 27 stopped it at launch. The new build, 1.1 (BUILD), is built with Xcode 26.6 and launches normally on iOS 27 and on iPad in iPhone compatibility mode.

2. Guideline 4.1(b): JoyoFit is an independent, open-source app (AGPL-3.0, https://github.com/dzulfikar08/joyofit). It is not made, endorsed or sponsored by Huawei and does not claim to be. Its name, icon, screenshots and interface use no Huawei logo, product image, watch-face artwork or trade dress; the icon and design are our own. The word "Huawei" appears only where a user needs it to know which watches the app works with and which steps to take (for example, unpairing the watch from the user's existing app first), which is a factual, nominative reference. We have reduced it further: the promotional text and the first lines of the description no longer mention Huawei, the brand now appears only in a compatibility note with a clear non-affiliation statement, and the permission prompts describe the device generically. JoyoFit has no business relationship with Huawei to document. If you still need changes, please tell us which content you consider to resemble Huawei and we will change it.

3. Guideline 2.1, demo video: a recording on a physical iPhone with a Huawei Watch Fit 4 Pro, showing launch, every permission request, pairing, syncing and the main features, is at VIDEO_URL (also in the App Review Information notes).

Best regards,
Dzulfikar Ats Tsauri
```

### 3. Demo video (2.1 Information Needed)

The notes in App Store Connect already point to `https://fit.joyorogo.com/review/joyofit-ios-demo.mp4`, which returns **404**: that is why Apple asked. Record with the build you submit, after deleting the app (so every prompt appears) and unbinding the watch from Huawei Health off camera. Use the iPhone's Screen Recording (Control Center) for the phone, and film the watch with a second phone where the watch matters (00:25 to 00:45, 01:40); or film both devices side by side from above for the whole take. Keep it under 3 minutes, no cuts inside the pairing.

| Time | Shot | What must be visible |
|---|---|---|
| 00:00 to 00:08 | Title card or spoken intro | "JoyoFit 1.1 (build number), iPhone model, iOS 27.x, Huawei Watch Fit 4 Pro" |
| 00:08 to 00:15 | Home screen, tap the JoyoFit icon | The app launching to the setup guide |
| 00:15 to 00:25 | Welcome and "Release the watch from Huawei Health" steps | The steps, then Next |
| 00:25 to 00:45 | Pair step: Connect. **Bluetooth permission prompt**, Allow | The system prompt with its text, the scan finding the watch |
| 00:45 to 01:05 | Tap the watch; the watch shows its pairing request; accept on the watch; Pair on the phone | Watch and phone together (camera), then "Connected" |
| 01:05 to 01:20 | First sync | Sync progress, then Today with steps, heart rate and battery from the watch |
| 01:20 to 01:40 | Sleep, Workouts, open a workout with its route | Data that came from the watch |
| 01:40 to 02:00 | Watch screen: set an alarm, switch the watch face | The change appearing on the watch (camera) |
| 02:00 to 02:15 | Settings, Weather on: **Location permission prompt** (While Using), Allow | Prompt text, weather sent to the watch |
| 02:15 to 02:35 | Settings, Apple Health, switch the export on: **Apple Health permission sheet** | The sheet listing the data types, Allow |
| 02:35 to 02:50 | Workouts, record a workout on the phone, Start: **Motion & Fitness prompt**, then stop and discard | Prompt text |
| 02:50 to 03:00 | Settings: background sync, About with the privacy policy link | End |

Hosting: **unlisted YouTube** (no size limit, plays on any device; Apple accepts unlisted links), or the site at `site/public/review/joyofit-ios-demo.mp4` if the file stays under 25 MiB (the Workers static-asset limit per file; H.264 720p at about 1 Mbit/s fits 3 minutes). Test the link in a private window before submitting.

**App Review notes to paste (replaces the current notes):**

```
JoyoFit is an independent, open-source app that syncs a compatible smartwatch with the iPhone over Bluetooth (tested with the Huawei Watch Fit 4 Pro). It is not made, endorsed or sponsored by Huawei.

DEMO VIDEO (physical iPhone with a Huawei Watch Fit 4 Pro, this build): VIDEO_URL
It shows launch, the Bluetooth, Location, Apple Health and Motion permission requests, pairing (the watch is filmed), the first sync and the synced data, alarms and watch faces on the watch, and Settings.

NO SIGN-IN, NO DEMO ACCOUNT. Watch sync and every screen in the video work without an account. Signing in with a JoyoRogo account only adds the optional cloud backup, Strava upload and the JoyoRogo Pro features (Coach, family sharing), which are bought in the JoyoRogo app; JoyoFit has no in-app purchases, no prices and no links to a web checkout.

WITHOUT A WATCH you can still see the setup guide, the Today, Workouts and Watch screens with their empty states, the watch scan (it finds nothing without a watch in range) and every Settings screen. Screens for features iOS does not allow (find my phone, calls, SOS texts) explain that instead of showing controls.

PERMISSIONS and why:
- Bluetooth: connect to the user's own watch (prompt when the user taps Connect) and, optionally, heart rate straps, cycling sensors, running pods and a Bluetooth scale the user pairs.
- Location (when in use): optional; weather on the watch (rounded to about 1 km before it goes to Open-Meteo), the position for a watch workout while the app is open, and the route of a workout the user starts on the phone.
- Motion & Fitness: steps and cadence of a run or walk the user records on the phone.
- Apple Health: writes the watch's steps, distance, active energy, heart rate, SpO2, sleep and workouts when the user switches the export on; reads Apple Health history once, only when the user taps Import history. Nothing read leaves the phone.
- Camera and Photos: only when the user takes or picks a photo for a shared workout image or a watch face.
- Background modes: bluetooth-central (reconnect and sync the remembered watch; keep a paired strap during a phone workout), location (only while a phone workout with GPS runs, blue indicator shown), audio (only the metronome click during a phone workout when the user sets it to Sound or Both; never records audio).
- Encryption: the Bluetooth link to the watch uses AES and HMAC; ITSAppUsesNonExemptEncryption is false.

Contact: Dzulfikar Ats Tsauri, +6285156160345, dzulfikar@joyorogo.com. Privacy policy: https://fit.joyorogo.com/privasi
```

Drop the `audio` line when submitting 1.1 (202610250846), which has no audio background mode.

### Other things found while checking (fix before resubmitting)

- The description and the current notes say Apple Health is "write only, never reads", but 1.1 has the one-time Apple Health import and asks for read access (`NSHealthShareUsageDescription`). Use the Apple Health bullet above (guideline 2.3.1 / 5.1.1).
- The current notes say "Nothing in the app is gated behind payment or an account", while Coach and family sharing show a JoyoRogo Pro upgrade card. The notes above describe it as it is. Unlocking in JoyoFit what was bought in another app may draw a 3.1.1 / 3.1.3(b) question [INFERENCE]; it was not part of this rejection.
- The current notes describe four tabs (Today, Workouts, Watch, Settings) from an older build; the text above is generic on purpose. Check it against the build you submit.
- `NSFaceIDUsageDescription` is expo-secure-store's default ("Allow JoyoFit to access your Face ID biometric data."); the app never asks for Face ID. Passing `"faceIDPermission": false` to the `expo-secure-store` plugin removes the key [INFERENCE: from the plugin's source, not built].

### Owner checklist

1. Download the App Review crash logs (path above) and confirm they show `NoSceneLifecycleAdoption`.
2. Merge PR #27, run **Release iOS** on master with upload on, install the build from TestFlight on an iOS 27 iPhone and open it.
3. Record the video with that build, upload it, check the link.
4. In App Store Connect: version record `1.0` to `1.1`, attach the new build, replace the promotional text, the description paragraphs and the notes with the texts above, paste the video link.
5. Reply in the Resolution Center with the text above (fill BUILD and VIDEO_URL), then resubmit.
