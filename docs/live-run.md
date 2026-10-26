# Live run: a band that runs beside the phone

Two directions, one band without a GPS of its own (tester: Huawei Band 11, non-Pro; Huawei Health's "connected GPS" run):

- **Started on the band, JoyoFit follows** (`LiveWorkout.kt`, `src/features/live/`): the live screen.
- **Started on the phone, the band follows** (`src/features/record/bandLink*.ts`, `WatchWorkout.kt`): the Run recorder starts the band's workout too.

Everything the band does not confirm is marked UNVERIFIED below: no Band 11 was at hand when this was written.

## What the band sends (observed on a Fit 4 Pro 6.1.0.117, expected alike on a Band 11 [INFERENCE])

| Frame | Meaning |
| --- | --- |
| `18/02 {01: 1}` about every 20 s | "send me the phone's GPS". It starts when the band's workout screen starts looking for a fix, i.e. **before the workout runs** (the GO screen / countdown). `{01: 0}` stops it: a watch with its own GPS sends it once it has a fix, long before the workout ends (Fit 4 Pro: 80 s into a 2 min 14 s walk, 2026-10-25). |
| `18/01` | which GPS fields the band takes (bitmap: speed, distance, altitude, lat/lon, direction, precision). |
| `18/03 81{82{...}}` | phone to band, one per fix (about 1 per second). The band's distance and pace come from these, so they are `--` until the first fixes reach it. |
| `17/03 81 00` answer | `81{02 trainMonitorState, 03 operator, [04 sport], [06 workout type]}`, read together as a `WatchPhase` (`LiveWorkoutPolicy.kt`; table in `protocol/README.md`, "Workout status and the watch's workout screen"): `02 00 03 00` idle, `02 00 03 01` **the GO screen** (open, not running), `02 01 03 03` running after GO, `02 01 03 04` paused, `02 01 03 05` running after a resume (Fit 4 Pro probe with the owner's times, 2026-10-25 17:43). The Fit 4 Pro's answers carry **no sport tag at all**. |
| `18/08 {01: 1}` / `{01: 0}` | the workout screen opened (with the first `18/02`) / closed: after the finish (7 s before `17/03` goes idle) or when the pre-start screen is left without GO. Huawei Health's activity-recognition switch; answered `7F 100000`. |
| `17/12 {01: 1}` then `17/11` | the realtime report: 02 duration (s), 03 heart rate, 04 zone, 05 steps, 06 cadence, 07 pace (s/km), 08 distance (m), 09 calories (cal, UNVERIFIED unit), 0A rise, 0B descent, 0C altitude, 0D/0E training effect, 11 operator. |
| `37/03` points | the reverse linkage Huawei Health gets: `operator_type` 1 running, 2 paused, 3 stopped, 7 pre-sport. Not seen from this phone, and **not sent to Huawei Health either** for a workout started on the Fit 4 Pro (below). |

### The Fit 4 Pro sends no live figures for a workout started on it (2026-10-25 capture)

Huawei Health 17.0.8.300's own log of a walk started on a Fit 4 Pro 6.1.0.117 (09:30:41 to 09:32:55; analysis and citations in `~/re/agps/LIVE.md`):

- no `17/11` report and no reverse linkage at all: no `37/02` start event `800400014`, no `37/03` points, although Huawei Health had registered for them. Huawei Health showed no live pace, speed or distance either;
- the `37/02` frames the watch did send were HTTP-proxy requests (event `800100011`), and Huawei Health's ~800-byte `37/02` answers were the HTTP responses, not sport data;
- Huawei Health refused the watch's `18/02` requests (`124004`: no ExpandCapability 332, not EMUI), and at 09:32:01 the watch withdrew its request (`18/02 {01: 0}`) while the walk went on;
- the only phone requests that could make this watch stream (`800400014` ops 4 and 5) are gated on ExpandCapability 335, which the Fit 4 Pro does not set; `17/12` is Huawei Health's tool for its own phone-started workouts.

So for a workout started on this watch, the phone's own GPS track is the only source of distance and pace, in Huawei Health as in JoyoFit.

## Band-started run: state machine (`LiveWorkout.kt`, `LiveWorkoutPolicy.kt`)

- A GPS request alone **never starts the clock**. It opens a session in `preparing` (`source: gps`, `gpsRequested`), starts the phone's GPS (for the band and for the session's own track), and asks for the status at once; the status is then asked every 2 s until the clock starts.
- **The GO screen is not a start, a pause is not an end** (JRG-418). The Fit 4 Pro answers `17/03` with operator 1 as soon as Outdoor walk is opened; tag 02 (`trainMonitorState`) turns 1 at GO and stays 1 to the finish, and tag 03 then counts the watch's own phases (3 running, 4 paused, 5 resumed). JoyoFit read tag 03 in the `17/02` numbering: the phone's clock ran ahead of the watch's (owner's probe 17:43:44 vs GO at 17:43:50; 16:09:32; ashfyz's video: 34 s on the phone, 5 s on the band), and the pause (4) and resume (5) counted as "no workout", which ended the phone's session 20 s into a pause (17:45:10). Now `open` keeps the session `preparing`; a session that ran and reads `open` again is paused.
- The clock starts (`running`) on the first of: `17/03` running (tag 02 set; operator 1 or 3 on a watch without tag 02), a `17/11` report that runs (operator 1 to 3, or time on its clock), a `37/03` start event. Time then comes from the band's own `0x02` duration once a report flows (the session becomes `source: watch`); until then from the phone's clock, counted from that moment.
- Pause and resume follow the same sources (status every 5 s while live). It ends on the band's stop frame, on `17/03` saying "no workout" three times in a row, **at the first idle answer after `18/08 {01: 0}`** (the finish on the watch reaches the phone in about 5 s; the close and a withdrawn GPS request ask the status at once), on the GPS requests stopping while preparing, or on Finish. A band that answers no `17/03` and closes its workout screen makes the screen ask the person (`endSuspected`) at once: whether such a band also sends the close on a pause is not known, so it is not ended outright.
- **The phone cannot pause or finish a watch-started workout.** The only phone-to-watch workout command is `17/01`, and the Fit 4 Pro refuses every operator with 123002, also for a workout started on the watch (probe of 2026-10-22, `protocol/README.md`); the reverse-linkage stop (`37/02` `800400014` op 1) belongs to a linkage the watch never opens, and Huawei Health's report/restart requests need ExpandCapability 335, clear on this watch. So the live screen of a band-started session (`source` gps or status) no longer offers a "Selesai" that pretends to finish: it says "Finish the workout on the watch. This screen ends with it." with a secondary "Stop following on the phone" (`finishLiveWorkout`, which ends only the phone's session). A session started on the phone (`manual`) keeps Finish.
- **A band that gives no sign at all** (it answers no `17/03` and sends no `17/11`): the only evidence of its start is the person moving. After three fixes in a row at 1 m/s or faster (`MotionStart`) the clock starts, `clockConfirmed` is false. Before this change such a session ran from the first GPS request, which is why the phone's clock started on the GO screen (B1).
- Payload fields added for this: `clockConfirmed`, `gpsRequested`, `location` `{lat, lon, accuracy, bearing}`, `locationAt`, `gpsDistanceM`, `gpsRiseM`, `gpsPaceSecPerKm`.

### Phone GPS for the whole session (`PhoneGpsSession`, `SessionTrack` in `LiveGpsTrack.kt` and `LiveGps.swift`)

- The watch's first `18/02 {01: 1}` starts the phone's location updates and the `18/03` feed to the band. `{01: 0}` stops **only the feed**: the updates, and with them `location` and the `gps*` figures, go on until the live session ends (Finish, the band's stop, `17/03` idle, the watchdog).
- A lost link stops the feed, and the updates too unless the session ends by itself without the band (`LiveWorkoutPolicy.endsWithoutLink`): only a `source: gps` session does, through its watchdog (asks the user after 2 min of silence, ends after 5; iOS ends it after 2 min without a request and 90 s without a status answer). A session fed by the band's own numbers, opened by the status poll or by hand ends only on the band's word or Finish, which a lost link never brings, so its GPS stops at once (as before this change) and the band's next request after a reconnect starts it again. Chosen over a grace timer: it adds no timer and reuses the end rules that already exist.
- With no live session to follow (a phone-started run, whose screen owns the band's workout), a withdrawn request stops the updates as before.
- A request after the end starts both again; updates that could not start (no location permission) are tried again on the next request.
- The track does not wait for the band's fields: `18/01` only shapes the feed, so a failed `18/01` costs the band its fixes, not the phone its figures.
- **The field bitmap is two bytes** (JRG-418): the Fit 4 Pro answers `18/01` with `81{02 01DF, 03 01, 05 01}` (2026-10-25 18:49:49). JoyoFit, like GB's `getByte`, read only `01` (speed), so the watch got neither position, altitude, distance, bearing nor accuracy. `WorkoutLink.gpsBitmap` (Swift `WorkoutLinkWire.gpsBitmap`) reads all bytes big-endian, as Huawei Health's `GpsParameter.getGpsInfoBitmap` does; bit 0x100 has no known field and is not sent.
- **Location source (JRG-418)**: Android 12 and newer use the fused provider at high accuracy, like the Run recorder (`ble-sensors` `WorkoutLocation.kt`): a first position within seconds, GNSS accuracy as satellites lock. The live screen used the raw GPS provider, which gives nothing until the phone's own GNSS has a fix (minutes after a cold start, never under a roof), so it sat on "Waiting for the phone's GPS position" while the recorder, on the fused provider, showed GPS ok on the same phone (ashfyz, Xiaomi HyperOS, 2026-10-25) [INFERENCE: the reporter's log was not available; the provider is the one difference between the two paths]. The band gets only fixes of 30 m or better (`18/03`; a rough Wi-Fi or cell position would add its jumps to the band's distance); the map takes every fix. The first three fixes are logged with their accuracy (`Workout link: phone fix N, accuracy ...`).
- **Preparing fixes**: kept as `location` for the map, never counted. On the switch to `running` (any of the clock-start rules above, `MotionStart` included) the track starts fresh at the newest fix, if it is at most 5 s old; a pause is not counted and a resume starts fresh the same way. Start fresh, not buffered: the clock starts at the same moment, so distance and time cover the same stretch and the average pace stays honest; a buffer would add the walk to the start line, pacing in front of the GO screen, or the `MotionStart` run-up, none of which is in the clock or in the band's own figures.
- iOS has the same track, payload fields and, since JRG-418, the same preparing state machine, `WatchPhase` reading, poll periods, `18/08` handling and 30 m feed gate (`LiveWorkout.swift`, `WorkoutLink.swift`, the pure rules in `HuaweiProtocol/.../LiveWorkoutPolicy.swift`). Its stream is CoreLocation (best accuracy, no distance filter) with when-in-use permission, so fixes flow only while the app is in the foreground: a watch request that arrives with JoyoFit in the background or the screen locked gets no position until the app is opened. iOS has no ongoing notification, so `endSuspected` reaches only the screen.
- Android also needs JoyoFit in the foreground for the track. `WatchService` runs with `foregroundServiceType="connectedDevice"` only (no `location` type, no `FOREGROUND_SERVICE_LOCATION`), and nothing in the app declares `ACCESS_BACKGROUND_LOCATION` (checked in the module's `AndroidManifest.xml` and `app.json`). [INFERENCE: Android's background-location rules then stop delivering `GPS_PROVIDER` fixes once the app is in the background or the screen is off; not tried on a device.] The phone recorder's service in `ble-sensors` has the `location` type, but it runs only for a run started on the phone.

### Sport kind (`liveSession.ts`)

1. The person's pick (`setSportKind`), else
2. the sport tag, `06` then `04` of the `17/03` answer, **only when it is a code of `WorkoutSportTypes`** (a small enum in one of the tags must not become "Running"): 1, 11 run; 2 walk; 3 ride; 4, 14 hike; 5, 7, 13 are indoor and not GPS sports; everything else `other`;
3. else, if the band asked for the phone's GPS: the kind picked for the last such workout (kv `joyofit.live.lastSportKind`, `useLiveSession.ts`), else `run`, **inferred** (`sportKindInferred`), so the screen lets the person switch run, walk, ride, hike. The band asks for GPS only in an outdoor workout. The Fit 4 Pro names the sport nowhere on the link, not even after GO (`17/03` `02 01 03 03`, no tag 04/06; Outdoor walk showed "Lari", 2026-10-25); `WorkoutLink` logs the whole `18/02` request and `18/01` answer (`Workout link: phone GPS request ...`, `... bitmap 0x.. (answer ...)`) in case a band does.
4. else null: nothing says what it is, and the generic screen may offer the strength logger. `gpsSport` is true for any GPS-asking or outdoor-typed session: "Log as strength" is never offered for them.

### Figures (`deriveMetrics`)

The band's number wins when it is above zero. A band without GPS reports a flat 0 for distance and nothing for pace: those must not hide the phone's own numbers. Otherwise the phone's track fills it (`LiveGpsTrack.kt`, `TrackAccumulator`, fed with the fixes of the running stretches only, see "Phone GPS for the whole session"):

- distance: sum of steps of at least 3 m from the last kept fix; fixes worse than 30 m accuracy and jumps above 30 m/s are dropped;
- climb: the altitude smoothed (alpha 0.25), counted past a 3 m dead band, so noise adds nothing;
- climb on the screen: run and walk start with ten fields on two pages, elevation gain among them (`runFields.ts` `defaultLayout`; the owner saw none on a walk, 2026-10-25, then asked for "all the run details"). It reads 0 m from the first fix with a position, also on a flat walk; a layout the person saved is kept;
- pace: distance over the last 10 s (at least 3 s of it), nothing below 0.28 m/s;
- average pace: duration over distance (`averagePace`, from 10 m), computed in JS;
- cadence: steps per minute on foot (`0x06`), revolutions per minute on a bike; without a `17/11` report, the phone's step counter (below).

### Figures added on the phone (`liveStats.ts`, `liveExtras.ts`, JRG-418)

`LiveExtrasFeed` (mounted once in `app/_layout.tsx`, inside `LiveWorkoutProvider`) feeds every payload to a `LiveExtrasSession` per session id; the screen reads `useLiveExtras`. Kept in JS for as long as the app runs: each figure covers what this app heard, so after the app was killed mid-workout the averages and the step count start over at its next start.

- **Average and maximum heart rate** (`HrStats`): over the `19/03` readings of the running stretches. The average is weighted by time (a reading holds until the next payload, at most 20 s, `HR_HOLD_MS`), so the 1 s payloads of the phone's GPS do not outweigh a reading that changed less often, and a gap (app in the background on iOS, link lost) is not filled with the last value. Readings while preparing, paused or ended count for neither figure.
- **Heart-rate zone**: the zone of the current reading in the person's zone settings (`useHrZones`, Settings > HR zones, `docs/hr-zones.md`), the same rule that tints the heart-rate tile (`heartZone`). A field of its own (`hrZone`): the number large, the zone's name below. The watch's own `17/11` `0x04` zone is not used: its numbering is unverified and the Fit 4 Pro does not send it.
- **Cadence, steps, stride from the phone's step counter**: `BleSensors.startLiveSteps()` (`modules/ble-sensors`: Android `TYPE_STEP_COUNTER`, moved on by `TYPE_STEP_DETECTOR` between counter events, through the Run recorder's `WorkoutSteps.kt`, a second instance `LiveSteps` with its own event `onLiveSteps`; iOS `WorkoutSteps.live`, a second `CMPedometer`), so a recorded run's counter and the live screen's never stop each other. It runs only while a watch-started session on foot (run, walk, hike, also a guessed run) is open, from the GO screen on (the first reading is the baseline), and stops at the end, when the kind changes to a ride, or when the session goes. The numbers come from `PhoneStepCount` (`sensors/phoneSteps.ts`, rules in `docs/sensors.md`, "How the numbers are made"), the code the Run recorder counts with: steps only while the clock runs; cadence over the last 20 s of the sensor's own times (the pedometer's own on iOS), held while the counter is silent no longer than it has lately taken to report (at least 8 s, at most 60 s), then faded to 0; nothing while paused, before two readings 4 s apart, or above 260. A watch's 0 cadence does not hide the phone's (`LiveWorkoutScreen`: the watch's cadence above 0, else the phone's, else the watch's 0). Stride = distance since the counter's first reading / its steps (from 20 steps and 10 m). These tiles say "(phone)" / "(ponsel)": they count the **phone's** steps, not the wrist's; a watch that sends its own cadence or steps (`17/11`) wins and the label goes.
- **Permission** (`liveSteps.ts`, tested in `liveSteps.test.ts`): the counter starts by itself only when the permission is already given (`stepCounterState`). Otherwise, while a step field is on the screen, a card asks ("Allow step counter": `ensureStepCounter`, ACTIVITY_RECOGNITION on Android 10+, the motion prompt on iOS, whose usage text now names watch-started workouts). Nothing is asked in the middle of a workout without a tap. After a refusal the system shows no prompt any more (iOS answers `denied` at once, Android `blocked` after "don't ask again"), so the card then says so and opens the phone's settings (`Linking.openSettings`, as the recorder's `PermissionGate` does); every return to the app checks the permission again and starts counting once it is given. A phone without a step counter, or a binary without `startLiveSteps`, shows `--`.
- **Background and late steps**: Android delivers the sensors' events while `WatchService` keeps the process; a phone whose processor sleeps (screen off, in a pocket) may keep them in the sensor hub and hand them over in a batch, each with its own time, and the count is cumulative, so nothing is lost and the cadence is computed from the steps' times, not their arrival. Device report (JRG-418, 2026-10-26, Xiaomi 15T Pro, HyperOS, Android 16, lab 9, a watch-started outdoor walk with the phone in a pocket): "cadence is mostly 0". Cause, from the code: the old rule read 0 after 4 s without a new reading and took a 10 s window, so a counter that reports late or in bursts (Android allows the step counter 10 s) read 0 most of the time; a counter reporting every 12 s showed 0 for 7 s of every 12 (`phoneSteps.test.ts` has that case). The lab log had no step lines at all because the native side logged nothing; what the phone really delivers is now in the log (`Phone steps (live): ...` every 30 s, `docs/sensors.md`, "Device log") [INFERENCE: the Xiaomi's delivery pattern is not measured yet]. iOS sends pedometer updates only in the foreground; the cumulative count catches up when the app comes back (steps of a pause in that gap are counted, as in the recorder).

### The grid: pages

Four to twelve fields (`FieldCount` 4, 6, 8, 10, 12). The first six are the first page as before (a large first field, rows of three; or pairs); every further six are a page of their own in pairs, swiped sideways (`gridPages`, `MetricGrid`: a paging horizontal scroll, dots below that also switch the page). A layout saved by an older build (four or six fields) reads back unchanged, also one equal to an old default; only a kind without a saved layout gets the new default (run and walk: time, distance, pace, average pace, heart rate, HR zone | cadence, elevation gain, calories, average heart rate). The Run recorder's live view shares the grid, so it pages too, and it has the new fields as well: average and maximum heart rate of the recorded seconds, HR zone, steps (a pod's, else the phone's) and stride; its phone-counted cadence, steps and stride carry "(phone)" when no running pod is paired. Steps and stride are offered on foot only.

A screen that can never read some metrics (an indoor recording: no elevation gain or altitude; not on foot: no steps or stride) offers only the field counts it can fill with the rest (`fieldCounts`: 10 at most on an indoor ride), and the repair of a saved layout never fills a slot with one of them (`normalizeLayout(raw, kind, exclude)`); a metric the person placed there themselves stays.

The phone's position (`location`) is in the payload for the map; the trail is the screen's (`trail.ts`).

### Metrics by source on the watch-started screen (JRG-418 inventory, Fit 4 Pro 6.1.0.117, 2026-10-25)

What reached the phone during the 17:43 and 18:49 walks (`logcat_go_probe.txt`, `logcat_lab3.txt`): `19/03` heart-rate reports (about one per 6 s while the realtime heart rate is on, `07/1C`), `17/03` status answers, `18/02` and `18/08`. No `17/11` report (although `17/12` was answered 100000), no `37/03` points, no reverse linkage; the `37/02` events were HTTP-proxy and watch-face reports, `34/01` P2P frames map-kit and battery. So the watch gives heart rate and state only.

| Field (`RunMetricId`) | Watch | Phone GPS | Phone step counter | Derived | On the Fit 4 Pro today |
| --- | --- | --- | --- | --- | --- |
| duration | `17/11` 02 (not sent) | | | phone clock from GO (`WorkoutClock`) | yes |
| distance, pace, speed | `17/11` 08 / 07 (not sent) | `SessionTrack` | | | yes (phone GPS) |
| avg pace | | | | duration / distance (`averagePace`) | yes |
| hr | `19/03` | | | | yes (watch) |
| avg hr, max hr | | | | `HrStats` over the `19/03` readings, running stretches only | yes (from the watch's HR) |
| hr zone | `17/11` 04 (not sent, not used) | | | `heartZone` with the person's zone settings | yes (from the watch's HR) |
| calories | `17/11` 09 (not sent) | | | `HeartRateEnergy` from HR, weight, age, sex | yes (estimate) |
| elevation gain, altitude | `17/11` 0A / 0C (not sent) | `SessionTrack` (smoothed, 3 m dead band) | | | yes (phone GPS; 0 m on the flat) |
| cadence | `17/11` 06 (not sent) | | `startLiveSteps`, `PhoneStepCount.cadence` | | yes (phone, labelled) |
| steps | `17/11` 05 (not sent) | | `PhoneStepCount.total` | | yes (phone, labelled) |
| stride | | | | phone distance / phone steps (`strideLength`) | yes (phone, labelled) |
| descent, training effect | `17/11` 0B, 0D/0E (not sent) | | | | no: shown under "More" only when a watch sends them |

Watch-measured on the Fit 4 Pro: heart rate only (and the derived average, maximum, zone and calories). Phone-measured: distance, pace, speed, average pace, elevation gain, altitude (GPS) and cadence, steps, stride (step counter, the phone's steps). Not possible: descent from the phone is not computed (the track counts rises only), and training effect needs the watch's own `17/11`.

## Phone-started run (`bandLinkCore.ts`, `bandLink.ts`, `controller.ts`)

"Mulai" on a GPS or treadmill run starts the band as well, when the setting "Mulai band bersama lari" is on (kv key `joyofit.record.bandStart`, default on) and a watch exists:

1. `17/01` SetOperator with the Huawei sport (`bandSportCode`): 1 run, 2 walk, 3 ride, 5 treadmill, 7 indoor ride, 14 hike; none for "other". Huawei Health itself only passes 1, 2, 3, 5, 7 through; 14 is the one it was not seen to send. Wire details and the refusal on the Fit 4 Pro: `docs/strength.md`, "The watch starts too".
2. The band then asks for GPS itself (`18/02`), and the existing `WorkoutLink` streams the phone's fixes (`18/03`). **There is no proactive GPS push**: if a band does not ask, it gets none [INFERENCE: it asks, as in a band-started run].
3. The band's heart rate (`onHeartRate`) feeds the recorder as a `2a37` reading; a paired strap wins while it gave a value in the last 5 s. This also works when the band refused to start. The heart rate is held with `setWorkoutHeartRate` (native, also in the background), else `setLiveHeartRate` (stops when the app leaves the foreground).
4. Pause, resume and stop go both ways. Phone to band: `setPaused`, and the end of the recording stops the band (`end`). Band to phone: the controller polls `getWatchWorkout()` once a second (no event exists): a pause or resume on the band pauses or resumes the recording, a **stop on the band only pauses** the recording and sets the phase `ended` (finishing is the person's decision, the band's workout may have ended by mistake). Our own commands are not read back as the band's (`busy` guard, and the band's state is re-read after each command, so a refused pause is not mistaken for a resume).
5. While the phone owns the band's workout, `LiveWorkout` does not open a mirror of it (`phoneOwned`): one screen, not two.

### What the screen shows (`useBandLink()`)

One line, never blocking: `starting`, `linked`, `refused` ("The band didn't start the workout. Recording on the phone only.": the band answered an error such as 123002, or did not confirm), `unsupported` ("This band can't start a workout from the phone. Recording on the phone; the band's heart rate is still used.": the band does not list `17/01`), `connecting` ("The band isn't connected. Recording on the phone; the band starts as soon as it connects.": `getWatchWorkout().connected` was false at Mulai, or the start came back `not_connected`), `nobuild` ("This app version can't start the band.": a binary without the functions), `ended` (the band stopped; the phone recording is paused). `off`: nothing (setting off, no watch, a sport without a band workout). A phone with no watch never sees a line.

**JRG-418, "The band isn't connected" with the band linked** (ashfyz, Band 9/11 basic, 2026-10-25): the old `begin` (`bandLinkCore.ts`) gave one phase, `unavailable`, to three causes: no functions in the binary, `unsupported` (`WatchWorkout.kt` `send`: the watch does not list `17/01`) and `not_connected` (`link.handle()` null), and all three said "not connected". A band that does not list `17/01` most likely gave `unsupported` on every start [INFERENCE: the reporter's log was not available; it shows as `record: band band start (type N): unsupported (connected true, supported false) -> unsupported` now]. The "not connected" text now appears only while `connected` is false, and a link that comes back during the recording starts the band then: one attempt per reconnect, never while a command is in flight or the recording is paused, given up when the recording ends.

The start screen's status pill has a "Band" segment next to GPS, sensors and steps (connected: solid dot; connecting: warning dot; not connected: hollow dot; from the watch link state, `useBandSegment` in `ui/statusSegments.ts`), shown when there is a watch, the setting is on and the sport has a band workout. Tapping it opens the Watch tab.

On a GPS sport the recorder's live view also offers Elevation gain and Altitude (`Recorder.climb`, the same rule as `SessionTrack`: altitude smoothed with alpha 0.25, rises past a 3 m dead band, fixes worse than 30 m ignored, nothing while paused, the smoothing starts over at resume). Android's altitude is above the WGS84 ellipsoid and iOS's above mean sea level: the gain is the same, the Altitude field can differ by the local geoid offset.

A refusal is not remembered between runs: every start is one command and one answer, and a band that starts accepting (a firmware change) simply works.

### Restore

After the app was killed mid-run the recording comes back paused. A band workout still open in the same process (a JS reload) is taken over (`adopt`) and paused; after a real restart the native side has forgotten it (`owned` is in memory) and the band keeps running on its own: stop it on the band.

## Metronome (`src/features/metronome/`)

On both live screens (band-started live screen, Run recorder): a switch, the tempo (120 to 200 beats per minute, steps of 5) and
what a beat does: **Vibration** (default), **Sound** or **Both**. Tempo and mode are kept (`joyofit.metronome.bpm`,
`joyofit.metronome.mode` in the KV store); the switch is not.

- **Timing.** JS timers on a fixed grid (`nextBeatAt`): a late timer does not shift the next beat; a suspension longer than a beat
  restarts the grid instead of firing a burst.
- **Sound.** `modules/metronome-click` (Kotlin + Swift twins) synthesizes a 35 ms tick (`ClickSound.kt` / `ClickSound.swift`, same
  samples, checked by `ClickSoundTest` and `ClickLogicTests`) and plays it as media audio. Android: `SoundPool`, `USAGE_MEDIA` /
  `CONTENT_TYPE_SONIFICATION`, no audio focus and **no MediaSession**, so music keeps playing at full volume and earbud buttons and
  the watch's music control (`MediaSessionTracker`, which also skips JoyoFit's own sessions) stay with the music app. iOS:
  `AVAudioPlayer` in a `.playback` + `.mixWithOthers` session (a mixable session never becomes Now Playing), deactivated with
  `.notifyOthersOnDeactivation`. The click goes to the connected Bluetooth headset, also with the ringer on silent. The sound is
  loaded (and the iOS session active) only while the metronome runs in Sound or Both; `start`, `click` and `stop` run in call order
  on one native thread, so a quick off after on cannot leave it loaded. A click while the sound still loads is skipped, never late.
  The next beat is booked before the vibration and the click, so a failing one skips a beat and never stops the metronome.
- **Screen off.** Android: the recording's foreground service keeps JS running (Run recorder); the band-started live screen holds
  the screen on while the metronome runs. iOS: `audio` in `UIBackgroundModes` (a background app is muted without it).

## OTA or store build

| Part | OTA (JS only) | Needs a store build (native) |
| --- | --- | --- |
| `liveSession.ts` sport kind, GPS-sport flag, metric fallbacks, `useLiveSession` | yes: `source: gps` already says "GPS request"; band figures are used as they come | `gpsRequested`, `location`, `gps*` fallbacks stay absent until the native build |
| B1: no clock from a GPS request alone | **no**: the old payload cannot tell a clock started by the fallback from one confirmed by the status poll (both: `source: gps`, `running`, `durationSec` 0) | `LiveWorkout.gpsPing`, `MotionStart`, `clockConfirmed` |
| B3 distance, pace, climb from the phone's GPS; map position | no | `LiveGpsTrack.kt`, `onLocation`, payload |
| Sport tag read with validation | no | `WorkoutLink.pollStatus`, `WorkoutSportTypes.pick` |
| Phone GPS for the whole session (track goes on after `18/02 {01: 0}`, preparing fixes not counted), iOS phone track | no | `PhoneGpsSession`, `SessionTrack`, `WorkoutLink`, `LiveWorkout.onLocation` (Kotlin and Swift); the JS payload contract is unchanged |
| Phone-started run: start, pause, resume, stop, band heart rate, the setting | yes, on a binary that already has `startWatchWorkout` (the strength logger's functions); `setLiveHeartRate` is the fallback | `setWorkoutHeartRate` (heart rate in the background); a binary without `startWatchWorkout` shows `nobuild` |
| Metronome sound mode (Sound / Both) | no: `modules/metronome-click` is a new native module (the fingerprint changes, so an OTA never reaches an older binary) | `MetronomeClick` (Kotlin, Swift), iOS `audio` background mode |
| JRG-418 recorder: band lines (`unsupported`, `connecting` with the start on reconnect), the Band status segment, live elevation gain and altitude | yes | nothing |
| JRG-418 band-started run: the GO screen is not a start (`WatchPhase`), fast status poll, end on `18/08` close, fused location, 30 m feed gate | no | `WatchPhase`, `LiveWorkoutPolicy`, `WorkoutLink` (Kotlin and Swift) |
| JRG-418 band-started run: an unnamed outdoor workout guesses the last picked kind | yes | nothing |
| JRG-418 full live metrics: grid pages (4 to 12 fields), the new run/walk default, average and maximum heart rate, HR zone field, recorder average/maximum heart rate, steps and stride | yes | nothing |
| JRG-418 phone cadence, steps and stride on the watch-started screen | no: an older binary has no `startLiveSteps`, the fields stay `--` | `startLiveSteps` / `stopLiveSteps` / `onLiveSteps` (`ble-sensors`, Kotlin and Swift); the motion usage text (iOS) |
| JRG-418 phone cadence over a late or bursty counter (hold, 20 s window on the sensor's times; a watch's 0 no longer hides it) | yes, on a binary with `startLiveSteps` (lab 9 included) | the detector, no batching asked, the `Phone steps` log lines and the iOS pedometer cadence (`WorkoutSteps.kt`, `StepCounterLogic.kt`, `StepLog.kt`, `WorkoutSteps.swift`) |

## Unverifiable without a Band 11

- whether the Band 11 (or Band 9) lists and accepts `17/01` at all (the Fit 4 Pro answers 123002 to every one), and with sport 1, 2, 3, 14 (`Watch workout: watch lists 17/01=...` settles the listing);
- whether it asks for GPS (`18/02`) after a phone-started run;
- whether its `17/03` answer carries a sport tag, in `04` or `06`, and in which space (`WorkoutLink` logs `workout status ...` when it changes: that line settles it);
- whether its `17/03` has tag 02 and goes `02 00 03 01` on the GO screen and `02 01 ...` after GO like the Fit 4 Pro (else a band without tag 02 is still read by its operator alone, and its GO screen would again start the clock);
- what any watch answers while paused (operator 2 is read as paused; a pause that only clears tag 02 reads as "open", which pauses too);
- whether a band sends `18/08`, and whether a GPS-less band withdraws its GPS request (`18/02 {01: 0}`) at the finish (both now ask the status at once);
- whether it answers `17/03` and sends `17/11` at all (else only movement starts the clock);
- the units of `17/11` `0x08` distance and `0x09` calories;
- that a pause or stop on the band reaches `getWatchWorkout()` (`17/02` notices) on this band;
- the fused provider's first fix on the reporter's Xiaomi (the cause of "Waiting for the phone's GPS position" is inferred, above).

Diagnostics to ask the tester for: the Android log lines `Workout link: watch lists ...`, `Workout link: workout status ...`, `Workout link: the watch's workout screen opened|closed (18/08)`, `Live workout: the watch started the workout (GO); timer running`, `Workout link: realtime report ...`, `Watch workout: ...` and `record: band band start ...`; for the phone's track, `Workout link: phone GPS started for the workout (fused|gps provider)`, `Workout link: phone fix N, accuracy ...`, `... feed stopped, the workout's track goes on` (the band withdrew its request) and `Workout link: phone GPS stopped` (should follow `Live workout: ended`); for the phone's steps, `Phone steps (live): started ...` / `not started: ...`, the first counter and detector events and the 30 s lines (`docs/sensors.md`, "Device log").
