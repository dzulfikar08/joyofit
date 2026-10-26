import { describe, expect, it } from 'bun:test';
import { virtualSpeedMs } from '@/features/cycling/series';
import { bytesToHex } from '../sensors/gatt';
import { Recorder, type GpsFix, type RecorderConfig, normalizedPower } from './recorder';

const T0 = 1_700_000_000_000;
const profile = { weightKg: 70, age: 35, sex: 'male' as const };
const config = (sport: RecorderConfig['sport'], gps = false): RecorderConfig => ({ sport, gps, wheelCircumferenceM: 2.105, profile });

const hr = (bpm: number) => bytesToHex(new Uint8Array([0x00, bpm]));
const u16 = (v: number) => [v & 255, (v >>> 8) & 255];
const u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const csc = (wheelRevs: number, wheelTime: number, crankRevs: number, crankTime: number) =>
  bytesToHex(new Uint8Array([0x03, ...u32(wheelRevs), ...u16(wheelTime), ...u16(crankRevs), ...u16(crankTime)]));

/** A fix `meters` north of the origin at second `sec` of the test. */
const M_PER_DEG = 111_194.93;
const fixAt = (sec: number, meters: number, extra: Partial<GpsFix> = {}): GpsFix => ({
  ts: T0 + sec * 1000,
  lat: 10 + meters / M_PER_DEG,
  lon: 20,
  alt: 100,
  accuracy: 5,
  speed: null,
  ...extra,
});

describe('transitions', () => {
  it('starts idle, records, pauses, resumes and finishes', () => {
    const r = new Recorder(config('other'));
    expect(r.status).toBe('idle');
    r.start(T0);
    expect(r.status).toBe('recording');
    r.pause(T0 + 5000);
    expect(r.status).toBe('paused');
    r.resume(T0 + 20_000);
    expect(r.status).toBe('recording');
    const w = r.finish(T0 + 30_000);
    expect(r.status).toBe('finished');
    expect(w).not.toBeNull();
  });

  it('ignores transitions that do not apply', () => {
    const r = new Recorder(config('other'));
    r.pause(T0);
    r.resume(T0);
    expect(r.lap(T0)).toBeNull();
    expect(r.finish(T0)).toBeNull();
    expect(r.status).toBe('idle');
    r.start(T0);
    r.start(T0 + 1000);
    r.resume(T0 + 1000);
    expect(r.status).toBe('recording');
  });

  it('writes one sample per second, none while paused, and counts only running time', () => {
    const r = new Recorder(config('other'));
    r.start(T0);
    r.tick(T0 + 10_000);
    r.pause(T0 + 10_000);
    r.tick(T0 + 40_000);
    expect(r.sampleCount).toBe(11);
    r.resume(T0 + 40_000);
    r.tick(T0 + 50_000);
    const w = r.finish(T0 + 50_000)!;
    expect(w.samples.map((s) => s.ts).filter((ts) => ts > T0 / 1000 + 10 && ts < T0 / 1000 + 40)).toEqual([]);
    // 10 s before the pause and 10 s after: 20 running seconds even though 50 s passed
    expect(w.movingSec).toBe(20);
    expect(w.start).toBe(T0 / 1000);
    expect(w.end).toBe(T0 / 1000 + 50);
    expect(r.movingSec(T0 + 50_000)).toBe(20);
  });

  it('catches up the seconds a stalled JS thread missed', () => {
    const r = new Recorder(config('other'));
    r.start(T0);
    r.tick(T0 + 1000);
    r.tick(T0 + 11_000);
    expect(r.sampleCount).toBe(12);
    const ts = r.drainNew().map((s) => s.ts);
    expect(ts).toEqual(Array.from({ length: 12 }, (_, i) => T0 / 1000 + i));
    expect(r.drainNew()).toEqual([]);
  });

  it('finishing while paused ends at the last running second', () => {
    const r = new Recorder(config('other'));
    r.start(T0);
    r.pause(T0 + 8000);
    const w = r.finish(T0 + 60_000)!;
    expect(w.end).toBe(T0 / 1000 + 8);
    expect(w.movingSec).toBe(8);
  });

  it('a recording with no sample has nothing to save', () => {
    const r = new Recorder(config('other'));
    expect(r.finish(T0)).toBeNull();
  });
});

describe('laps', () => {
  it('closes a lap with its own heart rate and distance, and the last lap at finish', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    const run = (from: number, to: number) => {
      for (let s = from; s <= to; s++) {
        r.fix(fixAt(s, s * 3, { speed: 3 }));
        r.sensor('2a37', hr(s < 10 ? 120 : 160), T0 + s * 1000);
        r.tick(T0 + s * 1000 + 500);
      }
    };
    run(0, 9);
    const lap = r.lap(T0 + 10_000)!;
    expect(lap.distanceM).toBeGreaterThan(20);
    expect(lap.maxHr).toBe(120);
    run(10, 20);
    const w = r.finish(T0 + 20_500)!;
    expect(w.laps).toHaveLength(2);
    expect(w.laps[1]!.avgHr).toBeGreaterThan(150);
    expect(w.laps[0]!.endTs).toBeLessThan(w.laps[1]!.endTs);
    expect(w.laps[0]!.distanceM + w.laps[1]!.distanceM).toBeCloseTo(w.distanceM, -1);
  });
});

describe('heart rate and energy', () => {
  it('uses heart rate energy when the strap covers most of the session', () => {
    const r = new Recorder(config('other'));
    r.start(T0);
    for (let s = 0; s < 600; s++) {
      r.sensor('2a37', hr(150), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 599_000)!;
    expect(w.kcalSource).toBe('hr');
    expect(w.avgHr).toBe(150);
    expect(w.maxHr).toBe(150);
    // Keytel male, 70 kg, 35 y, 150 bpm: 14.5 kcal/min -> 10 min about 145 kcal
    expect(w.calories).toBeGreaterThan(140);
    expect(w.calories).toBeLessThan(150);
  });

  it('falls back to MET without a strap', () => {
    const r = new Recorder(config('run'));
    r.start(T0);
    r.tick(T0 + 3_599_000);
    const w = r.finish(T0 + 3_599_000)!;
    expect(w.kcalSource).toBe('met');
    // 9.8 MET x 70 kg x 1 h
    expect(w.calories).toBe(686);
    expect(w.avgHr).toBeNull();
  });

  it('holds a heart rate for 5 s only', () => {
    const r = new Recorder(config('other'));
    r.sensor('2a37', hr(140), T0);
    r.start(T0);
    for (let s = 0; s <= 10; s++) r.tick(T0 + s * 1000);
    const w = r.finish(T0 + 10_000)!;
    expect(w.samples.filter((s) => s.hr !== null)).toHaveLength(6);
  });
});

describe('GPS distance', () => {
  it('adds the path of good fixes and gives the sample its speed', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    for (let s = 0; s <= 60; s++) {
      r.fix(fixAt(s, s * 3, { speed: 3 }));
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 60_000)!;
    expect(w.distanceM).toBeGreaterThan(175);
    expect(w.distanceM).toBeLessThan(185);
    expect(w.avgSpeed).toBeCloseTo(3, 0);
    expect(w.samples[30]!.lat).not.toBeNull();
    expect(w.samples[30]!.speed).toBe(3);
  });

  it('ignores poor fixes, a teleport and standing-still jitter', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    r.fix(fixAt(0, 0));
    r.tick(T0);
    // standing still, reported speed 0.1 m/s, wandering 3 m
    for (let s = 1; s <= 10; s++) {
      r.fix(fixAt(s, (s % 2) * 3, { speed: 0.1 }));
      r.tick(T0 + s * 1000);
    }
    // an accuracy 80 m fix far away
    r.fix(fixAt(11, 500, { accuracy: 80 }));
    // a teleport of 2 km in a second
    r.fix(fixAt(12, 2000));
    r.tick(T0 + 12_000);
    const w = r.finish(T0 + 12_000)!;
    expect(w.distanceM).toBe(0);
  });

  it('re-anchors after repeated jumps so the track is not lost for good', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    r.fix(fixAt(0, 0));
    // the phone really was carried 5 km away in a car-like jump: five in a row re-anchor
    for (let s = 1; s <= 6; s++) r.fix(fixAt(s, 5000 + s * 3));
    r.fix(fixAt(7, 5000 + 7 * 3 + 3));
    r.tick(T0 + 7000);
    const w = r.finish(T0 + 7000)!;
    expect(w.distanceM).toBeLessThan(10);
    expect(w.distanceM).toBeGreaterThan(0);
  });

  it('a pause adds no distance and the first fix after it is only an anchor', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    for (let s = 0; s <= 10; s++) {
      r.fix(fixAt(s, s * 3, { speed: 3 }));
      r.tick(T0 + s * 1000);
    }
    r.pause(T0 + 10_000);
    r.fix(fixAt(30, 600, { speed: 0 }));
    r.resume(T0 + 30_000);
    r.fix(fixAt(31, 603, { speed: 3 }));
    r.tick(T0 + 31_000);
    const w = r.finish(T0 + 31_000)!;
    expect(w.distanceM).toBeLessThan(40);
  });

  it('does not use GPS for an indoor sport', () => {
    const r = new Recorder(config('treadmill', false));
    r.start(T0);
    r.fix(fixAt(0, 0));
    r.fix(fixAt(5, 30));
    r.tick(T0 + 5000);
    const w = r.finish(T0 + 5000)!;
    expect(w.distanceM).toBe(0);
    expect(w.samples.every((s) => s.lat === null)).toBe(true);
  });

  it('drops the position when the last fix is stale', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    r.fix(fixAt(0, 0));
    for (let s = 0; s <= 20; s++) r.tick(T0 + s * 1000);
    const w = r.finish(T0 + 20_000)!;
    expect(w.samples[2]!.lat).not.toBeNull();
    expect(w.samples[10]!.lat).toBeNull();
  });
});

describe('sensors', () => {
  it('a speed and cadence sensor gives distance, speed and cadence indoors', () => {
    const r = new Recorder(config('indoorRide'));
    r.start(T0);
    r.sensor('2a5b', csc(1000, 0, 500, 0), T0);
    r.tick(T0);
    // 10 s at 5 wheel revs and 1.5 crank revs per second
    for (let s = 1; s <= 10; s++) {
      r.sensor('2a5b', csc(1000 + s * 5, s * 1024, 500 + Math.floor(s * 1.5), s * 1024), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 10_000)!;
    expect(w.distanceM).toBe(Math.round(50 * 2.105));
    expect(w.samples[5]!.speed).toBeCloseTo(5 * 2.105, 1);
    expect(w.avgCadence).toBeGreaterThan(50);
    expect(w.maxCadence).toBeLessThanOrEqual(120);
  });

  it('a stopped bike reads 0 speed and adds no distance', () => {
    const r = new Recorder(config('indoorRide'));
    r.start(T0);
    r.sensor('2a5b', csc(0, 0, 0, 0), T0);
    r.tick(T0);
    r.sensor('2a5b', csc(5, 1024, 0, 0), T0 + 1000);
    r.tick(T0 + 1000);
    r.tick(T0 + 10_000);
    const w = r.finish(T0 + 10_000)!;
    expect(w.distanceM).toBe(Math.round(5 * 2.105));
    expect(w.samples[10]!.speed).toBe(0);
  });

  it('outdoors a wheel sensor wins over the GPS path, and GPS is used again without it', () => {
    const r = new Recorder(config('ride', true));
    r.start(T0);
    r.sensor('2a5b', csc(0, 0, 0, 0), T0);
    r.fix(fixAt(0, 0));
    r.tick(T0);
    for (let s = 1; s <= 5; s++) {
      r.sensor('2a5b', csc(s * 5, s * 1024, 0, 0), T0 + s * 1000);
      r.fix(fixAt(s, s * 20, { speed: 20 }));
      r.tick(T0 + s * 1000);
    }
    // wheel total 5 x 5 x 2.105 = 52.6 m although GPS said 100 m
    expect(r.live(T0 + 5000).distanceM).toBeCloseTo(52.6, 0);
    // the sensor goes quiet for good: after the coasting timeout the wheel reads 0 speed, so distance stays; but a ride with no
    // wheel data at all uses the GPS path
    const gpsOnly = new Recorder(config('ride', true));
    gpsOnly.start(T0);
    for (let s = 0; s <= 5; s++) {
      gpsOnly.fix(fixAt(s, s * 10, { speed: 10 }));
      gpsOnly.tick(T0 + s * 1000);
    }
    expect(gpsOnly.live(T0 + 5000).distanceM).toBeGreaterThan(45);
  });

  it('an indoor ride with a power meter and no wheel sensor rides at the speed those watts make on the flat', () => {
    const r = new Recorder(config('indoorRide'));
    r.start(T0);
    for (let s = 0; s <= 60; s++) {
      r.sensor('2a63', bytesToHex(new Uint8Array([0, 0, ...u16(200)])), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 60_000)!;
    const v = virtualSpeedMs(200, 70);
    expect(w.samples[30]!.speed).toBeCloseTo(v, 1);
    expect(w.distanceM).toBeGreaterThan(v * 58);
    expect(w.distanceM).toBeLessThan(v * 62);
    // A wheel sensor, when there is one, still wins.
    const wheel = new Recorder(config('indoorRide'));
    wheel.start(T0);
    wheel.sensor('2a5b', csc(0, 0, 0, 0), T0);
    wheel.tick(T0);
    for (let s = 1; s <= 5; s++) {
      wheel.sensor('2a63', bytesToHex(new Uint8Array([0, 0, ...u16(200)])), T0 + s * 1000);
      wheel.sensor('2a5b', csc(s * 5, s * 1024, 0, 0), T0 + s * 1000);
      wheel.tick(T0 + s * 1000);
    }
    expect(wheel.finish(T0 + 5000)!.distanceM).toBe(Math.round(25 * 2.105));
  });

  it('keeps the mean pedal balance of a power meter that reports it, while pedalling', () => {
    const r = new Recorder(config('indoorRide'));
    r.start(T0);
    // flags 0x0001: pedal power balance in half percent after the power: 97 = 48.5 % left, then 100 = 50 %; the first second is taken before the first reading and a second without watts counts for nothing.
    for (const [s, watts, half] of [[0, 200, 60], [1, 200, 97], [2, 200, 100], [3, 0, 60]] as const) {
      r.sensor('2a63', bytesToHex(new Uint8Array([1, 0, ...u16(watts), half])), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 3000)!;
    expect(w.balanceLeftPct).toBe(49.3);
    const none = new Recorder(config('indoorRide'));
    none.start(T0);
    none.sensor('2a63', bytesToHex(new Uint8Array([0, 0, ...u16(200)])), T0);
    none.tick(T0);
    expect(none.finish(T0)!.balanceLeftPct).toBeNull();
  });

  it('power and a foot pod end up in the sample', () => {
    const r = new Recorder(config('treadmill'));
    r.start(T0);
    r.sensor('2a63', bytesToHex(new Uint8Array([0, 0, ...u16(200)])), T0);
    r.sensor('2a53', bytesToHex(new Uint8Array([0x05, ...u16(768), 160, ...u16(110)])), T0);
    r.tick(T0);
    r.tick(T0 + 4000);
    const w = r.finish(T0 + 4000)!;
    expect(w.samples[2]).toMatchObject({ power: 200, cadence: 160, stride: 1.1, speed: 3 });
    expect(w.avgPower).toBe(200);
    expect(w.normalizedPower).toBe(200);
    // 3 m/s for the 4 seconds after the first sample
    expect(w.distanceM).toBe(12);
    expect(w.steps).toBeGreaterThan(10);
  });
});

describe('restore after a kill', () => {
  it('comes back paused from the last sample with its totals', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    for (let s = 0; s <= 30; s++) {
      r.fix(fixAt(s, s * 3, { speed: 3 }));
      r.sensor('2a37', hr(140), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const samples = r.drainNew();
    const meta = JSON.parse(JSON.stringify(r.meta()));
    const back = Recorder.restore(meta, samples);
    expect(back.status).toBe('paused');
    expect(back.sampleCount).toBe(31);
    expect(back.live(T0 + 600_000).distanceM).toBeCloseTo(r.live(T0 + 30_000).distanceM, 6);
    // time the app was dead is not workout time
    expect(back.movingSec(T0 + 600_000)).toBe(31);
    back.resume(T0 + 600_000);
    back.tick(T0 + 605_000);
    const w = back.finish(T0 + 605_000)!;
    expect(w.samples.length).toBe(31 + 6);
    expect(w.movingSec).toBe(30 + 5);
  });
});

describe('normalizedPower', () => {
  it('is the plain mean under 30 s and weights surges above it', () => {
    expect(normalizedPower([100, 200, 300])).toBe(200);
    const steady = new Array(60).fill(200);
    expect(normalizedPower(steady)).toBe(200);
    const surgy = [...new Array(30).fill(100), ...new Array(30).fill(300)];
    expect(normalizedPower(surgy)).toBeGreaterThan(200);
  });
});

describe('virtual speed from the web game (indoor ride, cadence sensor only)', () => {
  const run = (virtual: boolean, wheel = false) => {
    const r = new Recorder(config('indoorRide'));
    r.start(T0);
    for (let s = 1; s <= 20; s++) {
      if (virtual) r.virtualSpeed(8, T0 + s * 1000);
      if (wheel) r.sensor('2a5b', csc(s * 4, (s * 1024) % 65536, s, (s * 1024) % 65536), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    return r.finish(T0 + 20_000)!;
  };

  it('is the speed and distance of the ride while the game keeps reporting', () => {
    const w = run(true);
    expect(w.distanceM).toBeGreaterThan(150);
    expect(w.distanceM).toBeLessThanOrEqual(8 * 21);
    expect(w.samples.at(-1)!.speed).toBe(8);
  });

  it('stops counting when the game goes quiet for over five seconds', () => {
    const r = new Recorder(config('indoorRide'));
    r.start(T0);
    r.virtualSpeed(8, T0);
    r.tick(T0 + 10_000);
    const w = r.finish(T0 + 10_000)!;
    expect(w.samples.filter((p) => p.speed === 8).length).toBeLessThanOrEqual(6);
    expect(w.samples.at(-1)!.speed).toBeNull();
  });

  it('gives way to a real wheel speed sensor', () => {
    const w = run(true, true);
    expect(w.samples.at(-1)!.speed).not.toBe(8);
  });

  it('does nothing without the game', () => {
    expect(run(false).distanceM).toBe(0);
  });
});

describe("the phone's step counter", () => {
  /** A counter reading at second `sec` of a walk at `spm` steps per minute that began at `from` with `base` steps already counted. */
  const reading = (r: Recorder, sec: number, spm: number, from = 0, base = 0) => r.steps(base + (spm * (sec - from)) / 60, T0 + sec * 1000);

  /** Records `seconds` of 170 spm with a reading per second; the recorder has ticked up to `seconds`. */
  const walk = (sport: RecorderConfig['sport'], seconds: number) => {
    const r = new Recorder(config(sport));
    r.start(T0);
    for (let s = 1; s <= seconds; s++) {
      reading(r, s, 170);
      r.tick(T0 + s * 1000);
    }
    return r;
  };

  it('gives the cadence of a counter that runs at 170 steps per minute', () => {
    const w = walk('run', 20).finish(T0 + 20_000)!;
    // the first seconds have too few readings, from the 5th second on the span is 4 s or more
    expect(w.samples[2]!.cadence).toBeNull();
    expect(w.samples.slice(6).every((p) => p.cadence === 170)).toBe(true);
    expect(w.avgCadence).toBe(170);
    expect(w.maxCadence).toBe(170);
    expect(w.samples.every((p) => p.stride === null)).toBe(true);
  });

  it('counts the steps of the workout from the first reading, and the ones of a pause not at all', () => {
    const r = new Recorder(config('walk'));
    r.start(T0);
    r.steps(1000, T0 + 1000); // baseline
    r.steps(1010, T0 + 2000);
    r.pause(T0 + 3000);
    r.steps(1040, T0 + 4000); // while paused
    r.steps(1070, T0 + 5000);
    r.resume(T0 + 6000);
    r.steps(1075, T0 + 7000);
    r.tick(T0 + 7000);
    const w = r.finish(T0 + 7000)!;
    expect(w.steps).toBe(15);
  });

  it('shows the average and highest heart rate of the recorded seconds and the steps so far, pauses excluded, also after a restore', () => {
    const r = new Recorder(config('run'));
    r.sensor('2a37', hr(120), T0);
    r.start(T0);
    r.steps(0, T0);
    for (let s = 0; s < 10; s++) {
      r.sensor('2a37', hr(s < 5 ? 120 : 160), T0 + s * 1000);
      r.steps(s * 3, T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    r.pause(T0 + 9_000);
    // a peak while paused counts for nothing
    r.sensor('2a37', hr(190), T0 + 12_000);
    r.steps(60, T0 + 12_000);
    const live = r.live(T0 + 12_000);
    expect(live.avgHr).toBe(140);
    expect(live.maxHr).toBe(160);
    expect(live.steps).toBe(27);
    const restored = Recorder.restore(r.meta(), r.drainNew());
    expect(restored.live(T0 + 12_000)).toMatchObject({ avgHr: 140, maxHr: 160, steps: 27 });
  });

  it('ignores readings before start and after finish', () => {
    const r = new Recorder(config('run'));
    r.steps(500, T0 - 1000);
    r.start(T0);
    r.steps(600, T0);
    r.steps(650, T0 + 1000);
    expect(r.finish(T0 + 1000)!.steps).toBe(50);
    r.steps(900, T0 + 5000);
    expect(r.meta().phoneSteps).toBe(50);
  });

  it('lets a running pod win, with the old accumulation of its steps', () => {
    const r = new Recorder(config('run'));
    r.start(T0);
    for (let s = 1; s <= 10; s++) {
      reading(r, s, 120);
      r.sensor('2a53', bytesToHex(new Uint8Array([0x05, ...u16(768), 160, ...u16(110)])), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 10_000)!;
    expect(w.samples.slice(1).every((p) => p.cadence === 160)).toBe(true);
    // 160 spm for 10 seconds, not the 20 steps of the counter
    expect(w.steps).toBe(Math.round((160 / 60) * 10));
  });

  it('starts the baseline over when the counter goes backwards, without taking steps away', () => {
    const r = new Recorder(config('run'));
    r.start(T0);
    r.steps(5000, T0 + 1000);
    r.steps(5100, T0 + 2000);
    r.steps(3, T0 + 3000); // the phone restarted
    r.steps(23, T0 + 4000);
    expect(r.finish(T0 + 4000)!.steps).toBe(120);
  });

  it('has no cadence while only one reading spans less than 4 s, and drops absurd values', () => {
    const r = new Recorder(config('run'));
    r.start(T0);
    r.steps(0, T0 + 1000);
    r.steps(8, T0 + 2000);
    r.tick(T0 + 2000);
    // 480 spm over the 4 s of a glitch: dropped, not clamped
    r.steps(32, T0 + 5000);
    r.steps(40, T0 + 6000);
    r.tick(T0 + 6000);
    const s = r.finish(T0 + 6000)!.samples;
    expect(s[2]!.cadence).toBeNull();
    expect(s[6]!.cadence).toBeNull();
  });

  it('fades to 0 once the counter stops moving, and stays 0 while it runs', () => {
    const r = new Recorder(config('run'));
    r.start(T0);
    for (let s = 1; s <= 6; s++) {
      reading(r, s, 150);
      r.tick(T0 + s * 1000);
    }
    // the person stands still: the counter repeats its value, then says nothing at all
    r.steps(15, T0 + 8000);
    r.steps(15, T0 + 12_000);
    r.tick(T0 + 12_000);
    r.steps(15, T0 + 16_000);
    r.tick(T0 + 16_000);
    r.tick(T0 + 21_000);
    r.tick(T0 + 27_000);
    const s = r.finish(T0 + 27_000)!.samples;
    // held for 8 s after the last step (6 s), fading over the next 4 s
    expect(s[12]!.cadence).toBeGreaterThan(0);
    expect(s[16]!.cadence).toBeLessThan(s[12]!.cadence!);
    expect(s[21]!.cadence).toBe(0);
    expect(s[27]!.cadence).toBe(0);
  });

  it('does nothing for other sports', () => {
    const r = walk('ride', 12);
    const w = r.finish(T0 + 12_000)!;
    expect(w.steps).toBe(0);
    expect(w.samples.every((p) => p.cadence === null)).toBe(true);
    const gym = walk('treadmill', 12).finish(T0 + 12_000)!;
    expect(gym.steps).toBe(0);
    expect(gym.avgCadence).toBeNull();
  });

  it('survives the journal: samples, totals and the baseline over again', () => {
    const r = walk('run', 20);
    const samples = r.drainNew();
    const meta = JSON.parse(JSON.stringify(r.meta()));
    const back = Recorder.restore(meta, samples);
    expect(back.status).toBe('paused');
    // the counter restarted from 0 with the new session; the first reading is the baseline
    back.steps(0, T0 + 100_000);
    back.resume(T0 + 101_000);
    for (let s = 102; s <= 112; s++) {
      reading(back, s, 170, 101);
      back.tick(T0 + s * 1000);
    }
    const w = back.finish(T0 + 112_000)!;
    expect(w.steps).toBe(Math.round((170 / 60) * 19 + (170 / 60) * 11));
    expect(w.avgCadence).toBe(170);
    expect(w.samples[w.samples.length - 1]!.cadence).toBe(170);
  });
});

describe('live elevation gain', () => {
  const run = (alts: number[], extra: (i: number) => Partial<GpsFix> = () => ({})) => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    alts.forEach((alt, i) => r.fix(fixAt(i + 1, (i + 1) * 3, { alt, accuracy: 5, ...extra(i) })));
    return r;
  };

  it('adds nothing for flat noise of +-2 m', () => {
    const r = run(Array.from({ length: 120 }, (_, i) => 100 + (i % 2 === 0 ? 2 : -2)));
    expect(r.live(T0 + 120_000).elevationGainM).toBe(0);
  });

  it('counts a 10 m climb', () => {
    const r = run([...Array(10).fill(100), ...Array.from({ length: 20 }, (_, i) => 100 + (i + 1) / 2), ...Array(30).fill(110)]);
    const live = r.live(T0 + 60_000);
    expect(live.elevationGainM).toBeGreaterThan(8.5);
    expect(live.elevationGainM).toBeLessThanOrEqual(10);
    expect(live.altitudeM).toBe(110);
  });

  it('ignores fixes worse than 30 m', () => {
    const r = run([...Array(10).fill(100), ...Array(30).fill(150)], (i) => (i >= 10 ? { accuracy: 32 } : {}));
    expect(r.live(T0 + 40_000).elevationGainM).toBe(0);
  });

  it('does not count a climb made while paused', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    for (let i = 1; i <= 10; i++) r.fix(fixAt(i, i * 3, { alt: 100, accuracy: 5 }));
    r.pause(T0 + 11_000);
    for (let i = 12; i <= 40; i++) r.fix(fixAt(i, i * 3, { alt: 100 + i, accuracy: 5 }));
    r.resume(T0 + 41_000);
    for (let i = 42; i <= 70; i++) r.fix(fixAt(i, i * 3, { alt: 140, accuracy: 5 }));
    expect(r.live(T0 + 71_000).elevationGainM).toBe(0);
  });
});
