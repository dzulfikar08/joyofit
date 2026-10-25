/** The arithmetic and settings of the cadence metronome. Pure: no React, no native modules, so it runs under `bun test`. */

export const MIN_BPM = 120;
export const MAX_BPM = 200;
export const DEFAULT_BPM = 170;
export const BPM_STEP = 5;

/** How long one beat buzzes (ms): short enough to be a tick at 200 bpm (a 300 ms beat). */
export const BEAT_PULSE_MS = 40;

/** `bpm` as a whole number inside the range; anything that is not a number is the default. */
export function clampBpm(bpm: unknown): number {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm)) return DEFAULT_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

/** One step of the stepper: `direction` times `BPM_STEP`, kept inside the range. */
export function stepBpm(bpm: number, direction: -1 | 1): number {
  return clampBpm(bpm + direction * BPM_STEP);
}

export function beatIntervalMs(bpm: number): number {
  return 60_000 / clampBpm(bpm);
}

/**
 * When the beat after the one due at `dueAt` is due. It follows a fixed grid (no drift from timer lateness); a timer that was
 * suspended for more than one beat (screen off, the app in the background) restarts the grid from `now` instead of firing a
 * burst of catch-up beats.
 */
export function nextBeatAt(dueAt: number, now: number, intervalMs: number): number {
  const next = dueAt + intervalMs;
  return next <= now ? now + intervalMs : next;
}

/** What a beat does: a vibration (the default, what the metronome did before it had a sound), a click, or both. */
export const METRONOME_MODES = ['vibration', 'sound', 'both'] as const;
export type MetronomeMode = (typeof METRONOME_MODES)[number];
export const DEFAULT_MODE: MetronomeMode = 'vibration';

/** A stored mode as a mode; anything unknown (nothing stored, an older or damaged value) is the default. */
export function parseMode(value: unknown): MetronomeMode {
  return METRONOME_MODES.find((mode) => mode === value) ?? DEFAULT_MODE;
}

export function vibrates(mode: MetronomeMode): boolean {
  return mode !== 'sound';
}

export function clicks(mode: MetronomeMode): boolean {
  return mode !== 'vibration';
}

/** Whether the click sound should be loaded (and on iOS the audio session active): only while the metronome runs in a mode with a click. */
export function wantsClickSound(state: { enabled: boolean; mode: MetronomeMode }): boolean {
  return state.enabled && clicks(state.mode);
}

/** The kept settings. The on/off state is not one of them: the metronome is always off after the app starts. */
export interface MetronomeSettings {
  bpm: number;
  mode: MetronomeMode;
}

/** The synchronous key-value store the settings live in (`expo-sqlite/kv-store` in the app). */
export interface SettingsStore {
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
}

export const BPM_KEY = 'joyofit.metronome.bpm';
export const MODE_KEY = 'joyofit.metronome.mode';

/** The kept settings, each one its default when missing, invalid or unreadable. */
export function readSettings(store: SettingsStore): MetronomeSettings {
  return {
    bpm: readKey(store, BPM_KEY, (text) => clampBpm(Number(text)), DEFAULT_BPM),
    mode: readKey(store, MODE_KEY, parseMode, DEFAULT_MODE),
  };
}

function readKey<T>(store: SettingsStore, key: string, parse: (text: string) => T, fallback: T): T {
  try {
    const text = store.getItemSync(key);
    return text === null ? fallback : parse(text);
  } catch {
    return fallback;
  }
}

/** Keeps one setting. A store that fails is ignored: the setting still applies for this session. */
export function saveSetting(store: SettingsStore, key: typeof BPM_KEY | typeof MODE_KEY, value: string): void {
  try {
    store.setItemSync(key, value);
  } catch {
    // Kept for this session only.
  }
}
