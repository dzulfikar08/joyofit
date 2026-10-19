/** Vectors derived from the frame layout in openScale's ExcelvanCF36xHandler.kt, not a capture (openScale has no Excelvan test). */
import { describe, expect, it } from 'bun:test';
import { EXCELVAN_CF36X, decodeExcelvanFrame, excelvanConfig } from './excelvan';

const ctx = { now: 0, timezoneOffsetMin: 0, user: { heightCm: 180, ageYears: 30, male: true } };
// weight 72.5, fat 21.3, bone 2.6, muscle 40.2, visceral 7, water 55.1, bmr 1500
const FRAME = 'cf000000' + '02d5' + '00d5' + '1a' + '0192' + '07' + '0227' + '05dc';

describe('excelvan cf36x', () => {
  it('writes config (kg, xor over bytes 1..6) then subscribes to fff4', () => {
    expect(excelvanConfig(ctx.user)).toBe('fe010100b41e01ab');
    const step = EXCELVAN_CF36X.createSession(ctx).start([]);
    expect(step.actions).toEqual([
      { op: 'write', service: 'fff0', characteristic: 'fff1', hex: 'fe010100b41e01ab', withResponse: true },
      { op: 'subscribe', service: 'fff0', characteristic: 'fff4' },
    ]);
    expect(excelvanConfig({ ...ctx.user, male: false })).toBe('fe010000b41e01aa');
  });

  it('decodes a 16 byte frame', () => {
    expect(decodeExcelvanFrame(FRAME)).toEqual({
      weightKg: 72.5,
      stable: true,
      unit: 'kg',
      reported: { bodyFatPct: 21.3, boneKg: 2.6, musclePct: 40.2, visceralFat: 7, waterPct: 55.1, bmrKcal: 1500 },
    });
  });

  it('accepts 17 bytes, weight-only frames, and rejects other lengths/headers/zero weight', () => {
    expect(decodeExcelvanFrame(FRAME + '00')?.weightKg).toBe(72.5);
    const weightOnly = 'cf000000' + '02d5' + '00'.repeat(10);
    expect(decodeExcelvanFrame(weightOnly)).toEqual({ weightKg: 72.5, stable: true, unit: 'kg' });
    expect(decodeExcelvanFrame(FRAME.slice(2))).toBeNull();
    expect(decodeExcelvanFrame('ce' + FRAME.slice(2))).toBeNull();
    expect(decodeExcelvanFrame('cf000000' + '0000' + '00'.repeat(10))).toBeNull();
    expect(decodeExcelvanFrame('')).toBeNull();
    expect(decodeExcelvanFrame('zz')).toBeNull();
  });

  it('session emits once, ignores other characteristics and duplicates', () => {
    const s = EXCELVAN_CF36X.createSession(ctx);
    expect(s.onValue('fff0', 'fff1', FRAME, 0).readings).toHaveLength(0);
    const step = s.onValue('fff0', 'fff4', FRAME, 0);
    expect(step.readings).toHaveLength(1);
    expect(step.done).toBe(true);
    expect(s.onValue('fff0', 'fff4', FRAME, 0).readings).toHaveLength(0);
  });

  it('matches the advertised name only', () => {
    expect(EXCELVAN_CF36X.matches({ id: 'x', name: 'Electronic Scale', serviceUuids: [] })).toBe(true);
    expect(EXCELVAN_CF36X.matches({ id: 'x', name: 'electronic scale', serviceUuids: [] })).toBe(true);
    expect(EXCELVAN_CF36X.matches({ id: 'x', name: 'Scale', serviceUuids: [] })).toBe(false);
  });
});
