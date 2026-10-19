/** Vectors derived from the frame layout in openScale's ExingtechY1Handler.kt, not a capture (openScale has no Exingtech test). */
import { describe, expect, it } from 'bun:test';
import { EXINGTECH_Y1, decodeExingtechFrame, exingtechUserBlock } from './exingtech';

const SERVICE = 'f433bd80-75b8-11e2-97d9-0002a5d5c51b';
const NOTIFY = '1a2ea400-75b9-11e2-be05-0002a5d5c51b';
const CMD = '29f11080-75b9-11e2-8bf6-0002a5d5c51b';
const ctx = { now: 0, timezoneOffsetMin: 0, user: { heightCm: 165, ageYears: 28, male: false } };
// weight 72.5, fat 21.3, water 55.1, bone 2.6, muscle 40.2, visceral 7
const FULL = '00000000' + '02d5' + '00d5' + '0227' + '001a' + '0192' + '07' + '00'.repeat(5);
const WEIGHT_ONLY = '00000000' + '02d5' + 'ff'.repeat(2) + '00'.repeat(12);

describe('exingtech y1', () => {
  it('subscribes then writes the user block', () => {
    expect(exingtechUserBlock(ctx.user)).toBe('1001011ca5');
    expect(EXINGTECH_Y1.createSession(ctx).start([]).actions).toEqual([
      { op: 'subscribe', service: SERVICE, characteristic: NOTIFY },
      { op: 'write', service: SERVICE, characteristic: CMD, hex: '100101' + '1c' + 'a5', withResponse: true },
    ]);
    expect(exingtechUserBlock({ ...ctx.user, male: true })).toBe('1001001ca5');
  });

  it('weight-only frame is a live reading, the full frame is final', () => {
    expect(FULL.length).toBe(40);
    expect(decodeExingtechFrame(WEIGHT_ONLY)).toEqual({ weightKg: 72.5, stable: false, unit: 'kg' });
    expect(decodeExingtechFrame(FULL)).toEqual({
      weightKg: 72.5,
      stable: true,
      unit: 'kg',
      reported: { bodyFatPct: 21.3, waterPct: 55.1, boneKg: 2.6, musclePct: 40.2, visceralFat: 7 },
    });
    const s = EXINGTECH_Y1.createSession(ctx);
    expect(s.onValue(SERVICE, NOTIFY, WEIGHT_ONLY, 0).done).toBeUndefined();
    expect(s.onValue(SERVICE, NOTIFY, FULL, 0).done).toBe(true);
  });

  it('never throws on short or odd data', () => {
    for (const h of ['', 'zz', '00', FULL.slice(2), '00'.repeat(20)]) expect(decodeExingtechFrame(h)).toBeNull();
    expect(EXINGTECH_Y1.createSession(ctx).onValue(SERVICE, CMD, FULL, 0).readings).toHaveLength(0);
  });

  it('matches by name or service uuid', () => {
    expect(EXINGTECH_Y1.matches({ id: 'x', name: 'VScale', serviceUuids: [] })).toBe(true);
    expect(EXINGTECH_Y1.matches({ id: 'x', name: null, serviceUuids: [SERVICE] })).toBe(true);
    expect(EXINGTECH_Y1.matches({ id: 'x', name: 'Other', serviceUuids: ['fff0'] })).toBe(false);
  });
});
