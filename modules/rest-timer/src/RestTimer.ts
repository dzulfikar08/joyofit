import { requireOptionalNativeModule, type NativeModule } from 'expo';

/** What the live rest timer shows. `endsAt` is epoch ms, the same absolute end the logger's draft keeps. */
export interface RestTimerOptions {
  endsAt: number;
  /** First line, e.g. "Istirahat". */
  title: string;
  /** Second line, e.g. the exercise that was just done. */
  body: string;
  /** Android only: the name of the notification channel in the system settings. */
  channelName?: string;
}

declare class RestTimerModule extends NativeModule {
  isSupported(): boolean;
  startRestTimer(endsAt: number, title: string, body: string, channelName: string): void;
  stopRestTimer(): void;
}

/**
 * A rest timer that keeps counting on the lock screen.
 *
 * - Android: an ongoing, silent notification with a chronometer counting down to `endsAt` (`RestTimerNotification.kt`). No foreground
 *   service; the system draws the clock and removes the notification at the end.
 * - iOS 16.2+: a Live Activity (ActivityKit) on the lock screen and in the Dynamic Island, `Text(timerInterval:countsDown:)` doing the
 *   clock. Its widget extension is `targets/rest-timer`; the module only starts, updates and ends it (`RestTimerModule.swift`).
 *
 * Optional native module: an OTA bundle on a binary built before this module existed has none, and every function is then a silent
 * no-op (`isRestTimerSupported()` is false). Nothing here throws.
 */
const native = requireOptionalNativeModule<RestTimerModule>('RestTimer');

/** Whether this binary can show a live rest timer: the native module is there and the platform allows it (iOS: Live Activities are on). */
export function isRestTimerSupported(): boolean {
  try {
    return native?.isSupported() ?? false;
  } catch {
    return false;
  }
}

/** Shows the countdown, or moves a running one to the new end and text. Idempotent. A time already past removes it. */
export function startRestTimer({ endsAt, title, body, channelName = 'Rest timer' }: RestTimerOptions): void {
  try {
    native?.startRestTimer(endsAt, title, body, channelName);
  } catch {
    // a missing countdown is not worth interrupting a workout for
  }
}

/** Removes the countdown. Idempotent. */
export function stopRestTimer(): void {
  try {
    native?.stopRestTimer();
  } catch {
    // nothing running
  }
}
