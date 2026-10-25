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
| `17/03 81 00` answer | `81{02 state, 03 operator, [04 sport], [06 workout type]}`; operator 1 start, 2 pause, 3 resume, 4 stop. The Fit 4 Pro's answer for a strength workout was `81 06 02 01 00 03 01 01`: **no sport tag at all**. |
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

- A GPS request alone **never starts the clock**. It opens a session in `preparing` (`source: gps`, `gpsRequested`), starts the phone's GPS (for the band and for the session's own track), and asks for the status at once.
- The clock starts (`running`) on the first of: `17/03` operator 1 or 3, a `17/11` report that runs (operator 1 to 3, or time on its clock), a `37/03` start event. Time then comes from the band's own `0x02` duration once a report flows (the session becomes `source: watch`); until then from the phone's clock, counted from that moment.
- Pause and resume follow the same sources. It ends on the band's stop frame, on `17/03` saying "no workout" three times in a row, on the GPS requests stopping while preparing, or on Finish.
- **A band that gives no sign at all** (it answers no `17/03` and sends no `17/11`): the only evidence of its start is the person moving. After three fixes in a row at 1 m/s or faster (`MotionStart`) the clock starts, `clockConfirmed` is false. Before this change such a session ran from the first GPS request, which is why the phone's clock started on the GO screen (B1).
- Payload fields added for this: `clockConfirmed`, `gpsRequested`, `location` `{lat, lon, accuracy, bearing}`, `locationAt`, `gpsDistanceM`, `gpsRiseM`, `gpsPaceSecPerKm`.

### Phone GPS for the whole session (`PhoneGpsSession`, `SessionTrack` in `LiveGpsTrack.kt` and `LiveGps.swift`)

- The watch's first `18/02 {01: 1}` starts the phone's location updates and the `18/03` feed to the band. `{01: 0}` stops **only the feed**: the updates, and with them `location` and the `gps*` figures, go on until the live session ends (Finish, the band's stop, `17/03` idle, the watchdog).
- A lost link stops the feed, and the updates too unless the session ends by itself without the band (`LiveWorkoutPolicy.endsWithoutLink`): only a `source: gps` session does, through its watchdog (asks the user after 2 min of silence, ends after 5; iOS ends it after 2 min without a request and 90 s without a status answer). A session fed by the band's own numbers, opened by the status poll or by hand ends only on the band's word or Finish, which a lost link never brings, so its GPS stops at once (as before this change) and the band's next request after a reconnect starts it again. Chosen over a grace timer: it adds no timer and reuses the end rules that already exist.
- With no live session to follow (a phone-started run, whose screen owns the band's workout), a withdrawn request stops the updates as before.
- A request after the end starts both again; updates that could not start (no location permission) are tried again on the next request.
- The track does not wait for the band's fields: `18/01` only shapes the feed, so a failed `18/01` costs the band its fixes, not the phone its figures.
- **Preparing fixes**: kept as `location` for the map, never counted. On the switch to `running` (any of the clock-start rules above, `MotionStart` included) the track starts fresh at the newest fix, if it is at most 5 s old; a pause is not counted and a resume starts fresh the same way. Start fresh, not buffered: the clock starts at the same moment, so distance and time cover the same stretch and the average pace stays honest; a buffer would add the walk to the start line, pacing in front of the GO screen, or the `MotionStart` run-up, none of which is in the clock or in the band's own figures.
- iOS has the same track and payload fields. Its stream is CoreLocation with when-in-use permission, so fixes flow while the app is in the foreground; its GPS sessions still open as `running` (the preparing state machine above is Android's).
- Android also needs JoyoFit in the foreground for the track. `WatchService` runs with `foregroundServiceType="connectedDevice"` only (no `location` type, no `FOREGROUND_SERVICE_LOCATION`), and nothing in the app declares `ACCESS_BACKGROUND_LOCATION` (checked in the module's `AndroidManifest.xml` and `app.json`). [INFERENCE: Android's background-location rules then stop delivering `GPS_PROVIDER` fixes once the app is in the background or the screen is off; not tried on a device.] The phone recorder's service in `ble-sensors` has the `location` type, but it runs only for a run started on the phone.

### Sport kind (`liveSession.ts`)

1. The person's pick (`setSportKind`), else
2. the sport tag, `06` then `04` of the `17/03` answer, **only when it is a code of `WorkoutSportTypes`** (a small enum in one of the tags must not become "Running"): 1, 11 run; 2 walk; 3 ride; 4, 14 hike; 5, 7, 13 are indoor and not GPS sports; everything else `other`;
3. else, if the band asked for the phone's GPS: `run`, **inferred** (`sportKindInferred`), so the screen lets the person switch run, walk, ride, hike. The band asks for GPS only in an outdoor workout.
4. else null: nothing says what it is, and the generic screen may offer the strength logger. `gpsSport` is true for any GPS-asking or outdoor-typed session: "Log as strength" is never offered for them.

### Figures (`deriveMetrics`)

The band's number wins when it is above zero. A band without GPS reports a flat 0 for distance and nothing for pace: those must not hide the phone's own numbers. Otherwise the phone's track fills it (`LiveGpsTrack.kt`, `TrackAccumulator`, fed with the fixes of the running stretches only, see "Phone GPS for the whole session"):

- distance: sum of steps of at least 3 m from the last kept fix; fixes worse than 30 m accuracy and jumps above 30 m/s are dropped;
- climb: the altitude smoothed (alpha 0.25), counted past a 3 m dead band, so noise adds nothing;
- pace: distance over the last 10 s (at least 3 s of it), nothing below 0.28 m/s;
- average pace: duration over distance (`averagePace`, from 10 m), computed in JS;
- cadence: steps per minute on foot (`0x06`), revolutions per minute on a bike.

The phone's position (`location`) is in the payload for the map; the trail is the screen's (`trail.ts`).

## Phone-started run (`bandLinkCore.ts`, `bandLink.ts`, `controller.ts`)

"Mulai" on a GPS or treadmill run starts the band as well, when the setting "Mulai band bersama lari" is on (kv key `joyofit.record.bandStart`, default on) and a watch exists:

1. `17/01` SetOperator with the Huawei sport (`bandSportCode`): 1 run, 2 walk, 3 ride, 5 treadmill, 7 indoor ride, 14 hike; none for "other". Huawei Health itself only passes 1, 2, 3, 5, 7 through; 14 is the one it was not seen to send. Wire details and the refusal on the Fit 4 Pro: `docs/strength.md`, "The watch starts too".
2. The band then asks for GPS itself (`18/02`), and the existing `WorkoutLink` streams the phone's fixes (`18/03`). **There is no proactive GPS push**: if a band does not ask, it gets none [INFERENCE: it asks, as in a band-started run].
3. The band's heart rate (`onHeartRate`) feeds the recorder as a `2a37` reading; a paired strap wins while it gave a value in the last 5 s. This also works when the band refused to start. The heart rate is held with `setWorkoutHeartRate` (native, also in the background), else `setLiveHeartRate` (stops when the app leaves the foreground).
4. Pause, resume and stop go both ways. Phone to band: `setPaused`, and the end of the recording stops the band (`end`). Band to phone: the controller polls `getWatchWorkout()` once a second (no event exists): a pause or resume on the band pauses or resumes the recording, a **stop on the band only pauses** the recording and sets the phase `ended` (finishing is the person's decision, the band's workout may have ended by mistake). Our own commands are not read back as the band's (`busy` guard, and the band's state is re-read after each command, so a refused pause is not mistaken for a resume).
5. While the phone owns the band's workout, `LiveWorkout` does not open a mirror of it (`phoneOwned`): one screen, not two.

### What the screen shows (`useBandLink()`)

One line, never blocking: `starting`, `linked`, `refused` ("The band didn't start the workout. Recording on the phone only." the band answered an error, or did not confirm), `unavailable` (no band connected, the band does not list `17/01`, or a binary without the functions), `ended` (the band stopped; the phone recording is paused). `off`: nothing (setting off, no watch, a sport without a band workout). A phone with no watch never sees a line.

A refusal is not remembered between runs: every start is one command and one answer, and a band that starts accepting (a firmware change) simply works.

### Restore

After the app was killed mid-run the recording comes back paused. A band workout still open in the same process (a JS reload) is taken over (`adopt`) and paused; after a real restart the native side has forgotten it (`owned` is in memory) and the band keeps running on its own: stop it on the band.

## OTA or store build

| Part | OTA (JS only) | Needs a store build (native) |
| --- | --- | --- |
| `liveSession.ts` sport kind, GPS-sport flag, metric fallbacks, `useLiveSession` | yes: `source: gps` already says "GPS request"; band figures are used as they come | `gpsRequested`, `location`, `gps*` fallbacks stay absent until the native build |
| B1: no clock from a GPS request alone | **no**: the old payload cannot tell a clock started by the fallback from one confirmed by the status poll (both: `source: gps`, `running`, `durationSec` 0) | `LiveWorkout.gpsPing`, `MotionStart`, `clockConfirmed` |
| B3 distance, pace, climb from the phone's GPS; map position | no | `LiveGpsTrack.kt`, `onLocation`, payload |
| Sport tag read with validation | no | `WorkoutLink.pollStatus`, `WorkoutSportTypes.pick` |
| Phone GPS for the whole session (track goes on after `18/02 {01: 0}`, preparing fixes not counted), iOS phone track | no | `PhoneGpsSession`, `SessionTrack`, `WorkoutLink`, `LiveWorkout.onLocation` (Kotlin and Swift); the JS payload contract is unchanged |
| Phone-started run: start, pause, resume, stop, band heart rate, the setting | yes, on a binary that already has `startWatchWorkout` (the strength logger's functions); `setLiveHeartRate` is the fallback | `setWorkoutHeartRate` (heart rate in the background); a binary without `startWatchWorkout` shows `unavailable` |

## Unverifiable without a Band 11

- whether the Band 11 accepts `17/01` at all (the Fit 4 Pro answers 123002 to every one), and with sport 1, 2, 3, 14;
- whether it asks for GPS (`18/02`) after a phone-started run;
- whether its `17/03` answer carries a sport tag, in `04` or `06`, and in which space (`WorkoutLink` logs `workout status ...` when it changes: that line settles it);
- whether it answers `17/03` and sends `17/11` at all (else only movement starts the clock);
- the units of `17/11` `0x08` distance and `0x09` calories;
- that a pause or stop on the band reaches `getWatchWorkout()` (`17/02` notices) on this band.

Diagnostics to ask the tester for: the Android log lines `Workout link: watch lists ...`, `Workout link: workout status ...`, `Workout link: realtime report ...` and `Watch workout: ...`; for the phone's track, `Workout link: phone GPS started for the workout`, `... feed stopped, the workout's track goes on` (the band withdrew its request) and `Workout link: phone GPS stopped` (should follow `Live workout: ended`).
