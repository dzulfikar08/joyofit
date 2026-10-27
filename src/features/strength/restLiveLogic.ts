/**
 * When the live rest timer (the lock-screen countdown, `modules/rest-timer`) has to start, move or stop. Framework free: the logger's
 * screen feeds it what it knows after every change and `restLive.ts` does the native calls.
 */

/** What the live timer shows: the rest's end and the exercise the rest follows. */
export interface RestLiveWish {
  endsAt: number;
  exerciseName: string | null;
}

export type RestLiveAction = { type: 'start'; wish: RestLiveWish } | { type: 'stop' };

export interface RestLiveInput {
  /** The logger is showing a workout in progress (not loading, not an edit of a finished workout). */
  active: boolean;
  /** The rest timer of the draft, or null. */
  rest: { endsAt: number } | null;
  /** The stopwatch is paused: the rest is held with it and its end moves on resume, so there is nothing to count down. */
  paused: boolean;
  /** The platform lets a countdown show (`liveRestAllowed`). */
  allowed: boolean;
  exerciseName: string | null;
  now: number;
}

/**
 * Whether the platform may show the countdown. Android posts a notification, so it needs the notification permission the logger asks
 * for. An iOS Live Activity is not a notification: it has its own switch in Settings, which the native module reads, and no permission.
 */
export function liveRestAllowed(os: string, notificationPermission: 'granted' | 'ask' | 'blocked'): boolean {
  return os === 'ios' || notificationPermission === 'granted';
}

/** What should be on the lock screen right now, or null for nothing. */
export function wantedRestLive(input: RestLiveInput): RestLiveWish | null {
  if (!input.active || !input.allowed || input.paused || !input.rest) return null;
  if (input.rest.endsAt <= input.now) return null;
  return { endsAt: input.rest.endsAt, exerciseName: input.exerciseName };
}

/**
 * The call that takes the lock screen from `shown` to `wanted`, or null when it is there already. `shown` undefined = nobody knows what
 * is up there (the app just started: a countdown of a killed session may be), so a wish for nothing still stops once.
 */
export function restLiveAction(shown: RestLiveWish | null | undefined, wanted: RestLiveWish | null): RestLiveAction | null {
  if (wanted === null) return shown === null ? null : { type: 'stop' };
  if (shown && shown.endsAt === wanted.endsAt && shown.exerciseName === wanted.exerciseName) return null;
  return { type: 'start', wish: wanted };
}
