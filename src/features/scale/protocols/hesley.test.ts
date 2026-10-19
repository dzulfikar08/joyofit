/** Vectors derived from the frame layout in openScale's HesleyHandler.kt, not a capture (openScale has no Hesley test). */
import { describe, expect, it } from 'bun:test';
import { HESLEY, HESLEY_ARM, decodeHesleyFrame } from './hesley';

const ctx = { now: 0, timezoneOffsetMin: 0 };
// weight 72.50, fat 21.3, water 55.1, muscle 40.2, bone 2.6, kcal 1500, body age 53
const FRAME = '0001' + '1c52' + '00d5' + '0000' + '0227' + '0192' + '001a' + '05dc' + '00' + '35' + '0000';

describe('hesley yunchen', () => {
  it('subscribes then writes the arming bytes', () => {
    expect(HESLEY_ARM).toBe('a5012cab505a29');
    expect(HESLEY.createSession(ctx).start([]).actions).toEqual([
      { op: 'subscribe', service: 'fff0', characteristic: 'fff4' },
      { op: 'write', service: 'fff0', characteristic: 'fff1', hex: 'a5012cab505a29', withResponse: true },
    ]);
  });

  it('decodes the 20 byte frame', () => {
    expect(FRAME.length).toBe(40);
    expect(decodeHesleyFrame(FRAME)).toEqual({
      weightKg: 72.5,
      stable: true,
      unit: 'kg',
      reported: { bodyFatPct: 21.3, waterPct: 55.1, musclePct: 40.2, boneKg: 2.6, bodyAge: 53 },
    });
  });

  it('drops out-of-range body age, rejects wrong length / zero weight', () => {
    expect(decodeHesleyFrame(FRAME.slice(0, 34) + '05' + FRAME.slice(36))?.reported?.bodyAge).toBeUndefined();
    expect(decodeHesleyFrame(FRAME.slice(2))).toBeNull();
    expect(decodeHesleyFrame('0001' + '0000' + '00'.repeat(16))).toBeNull();
    expect(decodeHesleyFrame('')).toBeNull();
    expect(decodeHesleyFrame('qq')).toBeNull();
  });

  it('session reports done on the frame', () => {
    const s = HESLEY.createSession(ctx);
    expect(s.onValue('fff0', 'fff1', FRAME, 0).readings).toHaveLength(0);
    const step = s.onValue('fff0', 'fff4', FRAME, 0);
    expect(step.readings).toHaveLength(1);
    expect(step.done).toBe(true);
  });

  it('matches yunchen case-insensitively', () => {
    expect(HESLEY.matches({ id: 'x', name: 'YunChen', serviceUuids: [] })).toBe(true);
    expect(HESLEY.matches({ id: 'x', name: 'yunchen2', serviceUuids: [] })).toBe(false);
  });
});
