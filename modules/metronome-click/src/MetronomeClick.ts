import { NativeModule, requireNativeModule } from 'expo';

/**
 * The metronome's click: 35 ms of a woodblock-like tick, synthesized natively (`ClickSound.kt`, `ClickSound.swift`), played as
 * media audio that mixes with whatever else plays.
 *
 * - Android: a `SoundPool` with `USAGE_MEDIA` / `CONTENT_TYPE_SONIFICATION`. No audio focus request (music keeps playing at full
 *   volume) and no `MediaSession` (headset buttons and the watch's music control keep going to the music app).
 * - iOS: an `AVAudioPlayer` in an `AVAudioSession` of category `.playback` with `.mixWithOthers`, active only between `start` and
 *   `stop` (deactivated with `.notifyOthersOnDeactivation`). A mixable session never becomes the Now Playing app.
 *
 * The click goes where media audio goes (a connected Bluetooth headset, else the speaker), also with the ringer on silent.
 *
 * All three functions return at once and never throw: the work runs in call order on one native serial queue, so a `stop` always
 * lands after the `start` before it. `click` before the sound is loaded (the first moments after `start`) or after `stop` is silent.
 */
declare class MetronomeClickModule extends NativeModule {
  /** Loads the click and, on iOS, activates the mixable audio session. Idempotent. */
  start(): void;

  /** Plays one click now. */
  click(): void;

  /** Unloads the click and, on iOS, deactivates the audio session. Idempotent. */
  stop(): void;
}

export default requireNativeModule<MetronomeClickModule>('MetronomeClick');
