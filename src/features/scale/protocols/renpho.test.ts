// openScale has no vectors for RenphoHandler (ScaleCatalog.kt lists only the name "RENPHO-SCALE-1234"); the weight frame is built
// from the layout documented in RenphoHandler.kt: 2E <raw lo> <raw hi>, kg = raw / 20. Copyright (C) olie.xdev, GPL-3.0-or-later.
import { describe, expect, it } from 'bun:test';
import { RENPHO_PROTOCOL } from './renpho';
import { QN_PROTOCOL } from './qn';

const NOW = 1_700_000_000_000; // Tuesday 2023-11-14 22:13:20 UTC
const open = (user?: { heightCm: number; ageYears: number; male: boolean }) => {
  const s = RENPHO_PROTOCOL.createSession({ user, now: NOW, timezoneOffsetMin: 0 });
  return { started: s.start([]), feed: (hex: string) => s.onValue('181d', '2a9d', hex, NOW) };
};
const writes = (actions: ReturnType<typeof open>['started']['actions']) =>
  actions.flatMap((a) => (a.op === 'write' ? [`${a.service}/${a.characteristic}:${a.hex}`] : []));

describe('renpho', () => {
  it('matches RENPHO-SCALE names without QN services (QNHandler owns those)', () => {
    const info = (name: string | null, ...serviceUuids: string[]) => ({ id: 'x', name, serviceUuids });
    expect(RENPHO_PROTOCOL.matches(info('RENPHO-SCALE-1234'))).toBe(true);
    expect(RENPHO_PROTOCOL.matches(info('RENPHO-SCALE-1234', 'ffe0'))).toBe(false);
    expect(RENPHO_PROTOCOL.matches(info('RENPHO-SCALE-1234', 'fff0'))).toBe(false);
    expect(QN_PROTOCOL.matches(info('RENPHO-SCALE-1234', 'ffe0'))).toBe(true);
    expect(RENPHO_PROTOCOL.matches(info('Other'))).toBe(false);
    expect(RENPHO_PROTOCOL.matches(info(null))).toBe(false);
  });

  it('handshake: time, magic frames, consent, user profile, then measurement subscriptions', () => {
    const { started } = open({ heightCm: 181, ageYears: 40, male: false });
    expect(writes(started.actions)).toEqual([
      '1805/2a2b:e7070b0e160d140200' + '00',
      '181b/ffe2:10010011',
      '181b/ffe2:03000104',
      '181c/2a9f:02aa0f27',
      '181c/2a8c:01',
      '181c/2a8e:b500',
      '181c/2a80:28',
      '181c/2aff:0300',
    ]);
    expect(started.actions.slice(0, 4).every((a) => a.op === 'subscribe')).toBe(true);
    expect(started.actions.at(-1)).toEqual({ op: 'subscribe', service: '181b', characteristic: '2a9c' });
    expect(started.actions.at(-2)).toEqual({ op: 'subscribe', service: '181d', characteristic: '2a9d' });
    expect(started.actions.at(-3)).toEqual({ op: 'read', service: '181b', characteristic: '2a9b' });
  });

  it('without a user, only the time and vendor handshake are written', () => {
    expect(writes(open().started.actions)).toHaveLength(4);
  });

  it('decodes 2E frames: raw / 20 kg', () => {
    const { feed } = open();
    expect(feed('2e7805').readings).toEqual([{ weightKg: 70, stable: true, unit: 'kg' }]);
    expect(feed('2e1f05').readings[0].weightKg).toBe(65.55);
  });

  it('ignores other frame types, zero weight, other characteristics; never throws', () => {
    const { feed } = open();
    for (const h of ['', '2e', '2e78', '2f7805', '2e0000', 'zz']) {
      expect(() => feed(h)).not.toThrow();
      expect(feed(h).readings).toEqual([]);
    }
    const s = RENPHO_PROTOCOL.createSession({ now: NOW, timezoneOffsetMin: 0 });
    expect(s.onValue('181b', '2a9c', '2e7805', NOW).readings).toEqual([]);
  });
});
