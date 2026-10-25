/**
 * The cadence metronome, shared by the live screen of a watch-started workout and the Run recorder.
 *
 * Each beat vibrates (`Vibration` from React Native), clicks (`expo-audio`), or both: the mode is a setting kept like the tempo,
 * vibration by default. One engine for the whole app, so the beat goes on while the person moves between screens; it stops when
 * switched off, or when the workout screen that started it reports the workout over (`useStopMetronomeWhen`). The on/off state is
 * not stored: the metronome is always off after the app starts.
 *
 * The click is `assets/sounds/metronome-click.wav` (35 ms of 16-bit PCM, written by `scripts/metronome-click.ts`). Two players are
 * created the first time a click is wanted and kept for the life of the app; a beat only starts a player that is loaded and back at
 * the start of the sample, so no beat waits for loading or seeking. A player rewinds as soon as its click ends, and beats take
 * turns between the two, so a slow rewind skips nothing. A beat that finds no ready player stays silent rather than late (the
 * first beat or so after the players are created, while they load). The beats keep the fixed grid of `nextBeatAt`: the output
 * latency (larger over Bluetooth) is the same on every beat, so it moves the whole grid a little and never makes it drift.
 *
 * The audio session mixes with other audio (`interruptionMode: 'mixWithOthers'`: no audio focus on Android, `.mixWithOthers` on
 * iOS), so music keeps playing at full volume, and the click plays where media sound goes: a connected Bluetooth headset, else the
 * speaker. It also plays with the ringer on silent or vibrate (`playsInSilentMode`): the person chose the sound. Nothing touches
 * the audio session while the mode is vibration; it is released when the metronome stops or leaves the sound modes.
 *
 * Screen off: beats are scheduled from JS timers, so they keep going only while the app process and its JS thread are kept alive.
 * On Android that is the recording's foreground service (Run recorder); on a watch-started workout the screen holds the device
 * awake instead (see `LiveWorkoutScreen`). Android may still throttle timers of an app it has put to sleep. `shouldPlayInBackground`
 * stops expo-audio from pausing its players when the app leaves the foreground. expo-audio's own media-playback foreground service
 * and notification are not declared (`enableBackgroundPlayback: false` in app.json): the recording already has a foreground service,
 * and a click needs no player controls. On iOS the `location` background mode keeps a phone recording running with the screen
 * locked, but iOS mutes an app in the background unless it has the `audio` background mode, so app.json adds `audio` to
 * `UIBackgroundModes` for the click; the session is active only while the metronome clicks.
 */
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import Storage from 'expo-sqlite/kv-store';
import { useEffect, useSyncExternalStore } from 'react';
import { Vibration } from 'react-native';

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
} from './metronomeModel';

const CLICK_SOURCE: number = require('../../../assets/sounds/metronome-click.wav');
const CLICK_PLAYERS = 2;
/** A player still not rewound this long after its 35 ms click (an interruption paused it, a status got lost) is rewound anyway. */
const CLICK_STUCK_MS = 1000;

export interface MetronomeState {
  enabled: boolean;
  bpm: number;
  mode: MetronomeMode;
}

let state: MetronomeState | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let dueAt = 0;

function current(): MetronomeState {
  state ??= { enabled: false, ...readSettings(Storage) };
  return state;
}

function commit(next: MetronomeState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

interface ClickPlayer {
  player: AudioPlayer;
  /** Loaded and at the start of the sample: the next `play()` sounds at once. */
  ready: boolean;
  loaded: boolean;
  playedAt: number;
}

let clickPlayers: ClickPlayer[] | null = null;
let nextClick = 0;
let audioActive = false;

function rewind(click: ClickPlayer): void {
  // ExoPlayer stays "play when ready" after the end: without the pause, the seek would play the click a second time.
  click.player.pause();
  const done = () => {
    click.ready = true;
  };
  void click.player.seekTo(0).then(done, done);
}

function createClickPlayer(): ClickPlayer {
  // keepAudioSessionActive: iOS would otherwise deactivate the session after every click and activate it again on the next one.
  const click: ClickPlayer = {
    player: createAudioPlayer(CLICK_SOURCE, { keepAudioSessionActive: true }),
    ready: false,
    loaded: false,
    playedAt: 0,
  };
  click.player.addListener('playbackStatusUpdate', (status) => {
    if (status.didJustFinish) {
      rewind(click);
    } else if (!click.loaded && status.isLoaded) {
      click.loaded = true;
      click.ready = true;
    }
  });
  return click;
}

/** Sets up the session (once per start) and the players (once per app run) when a click is wanted. */
function startAudio(): void {
  if (audioActive) return;
  audioActive = true;
  void setAudioModeAsync({
    interruptionMode: 'mixWithOthers',
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    allowsRecording: false,
  })
    .then(() => setIsAudioActiveAsync(true))
    .catch(() => undefined)
    .then(() => {
      clickPlayers ??= Array.from({ length: CLICK_PLAYERS }, createClickPlayer);
    });
}

function stopAudio(): void {
  if (!audioActive) return;
  audioActive = false;
  void setIsAudioActiveAsync(false).catch(() => undefined);
}

function click(now: number): void {
  if (!clickPlayers) return;
  for (let i = 0; i < clickPlayers.length; i++) {
    const index = (nextClick + i) % clickPlayers.length;
    const candidate = clickPlayers[index];
    if (!candidate.ready) {
      if (candidate.loaded && now - candidate.playedAt > CLICK_STUCK_MS) rewind(candidate);
      continue;
    }
    candidate.ready = false;
    candidate.playedAt = now;
    candidate.player.play();
    nextClick = (index + 1) % clickPlayers.length;
    return;
  }
}

/** Starts or stops the click to match the state: on while enabled in a mode with a click. */
function syncAudio(next: MetronomeState): void {
  if (next.enabled && clicks(next.mode)) startAudio();
  else stopAudio();
}

function beat(): void {
  const now = Date.now();
  const { bpm, mode } = current();
  if (vibrates(mode)) Vibration.vibrate(BEAT_PULSE_MS);
  if (clicks(mode)) click(now);
  dueAt = nextBeatAt(dueAt, now, beatIntervalMs(bpm));
  timer = setTimeout(beat, Math.max(0, dueAt - now));
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
    syncAudio(next);
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
    syncAudio(next);
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
