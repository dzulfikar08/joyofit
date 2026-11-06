# Checking the watch against a chest strap

How a tester measures how accurate the watch, and JoyoFit's figures built on it, really are: one person wears the watch under
test and a reference chest strap (Polar H10 or similar ECG strap) **in the same session**, and the two recordings are compared
second by second. Comparing different people's workouts says nothing; comparing two devices on one body does.
(From Jeremy's review, Nov 2026: `docs/reviews/2026-11-jeremy-algorithm-review.md`.)

## What each recording gives

| Recording | Made by | Exported as | Carries |
|---|---|---|---|
| Watch under test | A workout started **on the watch**, synced to JoyoFit | Workout screen → Export file → .fit | The watch's heart rate (and GPS, pace, calories) |
| Reference | JoyoFit's **Record** screen with the chest strap connected as a sensor | Workout screen → Export file → .fit | The strap's heart rate, and its beat-to-beat R-R intervals as FIT `hrv` messages |

The R-R intervals are kept as the strap sent them (only values outside 250–2000 ms, which no heart produces, are dropped); the
artefact filter is applied only to the HRV figure JoyoFit shows, never to the file. Recordings made before this build have no
R-R in their file.

## Steps

1. Note the watch model and its software version (on the watch's About screen). Every tester in one comparison should wear the
   same model; results from different watches are separate comparisons.
2. Wet the strap's electrodes, put it on, wear the watch snug, one finger above the wrist bone.
3. On the phone, turn **off** "Start the band with the run" (on the Record screen, before starting). With it on, the band's heart rate can feed
   the phone recording and the two would no longer be independent.
4. Start the workout on the watch, then start the Record screen with the strap, within a few seconds of each other. Note the
   gap if there is one.
5. Do the session. Useful variety: a steady part, sudden efforts (sprints, intervals: wrist sensors lag here), and some arm
   movement (strength, rowing: wrist sensors struggle here).
6. Stop both, let the watch sync, then export both workouts as .fit and send the two files together.

## What gets compared

- Heart rate: mean absolute error and bias per second, the lag after a sudden change, dropouts.
- HRV: RMSSD and SDNN from the strap's R-R against the watch's own HRV figure, when it gives one.
- Calories: the watch's kcal against JoyoFit's estimate from the strap's heart rate (the open question in JURNAL-02).

Any FIT reader works: Garmin's FIT SDK, Golden Cheetah, Kubios (HRV), or a script. Align the two files on their timestamps; the
`hrv` messages have none of their own and start at the first beat after the recording started.
