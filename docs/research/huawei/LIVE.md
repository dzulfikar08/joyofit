# Live workout figures from a Huawei Watch Fit 4 Pro (6.1.0.117): Huawei Health 17.0.8.300 vs JoyoFit

Sources:
- `jadx/cN` is the decompile of `dex/classesN.dex`. `c0` is `classes.dex`.
- `logcat2.txt` is Huawei Health's own logcat for 09:25–09:48 on 2026-10-25. It covers the phone-started run (09:25:18–09:28:00) and the watch-started walk (09:30:41–09:32:55).
- `logcat.txt` ends at 09:14.

Claims without a citation are marked [INFERENCE].

## TL;DR

- **Huawei Health gets no live pace, speed or distance from the Fit 4 Pro during a watch-started workout either.**
  - Huawei Health's only channel for a watch-started workout is reverse linkage: a `37/02` event `800400014` start, then `37/03` points from `hw.sport.linkage.device`. The watch never opened it.
  - `logcat2.txt` has zero `R_LINKAGE_Event_*` or `R_LINKAGE_Real_*` lines. Huawei Health is ready to receive them: the platform registered at 08:44:55 (`R_LINKAGE_ReverseLinkagePlatform initReverseLinkage register`).
- **What the watch sent during the walk:**
  - `37/02` every ~20–30 s: HTTP-proxy requests (event `800100011`).
  - Huawei Health's ~841/1013 B `37/02` answers are the HTTP responses (event `800100012`). They are not sport data.
  - `18/02` GPS requests: Huawei Health refused them with `124004`.
  - At 09:32:01, 80 s into the walk, the watch turned its phone-GPS request **off**, while the walk went on until 09:32:55.
- **No phone request in Huawei Health makes this watch stream figures for a watch-started workout.**
  - The only phone-to-watch linkage requests ("report status", op 4; "restart linkage", op 5) are sent only when ExpandCapability 335 is set. It is clear on the Fit 4 Pro.
- **The 1 Hz `37/03` that Huawei Health sends during a phone-started run** goes phone → watch. It carries Huawei Health's own realtime sport data for the watch's running-posture app (dict `300001`, ExpandCapability 175). It is not a request.
- **`17/11` is not what Huawei Health expects from this watch.**
  - With ExpandCapability 234 ("isSupportReal", true on this watch), Huawei Health sends `17/12 {01:1}` but listens to linkage `37/03` points, not `17/11`.
  - Huawei Health only does this for a phone-started workout, and the `17/01` behind it was refused (123002), so nothing streamed.
- **JoyoFit root cause:**
  - The watch sends no figures (it does the same to Huawei Health).
  - JoyoFit's only other source is its phone-GPS track. That track lives only as long as the watch's `18/02` request: `stopGps()` runs on `18/02 {01:0}`.
  - A watch with its own GPS turns that request off about a minute in (observed 09:32:01).
  - Fixes are also dropped unless the session is already `RUNNING`.
- **Fix:** keep the phone's own location updates for the whole live session, independent of `18/02`. Feed `18/03` to the watch only while it asks.

---

## 1. Huawei Health reverse-linkage protocol (DataSync service 0x37)

### Transport

- **Service `0x37` (55) commands, by byte 1 of the frame** (`ynw.a(UniteDevice,byte[],..)`, `c21/defpackage/ynw.java:249-277`; service check `:339`):

  | Command | Kind | Sending needs ExpandCapability |
  |---|---|---|
  | `01` | SampleConfig | 83 (`:115`) |
  | `02` | SampleEvent | 84 (`:135`) |
  | `03` | SamplePoint | 85 (`:172`) |
  | `04` | DictionaryPoint | – |
  | `05` | CompactDictionary | – |

- **Header tags:**
  - `01` src package, `02` wear package, `7F` error code (`ynw.c(List,efz)` `:546-575`).
  - Event: `03` event id, `04` level, `05` data (`ynw.e(...)` `:380-412`).
  - Point: `03` dict id, `04` and `05` start and end ms, `0A`, then nested children `08` field id and `09` value (`ynw.a(List,egf)` `:577-614`, `ynw.d(...)` `:739-764`).
- **Watch → phone frames carry `src = hw.sport.linkage.device` and `wear = hw.sport.linkage.app`.**
  - The receiver `nkp.onDataReceived` rejects anything else (`c11/defpackage/nkp.java:26-45`, check at `:76-78`).
  - It is registered for `hw.sport.linkage.app` (`c2/defpackage/nkt.java:21-24`).
  - It dispatches by sample class (`c11/defpackage/nkw.java`): event → `nkx` → `nla` (event-id table, `c11/defpackage/nla.java:12-20`); point → `nku`.

### Table

| Event / dict id | Dir | Fields (tag → meaning) | Units / values | Cite |
|---|---|---|---|---|
| `37/02` event **800400014** (linkage control) | watch → phone | `01` workoutType, `02` op, `03` time, `04` replyCode, `05` currentStatus | op: 0 startLinkage, 1 stopLinkage, 2 resumeLinkage, 3 reportLinkageStatus. time in ms. status: the watch's sport state (0 pre-sport, 1 running, 2 paused, as JoyoFit models it) | `nlc.handleSampleEvent` `c11/defpackage/nlc.java:12-27`, op switch `:29-44` |
| ↳ reply to op 0 | phone → watch | `02 00`, `04 <code>` | code 0 = accept, 1 = refuse. Integers are minimal-length (`cph.f`, `c4/defpackage/cph.java:199-214`), so an accept is `02 01 00 04 01 00` | `nlf` (`c11/defpackage/nlf.java:16-18`), factory `nlm.java` map2 |
| ↳ reply to op 2 | phone → watch | `02 02`, `04 <code>` | same | `nli.java:16` |
| ↳ reply to op 1 | phone → watch | `02 01`, `04 <code>` | same | `nlh.java:16` |
| `37/02` **800400014**, phone-originated | phone → watch | `02 01` stopLinkage (op type 102); `02 04` requestReportLinkageStatus (103); `02 05` requestRestartLinkage (104) | 103 and 104 are sent only if ExpandCapability **335** (`fkf.h()`) | `nlr`/`nlk`/`nll.java:10`, `nlm.java:18-20`, `c30/defpackage/fkf.java:316-349` |
| `37/02` **800400002** start / **…03** stop / **…04** pause / **…05** resume | watch → phone | `01` time, `02` workoutType | time in ms | `nlb.java` (start → `AppLinkageApiImpl.start`), `nlg.java` (stop) |
| ↳ same events | phone → watch | `01` now, `02` workoutType | op types 204 stop, 202 pause, 203 resume. Sent only for a linkage Huawei Health already runs (`ReverseLinkageManager.onStop/Pause/ResumeSport`) | `nls`/`nlj`/`nln.java:10` |
| `37/03` point, dict **50004** (linkage realtime) | watch → phone | children `08` dict field id, `09` big-endian value. Only ids in the `olk.c` allow-list (53 ids) are kept | `50004396` duration (s), `50004838` HR (bpm), `50004765` distance (dm; the phone→watch packer writes ×10, `fku.java:26`), `50004829` calories, `50004799` speed, `50004979` pace (s/km), `50004770` operator_type, and others. Units as already derived in JoyoFit `LiveWorkoutCodec.kt:48-64` | `nku.c()` `c11/defpackage/nku.java:46-80`, `olk.c` `c12/defpackage/olk.java`, handlers `c30/defpackage/fkc.java`, consumer `fkf$4.onResponse` → `fjt$7` / `MirrorLinkDataSource` |
| `37/03` point, dict **50004** | phone → watch | the same ids, filled from Huawei Health's JSON (`fmf.b` / `fmf.c`, `c30/defpackage/fmf.java`) | Huawei Health's own computed figures | `fkf.d(JSONObject,DeviceInfo)` `fkf.java:277-287`. Sent only via `fjt.b()` when ExpandCapability 234 is set **and** Huawei Health is "linked" (`c7/defpackage/fjt.java:704-709`, `fjq.java:365-379`) |
| `37/03` point, dict **300001** `REALTIME_SPORT_DATA`, src `hw.linkage.watch.posture.app` → wear `hw.linkage.watch.posture.device` | phone → watch | fields from `fmk.b` present in Huawei Health's track bundle: walkOrRun, speed, steps, stepRate, stride, ground contact, … | integer, float and double encodings per `fmk.d` / `fmk.a` / `fmk.e` | `fmj.e(Bundle,DeviceInfo)` `c7/defpackage/fmj.java:51-61`. Gate: ExpandCapability **175** (`fmk.d()`, `fmk.java:137-141`). Caller: `fjq$5.getSportInfo` → `fjw.sendDataToDevice` (`fjq.java:83`, `fjw.java:99-109`), **ungated by the 17/01 result** |
| `37/02` event **800100011** (src `hw.wearable.httpProxy[Ap]`) | watch → phone | `01` requestId, `02` path, `03` host, `04` grsHostKey, `05` method, `06` headers, `07` body, `08` cloudType, `09` isForeground, `0A` contentType, `0B` flag, `0C` isStreaming | an HTTP request the phone runs against Huawei cloud | `mux.e(egd)` `c11/defpackage/mux.java:143-158`; parse `:166-180`; setter→field map `HttpRequestInfo.java` |
| ↳ `37/02` event **800100012** (src `hw.unitedevice.httpProxy`) | phone → watch | the HTTP response | – | `mux.a(DeviceInfo,byte[],boolean)` `mux.java:725-737` |
| `37/02` event from `hw.sport.threecircle` | watch → phone | 8 bytes: LE timestamp + event 3 | "activity rings" notice at workout start | logcat2 09:30:41.452 `R_TC_3CircDevInt eventData ... D169DD6A03000000 ... eventId:3` |

### When Huawei Health accepts a start (op 0)

`AppLinkageApiImpl.startLinkage` (`c32/.../impl/AppLinkageApiImpl.java:49-68`) accepts only if all of these hold:

- The mapped sport is in `{257, 258, 259, 264, 265, 281}` (`:28`). The mapping is workoutType 2→257, 1→258, 3→259, 5→264, 7→265, 15→281 (`fkf.java:40-48`).
- The client type is supported.
- Huawei Health is not already in a workout.
- Huawei Health is in the **foreground**, unless `CommonUtil.bd()` (`:62`).

Otherwise it replies `1`.

On success it starts `TrackMainMapActivity` with `sport_data_source_sportting=100` (`:174-186`). `ReverseLinkageManager.onPreSport` then sends the accept (`replyDevice(100,"0")`, `c32/.../manager/ReverseLinkageManager.java:37`). `MirrorLinkDataSource.onPreSport` registers the `37/03` listener (`c32/.../datasource/MirrorLinkDataSource.java:29`, `:167`). It **only listens**: no phone request is sent to make the watch stream. After the accept, the watch pushes points unprompted [INFERENCE: the watch-side trigger is not in Huawei Health].

---

## 2. What Huawei Health replied during the watch-started walk (logcat2.txt + HCI sizes)

| Time | Wire | Huawei Health log | Meaning |
|---|---|---|---|
| 09:30:41.452 | `37/02` w→p (≈98 B) | `R_TC_SprtRmdDistCtr receive device event` / `R_TC_3CircDevInt eventId:3` | activity-rings event at the workout start; not linkage [INFERENCE: the 98 B frame] |
| 09:31:00.176 / .187 | `37/02` w→p (279 B ×2) | `R_HttpProxyManager Receive httpProxy request from device, requestId:83` / `84`, method 2 (GET), GRS `domainHealthdataHicloud` | HTTP proxy request (800100011) |
| 09:31:00.478 / .479 | `37/02` p→w (841 B, 1013 B) | `sendCommand ... serviceId: 55 commandId: 2` ×2 right after `request succeed` | **the ~800-byte "reply" is the HTTP response event 800100012** |
| 09:31:18, 09:31:47, 09:32:18 | same pattern | requestIds 10005/10006, 10005, 10005. One failing URL is logged as masked `...healthAlgorithm/v1/algorithm/algorithmParam?type=6000…` | the watch fetching algorithm parameters from Huawei cloud [INFERENCE from the masked URL] |
| 09:31:04, :25, :46 | `18/02 {01:1}` w→p, answer `18/02 7F 0001E464` (45 B) | `Track_HwGpsLocationManager bitmap not support lat,is emui5.0:false` | Huawei Health refuses phone GPS with **124004**: the watch's `18/01` bitmap asks for lat/lon (>15), the phone lacks ExpandCapability 332, and it is not EMUI (`c2/defpackage/ndl.java:259-263`). So no `18/03` |
| 09:31:04.475, 09:32:01.434 | `24/08` p→w | – | ack of `18/08` (activity recognition, `nde.b(DeviceInfo)` `c11/defpackage/nde.java:328-337`) |
| 09:32:01.431 | `18/02 {01:0}` w→p | `device disable gps` → answer 100000 | **the watch stops asking for the phone's GPS 80 s into the walk** (`ndl.java:138-152`, `:147`) |
| whole walk | – | **no** `R_LINKAGE_*`, `LINKAGE_Real`, `handleGetOperatorStatus` | no reverse linkage, no `37/03` from the watch, no `17/11`. Huawei Health showed no live figures either |

Answers to the questions:

- **Does Huawei Health push its own data, a sport config, or a realtime request in the ~800 B reply?** None of them. It is an HTTP response relayed for the watch.
- **Can any phone request make the watch stream during a watch-started workout?**
  - Not in Huawei Health 17.0.8.300 for this watch.
  - The only candidates are the `800400014` ops 4 and 5 (`nlk`, `nll`). Huawei Health gates them on ExpandCapability 335 (`fkf.java:349`), which the Fit 4 Pro does not set.
  - `17/12` is a phone-started-workout tool (§3).

### The 1 Hz `37/03` during the phone-started run

The sequence in logcat2:

| Time | Event |
|---|---|
| 09:25:18.358 | `NewLinkStrategy, start sport` |
| 09:25:18.359 | `isSupportReal is true`, `registerRealDataListener`, `isSupportWatchRunPosture is true` |
| 09:25:18.359–.365 | Huawei Health sends `17/15` (23/21), `17/01` (23/1), `17/12` (23/18) |
| 09:25:18.444 | `handleNotificationOperatorStatus info:123002` |
| from 09:25:18.748 | `55/3` every 1.000 s until the stop at 09:28:00 |

Why this is the posture channel:

- After 123002 the "linked" flag is false (`fjq$3`, `c7/defpackage/fjq.java:117-131`). That disables `fjq.d(Bundle)` → `fjt.b` → `fkf.d` (`fjq.java:366`).
- The only 1 Hz `37/03` sender left is `fjq$5.getSportInfo` → `fjw.sendDataToDevice` → `fmj.e` (`fjq.java:83`). This is the posture channel, dict 300001, phone → watch.
- Its gate is ExpandCapability 175, true at 09:25:18.359.
- So the 133 B frame is Huawei Health's own realtime sport data pushed into the watch's running-posture app. It is not a request, and it is unrelated to live figures on the phone. [INFERENCE: field set; the size fits a header plus 1–2 fields]

---

## 3. `17/11` gating

- **`17/12` = `openOrCloseReport`**, payload `01 01 <operator_type>` (1 open, 0 close). Sources: `HwHeartRateManager.openOrCloseReport`, `c2/.../heartrate/HwHeartRateManager.java:229-251`.
- **`17/11` = "5.23.17"**, handled by `HwLinkageServiceManager.handleWorkoutReportPlayData` (`c11/.../exercise/HwLinkageServiceManager.java:109-110`, `:591-606`). It is delivered only to the `registerGetRTSportDataListCallbackList` notification.
- Huawei Health opens the report only inside its **own phone-started workout**:
  - Call chain: `fjq.a(int)` / `fjq.d(int)` (start / resume) → `fjt.d()` (`fjq.java:353`, `:325`).
  - The call needs `isSupportInformCloseOrOpen` (23.18 listed, `fju.java:416-419`).
  - It goes out in the same call as `17/01` (`setOperator`), before the `17/01` answer arrives. So it does not depend on an accepted `17/01`.
- `fjt.d()` (`c7/defpackage/fjt.java:801-820`):
  - **ExpandCapability 234 set** (Fit 4 Pro: logcat2 09:25:18.359 `isSupportReal is true`): sends `17/12 {01:1}` via `fmn.e(1,…)`. This path does **not** register the `17/11` callback (`fmn.java:232-245`). It registers the linkage `37/03` listener instead (`fjt.java:837-847`). Realtime is expected as `37/03` points from `hw.sport.linkage.device`.
  - **234 clear**: `fmn.b(...)` sends `17/12` and registers `registerGetRTSportDataListCallbackList`, i.e. it expects `17/11` (`fmn.java:217-230`).
- During the phone run nothing streamed:
  - The 17/12 answer reached `HwLinkageServiceManager.getResult` and logged `getResult error commandId` (09:25:18.445): that dispatcher has no case for command 18.
  - No `37/03` and no `17/11` came from the watch, because the watch refused the workout (`17/01` → 123002) [INFERENCE: the watch streams only for a workout it links].
- For a **watch-started** workout, Huawei Health sends neither `17/12` nor anything else. Its only path is reverse linkage (§1), which the watch did not start.

---

## 4. JoyoFit live path for a watch-started workout and the root cause

Android, `modules/huawei-wear/android/src/main/java/com/joyodigitama/huaweiwear/`:

1. **Connect.** `WorkoutLink.onLinkState` (`WorkoutLink.kt:65-87`) subscribes to `18/02` and `17/11`. It sends `17/12 {01:1}` once per link session (`:85`, deduplicated by `reportOpenOn`, `:298-314`) and starts the `17/03` poll (`:114-134`).
2. **DataSync.** `LiveWorkout.register` (`LiveWorkout.kt:114-117`) takes events and points of `hw.sport.linkage.app` ⇄ `hw.sport.linkage.device` in either orientation (`DataSyncService.kt:286-315`).
   - `onEvent` (`:191-201`) handles 800400014 (start, resume and stop are answered with code 0, `:203-240`; the reply bytes match Huawei Health's `nlf/nli/nlh`) and 800400002..05.
   - `onPoint` (`:262-283`) applies `LiveMetrics.applyPoint` (`LiveWorkoutCodec.kt:112-138`).
   - The JoyoFit side of reverse linkage is complete. It is never exercised because the watch does not start it (§2).
   - HTTP-proxy events (`hw.wearable.httpProxy`) get only `DataSync event: no handler` (`DataSyncService.kt:314`). That is harmless for live figures.
3. **Watch `18/02 {01:1}`.** `WorkoutLink.onGpsStatus` (`WorkoutLink.kt:182-204`):
   - Always answers 100000 (`:188`), where Huawei Health would answer 124004 for this watch.
   - `live.gpsPing()` opens a `Source.GPS` session in `PREPARING` (`LiveWorkout.kt:357-422`).
   - `openReport()` is a no-op after the connect-time open (`:300`).
   - `startGps()` (`:227-261`) needs `ACCESS_FINE_LOCATION` and a successful `18/01` GpsParameters answer (`:206-221`, `:233`). It then requests `GPS_PROVIDER` at 1 Hz and forwards each fix to `live.onLocation` and to the watch as `18/03`.
4. **Watch `18/02 {01:0}`.** `onGpsStatus` → **`stopGps()`** (`:201`, `:263-267`). The phone's location updates stop, and so does every phone-GPS figure.
5. **Fix intake.** `LiveWorkout.onLocation` (`:456-476`):
   - Fixes are added to the track **only while `RUNNING`** (`:463`).
   - In `PREPARING`, `MotionStart` can start the clock only if the `17/03` poll never answered (`silentWatch`, `:465`). On the Fit 4 Pro, 17/03 does answer (protocol/README.md "Watch-started workout probe").
   - So the clock starts only when the poll says operator 1 or 3 (`watchStatus`, `:291-348`).
6. **To JS.** `toJs` (`:556-601`):
   - `distanceM`, `speedKmh` and `paceSecPerKm` are null: no `37/03`, no `17/11`.
   - `gpsDistanceM` is `track.distanceM` when a location exists (`:597`).
   - `gpsPaceSecPerKm = track.paceSecPerKm` (`:599`). It is computed over a short window and frozen at the last value once fixes stop (`LiveGpsTrack.kt:42-56`).
7. **JS.** `deriveMetrics` (`src/features/live/liveSession.ts:111-128`): distance = first positive of `distanceM` and `gpsDistanceM`; pace = first positive of `paceSecPerKm`, `3600/speedKmh` and `gpsPaceSecPerKm`. On screen, speed is derived from the pace (`runFields.ts:115-117`, `LiveWorkoutScreen.tsx:150`). Nothing else feeds them.

### Root cause, ranked

1. **The watch sends no figures for a watch-started workout** (certain, §2).
   - No `17/11`, no `37/03`, no reverse-linkage start, even to Huawei Health.
   - JoyoFit's watch-figure paths (`onReport`, `onPoint`) are correct but idle.
2. **JoyoFit's phone-GPS fallback is tied to the watch's `18/02` lifetime** (high).
   - A watch with its own GPS asks only while searching. Huawei Health saw `{01:0}` at 09:32:01, 80 s into a walk that ran on.
   - `WorkoutLink.kt:201` then stops the phone's GPS. Distance freezes and pace freezes at its last window or stays null. With the screen off it may never start at all (see 4).
   - [INFERENCE] With JoyoFit answering 100000 and sending `18/03`, the watch may stop asking even sooner, once its own fix is good.
3. **Fixes are dropped until `RUNNING`, and only `17/03` operator 1/3 can make an answered-poll session run** (medium).
   - If the Fit 4 Pro's `17/03` stays idle during an outdoor walk's pre-start/GPS phase and the phone GPS has already stopped (2), the session runs with zero distance.
   - The outdoor-walk `17/03` values were never logged on this watch (only strength: operator 1).
4. **Silent `startGps` bail-outs** (unknown): no precise-location permission (`:229`), `18/01` failure (`:233`), or no background location for a `connectedDevice` foreground service. Logged, so the device log tells.
5. **iOS has no phone-GPS track at all.** `ios/LiveWorkout.swift` has no `onLocation` and opens GPS sessions straight as `.running` (`:312-322`). On iOS distance and pace can only come from the watch, which never sends them.

Side notes:
- `protocol/README.md:350` says JoyoFit does not announce reverse-capability bits 47..59. That is stale: `DeviceConfig.java:2179-2182` sends Huawei Health's bitmap.
- The README's "the watch pushes all of it unprompted" is right for a linked workout, but on the Fit 4 Pro the link is never offered.

---

## 5. Recommended fix (smallest first, ranked by confidence) and device test

1. **Run the phone's own location for the whole live session, independent of `18/02`** (high confidence; this fixes the screen).
   - Changes:
     - `WorkoutLink.onGpsStatus` (`WorkoutLink.kt:182-204`): on `{01:0}`, stop only the `18/03` feed (a `feedWatch` flag checked in the listener before `sendLocation`, `:247`). Do not remove the location listener.
     - Split `stopGps()` (`:263-267`) into "stop feeding the watch" and "stop tracking". Call "stop tracking" from `LiveWorkout.end()` (`LiveWorkout.kt:147-158`) via a callback, and on `DISCONNECTED` (`:97`) only if no live session.
     - Do not make the tracking leg depend on `loadGpsParams()`: it is needed only for the `18/03` format (`:233`).
   - Acceptance: after the watch's `{01:0}`, the log still shows phone fixes, and `gpsDistanceM` keeps rising.
2. **Do not drop fixes of a GPS-requested session that the poll has not confirmed yet** (medium).
   - In `LiveWorkout.onLocation` (`:462-470`), let `MotionStart` start the clock for a `Source.GPS` session that is still `PREPARING` after the watch stopped asking for GPS, even when `lastStatusAtMs != 0`.
   - Or buffer fixes while `PREPARING` and add them at the switch to `RUNNING`.
   - Decide this from the device log of item T3 first.
3. **iOS parity** (needed for iOS users):
   - Add `onLocation` and a track to `ios/LiveWorkout.swift`, with the same `gps*` keys in `toJS`.
   - Make `ios/WorkoutLink.swift` keep `CoreLocationStream` running after `{01:0}` (`:159-181`, `:233`).
4. **Optional experiment, low confidence:** during a watch-started workout, send `37/02` `800400014` with data `02 01 05` (requestRestartLinkage, Huawei Health's `nll`) or `02 01 04` (requestReportLinkageStatus, `nlk`).
   - Success looks like an op 0/2 or 3 control event, then `37/03` points that the existing `onEvent`/`onPoint` already parse.
   - Huawei Health never sends these to this watch (ExpandCapability 335 clear), so expect no answer.
5. **Not recommended:** re-sending `17/12` per workout or parsing `37/02` payloads.
   - Huawei Health uses neither for this watch.
   - The periodic `37/02` frames are HTTP-proxy traffic, not sport reports.

### Device test (Fit 4 Pro 6.1.0.117, outdoor walk started on the watch, phone screen on, then off)

- **T1.** The JoyoFit log has no `DataSync event from watch: src=hw.sport.linkage.device` and no `DataSync point from watch` (confirms §2 with JoyoFit). Any `hw.wearable.httpProxy` events show up as "no handler" (expected).
- **T2.** These lines and their times:
  - `Workout link: watch takes GPS fields bitmap 0x..` and `phone GPS started for the watch`.
  - `phone GPS stopped` after the watch's `18/02 {01:0}`, and how long after the start that happens with JoyoFit answering 100000.
- **T3.** `Workout link: workout status ...` during the GPS search, after GO, during pause and resume. Do operator 1/3 appear for an outdoor walk, and when?
- **T4.** After fix 1: the location fixes continue after `{01:0}`; `gpsDistanceM` and `gpsPaceSecPerKm` change every few seconds; the screen shows distance and pace; the screen-off/background behaviour is recorded.
- **T5.** The final distance on the phone vs the watch's own summary after sync. This gives the error of the phone-GPS figure.
- **T6 (optional, fix 4).** Any watch answer to `800400014` op 4 or 5.
