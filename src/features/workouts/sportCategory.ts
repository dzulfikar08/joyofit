import type { SportKind } from '@/features/workouts/analysis/types';

/**
 * The family a sport belongs to for sharing: which numbers mean something for it (a pace for a run, laps and SWOLF for a swim,
 * the time and heart rate for a gym session) and which share cards fit it.
 *
 * - `run`: running, trail, treadmill, obstacle race
 * - `walk`: walking and hiking
 * - `ride`: cycling outdoors and indoors
 * - `swim`: pool and open water swimming
 * - `gym`: strength, functional and core training, crossfit, gymnastics
 * - `cardio`: HIIT, jump rope, aerobics, machines (elliptical, stepper, rowing machine), boxing and martial arts, dance
 * - `flow`: yoga, pilates, stretching, tai chi, meditation
 * - `court`: team and racket sports
 * - `other`: the rest (golf, skiing, paddling, diving, ...)
 */
export const SPORT_CATEGORIES = ['run', 'walk', 'ride', 'swim', 'gym', 'cardio', 'flow', 'court', 'other'] as const;
export type SportCategory = (typeof SPORT_CATEGORIES)[number];

/**
 * First match wins, matched against the watch's English sport name (then the Gadgetbridge kind of the summary, with `_` read as
 * a space). The specific names come before the broad ones: "Air walker" and "Rowing machine" are machines, not a walk or a
 * boat; "High-intensity Interval Training" is cardio before "training" could read as gym. Diving reads as a swim to
 * `sportKind`, but its numbers are depth and time, not laps: it stays outside the swim family.
 */
const RULES: readonly [RegExp, SportCategory][] = [
  [/diving|apnea|scuba|snorkel/i, 'other'],
  [/swim/i, 'swim'],
  [/air walker|elliptical|stepper|stair|rowing machine|indoor row|high[- ]intensity|hiit|jump(?:ing)? rop|skipping|aerobic|zumba|hula hoop|boxing|sparring|combat|kickbox|karate|taekwondo|kendo|judo|martial|fencing|danc|ballet|parkour/i, 'cardio'],
  [/hik|orienteer|walk/i, 'walk'],
  [/run|trail|treadmill|obstacle/i, 'run'],
  [/cycl|spinning|bik|\bride\b|bmx/i, 'ride'],
  [/strength|weight|crossfit|functional|physical training|core training|barbell|dumbbell|kettlebell|horizontal bar|parallel bars|gymnastic|calisthenic/i, 'gym'],
  [/yoga|pilates|stretch|tai chi|meditat|mobility|breath|barre/i, 'flow'],
  [/ping pong|table tennis|badminton|shuttlecock|tennis|padel|squash|pickleball|soccer|futsal|football|basketball|volleyball|sepak|handball|baseball|softball|cricket|rugby|hockey|frisbee|dodgeball|gateball|netball|laser tag|tug of war/i, 'court'],
];

const KIND_CATEGORY: Record<SportKind, SportCategory> = { run: 'run', walk: 'walk', ride: 'ride', swim: 'swim', other: 'other' };

/** The family of a workout: by its sport name, then the summary's activity kind, then the analysed sport kind. */
export function sportCategory(sportName: string, summaryKind?: string, kind?: SportKind): SportCategory {
  const byName = RULES.find(([pattern]) => pattern.test(sportName))?.[1];
  if (byName) return byName;
  const activity = summaryKind?.replace(/_/g, ' ');
  const byActivity = activity ? RULES.find(([pattern]) => pattern.test(activity))?.[1] : undefined;
  return byActivity ?? (kind ? KIND_CATEGORY[kind] : 'other');
}

/** Cardio machines that measure a distance, power and cadence of their own (a rowing machine's metres and watts). */
export function isCardioMachine(sportName: string): boolean {
  return /air walker|elliptical|stepper|stair|rowing machine|indoor row|ski erg/i.test(sportName);
}
