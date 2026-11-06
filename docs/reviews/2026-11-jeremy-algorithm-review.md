# Jeremy's algorithm review (5 Nov 2026): verdicts and evidence

Jeremy sent five documents (`051126_JoyoFit.7z`); the one that matters is `5_SPEC-FINAL-CONSOLIDATED.md`, which lists ten
changes ("modules"). Each item below was checked against the code, not against earlier notes. Links point to master at
`5f341186` (after the fixes landed) unless they say otherwise.

**This is the first iteration.** The rejections below are about the changes as written, not the concerns behind them.
We will go through the rejected items again with Jeremy: corrected numbers, other ways to reach the same goal (for
example a recovery curve where a normal day reads green), or measured data where a model is in question.

| ID | Claim | Verdict | Status |
|---|---|---|---|
| JURNAL-03 | Riegel pace exponent should be 0.06/1.06 | ✅ Accept | Fixed, PR #77; live by OTA 2026-11-06 |
| BLE-03 | Negative altitude reads as +65526 | ✅ Accept (sign fix only, no clipping) | Fixed, PR #77; native, reaches devices with the next store build |
| BLE-01 | Keep chest-strap R-R intervals | ✅ Accept (feature) | Session HRV (#77) and raw R-R in the FIT export (#79); live by OTA 2026-11-06; no screen yet |
| JURNAL-01 | VO₂max should use resting HR, not daily minimum | Already true | Comment fixed, PR #77 |
| ALGO-03 | Custom zones should stay display-only | Already true | No change |
| ALGO-02 | Forward-fill 600 s → 15 s | ❌ Reject | — |
| ALGO-01 | Recovery sigmoid, z=0 → 82 % | ❌ Reject as written | — |
| BLE-02 | TruSleep state ranges stored as light sleep | Already fixed | No change |
| JURNAL-02 | Keytel → "Hiilloskorpi" calories | ❌ Not now | — |
| (extra) | Raw data export to compare with a gold-standard device | ✅ Accept | R-R in the FIT export + tester guide, PR #79; live by OTA 2026-11-06 |

Base for links: `https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/`
(written below as `@master/…`).

---

## ✅ Accepted

### JURNAL-03: Riegel exponent

**Claim.** Riegel's law is `T2 = T1 · (D2/D1)^1.06`. Pace at a fixed duration therefore scales with time by
`(T2/T1)^(0.06/1.06)`, not `^0.06`.

**Evidence.** Before: [`zones.ts#L9-L10` @ bce4798e](https://github.com/dzulfikar08/joyofit/blob/bce4798ee9a83df8db1334f8bfd89fd02bb9a486/src/features/workouts/analysis/zones.ts#L9-L10)
used `0.06`. The algebra: `T ∝ D^1.06` ⇒ `D ∝ T^(1/1.06)` ⇒ pace `T/D ∝ T^(1 - 1/1.06) = T^(0.06/1.06)`.
He is right.

**Fix.** [`@master/src/features/workouts/analysis/zones.ts#L14`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/workouts/analysis/zones.ts#L14)
`RIEGEL_PACE_EXPONENT = 0.06 / 1.06`, used at [`#L57`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/workouts/analysis/zones.ts#L57).
Golden values in `analysis.test.ts` updated. Effect on threshold pace is 0.06 % to 0.8 % depending on effort length.

### BLE-03: negative altitude

**Claim.** Altitude below sea level sent in fewer than four bytes is read unsigned (`FF F6` → 65526 instead of −10).

**Evidence.** `signedWhenFour` only sign-extends a 4-byte value:
[`LiveWorkoutCodec.kt#L75`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/modules/huawei-wear/android/src/main/java/com/joyodigitama/huaweiwear/LiveWorkoutCodec.kt#L75).
He is right, though nobody has seen the watch send a short altitude.

**What we changed from his spec.**
- His fix also clipped values outside −500..9000 to "no reading" inside the shared function. That function is also used
  for workout status codes ([`WatchWorkout.kt#L86`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/modules/huawei-wear/android/src/main/java/com/joyodigitama/huaweiwear/WatchWorkout.kt#L86),
  tag 0x7F), where values like 100014 must survive. So we added a separate
  [`signedBytes` (Kotlin #L87)](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/modules/huawei-wear/android/src/main/java/com/joyodigitama/huaweiwear/LiveWorkoutCodec.kt#L87)
  and pointed only the altitude callers at it. No clipping.
- His spec only covered Android. iOS has its own copy:
  [`LiveWorkoutCodec.swift#L88`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/modules/huawei-wear/ios/HuaweiProtocol/Sources/HuaweiProtocol/LiveWorkoutCodec.swift#L88),
  callers [`#L144`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/modules/huawei-wear/ios/HuaweiProtocol/Sources/HuaweiProtocol/LiveWorkoutCodec.swift#L144)
  and [`#L269`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/modules/huawei-wear/ios/HuaweiProtocol/Sources/HuaweiProtocol/LiveWorkoutCodec.swift#L269).
- The existing tests asserted the old behaviour (`F4` → 244); both now expect −12 (`altitudeIsSignedAtAnyWidth`).

### BLE-01: R-R intervals

**Claim.** The chest strap's R-R intervals are parsed but thrown away; keep them for HRV.

**Evidence.** [`gatt.ts#L86`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/sensors/gatt.ts#L86)
parses R-R from `0x2A37`; before PR #77 the recorder never stored them. Applies to external straps only, not the Huawei
watch. His filter is a 5-point median check; it is not the Lipponen & Tarvainen (2019) method the documents cite.

**What we did.** [`rri.ts`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/record/rri.ts):
physiological bounds 250–2000 ms, 4-neighbour median artefact filter (20 %), RMSSD/SDNN once there are ≥ 30 clean beats.
The recorder keeps them ([`recorder.ts#L94`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/record/recorder.ts#L94),
crash-recovery meta [`#L175`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/record/recorder.ts#L175)),
and the saved workout's `summary_json` gets `hrv` ([`save.ts#L83-L86`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/record/save.ts#L83-L86),
[`summary.ts#L76`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/workouts/summary.ts#L76)).
**Follow-up:** no screen shows it yet.

**Then (#79).** The raw series (bounds-checked only) is now stored per workout (`workout_rri`) and written into the
workout's `.fit` as FIT `hrv` messages; the HRV summary is computed from a filtered copy. See the extra item below.

---

## Already done

### JURNAL-01: VO₂max resting heart rate

**Claim.** The estimate uses the day's minimum heart rate instead of the watch's resting heart rate.

**Evidence.** The query already reads the watch's own resting value, `MIN(s.resting_heart_rate)`:
[`queries.ts#L354`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/db/queries.ts#L354).
Only the comment in `vo2max.ts` was misleading; it is fixed
([`vo2max.ts#L9-L12`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/fitness/vo2max.ts#L9-L12)).

**The range.** [`uthSorensen` (#L47-L48)](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/fitness/vo2max.ts#L47-L48)
already rejects a resting HR outside 30–110 bpm (and the result must be a plausible VO₂max, 10–90). It is a sanity
check: outside it, no estimate is shown. Jeremy suggests 40–95. We keep 30–110: well-trained endurance athletes
commonly rest in the high 30s, and 40 would hide their VO₂max.

### ALGO-03: custom zones only for display

**Claim.** The user's custom HR zones (max / HRR / LTHR / manual) should only change what is displayed; strain must stay
on fixed zones.

**Evidence.** That is already the design. Strain uses Edwards' zones on % of maximum HR and nothing else
([`strain.ts#L13-L16`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/today/strain.ts#L13-L16));
the person's zones only drive time-in-zone, coaching and the watch
([`analysis/zones.ts#L18-L23`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/workouts/analysis/zones.ts#L18-L23),
"Display only"; also `docs/hr-zones.md`, "What the zones do not change"). His own module 9 reaches the same
decision; the `userZoneIndex` / `zoneLabel` helpers he adds duplicate what `hrZones` already does.

### BLE-02: TruSleep state ranges as light sleep

**Claim.** Ranges from the sleep *state* file are stored as light sleep (type 0x06); change them to type 1 and migrate
history with `UPDATE sleep_segments SET type = 1 WHERE type = 6 AND stage IS NULL`.

**Evidence.** Already fixed differently: those rows keep 0x06 only as a storage key and carry `stage = null`, so they no
longer read as light ([`SleepSync.kt#L145-L152`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/modules/huawei-wear/android/src/main/java/com/joyodigitama/huaweiwear/SleepSync.kt#L145-L152)).

**Why not his change.** Sleep rows are upserted on `(start, type)`
([`WatchSql.kt#L45-L48`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/modules/huawei-wear/android/src/main/java/com/joyodigitama/huaweiwear/WatchSql.kt#L45-L48)).
Changing the type to 1 means the next sync of an old night inserts a new row beside the old one instead of updating it,
which duplicates nights. The migration rewrites history (and bumps every row's cloud `rev`) for no visible gain.

---

## ❌ Rejected (this iteration)

Rejected as specified, open for a second iteration.

### ALGO-02: forward-fill 600 s → 15 s

**Claim.** One heart-rate reading counting for up to 10 minutes invents "phantom" training load; cut it to 15 s.

**How it works.** This is not a sampling rate. Daily strain runs on the watch's all-day samples, which are whatever the
watch recorded. At rest the watch measures heart rate only every few minutes, so each reading is taken to stand for the
time until the next reading, capped at 10 minutes
([`strain.ts#L21-L22`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/today/strain.ts#L21-L22),
applied at [`#L93`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/today/strain.ts#L93)).
The cap only matters when there is a gap; during a workout the watch reads every second or so and the next reading
arrives long before either cap.

**Why 15 s is wrong.**
1. *It does not add readings, it throws time away.* With readings 5 minutes apart, a 15 s cap counts 15 s per reading
   and drops the other 4 m 45 s. Covered time falls about 95 %, so strain and intensity minutes for an ordinary day fall
   with it. Lowering the cap cannot make anything more accurate; only the watch measuring more often could.
2. *The "phantom" load is close to zero.* Below 50 % of maximum HR the Edwards weight is 0
   ([`edwardsZone`, #L24-L28](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/today/strain.ts#L24-L28)),
   and resting readings are almost always there. A stretched resting reading adds coverage, not load.
3. *It breaks the SQL twin.* Long ranges compute the same thing in SQL with `ts + 600`
   ([`queries.ts#L296`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/db/queries.ts#L296),
   [`#L322`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/db/queries.ts#L322));
   the two are required to agree, and his spec changes only one.

The real dropout case (a sensor losing contact mid-workout) is already handled: inside a workout a gap over 120 s counts
as a pause ([`MAX_WORKOUT_GAP_SEC`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/today/strain.ts#L108)).

### ALGO-01: recovery sigmoid

**Claim.** Replace `50 + 25z` with `99 / (1 + e^(−2.5(z + 0.1)))` so a normal day (z = 0) shows 82 % (green).

**Evidence.** Today: [`recovery.ts#L102`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/today/recovery.ts#L102),
bands at [`#L48-L49`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/today/recovery.ts#L48-L49)
(green ≥ 67, yellow ≥ 34).

**The formula does not do what the text says.** At z = 0: `99 / (1 + e^(−2.5 × 0.1)) = 99 / (1 + e^−0.25) =
99 / 1.779 = 55.7 %`. Across the range:

| z | Today (`50 + 25z`) | His formula |
|---|---|---|
| +1 | 75 % | 93 % |
| 0 | 50 % | **55.7 %** (not 82 %) |
| −0.5 | 37.5 % | 26.6 % |
| −1 | 25 % | 9.4 % |

His document evaluates `e^(+0.2) = 1.221` where `e^(−0.25) = 0.779` belongs. With the correct value z = 0 lands at
55.7 % (yellow), and below-baseline days become much harsher than today. Whether a normal day should read green is a
product choice we can make separately (e.g. by shifting the curve), but not with this formula.

### JURNAL-02: Keytel → "Hiilloskorpi"

**Claim.** The female Keytel equation has a negative weight coefficient, so replace it with Hiilloskorpi (2003).

**Evidence.** The −0.1263 is Keytel et al. (2005)'s own published coefficient, copied exactly
([`energy.ts#L19-L23`](https://github.com/dzulfikar08/joyofit/blob/5f341186191faea4d9489567ecd793df27d6b29e/src/features/record/energy.ts#L19-L23)).

**Why not.** His replacement is not Hiilloskorpi's regression; it is a generic %HRR ≈ %VO₂R (Swain 1994) conversion. It
needs VO₂max, which here is itself an estimate built on 220 − age (falling back to a hardcoded 35), so the errors
stack. Watch workouts use the watch's own calories anyway; this only affects phone-recorded sessions. Worth revisiting
only against measured data (e.g. comparing with the watch's kcal for the same session).

---

## ✅ Extra idea: raw export to compare with a gold-standard device

**Idea (sent after the documents).** Let users who own a reference device (Polar H10 for heart rate, or others) export raw
data, so JoyoFit's figures can be compared with another system. He expected the data formatting to be the hard part.

**What it means.** One person wears the watch under test and the reference strap in the same session, and the two recordings
are compared second by second. Every tester in one comparison wears the same watch model. Different people's workouts are
not compared with each other.

**Done (PR #79, merged `3ce04bf3`, live by OTA 2026-11-06).** No whitelist was needed: every workout could already be exported
as `.fit`, the format Garmin's SDK, Golden Cheetah and Kubios read. What was missing was the strap's beat-to-beat data:
- A phone recording with a chest strap stores its R-R intervals as received, dropping only values outside 250–2000 ms
  ([`sensors/store.ts`, `workout_rri`](https://github.com/dzulfikar08/joyofit/blob/3ce04bf3/src/features/sensors/store.ts)).
- `buildFit` writes them as FIT `hrv` messages, one interval each, the way Garmin devices carry them
  ([`activityFile.ts`](https://github.com/dzulfikar08/joyofit/blob/3ce04bf3/src/features/strava/activityFile.ts));
  a test reads them back with Garmin's SDK.
- The tester guide: [`docs/hr-validation.md`](https://github.com/dzulfikar08/joyofit/blob/3ce04bf3/docs/hr-validation.md).
  It covers setup, turning off "Start the band with the run" so the two recordings stay independent, and what to compare.

**Next.** Paired sessions from testers with an H10 are the measured data the second iteration needs, for calories
(JURNAL-02) and HRV and recovery (ALGO-01). Recordings made before the OTA have no R-R stored.
