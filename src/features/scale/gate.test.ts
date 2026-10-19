import { describe, expect, it } from 'bun:test';

import { DEDUPE_MS, ReadingGate } from './gate';
import type { ScaleReading } from './types';

const stable = (weightKg: number, extra: Partial<ScaleReading> = {}): ScaleReading => ({ weightKg, stable: true, ...extra });
const live = (weightKg: number): ScaleReading => ({ weightKg, stable: false });

describe('ReadingGate', () => {
  it('shows unstable frames live and never saves them', () => {
    const gate = new ReadingGate({ repeats: 1 });
    expect(gate.push(live(60.2), 0)).toEqual({ live: live(60.2) });
    expect(gate.push(live(72.9), 100).final).toBeUndefined();
  });

  it('makes a final at once for a connected scale (repeats 1)', () => {
    const gate = new ReadingGate({ repeats: 1 });
    expect(gate.push(stable(73.5), 0)).toEqual({ final: stable(73.5) });
  });

  it('needs equal stable frames in a row for a broadcast scale (repeats 2)', () => {
    const gate = new ReadingGate({ repeats: 2 });
    expect(gate.push(stable(73.5), 0).final).toBeUndefined();
    expect(gate.push(stable(73.5), 100).final).toEqual(stable(73.5));
  });

  it('restarts the run when the weight changes between stable frames', () => {
    const gate = new ReadingGate({ repeats: 2 });
    gate.push(stable(73.5), 0);
    expect(gate.push(stable(74.1), 100).final).toBeUndefined();
    expect(gate.push(stable(74.1), 200).final).toEqual(stable(74.1));
  });

  it('an unstable frame in between breaks the run', () => {
    const gate = new ReadingGate({ repeats: 2 });
    gate.push(stable(73.5), 0);
    gate.push(live(73.6), 50);
    expect(gate.push(stable(73.5), 100).final).toBeUndefined();
  });

  it('dedupes the same weight within two minutes, accepts it afterwards', () => {
    const gate = new ReadingGate({ repeats: 1 });
    expect(gate.push(stable(73.5), 0).final).toBeDefined();
    expect(gate.push(stable(73.5), 1_000).final).toBeUndefined();
    expect(gate.push(stable(73.54), DEDUPE_MS - 1).final).toBeUndefined();
    expect(gate.push(stable(73.5), DEDUPE_MS + 1).final).toBeDefined();
  });

  it('a different weight within two minutes is a new weigh-in', () => {
    const gate = new ReadingGate({ repeats: 1 });
    gate.push(stable(73.5), 0);
    expect(gate.push(stable(60.1), 5_000).final).toEqual(stable(60.1));
  });

  it('completes the saved weigh-in when impedance arrives with the same weight', () => {
    const gate = new ReadingGate({ repeats: 1 });
    gate.push(stable(73.5), 0);
    const out = gate.push(stable(73.5, { impedanceOhm: 480 }), 2_000);
    expect(out.upgrade).toBe(true);
    expect(out.final?.impedanceOhm).toBe(480);
    expect(gate.push(stable(73.5, { impedanceOhm: 480 }), 3_000)).toEqual({});
  });

  it('ignores implausible weights', () => {
    const gate = new ReadingGate({ repeats: 1 });
    expect(gate.push(stable(0), 0)).toEqual({});
    expect(gate.push(stable(4.2), 0)).toEqual({});
    expect(gate.push(stable(450), 0)).toEqual({});
    expect(gate.push(stable(Number.NaN), 0)).toEqual({});
  });

  it('reset starts a fresh run but keeps the dedupe memory', () => {
    const gate = new ReadingGate({ repeats: 2 });
    gate.push(stable(73.5), 0);
    gate.push(stable(73.5), 10);
    gate.reset();
    expect(gate.push(stable(73.5), 20).final).toBeUndefined();
    expect(gate.push(stable(73.5), 30).final).toBeUndefined(); // run complete again, but deduped
  });
});
