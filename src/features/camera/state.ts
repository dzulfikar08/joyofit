// What the camera screen and the always-mounted runner share about the watch's Remote shutter (no native imports, so it is testable).

/** An "open" from the watch while JoyoFit was in the background opens the camera when the app comes back within this time. */
export const PENDING_OPEN_MS = 60_000;

/**
 * Who is listening to the watch's shutter: the camera screen while it is mounted. The runner (always mounted) leaves the watch's events to
 * it then, and otherwise opens the screen.
 */
let screenMounted = false;
/** The watch pressed the shutter before the screen was there: the screen takes the picture once its camera is ready. */
let pendingShutter = false;
/** When the watch opened its shutter while JoyoFit was in the background (ms), null when it has not or the camera opened since. */
let pendingOpenAt: number | null = null;

export const cameraRemoteState = {
  get screenMounted() {
    return screenMounted;
  },
  setScreenMounted(mounted: boolean) {
    screenMounted = mounted;
    if (mounted) pendingOpenAt = null;
  },
  /** True once: the screen asks this when its camera is ready. */
  takePendingShutter(): boolean {
    const pending = pendingShutter;
    pendingShutter = false;
    return pending;
  },
  queueShutter() {
    pendingShutter = true;
  },
  markPendingOpen(now: number) {
    pendingOpenAt = now;
  },
  clearPendingOpen() {
    pendingOpenAt = null;
  },
  /** True once when an open from the watch is still fresh at `now`. */
  takePendingOpen(now: number): boolean {
    const at = pendingOpenAt;
    pendingOpenAt = null;
    return at !== null && now - at <= PENDING_OPEN_MS;
  },
};
