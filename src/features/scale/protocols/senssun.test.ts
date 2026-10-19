/** Vectors derived from the frame layout in openScale's SenssunHandler.kt, not a capture (openScale has no Senssun test). */
import { describe, expect, it } from 'bun:test';
import { bytesToHex } from '../../sensors/gatt';
import type { DiscoveredService } from '../types';
import { SENSSUN, senssunDateMessage, senssunTimeMessage, senssunUserMessage } from './senssun';

// 2025-03-05 13:45:09 local (UTC+7) => 06:45:09 UTC
const NOW = Date.UTC(2025, 2, 5, 6, 45, 9);
const ctx = { now: NOW, timezoneOffsetMin: 420, user: { heightCm: 175, ageYears: 41, male: true } };
const svcA: DiscoveredService = { uuid: 'fff0', characteristics: [] };
const svcB: DiscoveredService = { uuid: 'ffb0', characteristics: [] };

/** `FF A5 [v1 BE] [v2 BE] [type]` notification with trailing padding. */
function rx(type: number, v1: number, v2: number): string {
  return bytesToHex(Uint8Array.from([0xff, 0xa5, v1 >> 8, v1 & 255, v2 >> 8, v2 & 255, type, 0, 0, 0]));
}

describe('senssun handshake', () => {
  it('date: year 25, day-of-year 64, checksum = sum of bytes 1..6', () => {
    // 0x30 + 0x19 + 0x00 + 0x40 = 0x89
    expect(senssunDateMessage(NOW, 420)).toBe('a530190040' + '0000' + '89' + '00');
  });
  it('time: 13:45:09', () => {
    // 0x31 + 13 + 45 + 9 = 0x31+0x0d+0x2d+0x09 = 0x74
    expect(senssunTimeMessage(NOW, 420)).toBe('a5310d2d09' + '0000' + '74' + '00');
  });
  it('user: male id 1 => 0xF1', () => {
    // 0x10 + 0xF1 + 41 + 175 = 0x10+0xf1+0x29+0xaf = 0x1d9 -> 0xd9
    expect(senssunUserMessage(ctx.user)).toBe('a510f129af' + '0000' + 'd9' + '00');
    expect(senssunUserMessage({ ...ctx.user, male: false }).slice(4, 6)).toBe('01');
  });
  it('start picks the discovered model, writing date then time', () => {
    const step = SENSSUN.createSession(ctx).start([svcB]);
    expect(step.actions.map((a) => [a.op, a.service, a.characteristic])).toEqual([
      ['subscribe', 'ffb0', 'ffb2'],
      ['write', 'ffb0', 'ffb2'],
      ['write', 'ffb0', 'ffb2'],
    ]);
    const a = SENSSUN.createSession(ctx).start([svcA]);
    expect(a.actions[0]).toEqual({ op: 'subscribe', service: 'fff0', characteristic: 'fff1' });
    expect(a.actions[1].op === 'write' && a.actions[1].characteristic).toBe('fff2');
  });
  it('unknown layout subscribes to both', () => {
    expect(SENSSUN.createSession(ctx).start([]).actions.filter((a) => a.op === 'subscribe')).toHaveLength(2);
  });
});

describe('senssun measurement', () => {
  it('live frames are unstable, stable frame sends the user, results complete the reading', () => {
    const s = SENSSUN.createSession(ctx);
    s.start([svcA]);
    // live 72.4 kg
    expect(s.onValue('fff0', 'fff1', rx(0xa0, 724, 0), 0).readings).toEqual([{ weightKg: 72.4, stable: false, unit: 'kg' }]);
    // stable 72.5
    const stable = s.onValue('fff0', 'fff1', rx(0xaa, 725, 0), 0);
    expect(stable.readings).toHaveLength(0);
    expect(stable.actions).toHaveLength(1);
    expect(stable.actions[0].op === 'write' && stable.actions[0].hex).toBe('a510f129af0000d900');
    // later live-looking frames are ignored
    expect(s.onValue('fff0', 'fff1', rx(0xa0, 800, 0), 0).readings).toHaveLength(0);
    // fat 21.3, water 55.1
    expect(s.onValue('fff0', 'fff1', rx(0xb0, 213, 551), 0).done).toBeUndefined();
    // muscle 40.2, bone: bytes 3,4 swapped => b3=0x1a,b4=0x00 => 0x001a = 2.6
    expect(s.onValue('fff0', 'fff1', rx(0xc0, 402, 0x1a00), 0).done).toBeUndefined();
    const end = s.onValue('fff0', 'fff1', rx(0xd0, 1500, 0), 0);
    expect(end.done).toBe(true);
    expect(end.readings).toEqual([
      { weightKg: 72.5, stable: true, unit: 'kg', reported: { bodyFatPct: 21.3, waterPct: 55.1, musclePct: 40.2, boneKg: 2.6 } },
    ]);
  });

  it('fat test error after a stable weight still returns the weight', () => {
    const s = SENSSUN.createSession(ctx);
    s.start([svcA]);
    s.onValue('fff0', 'fff1', rx(0xaa, 725, 0), 0);
    const end = s.onValue('fff0', 'fff1', rx(0xbe, 0, 0), 0);
    expect(end.done).toBe(true);
    expect(end.readings).toEqual([{ weightKg: 72.5, stable: true, unit: 'kg' }]);
  });

  it('never throws on garbage', () => {
    const s = SENSSUN.createSession(ctx);
    for (const h of ['', 'ff', 'ffa5', 'ffa5000000', 'a5000000000000', 'zz', 'ffa500000000bb00']) {
      expect(s.onValue('fff0', 'fff1', h, 0).readings).toHaveLength(0);
    }
  });

  it('matches only SENSSUN FAT', () => {
    expect(SENSSUN.matches({ id: 'x', name: 'SENSSUN FAT', serviceUuids: [] })).toBe(true);
    expect(SENSSUN.matches({ id: 'x', name: 'Senssun', serviceUuids: [] })).toBe(false);
  });
});
