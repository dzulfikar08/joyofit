// Writes the metronome's click, assets/sounds/metronome-click.wav: 35 ms of a woodblock-like tick (two decaying partials,
// 1.8 and 2.9 kHz), 16-bit mono PCM at 44.1 kHz, about 3 KB. PCM WAV plays on ExoPlayer (Android) and AVPlayer (iOS) with
// no decoder delay, and the sound starts at the first sample, so the tick lands when the player starts.
//
//   bun scripts/metronome-click.ts

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RATE = 44_100;
const SECONDS = 0.035;
const DECAY_S = 0.005;
const ATTACK_S = 0.0003;
const PEAK = 0.89; // about -1 dBFS

const count = Math.round(RATE * SECONDS);
const raw = new Float64Array(count);
for (let i = 0; i < count; i++) {
  const t = i / RATE;
  const envelope = Math.min(1, t / ATTACK_S) * Math.exp(-t / DECAY_S);
  raw[i] = envelope * (0.7 * Math.sin(2 * Math.PI * 1800 * t) + 0.3 * Math.sin(2 * Math.PI * 2900 * t));
}
const max = raw.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

const data = Buffer.alloc(count * 2);
raw.forEach((v, i) => data.writeInt16LE(Math.round((v / max) * PEAK * 32767), i * 2));

const header = Buffer.alloc(44);
header.write('RIFF', 0, 'ascii');
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8, 'ascii');
header.write('fmt ', 12, 'ascii');
header.writeUInt32LE(16, 16); // fmt chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36, 'ascii');
header.writeUInt32LE(data.length, 40);

const out = fileURLToPath(new URL('../assets/sounds/metronome-click.wav', import.meta.url));
writeFileSync(out, Buffer.concat([header, data]));
console.log(`${out}: ${44 + data.length} bytes`);
