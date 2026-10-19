/** Vectors derived from the frame layout in openScale's InlifeHandler.kt, not a capture (openScale has no Inlife test). */
import { describe, expect, it } from 'bun:test';
import { INLIFE, decodeInlifeFrame, inlifeCommand } from './inlife';

const ctx = { now: 0, timezoneOffsetMin: 0, user: { heightCm: 180, ageYears: 30, male: true } };

/** Received frame: `02 cmd p2..p11 xor aa`. */
function rx(cmd: number, params: number[]): string {
  return inlifeCommand(cmd, ...params);
}

describe('inlife', () => {
  it('writes the user block after subscribing', () => {
    const step = INLIFE.createSession(ctx).start([]);
    expect(step.actions[0]).toEqual({ op: 'subscribe', service: 'fff0', characteristic: 'fff1' });
    expect(step.actions[1]).toEqual({
      op: 'write',
      service: 'fff0',
      characteristic: 'fff2',
      hex: '02d2010001' + '1eb4' + '0000000000' + '78' + 'aa',
      withResponse: true,
    });
  });

  it('live weight frame is unstable', () => {
    const r = decodeInlifeFrame(rx(0xd8, [0x02, 0xd0]));
    expect(r?.reading).toEqual({ weightKg: 72, stable: false, unit: 'kg' });
    expect(r?.final).toBe(false);
  });

  it('new result frame carries weight and impedance', () => {
    const r = decodeInlifeFrame(rx(0xdd, [0x02, 0xd0, 0, 0, 0x01, 0xf4, 0, 0, 0, 0x80]));
    expect(r?.reading).toEqual({ weightKg: 72, stable: true, unit: 'kg', impedanceOhm: 500 });
  });

  it('legacy result frame reports lean body mass', () => {
    // weight 72.0, LBM 0x00AFC8 = 45000 g
    const r = decodeInlifeFrame(rx(0xdd, [0x02, 0xd0, 0x00, 0xaf, 0xc8, 0x01, 0xf4, 0, 0, 0x00]));
    expect(r?.reading).toEqual({ weightKg: 72, stable: true, unit: 'kg', reported: { leanKg: 45 } });
  });

  it('legacy "feet not placed" sentinel yields nothing', () => {
    expect(decodeInlifeFrame(rx(0xdd, [0x02, 0xd0, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('session finishes after the result and drops duplicates', () => {
    const s = INLIFE.createSession(ctx);
    const f = rx(0xdd, [0x02, 0xd0, 0, 0, 0x01, 0xf4, 0, 0, 0, 0x81]);
    const step = s.onValue('fff0', 'fff1', f, 0);
    expect(step.readings).toHaveLength(1);
    expect(step.done).toBe(true);
    expect(step.actions[0].op === 'write' && step.actions[0].hex).toBe('02d4' + '00'.repeat(10) + 'd4aa');
    expect(s.onValue('fff0', 'fff1', f, 0).readings).toHaveLength(0);
  });

  it('rejects bad checksum, wrong length, garbage', () => {
    const f = rx(0xd8, [0x02, 0xd0]);
    expect(decodeInlifeFrame(f.slice(0, 24) + '00' + 'aa')).toBeNull();
    expect(decodeInlifeFrame(f.slice(2))).toBeNull();
    expect(decodeInlifeFrame('')).toBeNull();
    expect(decodeInlifeFrame('xyz')).toBeNull();
  });

  it('matches names case-insensitively', () => {
    expect(INLIFE.matches({ id: 'x', name: '000FatScale01', serviceUuids: [] })).toBe(true);
    expect(INLIFE.matches({ id: 'x', name: '042fatscale01', serviceUuids: [] })).toBe(true);
    expect(INLIFE.matches({ id: 'x', name: null, serviceUuids: [] })).toBe(false);
  });
});
