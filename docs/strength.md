# Strength training (the logger)

JoyoFit logs strength workouts the way Hevy does, on the same exercise ids as the coach. Everything is JavaScript (ships over the
air, see `docs/ota.md`), except "the watch starts too" (below), which calls the `huawei-wear` module, and "Rest timer on the lock screen" (below), which calls the `rest-timer` module; both need a store build. Code: `src/features/strength/`, routes `src/app/strength/`, copy in the
`strength`, `routines`, `lifts`, `strengthshare` and `strengthcloud` i18n namespaces. The cloud half is `docs/strength-cloud.md`.

## Who owns what

| | owner |
| --- | --- |
| Exercise library data (`src/features/coach/exercises`), plans, `coach_doc`, the coach screens | coach |
| Logger, rest timer, routines, history, analytics, cloud kind `strength_record`, Strava sets, share card, JoyoRogo import | strength |

The two meet at three points:

- **Exercise ids** are `ExerciseDef.id` slugs of the library (never reused). An exercise the person makes is `custom_<base36 ms>` and is stored by the logger (`strength_record` kind `exercise`).
- **Set types**: `normal`, `warmup`, `drop`, `failure`. Warm-up sets never count toward volume, records or muscle load.
- **The session player is the logger's active screen** (one rest timer for the whole app). The coach calls `startStrengthWorkout({ planKey, exercises: PlannedExercise[] })` (`src/features/strength/start.ts`) and reads `listStrengthWorkoutsByPlanKey(db, planKey)` (`store.ts`) to mark a plan session done. The logger never writes `coach_doc`.

## Data

Tables are created from JS (`ensureStrengthSchema`, called by `_layout.tsx`; the native migration list is part of the binary, same
reason as `features/gear/store.ts`):

- `strength_record (kind, id, json, sort_at, plan_key, workout_start, updated_at, deleted_at, dirty)`: one JSON document per record; kinds `workout`, `routine`, `folder`, `exercise` (custom), `pref` (rest timer and last Repetisi / Waktu choice per exercise; a pref with neither is a tombstone). A delete is a row with `deleted_at` (a tombstone, the cloud hears about it). `dirty = 1` marks what still has to be uploaded.
- `strength_exercise_use (workout_id, exercise_id, started_at)`: which workouts contain which exercise, so the inline "previous" of a set is one indexed read.
- `strength_meta (key, value)`: the workout in progress (`draft`, local only until finished), logger settings, sync cursor, import state.

Types are in `types.ts`. The workout in progress (`StrengthDraft`) is saved on every change, so an app kill loses nothing; the stopwatch is derived from `startedAt` and `pausedMs`, the rest timer from an absolute `endsAt`. The rules of a workout in progress (adding sets, ticking, rest timer, supersets, finishing) are pure functions in `draft.ts`.

### Every finished workout is also a `workouts` row

`link.ts` gives each finished strength workout a row in the watch table, so the Workouts tab, the calendar, Gear, the JoyoRogo cloud workouts and the Strava upload need no special case:

- **The watch recorded it too**: a complete, watch-recorded (`imported = 0`) workout of a strength-like sport (Huawei types 134-136, 139, 140, 142, 143, 145-147, 157) whose time span overlaps the logged workout by more than half of the shorter span is the same session. The logger links to it (`workoutStart` = its `start`) and the watch's heart rate, energy and strain stay the workout's. Nothing of the watch row is written. A workout logged before the watch synced moves from its own row to the watch's at the next sync (`reconcileLinks`).
- **Nobody else recorded it**: the workout gets its own row, sport 140 "Strength Training", `imported = 1`, summary `{"kind":"strength","strengthWorkoutId":...}`, energy from the estimate below. `imported = 1` keeps it out of the watch-only exports (Health Connect, Apple Health, automatic Strava: their cursors read `imported = 0` and the native sync owns them); its energy reaches JoyoRogo through `src/cloud/strengthKcal.ts` instead (see `docs/strength-cloud.md`).
- History imported from JoyoRogo (`rogo:<session id>`) has no `workouts` row (`workoutStart = null`); it is history only.

## Numbers (`calc.ts`)

- Counted set: done and not a warm-up. Volume = sum of weight x reps of counted sets (a bodyweight set adds reps, not volume).
- Estimated 1RM (Epley): `w * (1 + reps / 30)`, one rep = the weight, none above 30 reps.
- Records, against everything logged before the workout (an exercise never done before has none): heaviest weight, best 1RM, best set volume, most reps at that load or heavier (needs an earlier set at that load or heavier), longest timed set.
- Time: a set holds `reps` or `seconds`. Totals add the seconds of counted sets (`WorkoutTotals.seconds`); the time record (longest hold) needs an earlier hold of the exercise, so the first hold after counting it in reps starts the record instead of breaking it.
- Muscle load: every counted set adds 1 to the groups of the exercise's primary muscles and 0.5 to the groups of its secondary muscles (12 groups, `MUSCLE_GROUPS`), per week from Monday.

### Energy when the watch did not record it (MET method)

```
sets per hour = counted sets / hours of the stopwatch (pauses excluded)
MET = 3.5 + 2.5 x clamp((sets per hour - 12) / (30 - 12), 0, 1)        light 3.5 .. vigorous 6.0
MET + 0.5 when the average RPE of counted sets is 8.5 or more (at most 6.5)
kcal = MET x 3.5 x weight(kg) x minutes / 200
```

3.5 and 6.0 are the Compendium of Physical Activities values for light-to-moderate and vigorous resistance training; 12 and 30 sets per hour are a slow session with long rests and a circuit. It is the formula JoyoRogo uses for its own quick entries (kcal per minute = MET x 3.5 x kg / 200), so the numbers agree. An estimate, never a measurement; weight comes from Settings > Profile (70 kg when empty).

## Reps or time per exercise

Each exercise of a workout or routine is measured in repetitions or in seconds. `StrengthExercise.timed` / `RoutineExercise.timed` hold the choice (absent = the library's `timed` flag, as in everything saved before the field; `resolveTimed` in `draft.ts` decides, falling back to what the sets hold for an exercise nothing knows any more). The Repetisi / Waktu switch (`ui/MeasureToggle.tsx`) sits in the chip row of the logger's exercise card and in the routine editor's card; `setExerciseTimed` converts the sets (weight and type stay, the other amounts and the ticks go; the screens ask first when a set holds something) and `setTimedPref` saves the choice in the exercise's `pref` record, so the exercise starts that way the next time it is added (`ExercisePref.timed`). A custom exercise picks its default when created. Everything downstream reads the sets, so history, records, share cards and the cloud need no flag.

Time entry (`logFormat.ts`: `secondsFromDigits`, `digitsClock`) works like a kitchen timer on the number pad: "1", "3", "0" read 0:01, 0:13, 1:30. A timed set also has a stopwatch button (`setTimer.ts`, held by `active.tsx`): a tap starts it, a second tap stores the seconds in the set; with `countdownTimed` (Settings > Set berwaktu, on by default) and seconds already in the set (the plan or routine target) it counts down from them and vibrates at zero. It never touches the rest timer.

## Without a watch

The logger never needed one: a phone with no watch (`useWatchPresence()` is `none`, see `src/features/device/presence.ts`) gets the logger's own `workouts` row (`imported = 1`), a MET energy estimate, history, charts, Strava and the JoyoRogo energy push. The logger's row is not watch data, so logging workouts does not turn the watch UI on. Today then shows `TodayNoWatch` (the logger, Coach, library, history, one "Sambungkan jam" row, the JoyoRogo link) instead of the watch's cards; the Workouts tab drops its Sync button and the "connect your watch" notice. A hand-typed run, walk or ride (`/workouts/manual`, `features/workouts/manual.ts`) lands in the same table with a MET estimate and no heart rate or route. When no weight was saved, the summary says the estimate ran on 70 kg and links to Profile.

The first-run guide has a no-watch route (`flow.ts`, `route: 'none'`): welcome, phone, account, pro, cloud, done. The supported watches and the way to request one are in `features/device/watchFamilies.ts` (short list; the full one is fit.joyorogo.com/jam).

## Routes

`/strength` home (start, routines, recent), `/strength/active` the logger (params `routineId`, `planKey`, `planned`, `name`, `repeatWorkoutId`, `editWorkoutId`), `/strength/summary/<id>`, `/strength/routine/<id|new>`, `/strength/history` (list and calendar with the watch workouts), `/strength/exercises`, `/strength/exercise/<id>` (charts, records), `/strength/muscles` (weekly heat map), `/strength/settings`.

## The watch starts too

"Mulai juga di jam" (Settings > Latihan beban, `StrengthSettings.startOnWatch`, on by default): when a workout in progress opens in the
logger and the watch is connected and lists the phone-started workout command (`17/01`), JoyoFit tells the watch to start Strength
training (Huawei sport 140). The stopwatch's pause and resume pause and resume the watch, finishing or discarding stops it. The watch records
heart rate and calories for that window; its workout comes with the next watch sync and `link.ts` joins it to the logged one as for a
workout started on the watch by hand. Code: `watchWorkout.ts` (the session, framework free, `watchWorkout.test.ts`),
`watchWorkoutInstance.ts` (the one instance and the `strength_meta` key `watch_workout`, so an app restart does not start the watch a
second time), `useStrengthWatch.ts`, `ui/WatchSession.tsx` (the "Jam" chip and the notice), native `WatchWorkout.kt` /
`WatchWorkoutControl.swift`, wire in `protocol/README.md`.

- **Only for a fresh workout**: a draft older than 4 hours is a forgotten one and does not start the watch.
- **Not connected**: a notice says so and the watch starts by itself once the link is up; a refusal or a failed start shows the notice with "Coba lagi". Nothing is shown when the setting is off.
- **A watch that cannot do it**: the setting is replaced by one info line (`startOnWatchUnsupported`); a phone with no watch, and a binary without the native functions (`hasNative`), show nothing.
- **An app restart in the middle**: the native side forgets the workout, so the logger cannot stop the watch's any more ("lost" notice); stop it on the watch.
- **Refused on the Fit 4 Pro** (2026-10-21): every `17/01` got code 123002, whatever the sport or payload; the cause is not known. The notice shows the code, and says "not on your wrist" only when the watch itself says so (`2E/03`, read after the refusal; not yet seen on a watch). Not yet seen accepted on any watch, and Huawei says a workout started from Huawei Health is stored in Huawei Health only, so the watch may keep no record to join. Details: `protocol/README.md`.
- **Gated for this phone (2026-10-22)**: with Strength training started **on the watch** (`17/03` reporting it running, `2E/03` saying worn), `17/01` pause, resume and stop from JoyoFit were refused with 123002 as well, with the full payload and with the smallest one. So `17/01` is unusable for every operator: the phone cannot start, pause or stop the watch's workout. JoyoFit remembers the refusal per watch (`strength_meta` key `watch_start_refused` = the watch address, only for a refusal while worn, not for "not on the wrist"): the start is not tried again on that watch, the logger shows one calm line ("Jam ini tidak bisa dimulai dari HP. Mulai Latihan kekuatan di jam, JoyoFit ikut otomatis.") with no retry button, and Settings > Latihan beban replaces the "Mulai juga di jam" switch with the explanation. Evidence: `protocol/README.md`.
- **UNVERIFIED on a watch**: the command is rebuilt from Huawei Health's code, and sport code 140 is the one value Huawei Health itself never sends. It needs a **store build** (native); an OTA bundle on an older binary hides the setting and does nothing.
- Reps are not counted by the watch or the phone: `docs/strength-reps.md`.

## Start on the watch, JoyoFit follows

Outdoor sports (run, walk, ride, hike) and the Run recorder starting the band use the same `17/01` and `17/03` frames: see [live-run.md](live-run.md). A GPS request from the band, with no sport tag, makes the live screen treat the workout as an inferred outdoor one there, so the strength button is not offered for it.

What works is the other direction. The native `LiveWorkout` already follows a watch workout through `17/03` (operator 1 start, 3 resume = running, 2 pause = paused; no `17/02` notice, `17/11` or GPS request came for an indoor workout in the probe). When it is a strength-type sport (`watchLive.ts`: Huawei 140 Strength training, 145 CrossFit, 146 Functional training, 157 Core training):

- `LiveWorkoutProvider` opens `/strength/watch-pick` instead of the generic `/workout-live`; the Today card says "Latihan beban berjalan di jam" and opens the same; `/workout-live` redirects there.
- `/strength/watch-pick` opens the logger at once when a workout is in progress. Otherwise the quick routine picker comes first, the routine of the last finished workout preselected (`lastUsedRoutineId`); "Tanpa rutinitas" starts an empty workout. The logger is the ordinary one: sets, reps, kg, rest timer.
- The logger's header chip shows the watch's heart rate and elapsed time (`RecordingChip`, from the live workout, dimmed while paused). When the watch ends the workout while the logger is open, a notice asks the person to finish here once the sets are logged; the watch workout joins by overlap after the sync (`link.ts`), as for any watch workout.
- **Open problem: the sport type.** The Fit 4 Pro's `17/03` answer for the probe's strength workout was `81 06 02 01 00 03 01 01`: it has no sport tag (04/06), so `LiveWorkout.sportType` stays null and the routing above cannot tell strength from any other indoor workout on that watch. Until another source for the type is found, the generic live screen has a "Catat sebagai latihan beban" button (shown when the type is null) that opens the picker, and a logger already open shows the watch chip for any workout the watch records. [INFERENCE] whether the type arrives in `17/11` once the report is opened (`17/12 {01: 1}`) was not tested for a strength workout.

## Could a custom course carry the exercise list to the watch? (research only, nothing built)

The only phone-to-watch carrier for a list of steps found in Huawei Health 17.0.8.300 is the P2P course file (`protocol/README.md`, "Training courses": business type 3, `courseInfo.bin` = header + `CourseStorageInfo` { `CombineInfo` repeat groups of `ActionInfo` { `actionId`, measurement type and value (time, distance, calories, heart rate, none), intensity } }). Findings:

- `actionId` names an entry of Huawei's own exercise library, not free text. The ids known to us are the run-course ones (`RD001` warm-up, `RD002` run, `RD003` walk, `RD004` rest, `RD005` cool-down); no id for a strength movement (squat, bench press) was found, and the course editor in Huawei Health takes them from the server-side catalogue. A course can therefore carry "rest" and timed or counted blocks, not the person's own exercise names with kg and reps [INFERENCE].
- A measurement is time, distance, calories or heart rate; there is no reps-with-weight target, so a routine's sets and kg cannot be expressed, at most "N timed steps with rest".
- It is the same family of risk as `17/01`: the file goes over `28/02` with the fitness app's package and fingerprints, and JoyoFit has never seen the watch accept or acknowledge a course (README, "What is missing" 1 to 3). Given that the watch refuses every `17/01` from this phone, a third-party gate there is likely too [INFERENCE].
- Verdict: not worth building for strength. The experiment, if wanted later: send one `RD004` (rest) + one timed step course with the existing experimental course screen and see whether the watch lists it; that tests the gate, not the exercise-list idea.

## Plate calculator

A "Plat" chip in the chip row of an exercise card (only when the exercise is not timed and a set has a weight above zero) opens `ui/PlateSheet.tsx` for that exercise. The maths is `plates.ts` (pure, `plates.test.ts`): `platesFor(target, bar, unit)` works in the display unit and in integer hundredths, so 1,25 plates and a weight converted from kg to lb add up exactly. Plates (unlimited pairs, heaviest first): kg 25, 20, 15, 10, 5, 2,5, 1,25; lb 45, 35, 25, 10, 5, 2,5.

- It loads each side greedily and reports the weight reached and what is left over. A weight that cannot be hit with these plates (101 kg on a 20 kg bar) shows the nearest lighter load and says how much is missing; a weight under the bar says so and shows no plates. Nothing is rounded up silently.
- The sheet opens on the first set still to do (else the last set with a weight); other loads of the exercise are chips (`plateLoads`).
- The bar has a stepper (2,5 kg or 5 lb per tap, 0 to 50) and is saved per unit in `StrengthSettings.barWeight` (20 kg, 45 lb by default) by `active.tsx` through `saveSettings`.
- Copy is under `strength:plates.*`. The picture is plain rectangles, one theme tint per plate size, height by weight.

## Sharing routines

Pure logic: `routineShare.ts` (`routineShare.test.ts`); device side (share sheet, cache file, picker, saving): `routineShareIo.ts`; screens: the routine editor and preview sheet (`Bagikan`, `Ekspor file`), the folder menu (`Ekspor folder (file)`), the strength home (`Impor rutinitas`, `ui/RoutineImportSheet.tsx`). Copy is `routines:share.*`.

- **Text** (`routineText`): name, note, then each exercise with runs of equal sets counted ("2 x 8 @ 60 kg"), rest, note, superset letters (A1, A2), weights in the current display unit, ending with a JoyoFit line. It goes through RN `Share.share`.
- **File** (`<name>.joyofit-routine.json`): `{ app: 'joyofit', kind: 'routine', v: 1, folder, routines: [{ name, note, exercises: [{ id, name, primary, equipment, timed?, restSec, note, supersetGroup, sets: [{ type, weightKg, reps, seconds }] }] }] }`. Weights are kg whatever unit the sender reads. Each exercise carries its name, muscles and equipment next to the id. Written to the cache with `expo-file-system` and handed to `react-native-share` (the helper `exportWorkoutFile` already uses), so no new dependency. A folder export is the same file with `folder` set and all the folder's routines.
- **Reading** (`parseRoutineExport`): strict and never throws. Refused as a whole, with a code (and the path of the bad field): `too-large` (over 2 M characters), `not-json`, `not-joyofit`, `wrong-kind`, `version` (anything but 1), `shape`, `number` (negative, fractional reps, weight over 999 kg, seconds over 3600, rest over 15 min), `too-many` (over 100 routines, 40 exercises, 30 sets). Unknown muscles or equipment are dropped, not refused.
- **Importing** (`planImport`, then `savePlan`): the plan is shown first (routine names, exercise counts, which exercises become custom, a new folder) and nothing is written before the confirm. Routines get fresh ids and are appended, so an import never overwrites or edits an existing routine. An exercise id the phone knows is kept (export then import on one phone gives the same routine); an unknown id (a sender's `custom_*`, or a library slug this build lacks) becomes a new custom exercise with the file's name, muscles and equipment, once per id, reusing a custom exercise of the same name so a second import does not pile up copies. A folder export reuses a folder of the same name, else creates it.
- **Opening a `.joyofit-routine.json` from another app** is not wired and is not possible without native changes. FIT, GPX and TCX open from other apps through `app.json`: iOS `CFBundleDocumentTypes` with `UTImportedTypeDeclarations` (custom UTIs by extension), Android `intentFilters` (`VIEW`, `content://`, path patterns on `.fit`/`.gpx`/`.tcx`); the file then goes to `useFitImport.importFitFromUri`. A JSON would need a new UTI plus document type and a new intent filter (path pattern on `.joyofit-routine.json`, mime `application/json`), which changes the manifest and `Info.plist`, so it needs a store build, not an OTA update. Until then the file is imported from inside the app with the picker.

## Rest timer on the lock screen

While the logger rests between sets, the countdown stays on the lock screen: an ongoing notification on Android, a Live Activity (lock screen and Dynamic Island) on iOS. The alert when the rest ends is unchanged (`restNotification.ts`, one local notification at `endsAt`); the live countdown is silent and only adds the clock. It needs a **store build** (native module, new iOS extension target). An OTA bundle on an older binary has no `RestTimer` native module (`requireOptionalNativeModule`), every call is a no-op and the rest behaves as before.

| Piece | Where |
| --- | --- |
| Native module `RestTimer`: `startRestTimer({ endsAt, title, body, channelName? })`, `stopRestTimer()`, `isRestTimerSupported()` | `modules/rest-timer/` (`src/RestTimer.ts`, `android/`, `ios/`) |
| When to start, move or stop (pure, `bun test`) | `restLiveLogic.ts`, `restLiveLogic.test.ts` |
| The calls and the copy (`strength:liveRest.*`) | `restLive.ts` |
| The logger follows the draft | `src/app/strength/active.tsx`: `syncRestLive` in the rest effect, `stopRestLive` beside every `cancelRestEnd` (skip, rest over, finish, discard, replacing a workout) |
| iOS widget extension (Live Activity views) | `targets/rest-timer/` (config plugin `@bacons/apple-targets`, entry in `app.json` `plugins`; `NSSupportsLiveActivities` in `ios.infoPlist`) |

- **Rules** (`wantedRestLive`): the countdown shows while the logger has a rest, the stopwatch is not paused and the platform allows it; +15 s and -15 s move it, a pause removes it (the rest's end moves on resume, so it starts again then), skip, the end of the rest, finishing, discarding and starting another workout remove it. `restLiveAction` sends a call only when the lock screen would change; after an app start nobody knows what a killed session left up there, so the first "nothing" still stops once.
- **Android** (`RestTimerNotification.kt`): an ongoing, `VISIBILITY_PUBLIC`, local-only notification on its own channel `strength-rest-live` (`IMPORTANCE_LOW`, no sound, no vibration, no badge) with `setWhen(endsAt)`, `setUsesChronometer(true)`, `setChronometerCountDown(true)` and `setTimeoutAfter(endsAt - now)`, so the system draws the clock and removes the notification at zero, also when the app was killed. No foreground service, no wake lock. A tap opens `joyofit://strength/active` (the logger, resumes the workout in progress; the launcher activity when no activity answers the link). It posts only when `areNotificationsEnabled()`, so it follows the permission flow of `restNotification.ts` (`restPermission`); `active.tsx` shows the countdown only with the permission granted. Notification id 4721.
- **iOS** (`RestTimerModule.swift`, `targets/rest-timer/`): ActivityKit, iOS 16.2 and later (the app's floor is 16.4, the code is `@available(iOS 16.2, *)` and the extension is built for 16.4). `ActivityContent` with `staleDate = endsAt`; the views use `Text(timerInterval:countsDown:)`, so nothing runs while it counts, and the range is clamped (a start after the end traps). It needs no notification permission: the person's "Live Activities" switch in Settings decides (`areActivitiesEnabled`, read by `isRestTimerSupported()`). The calls run in order on a chained `Task`. An activity can only be requested from the foreground, which is where the logger starts a rest.
- **The type is in two places.** The `RestTimer` pod and the extension are different Swift modules, so `RestTimerAttributes.swift` sits in `modules/rest-timer/ios/` and in `targets/rest-timer/`, byte for byte. ActivityKit pairs the sides by the type name and decodes with `Codable`. `restLiveLogic.test.ts` fails when the copies differ. (It is not under `targets/rest-timer/_shared`: that folder links a file into the app target, which does not use the type.)
- **iOS limit**: when the app is suspended at the end of the rest, nothing can end the activity; it stays at 0:00 (stale) until the logger is open again or the 8 hour limit of ActivityKit.
- **Needs the portal**: the extension has its own bundle id `com.joyodigitama.joyofit.resttimer`, an App ID and an App Store profile like the app (`docs/ios-mac.md`, `scripts/ios/mac-build.sh`). The export step of the release scripts maps only the app's bundle id to a profile today; the extension has to be added there before an iOS store build (JoyoRogo did the same for its widget: `scripts/ios/mac-build.sh`, `EXPORT_WIDGET_PROFILE`).
- **Checked on Linux (2026-10-27)**: `bun test` of the rules, the Kotlin compiled (`:rest-timer:compileDebugKotlin`), its unit test passed and `lintDebug` (NewApi) found nothing, after `expo prebuild --platform android`. `expo prebuild --platform ios` produced the `RestTimerActivity` target (bundle id, iOS 16.4, embedded in the app, `NSSupportsLiveActivities`) and autolinking resolves the `RestTimer` pod. **Not checked**: the Swift (no Swift toolchain on Linux), `pod install`, any Xcode build, and nothing ran on a phone. Try on a store build: Android 13 and 14 lock screen (the clock counts down, no sound, gone at zero, a tap opens the logger, the end alert still fires), the iOS lock screen and Dynamic Island, an app kill in the middle of a rest.

## Units

Weights show and are typed in kg or lb (Settings > Latihan beban > Satuan beban, `StrengthSettings.weightUnit`, kg by default). **Storage never changes**: records, drafts, routines, the cloud, the Strava FIT sets and the sticker data are kg, so switching back and forth loses nothing and an old workout reads the same in either unit. Body weight (MET energy, `profile.ts`), JoyoRogo kcal and everything in a FIT file are kg by spec and have no unit setting.

- `units.ts` (framework free, `units.test.ts`): the unit is module state like the i18n locale, so the pure formatters read it without a parameter. `kgToUnit` / `unitToKg` convert (1 lb = 0.45359237 kg exactly). Display rounding (`roundWeight`): kg whole from 100 up, one decimal below, as before; lb one decimal everywhere, because a 2,5 lb jump (a pair of 1,25 lb plates) must stay readable above 100 lb. A weight box shows `inputWeight`: two decimals of kg, one of lb, never the whole-number rounding.
- **Round trip**: a value typed in lb goes through `unitToKg` and then `clampWeight` (kg to 0.01). That is at most 0.011 lb off, so anything typed with one decimal of lb reads back the same (135 lb is 61,23 kg and shows 135 again). The kg cap `MAX_WEIGHT_KG` (1000) stays the stored limit; typed past it in lb it clamps to 1000 kg (2204,6 lb).
- **Hydration**: `useHydrateWeightUnit` (`useWeightUnit.ts`, mounted once in `src/app/_layout.tsx` because lifts also show on the Workouts tab and in a workout's detail) reads the saved unit when the database opens; until then everything reads kg. The settings screen calls `setWeightUnit` on a change. `setWeightUnit` notifies subscribers and screens that draw weights call `useWeightUnit()` to redraw (memoised rows, cards and the weight box need it inside themselves); text built with `useMemo` has the unit in its deps.
- Where it applies: the logger (column header, boxes, hint and "previous" labels, `NumberField` / `SetRow` / `ExerciseCard`), the routine editor (`RoutineExerciseCard` through `parseWeightAmount`, `RoutineSheet`), summary, history, week strip, the exercise page (charts are scaled to the unit before drawing so their axis ticks land on round pounds; records and rep records), the workouts list and a watch workout's strength block (`ui/liftFormat.ts`), the share text (`share/strengthShareStats.ts`: top sets, volume stat, Strava description) and the sticker share cards (`volume` and `unit` in the sticker subject data).
- Not converted: weights other people posted (JoyoRogo social attachments carry `volumeKg` and show kg).

## Not covered

- The logger does not read heart rate live from the watch; the merge happens after the fact.
- No other unit than kg and lb (no stone, no per-exercise unit).
