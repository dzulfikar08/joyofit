/**
 * The cadence metronome, shared by the live screen of a watch-started workout and the Run recorder.
 *
 * Each beat vibrates (`Vibration` from React Native), clicks (`modules/metronome-click`), or both: the mode is a setting kept like the
 * tempo, vibration by default. One engine for the whole app, so the beat goes on while the person moves between screens; it stops when
 * switched off, or when the workout screen that started it reports the workout over (`useStopMetronomeWhen`). The on/off state is
 * not stored: the metronome is always off after the app starts.
 *
 * The click is a 35 ms tick synthesized natively and played as media audio mixed with other audio: Android `SoundPool` with no audio
 * focus and no MediaSession (music keeps playing at full volume; earbud buttons and the watch's music control stay with the music
 * app), iOS `AVAudioPlayer` in a `.playback` session with `.mixWithOthers`. It goes where media audio goes (a connected Bluetooth
 * headset, else the speaker), also with the ringer on silent: the person chose the sound. The sound is loaded (and the iOS session
 * active) only while the metronome runs in a mode with a click (`wantsClickSound`); a click in the first moments after that, while
 * the sound loads, is silent rather than late. The native calls queue in order on one native thread, so switching off right after
 * switching on can never leave the sound loaded. The beats keep the fixed grid of `nextBeatAt`; the output latency (larger over
 * Bluetooth) delays every click about the same, so it moves the grid a little and does not accumulate.
 *
 * Screen off: beats are scheduled from JS timers, so they keep going only while the app process and its JS thread are kept alive.
 * On Android that is the recording's foreground service (Run recorder); on a watch-started workout the screen holds the device
 * awake instead (see `LiveWorkoutScreen`). Android may still throttle timers of an app it has put to sleep. On iOS the `location`
 * background mode keeps a phone recording running with the screen locked, but iOS mutes an app in the background unless it has the
 * `audio` background mode, so app.json adds `audio` to `UIBackgroundModes` for the click.
 */
import Storage from 'expo-sqlite/kv-store';
import { useEffect, useSyncExternalStore } from 'react';
import { Vibration } from 'react-native';

import MetronomeClick from '../../../modules/metronome-click';
import {
  BEAT_PULSE_MS,
  beatIntervalMs,
  BPM_KEY,
  clampBpm,
  clicks,
  type MetronomeMode,
  MODE_KEY,
  nextBeatAt,
  parseMode,
  readSettings,
  saveSetting,
  vibrates,
  wantsClickSound,
} from './metronomeModel';

export interface MetronomeState {
  enabled: boolean;
  bpm: number;
  mode: MetronomeMode;
}

let state: MetronomeState | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let dueAt = 0;
let soundLoaded = false;

function current(): MetronomeState {
  state ??= { enabled: false, ...readSettings(Storage) };
  return state;
}

function commit(next: MetronomeState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

/** Loads or unloads the click to match the state. */
function syncSound(next: MetronomeState): void {
  const want = wantsClickSound(next);
  if (want === soundLoaded) return;
  soundLoaded = want;
  try {
    if (want) MetronomeClick.start();
    else MetronomeClick.stop();
  } catch {
    // The beat goes on without the sound.
  }
}

function beat(): void {
  const now = Date.now();
  const { bpm, mode } = current();
  // The next beat is booked before anything that could throw: a failing vibration or click skips one beat, never the rest.
  dueAt = nextBeatAt(dueAt, now, beatIntervalMs(bpm));
  timer = setTimeout(beat, Math.max(0, dueAt - now));
  try {
    if (vibrates(mode)) Vibration.vibrate(BEAT_PULSE_MS);
    if (clicks(mode)) MetronomeClick.click();
  } catch {
    // Skipped beat.
  }
}

function stopTimer(): void {
  clearTimeout(timer);
  timer = undefined;
}

export const metronome = {
  get: current,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setEnabled(enabled: boolean): void {
    const now = current();
    if (now.enabled === enabled) return;
    const next = { ...now, enabled };
    commit(next);
    syncSound(next);
    stopTimer();
    if (enabled) {
      dueAt = Date.now();
      beat();
    } else {
      Vibration.cancel();
    }
  },
  /** The new tempo takes effect from the next beat. */
  setBpm(bpm: number): void {
    const next = clampBpm(bpm);
    commit({ ...current(), bpm: next });
    saveSetting(Storage, BPM_KEY, String(next));
  },
  /** The new mode takes effect from the next beat. */
  setMode(mode: MetronomeMode): void {
    const value = parseMode(mode);
    const next = { ...current(), mode: value };
    commit(next);
    syncSound(next);
    if (!vibrates(value)) Vibration.cancel();
    saveSetting(Storage, MODE_KEY, value);
  },
};

export function useMetronome(): MetronomeState {
  return useSyncExternalStore(metronome.subscribe, current, current);
}

/** Switches the metronome off once `over` is true (the workout ended) and when the calling screen goes away for good. */
export function useStopMetronomeWhen(over: boolean): void {
  useEffect(() => {
    if (over) metronome.setEnabled(false);
  }, [over]);
}

/** Switches the metronome off when the calling screen unmounts: the Run recorder's live view exists only while recording. */
export function useStopMetronomeOnUnmount(): void {
  useEffect(() => () => metronome.setEnabled(false), []);
}
