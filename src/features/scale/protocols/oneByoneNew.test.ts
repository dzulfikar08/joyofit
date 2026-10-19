// No captured vectors exist in openScale for this protocol (OneByoneNewLibTest.kt covers formulas only). Frames below are built from
// the layout documented in OneByoneNewHandler.kt; the handshake bytes are hand-computed from its D7 / D4 checksum rules.
import { describe, expect, it } from 'bun:test';
import { ONE_BY_ONE_NEW_PROTOCOL } from './oneByoneNew';

const NOW = 1_700_000_000_000; // 0x6553F100 s
const USER = { heightCm: 170, ageYears: 30, male: true };

const open = (user = USER) => {
  const s = ONE_BY_ONE_NEW_PROTOCOL.createSession({ user, now: NOW, timezoneOffsetMin: 0 });
  return { started: s.start([]), feed: (hex: string) => s.onValue('ffb0', 'ffb2', hex, NOW) };
};

const frame = (bytes: number[]) => bytes.concat(new Array(20 - bytes.length).fill(0)).map((x) => x.toString(16).padStart(2, '0')).join('');

describe('1byone new', () => {
  it('matches only the exact name', () => {
    const m = (name: string | null) => ONE_BY_ONE_NEW_PROTOCOL.matches({ id: 'x', name, serviceUuids: [] });
    expect(m('1byone scale')).toBe(true);
    expect(m('1BYONE SCALE')).toBe(true);
    expect(m('1byone scale 2')).toBe(false);
    expect(m('Health Scale')).toBe(false);
    expect(m(null)).toBe(false);
  });

  it('handshake: subscribe, D7 weight request, D4 user history', () => {
    const { started } = open();
    expect(started.actions).toEqual([
      { op: 'subscribe', service: 'ffb0', characteristic: 'ffb2' },
      { op: 'write', service: 'ffb0', characteristic: 'ffb1', hex: 'ab2a6553f1000000' + '01aa00009e0000' + '000000' + 'd72b', withResponse: true },
      { op: 'write', service: 'ffb0', characteristic: 'ffb1', hex: 'ab2a0101' + '01aa00009e0000' + '00'.repeat(7) + 'd41f', withResponse: true },
    ]);
  });

  it('final weight 0x80 then impedance 0x01 gives a settled reading', () => {
    const { feed } = open();
    // 72.35 kg = 72350 = 0x011A9E
    const live = feed(frame([0xab, 0x2a, 0x80, 0x01, 0x1a, 0x9e]));
    expect(live.readings).toEqual([{ weightKg: 72.35, stable: false, unit: 'kg' }]);
    const done = feed(frame([0xab, 0x2a, 0x01, 0x00, 0x01, 0xf4]));
    expect(done.readings).toEqual([{ weightKg: 72.35, stable: true, unit: 'kg', impedanceOhm: 500 }]);
    expect(feed(frame([0xab, 0x2a, 0x01, 0x00, 0x01, 0xf4])).readings).toEqual([]);
  });

  it('weight bits above 18 are masked; zero impedance is omitted', () => {
    const { feed } = open();
    feed(frame([0xab, 0x2a, 0x80, 0xfd, 0x1a, 0x9e])); // 0xFD1A9E & 0x3FFFF = 0x11A9E = 72350
    const r = feed(frame([0xab, 0x2a, 0x01, 0x00, 0x00, 0x00])).readings;
    expect(r).toEqual([{ weightKg: 72.35, stable: true, unit: 'kg' }]);
  });

  it('historic frame (type 0 with byte 7 == 0x80) carries epoch time, weight and impedance', () => {
    const { feed } = open();
    const t = [0x65, 0x53, 0xf1, 0x00];
    const r = feed(frame([0xab, 0x2a, 0x00, ...t, 0x80, 0x01, 0x1a, 0x9e, 0, 0, 0, 0, 0x01, 0xf4])).readings;
    expect(r).toEqual([{ weightKg: 72.35, stable: true, unit: 'kg', impedanceOhm: 500, scaleTime: 1_700_000_000_000 }]);
  });

  it('real-time type 0 frames and unknown types are ignored', () => {
    const { feed } = open();
    expect(feed(frame([0xab, 0x2a, 0x00, 1, 2, 3, 4, 0x00])).readings).toEqual([]);
    expect(feed(frame([0xab, 0x2a, 0x55])).readings).toEqual([]);
    expect(feed(frame([0xab, 0x2a, 0x01, 0, 1, 0xf4])).readings).toEqual([]); // impedance without pending weight
  });

  it('never throws on short or garbage input', () => {
    const { feed } = open();
    for (const h of ['', 'ab', 'ab2a', 'ab2a80', 'zz', 'cc'.repeat(20), 'ab2b' + '00'.repeat(18)]) {
      expect(() => feed(h)).not.toThrow();
      expect(feed(h).readings).toEqual([]);
    }
  });
});
