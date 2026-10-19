# Publishing JoyoFit on Google Play

This is the developer's runbook: what is already done in the repo, what you click in Play Console, and the exact text to paste.
Play Console menu names change between releases; the wording below follows the Console's own section names, so use the search
box if one has moved.

Source of truth for the policies cited here:

- Testing requirement for new personal accounts: <https://support.google.com/googleplay/android-developer/answer/14151465>
- SMS and Call Log permissions policy: <https://support.google.com/googleplay/android-developer/answer/10208820>
- Source code (AGPL-3.0-or-later): <https://github.com/dzulfikar08/joyofit>
- Privacy policy (live): <https://fit.joyorogo.com/privasi> (Indonesian, English section below it). Data deletion section: <https://fit.joyorogo.com/privasi#hapus>

## 0. What the Play build is

| | Sideload APK | Play AAB |
|---|---|---|
| Command | `scripts/build-release.sh` | `scripts/build-release.sh --play` |
| Flag | `JOYOFIT_DISTRIBUTION=sideload` (default) | `JOYOFIT_DISTRIBUTION=play` (the script sets it) |
| Output | `dist/joyofit-<versionCode>.apk` | `dist/joyofit-play-<versionCode>.aab` |
| `SEND_SMS` | yes (SOS texts the watch asks for) | **removed** |
| `READ_CALL_LOG` | yes (caller number) | **removed** |
| `READ_CONTACTS` | yes (caller name) | **removed** (only used with the number, which Android no longer passes without `READ_CALL_LOG`) |
| APK self-updater | none in JoyoFit | none (`REQUEST_INSTALL_PACKAGES` is in neither build). Play installs show an in-app update banner instead: `docs/in-app-updates.md` |

How it works: `modules/huawei-wear/android/build.gradle` reads `JOYOFIT_DISTRIBUTION` (or `-PjoyofitDistribution=`). For `play` it merges
`modules/huawei-wear/android/src/play/AndroidManifest.xml` (`tools:node="remove"` for the three permissions and the SMS `uses-feature`) and
bakes `BuildConfig.DISTRIBUTION = "play"` into the module, which JS reads as `HuaweiWear.distribution`. The script then dumps the AAB's
merged manifest with bundletool and **fails the build** if a restricted permission is still there.

What the Play build does differently for the user:

- Settings, Safety: the "SOS text messages" section is replaced by an explanation. The watch can still start an SOS; JoyoFit answers it with
  "not sent" (the same answer it gives when SMS is switched off), so the watch never believes a text went out. A switch left on by an earlier
  build reads as off.
- Settings, Phone and calls: "Show incoming calls on the watch" asks only for Phone state. The watch shows "Incoming call" (no number, no
  name). The call-log and contacts rows are hidden.
- Everything else is identical.

`versionCode` is minutes since 2024-01-01 UTC (same as JoyoRogo; `plugins/with-version-code.js`), for both builds, so it only ever grows and
stays below Play's 2,100,000,000 cap. Never reuse an AAB: Play rejects a versionCode it has seen.

Other permissions in the Play build and why (the manifest of `dist/joyofit-play-*.aab`):

| Permission | User-facing reason |
|---|---|
| `BLUETOOTH_CONNECT` (`BLUETOOTH`, `BLUETOOTH_ADMIN` up to Android 11) | Connect to the Huawei/Honor watch you already paired |
| `BLUETOOTH_SCAN` (declared `neverForLocation`) | "Scan nearby devices" on the Watch tab lists Huawei and Honor watches in range so one can be connected without pairing it in Android Bluetooth settings first (Android 12+ only; a scan only lists, nothing connects or binds). Asked when the button is tapped; no location permission is used for it |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE` | Keep the watch connection alive in the background (Settings, Background); keep a heart rate strap or cycling sensor connected during a workout recorded on the phone |
| `FOREGROUND_SERVICE_LOCATION` | Record the GPS of an outdoor workout started on the phone while the screen is off (a foreground service with an ongoing notification, only while that workout runs) |
| `POST_NOTIFICATIONS` | The service notification and the optional morning summary |
| `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK` | Restart the watch connection after a reboot or update; stay awake during a sync |
| `VIBRATE` | Find my phone |
| `READ_PHONE_STATE` | Show that the phone is ringing on the watch (optional switch) |
| `ANSWER_PHONE_CALLS` | The watch's accept and reject buttons (optional switch) |
| `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` | Weather for the phone's position (coarse); phone GPS for outdoor workouts the watch records and for outdoor workouts recorded on the phone (precise). Used only while the app is open or while a recording's foreground service runs; no `ACCESS_BACKGROUND_LOCATION` |
| `INTERNET`, `ACCESS_NETWORK_STATE` | Weather (Open-Meteo), optional JoyoFit cloud and JoyoRogo, satellite-assist downloads for the watch |
| `android.permission.health.WRITE_*` (steps, distance, active calories, heart rate, resting heart rate, oxygen saturation, sleep, exercise) | Write watch data to Health Connect. No read permission |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | Added by the `androidx.biometric` library inside `expo-secure-store`. Normal permissions; JoyoFit never asks for biometrics |
| `com.joyodigitama.joyofit.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX internal, signature-level |
| Notification access (`BIND_NOTIFICATION_LISTENER_SERVICE`, special access the user grants in Android settings) | Forward notifications to the watch (optional switch) |
| `CAMERA` (from `expo-image-picker`) | "Take photo" in the workout share screen puts a new photo behind the numbers of the share image. Asked only when that button is tapped; the photo stays on the phone and is never uploaded by JoyoFit |

Removed from both builds because no JoyoFit feature uses them (`app.json` `android.blockedPermissions`): `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` (Expo template defaults; debug builds keep the overlay),
`READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE` (from `expo-file-system` and `expo-media-library`, API 32 and lower only; pickers return cache copies, and Save on the share sheet writes through MediaStore, which needs no permission on Android 11+; the button is hidden on Android 10),
`READ_MEDIA_VISUAL_USER_SELECTED` (from `expo-media-library`; the plugin's `granularPermissions` is empty so no `READ_MEDIA_*` photo permission is declared) and `ACCESS_WIFI_STATE`
(from `expo-network`, which no screen imports).

## 1. Account: personal or organization

| | Personal | Organization |
|---|---|---|
| Needs | ID verification, payment profile, a phone and an email you control | Everything personal needs plus a D-U-N-S number and the organization's legal details |
| Before production | Closed test with **at least 12 testers opted in continuously for 14 days**, then apply for production (see section 4) | Exempt from the 12-tester rule |
| Cost | One-time registration fee | Same fee, plus the time to get a D-U-N-S number (free from Dun & Bradstreet, usually days to weeks) |
| Fit for JoyoFit | Fine; you need to recruit 12 people who will stay opted in for 14 days | Only worth it if you have a registered business (PT/CV) anyway |

The rule above is Play's own (link at the top). In Indonesia you also need to complete Android developer verification; since 30 Sep 2026 it is enforced
for installs from participating stores including Google Play, and your Play Console account covers it.

Recommendation: personal account, run the 14-day test with friends, family and the people who already use the sideload build.

## 2. Create the app

1. Play Console, **Create app**. Name: `JoyoFit: Sinkron Jam Pintar` (see listing, section 5). Default language: Indonesian (id). App or game: **App**. Free or paid: **Free**. Accept the declarations.
2. **Set up your app** (dashboard checklist), in this order: app access, ads, content rating, target audience, data safety, government apps (no), financial features (none), health apps, privacy policy, app category and contact details. Text for each is in sections 6 to 10.
3. **Play App Signing**. Upload your first AAB (section 3); Play offers to manage the signing key. Accept. Two choices:
   - **Let Google generate the app signing key (recommended).** Your existing `keystore/joyofit-release.jks` becomes the *upload key*: it signs what you upload, Google re-signs what users get. A lost upload key can be reset through Google; a lost sideload key cannot be replaced.
   - Upload your existing key as the app signing key (Console offers it at first upload; needs Google's `pepk.jar` tool). The Play build and the sideload APK then share a signature and update each other in place. This choice cannot be undone.
   Consequence of the recommended choice: **the APK from the website and the Play install are signed with different keys, so Android will not update one with the other**. Uninstall one before installing the other (JoyoFit has no export, so this wipes the local database; sync the cloud first if you use it).
4. Keep `~/.config/joyofit/KEYSTORE_BACKUP.md` current; the upload key is still the one thing you must not lose.

## 3. Build and upload

```bash
scripts/build-release.sh --play      # -> dist/joyofit-play-<versionCode>.aab, listing its permissions
```

The environment from the repo rules (`JAVA_HOME`, `ANDROID_HOME`, `TMPDIR`) is set by the script. The AAB is signed with `keystore/joyofit-release.jks`
(upload key). `dist/` is gitignored.

Upload: **Testing, Closed testing, Create track** (call it `joyofit-testers`), **Create new release**, drop the AAB, release name = versionCode,
release notes (below), **Save**, **Review release**, **Start rollout to Closed testing**. Every later release needs a new build (new versionCode).

Release notes, Indonesian: `<id-ID>Rilis uji pertama JoyoFit: sinkron langkah, detak jantung, tidur, SpO2 dan olahraga dari jam Huawei/Honor ke HP.</id-ID>`
English: `<en-US>First test release of JoyoFit: syncs steps, heart rate, sleep, SpO2 and workouts from a Huawei/Honor watch to your phone.</en-US>`

## 4. Closed testing with a Google Group (12 testers x 14 days)

1. Create a Google Group at <https://groups.google.com> named `joyofit-testers` (address `joyofit-testers@googlegroups.com`). Settings: *Who can join the group*: **Anyone can ask**, or invite only; *Who can view conversations*: **Group members** is fine. Add your 12+ testers as members (they must be real Google accounts; ask for 15 to 20, because the count is of testers who stay opted in).
2. Play Console, Closed testing track, **Testers** tab, **Create email list** (or *Google Groups*), add `joyofit-testers@googlegroups.com`, save. Set a feedback email or URL there.
3. In the same tab copy the **opt-in URL** (looks like `https://play.google.com/apps/testing/com.joyodigitama.joyofit`). Send it to the group.
4. Each tester: open the link while signed in with the Google account that is in the group, tap **Become a tester**, then **Download it on Google Play** (or search JoyoFit in Play after a few minutes). They must stay opted in. JoyoFit needs a Huawei/Honor watch to show anything; testers without one can still install, open the app and give feedback on the empty state, and count toward the number.
5. Day 0 is when the 12th tester has opted in. Keep **at least 12 opted in, without a gap, for 14 days**. Releasing a new build during the test is fine and encouraged (testers install the update from Play).
6. After 14 days: **Dashboard, Apply for production** (shown once the test counts). Answer the questions: how you recruited testers, what feedback you got and acted on, why the app is ready. Honest answers: testers were friends, family and sideload users; list the changes you made from feedback.
7. Google reviews the application (allow several days), then you can create a **Production** release with the same AAB flow (promote the release from the closed track, or upload a new one) and choose countries (start with Indonesia).

## 5. Store listing drafts

Required assets (Main store listing):

| Asset | Spec | Source |
|---|---|---|
| App icon | 512 x 512 PNG, 32-bit, up to 1 MB | `assets/icon.png` resized, or `scripts/build-icons.ts` |
| Feature graphic | 1024 x 500 PNG or JPG | make one: logo on the paper background `#F9F6F1` with "Jam-mu. Datamu. HP-mu." |
| Phone screenshots | 2 to 8; PNG or JPG up to 8 MB; each side 320 to 3840 px; the long side at most 2x the short side. Capture at the phone's native size (about 1080 x 2400) | see below |
| 7-inch and 10-inch tablet screenshots | optional; skip | |

Screenshots to capture on the phone with a connected watch (`adb exec-out screencap -p > shot.png`, or the phone's own screenshot). Use a profile with no personal data visible:

1. **Today**: the ring cards (steps, heart rate, sleep summary).
2. **Sleep**: last night with the stages.
3. **Workouts**: the list and one workout detail with the map and analysis.
4. **Watch**: connected watch, battery, find my watch, alarms.
5. **Settings, Notifications and calls**: forwarding and call options.
6. **Settings, Health and cloud**: Health Connect and the optional cloud, showing it is opt-in.
7. **Settings, Weather** (optional).

The site already has `site/public/shots/today.webp`, `sleep.webp`, `watch.webp` (640 x 1280). They are below the recommended size; recapture at full size for the Console.

Do not use Huawei's logo or product renders in graphics. The listing may say the app works with Huawei and Honor watches, but the title should not imply Huawei made it.

### Indonesian (default language, id-ID)

Title (max 30), 27 characters:

```
JoyoFit: Sinkron Jam Pintar
```

Short description (max 80), 79 characters:

```
Sinkron langkah, tidur, detak jantung dan olahraga dari jam ke HP. Open source.
```

Full description (max 4000):

```
JoyoFit menyambungkan jam Huawei dan Honor langsung ke HP-mu lewat Bluetooth, tanpa akun Huawei dan tanpa server perantara. Data jam disimpan di HP-mu.

Yang bisa dilakukan:
• Sinkron langkah, jarak, kalori, detak jantung, SpO2, tidur, dan olahraga dari jam, dengan rute GPS dan tahap tidur.
• Lihat hari ini, tidur semalam, tren, dan riwayat olahraga dalam satu aplikasi.
• Tulis data ke Health Connect (hanya menulis, tidak pernah membaca) supaya aplikasi kesehatan lain yang kamu izinkan bisa memakainya.
• Cuaca di jam dari Open-Meteo (opsional, koordinat dibulatkan sekitar 1 km).
• Teruskan notifikasi HP ke jam, tampilkan panggilan masuk, terima atau tolak panggilan dari jam, dan cari HP dari jam.
• Atur alarm, wajah jam, dan target harian dari HP.
• Tetap tersambung di latar belakang dengan satu notifikasi layanan (opsional).

Privasi:
• Data jam disimpan di HP. Tidak ada iklan, tidak ada analitik, data tidak dijual.
• Cloud JoyoFit bersifat opsional dan baru aktif setelah kamu masuk dengan akun JoyoRogo. Data cloud bisa dihapus lewat permintaan email.
• Koneksi AI (opsional, Pro): hanya bila kamu menyambungkan Claude, ChatGPT, atau aplikasi MCP lain, datamu dibaca (hanya-baca) saat kamu bertanya di sana. Bisa diputus kapan saja di Pengaturan, Koneksi AI. Rute GPS dan data Strava tidak pernah dibagikan.
• Kebijakan privasi: https://fit.joyorogo.com/privasi

Catatan:
• Butuh jam Huawei atau Honor. Diuji di Huawei Watch Fit 4 Pro; jam lain masih eksperimen. Daftar: https://fit.joyorogo.com/jam
• Versi Google Play tidak membaca log panggilan atau kontak dan tidak mengirim SMS, jadi jam menampilkan "Incoming call" tanpa nama penelepon dan SOS lewat SMS tidak tersedia.
• JoyoFit bukan produk Huawei dan tidak berafiliasi dengan Huawei atau Honor. Huawei dan Honor adalah merek dagang pemiliknya.
• JoyoFit bukan alat medis. Jangan dipakai untuk diagnosis atau pengobatan.

Open source (AGPL-3.0): https://github.com/dzulfikar08/joyofit
```

### English (en-US)

Title (max 30), 24 characters:

```
JoyoFit: Smartwatch Sync
```

Short description (max 80), 72 characters:

```
Sync steps, sleep, heart rate and workouts from your watch. Open source.
```

Full description:

```
JoyoFit connects your Huawei or Honor watch straight to your phone over Bluetooth, with no Huawei account and no middleman server. Your watch data stays on your phone.

What it does:
• Syncs steps, distance, calories, heart rate, SpO2, sleep and workouts from the watch, with GPS routes and sleep stages.
• Shows today, last night's sleep, trends and workout history in one app.
• Writes data to Health Connect (write only, it never reads) so other health apps you allow can use it.
• Weather on the watch from Open-Meteo (optional, coordinates rounded to about 1 km).
• Forwards phone notifications to the watch, shows incoming calls, lets you accept or reject calls from the watch, and finds your phone from the watch.
• Sets alarms, watch faces and daily goals from the phone.
• Stays connected in the background with one service notification (optional).

Privacy:
• Watch data is stored on your phone. No ads, no analytics, your data is not sold.
• The JoyoFit cloud is optional and only starts after you sign in with a JoyoRogo account. Cloud data can be deleted by email request.
• AI connection (optional, Pro): only if you connect Claude, ChatGPT or another MCP app is your data read (read-only), when you ask a question there. Disconnect any time in Settings, Koneksi AI. GPS routes and Strava data are never shared.
• Privacy policy: https://fit.joyorogo.com/privasi

Notes:
• You need a Huawei or Honor watch. Tested on the Huawei Watch Fit 4 Pro; other watches are experimental. List: https://fit.joyorogo.com/jam
• The Google Play version does not read your call log or contacts and does not send SMS, so the watch shows "Incoming call" without a caller name and SOS texts are not available.
• JoyoFit is not a Huawei product and is not affiliated with Huawei or Honor. Huawei and Honor are trademarks of their owners.
• JoyoFit is not a medical device. Do not use it for diagnosis or treatment.

Open source (AGPL-3.0): https://github.com/dzulfikar08/joyofit
```

Category: **Health & Fitness**. Tags: pick fitness/health tracker tags offered. Contact email: `dzulfikar@joyorogo.com`, website `https://fit.joyorogo.com`.
Privacy policy URL: `https://fit.joyorogo.com/privasi`.

## 6. App access, ads, audience, content rating

**App access**: select "All or some functionality is restricted" and give instructions (reviewers have no Huawei watch, so say so and give them a video):

```
No login is needed to open the app or to use any feature. The cloud (Settings, Health and cloud) is optional and needs a JoyoRogo account; leave it off.
Most screens show data from a Huawei or Honor smartwatch paired over Bluetooth, which a reviewer may not have. Without a watch the app opens on empty screens
(Today, Workouts, Watch). A screen recording of the full flow with a watch is at: <PASTE UNLISTED YOUTUBE URL>
To see the settings screens: tab Settings, then the sections On the watch, Health and cloud, Safety.
```

Record that demo video (2 to 3 minutes) before you submit; the same video can serve section 8.

**Ads**: No, the app does not contain ads.

**Target audience and content**: age group **18 and over** only. Not designed for children, no Families program. Appeals to children: no.

**Content rating (IARC questionnaire)**, category *Utility, Productivity, Communication, or other*:

| Question | Answer |
|---|---|
| Violence, blood, fear, sexual content, profanity, drugs, gambling, hate speech | No to all |
| Does the app let users interact or exchange content with other users? | No |
| Does it share the user's location with other users? | No |
| Does it allow users to purchase digital goods? | No |
| Does it have unrestricted internet access / a web browser? | No (it opens GitHub and the privacy page in the system browser only on tap; it has no embedded browser) |
| Does it contain news, or is it a government, financial or COVID-19 app? | No |
| Health: does it provide medical advice or diagnosis? | No (it displays data from the user's own watch; the listing says it is not a medical device) |

Expected result: Everyone / PEGI 3 / IARC 3+.

**Health apps declaration** (App content, Health apps): select **Activity and fitness** (and **Sleep** if offered). Do not select medical or clinical options.

**News / government / financial features**: none. **Data deletion URL** (asked in the Data safety form): `https://fit.joyorogo.com/privasi#hapus`.

## 7. Data safety form

JoyoFit keeps watch data on the device by default. Google counts data as *collected* only when it leaves the device. Declare these (Play build, current code; verified against the code in `src/cloud`, `server/src`, the weather and Health Connect modules):

| Data type | Collected | Shared | Purpose | Optional | Encrypted in transit | Deletion |
|---|---|---|---|---|---|---|
| Health info: heart rate, SpO2, sleep | Yes (JoyoFit cloud) | No | App functionality (backup) | Yes: only after signing in to the cloud | Yes (HTTPS) | Yes, on request by email |
| Fitness info: steps, distance, calories, workouts, daily scores and body metrics (sleep hours, resting heart rate, HRV, VO2max, training status, recovery time) | Yes (JoyoFit cloud; scores and body metrics also to JoyoRogo) | No | App functionality | Yes | Yes | Yes, on request |
| Precise location: workout GPS tracks | Yes (JoyoFit cloud, full-precision track points) | No | App functionality | Yes | Yes | Yes, on request |
| Precise location: start point and waypoints of a loop route (Routes, Loop baru dari rumah) | Yes, only when the user taps Cari rute: the coordinates go to the public OSRM routing service of FOSSGIS e.V. (`routing.openstreetmap.de`), not to JoyoFit servers; nothing is stored by us | **Yes**, with FOSSGIS e.V. (routing provider) | App functionality | Yes: the feature is opened by the user and works from a saved Home point without any location permission | Yes (HTTPS) | Not stored by us; FOSSGIS's own policy applies |
| Approximate location: weather position rounded to ~1 km | Yes (sent to Open-Meteo) | **Yes**, with Open-Meteo (weather provider) | App functionality | Yes: weather is off by default | Yes | Not stored by us; Open-Meteo's own policy applies |
| Name, Email address, User IDs | Yes (JoyoRogo sign-in; the cloud keys rows by the user id) | No | Account management, app functionality | Yes | Yes | Yes, on request |
| Device or other IDs: the watch's Bluetooth address | Yes (JoyoFit cloud) | No | App functionality | Yes | Yes | Yes, on request |
| Food and meals (JoyoRogo link: calories logged on the watch) | Yes, to JoyoRogo while signed in | No | App functionality | Yes | Yes | Yes, via JoyoRogo's deletion |
| Health and fitness info, food, weight (optional AI connection, JoyoRogo Pro) | Read from JoyoRogo's server by the AI app the user connects (Claude, ChatGPT or another MCP app), only when the user asks a question there; read-only; GPS routes and Strava data excluded | **Yes**, with the AI provider the user chose, started by the user | App functionality (user-initiated) | Yes: off until the user connects an app, revocable at once in Settings, Koneksi AI | Yes | JoyoRogo keeps a 90-day audit log (tool and dates, not the data); the provider's own terms apply to what it received. Whether Play classifies this user-initiated transfer as sharing: confirm in the Console [INFERENCE: not checked] |

Answers to the other questions:

- Is any data collected or shared? **Yes** (above). Is all collected data encrypted in transit? **Yes**.
- Do you provide a way for users to request that their data be deleted? **Yes**, URL `https://fit.joyorogo.com/privasi#hapus` (email request, answered within 30 days; the in-app cloud section says the same).
- Not collected: contacts, call log, SMS, photos, files, audio, calendar, app activity, web browsing, crash logs, diagnostics, advertising ID, notifications content (forwarded to the user's own watch over Bluetooth only), financial info. In the Play build the phone-state, call-answer and notification-listener permissions are only used on the device.
- Health Connect data is **written only** and never leaves the device through JoyoFit, so it is not a "collected" row.
- Security practices: *Data encrypted in transit*: yes. *You can request data deletion*: yes. *Committed to the Play Families policy*: no. *Independent security review*: no.

Notes for you when answering:

- Satellite-assist (AGPS): at the watch's request the phone downloads the public Broadcom LTO file from the fixed address `https://gllto.glpals.com/7day/v6/latest/lto.dat` (plain GET, no location, no ID, no app identification). That server sees the IP address. JoyoFit does not contact Huawei servers; any other assist data the watch asks for is declined. The address is fixed in the app, so this download carries no location and does not change the declarations above.
- Cloudflare Workers logs request metadata (URL, status, IP). This is operational logging by the infrastructure provider and not declared as a separate data type.
- If you change what the app uploads, update this table, `site/src/Privasi.tsx` and the in-app Cloud text together.

### Deleting cloud data on request (your runbook)

Verify the sender's account email, find their JoyoRogo user id in `user_state`/the Better Auth user table, then (from `server/`):

```bash
USER_ID='<id>'
for t in step_samples sleep_segments workouts workout_points device imports user_state; do
  bunx wrangler d1 execute joyofit --remote --command "DELETE FROM $t WHERE user_id = '$USER_ID'"
done
# R2: raw imports live under imports/<userId>/ in the joyofit-imports bucket (the app never uploads there; check anyway)
bunx wrangler r2 object list joyofit-imports --prefix "imports/$USER_ID/"   # then delete each object
```

Reply to the sender when done. The privacy page promises 30 days at most; change it in `site/src/Privasi.tsx` if you prefer another number.

## 8. Permission and API declarations

### Health Connect (App content, Health Connect / Permissions declaration)

Privacy policy URL: `https://fit.joyorogo.com/privasi`. JoyoFit declares **write** access only. The app also provides the permission rationale screen
(`HealthConnectRationaleActivity`, reached from Health Connect and from "View permission usage"). Core use for every type:
"JoyoFit copies measurements recorded by the user's Huawei or Honor smartwatch into Health Connect so that the user's other health apps can show
them. It never reads Health Connect and does not send this data anywhere."

| Permission | Justification text |
|---|---|
| `WRITE_STEPS` | Writes per-minute step counts recorded by the user's smartwatch so other fitness apps show the same daily steps. |
| `WRITE_DISTANCE` | Writes per-minute distance walked or run, recorded by the watch. |
| `WRITE_ACTIVE_CALORIES_BURNED` | Writes active energy per minute and per workout, recorded by the watch. |
| `WRITE_HEART_RATE` | Writes heart-rate samples measured by the watch, including during workouts. |
| `WRITE_RESTING_HEART_RATE` | Writes the resting heart rate the watch reports. |
| `WRITE_OXYGEN_SATURATION` | Writes SpO2 readings measured by the watch. |
| `WRITE_SLEEP` | Writes sleep sessions with stages (light, deep, REM, awake) recorded by the watch. |
| `WRITE_EXERCISE` | Writes workout sessions (type, start, end, summary) recorded by the watch. No GPS route is written. |

Is the data shared with third parties, sold or used for ads? **No**. Used for anything beyond writing it to Health Connect? **No**.
Health Connect data is not part of the cloud upload.

### Foreground service: `connectedDevice`

Declaration (App content, Foreground service permissions) for `FOREGROUND_SERVICE_CONNECTED_DEVICE`:

> JoyoFit's `WatchService` keeps a Bluetooth connection open to the user's paired Huawei or Honor smartwatch while the app is closed, so the watch
> keeps syncing steps, heart rate, sleep and workouts, receives forwarded notifications and incoming-call alerts, can find the phone, and reconnects
> after a drop. It runs only when the user turns on Settings, On the watch, Background and sync, "Keep connected in the background". It shows an ongoing
> notification and stops when the user turns the switch off or disconnects the watch.

Video (unlisted YouTube link, 1 to 2 minutes, record the screen plus a short clip of the watch):

1. Settings, Background and sync: switch **Keep connected in the background** on. The service notification appears.
2. Show the watch connected (Watch tab) and press the app away/close it from recents.
3. Send a notification or ring the phone from the watch (find my phone) while JoyoFit is closed; show it reaching the watch / the phone ringing.
4. Reopen the app, switch the setting off: the notification disappears.

### Foreground service: `location` (workouts recorded on the phone)

Branch `sensors` adds `RecordingService` (`modules/ble-sensors`), type `location|connectedDevice`. Declaration for `FOREGROUND_SERVICE_LOCATION` (and the sensor half of `FOREGROUND_SERVICE_CONNECTED_DEVICE`):

> When the user starts an outdoor workout (run, walk, ride, hike) on the phone, JoyoFit records the route, distance and pace from the phone's GPS and, if the
> user paired them, the heart rate, speed, cadence and power of Bluetooth sensors. The workout has to keep recording while the screen is off and the phone is
> in a pocket or on a bike mount, so it runs as a foreground service with an ongoing notification (time, distance, heart rate). The service starts only when the
> user taps Start and stops when the workout is finished or discarded. It is never started in the background.

Video: Workouts, Rekam latihan, Lari, allow location, Mulai; lock the screen; show the notification counting; unlock, Selesai, show the saved route.

### Notification listener (prominent disclosure)

Notification access is a special permission the user grants in Android settings, and the app shows an in-app disclosure first. The disclosure text (shown
before JoyoFit opens Android's notification-access screen, on a dialog with **Cancel** and **Continue**):

> JoyoFit reads the notifications on this phone (app name, title and text) so it can show them on your watch. They are sent to the watch over Bluetooth
> only. JoyoFit does not store them and does not send them over the internet. You can choose which apps are forwarded, and turn this off at any time.

Play Console: when it asks about this permission, answer that notification access is the app's core function (forwarding phone notifications to the paired watch),
that the user is shown the disclosure above and must grant access in system settings, and that the data is not shared or retained.

### Location

No background location permission. Coarse for the weather position (optional, off by default), precise for the phone GPS during outdoor workouts the watch starts and for outdoor workouts recorded on the phone (the latter keeps running with the screen off inside the `location` foreground service above, started from the foreground by the user's tap).
JoyoFit explains the GPS use in a dialog before the first Android location prompt (and Settings, Notifications and calls, "Phone GPS for outdoor workouts" asks again). Declare in
the Data safety form as in section 7. The declared reason: "Location is used for weather on the watch and to give the watch the phone's GPS during workouts."

### Permissions that need no declaration form

`READ_PHONE_STATE` and `ANSWER_PHONE_CALLS` are not in the restricted SMS/Call Log group (the Play build has no `READ_CALL_LOG`, `SEND_SMS`, `READ_SMS`,
`RECEIVE_SMS` or `READ_CONTACTS`), `BLUETOOTH_CONNECT`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE`, `WAKE_LOCK`, `INTERNET`: none of these needs a Console declaration.
If the Console pre-launch report flags `READ_PHONE_STATE`, explain: "Used to tell the user's watch that the phone is ringing, on an opt-in switch."

### Family monitoring (stalkerware policy, Data safety)

Family monitoring shows one person's daily numbers to another, so Google's Malware policy on stalkerware applies: tracking must never be covert. How JoyoFit meets it:

- **Prominent in-app disclosure and consent**, shown to the watched person before anything is shared, on its own screen with **Lanjut** and **Nanti saja**: "Izinkan [nama] melihat kabarmu? [nama] ingin ikut memantau kabarmu dari jam Huawei-mu. Kamu yang menentukan apa yang dibagikan." A switch per category, the "tidak pernah dibagikan: lokasi, rute olahraga, detak jantung per menit, makanan, foto" line, and "Kamu bisa jeda atau berhenti kapan saja. Kalau berhenti, [nama] langsung tidak bisa melihat apa pun dan riwayatnya kami hapus." The invite page (`fit.joyorogo.com/keluarga/<code>`) repeats the same points before the app opens.
- **No covert mode:** the app has no hidden icon, no silent install path and no way to start sharing without the watched person accepting. The watched person always sees who can view their data and can pause or revoke in one tap.
- **Not real-time, not emergency:** the disclaimer text appears on the first-run screen and every family screen. The store listing must not claim fall, heart attack or emergency detection.
- **Data safety update:** add Health info (resting heart rate, sleep, SpO2) and Fitness info (steps) as **shared** with another user, for App functionality, optional, encrypted in transit, deletable (revoke or account deletion). Add Device or other IDs: push token (App functionality) when alerts ship. Play Console may treat user-initiated sharing with another person differently from "sharing" with a third party: confirm which classification applies in the Data safety form before submitting [INFERENCE: not checked in Console].
- **Notifications:** Android 13+ needs the notification prompt; the app explains first ("Notifikasi bisa terlambat dan tidak menjamin kamu langsung tahu") on a screen whose button says **Lanjut**.
- **Listing line (id):** "Opsional: bagikan kabar harianmu (langkah, tidur, detak istirahat) ke keluarga yang kamu izinkan. Bukan pantauan langsung dan bukan alat darurat."
- **Listing line (en):** "Optional: share a few daily numbers (steps, sleep, resting heart rate) with family you choose. Not real-time and not an emergency tool."
- **Privacy policy:** `https://fit.joyorogo.com/privasi#keluarga`.

## 9. Pre-launch checklist

- [ ] `scripts/build-release.sh --play` ran cleanly (it prints the permission list and fails on a forbidden one).
- [ ] Privacy page loads at `https://fit.joyorogo.com/privasi`, and `#hapus` jumps to the deletion section.
- [ ] You can answer a cloud deletion email within 30 days (section 7 runbook).
- [ ] Demo video recorded and linked in App access and the foreground service declaration.
- [ ] 512 x 512 icon, 1024 x 500 feature graphic, 2+ phone screenshots uploaded.
- [ ] Family monitoring: Data safety rows added, sharing classification confirmed, listing line added, disclosure screen screenshot ready.
- [ ] Data safety, content rating, target audience, health apps, ads declarations saved.
- [ ] Google Group created, 12+ testers added, opt-in link sent, day count started.
- [ ] Android developer verification complete for the account.
