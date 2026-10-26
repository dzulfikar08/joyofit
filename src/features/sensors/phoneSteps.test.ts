import { describe, expect, test } from 'bun:test';

import { PHONE_CADENCE_FADE_MS, PHONE_STEPS_HOLD_MS, PHONE_STEPS_MAX_HOLD_MS, PhoneStepCount } from './phoneSteps';

const T0 = 1_760_000_000_000;
const s = (seconds: number) => T0 + seconds * 1000;

/** The cadence at every whole second from `from` to `to` (inclusive). */
const cadences = (steps: PhoneStepCount, from: number, to: number) => {
  const out: (number | null)[] = [];
  for (let t = from; t <= to; t++) out.push(steps.cadence(s(t)));
  return out;
};

describe('PhoneStepCount: steps and cadence from the cumulative counter', () => {
  test('steps per minute over the last seconds', () => {
    const steps = new PhoneStepCount();
    steps.reading(1000, s(0), true);
    steps.reading(1015, s(5), true);
    steps.reading(1030, s(10), true);
    // 30 steps in 10 s
    expect(steps.cadence(s(10))).toBe(180);
    expect(steps.total).toBe(30);
  });

  test('a steady counter, one reading a second at 120 spm, reads 120 over a 20 s window', () => {
    const steps = new PhoneStepCount();
    for (let t = 0; t <= 60; t++) steps.reading(2 * t, s(t), true);
    expect(cadences(steps, 5, 60).every((c) => c === 120)).toBe(true);
    expect(steps.total).toBe(120);
  });

  test('a single reading or two too close together give no cadence', () => {
    const steps = new PhoneStepCount();
    steps.reading(0, s(0), true);
    expect(steps.cadence(s(0))).toBeNull();
    steps.reading(5, s(2), true);
    expect(steps.cadence(s(2))).toBeNull();
    steps.reading(15, s(6), true);
    expect(steps.cadence(s(6))).toBe(150);
  });

  test('above 260 per minute is a glitch, not a cadence', () => {
    const steps = new PhoneStepCount();
    steps.reading(0, s(0), true);
    steps.reading(100, s(5), true);
    expect(steps.cadence(s(5))).toBeNull();
  });

  test('steps of a pause are skipped, and a counter that starts over keeps what was counted', () => {
    const steps = new PhoneStepCount();
    steps.reading(0, s(0), true);
    steps.reading(50, s(20), true);
    steps.pause();
    steps.reading(80, s(40), false);
    expect(steps.total).toBe(50);
    steps.reading(90, s(45), true);
    expect(steps.total).toBe(60);
    steps.reading(3, s(50), true);
    steps.reading(13, s(55), true);
    expect(steps.total).toBe(70);
  });
});

describe('PhoneStepCount: a counter that reports late and in bursts (Xiaomi, JRG-418 device report)', () => {
  test('+24 steps every 12 s, a real 120 spm, reads 120 between the bursts, never 0', () => {
    const steps = new PhoneStepCount();
    for (let k = 0; k <= 10; k++) steps.reading(24 * k, s(12 * k), true);
    // from the second burst on (two readings), at every second up to the next burst
    const between = cadences(steps, 120, 131);
    expect(between.every((c) => c === 120)).toBe(true);
    // the hold learnt the counter's 12 s between reports: half again as long
    expect(steps.holdMs(s(120))).toBe(18_000);
  });

  test('the same bursts read 120 at each second as they arrive', () => {
    const steps = new PhoneStepCount();
    const seen: (number | null)[] = [];
    for (let t = 0; t <= 120; t++) {
      if (t % 12 === 0) steps.reading(2 * t, s(t), true);
      seen.push(steps.cadence(s(t)));
    }
    // null until the second burst gives a span, 120 from then on
    expect(seen.slice(0, 12).every((c) => c === null)).toBe(true);
    expect(seen.slice(12).every((c) => c === 120)).toBe(true);
  });

  test('a batch held back for 30 s (the sensor hub of a sleeping phone) reads 120 at each second, from the sensor times', () => {
    const steps = new PhoneStepCount();
    const seen: (number | null)[] = [];
    let sent = 0;
    for (let t = 0; t <= 150; t++) {
      // every 30 s the phone delivers the steps of the last 30 s at once, each step at its own time (two a second)
      if (t > 0 && t % 30 === 0) {
        for (; sent <= 2 * t; sent++) steps.reading(sent, s(0) + sent * 500, true, s(t));
      }
      seen.push(steps.cadence(s(t)));
    }
    expect(seen.slice(0, 30).every((c) => c === null)).toBe(true);
    expect(seen.slice(30).every((c) => c === 120)).toBe(true);
    // what it waited for: half again the 30 s a step took to arrive
    expect(steps.holdMs(s(150))).toBe(45_000);
  });

  test('a counter 10 s late on every step reads the right cadence once its steps arrive', () => {
    const steps = new PhoneStepCount();
    const seen: (number | null)[] = [];
    for (let t = 0; t <= 60; t++) {
      // the step taken at t - 10 arrives at t
      if (t >= 10) steps.reading(2 * (t - 10), s(t - 10), true, s(t));
      seen.push(steps.cadence(s(t)));
    }
    expect(seen.slice(15).every((c) => c === 120)).toBe(true);
  });
});

describe('PhoneStepCount: a stop, a stand and a pause', () => {
  test('a stop holds the cadence for 8 s, fades it to 0 and reads 0 while the counter runs', () => {
    const steps = new PhoneStepCount();
    for (let t = 0; t <= 30; t++) steps.reading(2 * t, s(t), true);
    const hold = PHONE_STEPS_HOLD_MS / 1000;
    const fade = PHONE_CADENCE_FADE_MS / 1000;
    expect(steps.cadence(s(30 + hold))).toBe(120);
    const fading = steps.cadence(s(30 + hold + fade / 2));
    expect(fading).toBe(60);
    expect(steps.cadence(s(30 + hold + fade))).toBe(0);
    expect(steps.cadence(s(30 + 600))).toBe(0);
  });

  test('the repeated value of a counter standing still counts as no step', () => {
    const steps = new PhoneStepCount();
    for (let t = 1; t <= 6; t++) steps.reading(2.5 * t, s(t), true);
    steps.reading(15, s(8), true);
    steps.reading(15, s(12), true);
    steps.reading(15, s(16), true);
    expect(steps.cadence(s(6 + 8))).toBeGreaterThan(0);
    expect(steps.cadence(s(21))).toBe(0);
    expect(steps.cadence(s(27))).toBe(0);
  });

  test('a stand is not a slow counter: after 30 s at a crossing the next stop still reads 0 within 12 s', () => {
    const steps = new PhoneStepCount();
    for (let t = 0; t <= 20; t++) steps.reading(2 * t, s(t), true);
    // stands from 20 to 50 s, the first step after it at 50 s
    for (let t = 50; t <= 80; t++) steps.reading(40 + 2 * (t - 50) + 1, s(t), true);
    expect(steps.holdMs(s(80))).toBe(PHONE_STEPS_HOLD_MS);
    expect(steps.cadence(s(80))).toBe(120);
    expect(steps.cadence(s(92))).toBe(0);
  });

  test('after a stand longer than a minute the window starts over: no cadence of the minute standing', () => {
    const steps = new PhoneStepCount();
    for (let t = 0; t <= 20; t++) steps.reading(2 * t, s(t), true);
    expect(steps.cadence(s(100))).toBe(0);
    // walks again at 120 spm from 100 s
    const walk = (t: number) => steps.reading(40 + 2 * (t - 100) + 2, s(t), true);
    walk(100);
    expect(steps.cadence(s(100))).toBeNull();
    for (let t = 101; t <= 104; t++) walk(t);
    expect(steps.cadence(s(104))).toBe(120);
    expect(PHONE_STEPS_MAX_HOLD_MS).toBeLessThan(80_000);
  });

  test('a pause shows no cadence, and the steps of the pause never enter the cadence after it', () => {
    const steps = new PhoneStepCount();
    for (let t = 0; t <= 20; t++) steps.reading(2 * t, s(t), true);
    expect(steps.cadence(s(20))).toBe(120);
    steps.pause();
    expect(steps.cadence(s(21))).toBeNull();
    // walks fast during the pause: 50 steps in 10 s
    for (let t = 21; t <= 30; t++) steps.reading(40 + 5 * (t - 20), s(t), false);
    expect(steps.cadence(s(30))).toBeNull();
    expect(steps.total).toBe(40);
    // resumed at 31 s, walking at 120 spm again: a cadence once two readings are 4 s apart
    for (let t = 31; t <= 33; t++) steps.reading(90 + 2 * (t - 30), s(t), true);
    expect(steps.cadence(s(33))).toBeNull();
    for (let t = 34; t <= 40; t++) steps.reading(90 + 2 * (t - 30), s(t), true);
    expect(steps.cadence(s(40))).toBe(120);
    expect(steps.total).toBe(60);
  });
});

describe("PhoneStepCount: the pedometer's own cadence (iOS)", () => {
  test('wins over the window when the newest reading has it, and fades with the same hold', () => {
    const steps = new PhoneStepCount();
    steps.reading(0, s(0), true, s(0), 110);
    expect(steps.cadence(s(0))).toBe(110);
    steps.reading(4, s(2), true, s(2), 116);
    expect(steps.cadence(s(3))).toBe(116);
    expect(steps.cadence(s(2 + 8))).toBe(116);
    expect(steps.cadence(s(2 + 12))).toBe(0);
  });

  test('without it the window gives the cadence, and a 0 from the pedometer is no cadence', () => {
    const steps = new PhoneStepCount();
    steps.reading(0, s(0), true, s(0), 0);
    steps.reading(10, s(5), true, s(5), null);
    expect(steps.cadence(s(5))).toBe(120);
  });
});
