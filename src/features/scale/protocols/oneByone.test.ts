// Vectors from openScale OneByoneHandlerTest.kt / ScaleCatalog.kt (olie.xdev, GPL-3.0-or-later).
import { describe, expect, it } from 'bun:test';
import { hexToBytes } from '../../sensors/gatt';
import type { GattStep } from '../types';
import {
  EUFY_ONE_BY_ONE_PROTOCOL,
  ONE_BY_ONE_CLASSIC_PROTOCOL,
  hasHistoryTimestamp,
  isFinalReading,
  isLiveFrame,
} from './oneByone';

const h = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const bytes = (s: string) => hexToBytes(h(s));

const SINGLE_1016 = 'CF 50 0F B0 27 10 13 51 00 00 55';
const SINGLE_1014 = 'CF 60 0E 9C 27 04 02 F0 00 00 EC';
const COALESCED_1016 = 'CF 32 0F B0 27 FD F7 0D 00 00 62 CF 32 0F B0 27 FD F7 0D 00';
const COALESCED_1014A = 'CF 6A 0E 9C 27 60 64 68 00 00 7C CF 6A 0E 9C 27 60 64 68 00';
const COALESCED_1014B = 'CF 92 0E 9C 27 1D 13 5F 00 00 B9 CF 92 0E 9C 27 1D 13 5F 00';
const COALESCED_1027 = 'CF 76 0C 1E 28 DF D6 07 01 00 8C CF 76 0C 1E 28 DF D6 07 01';
const ZERO_IMPEDANCE = 'CF 00 00 28 28 00 00 00 01 00 CE';
const SOCKS = 'CF 00 00 3C 28 00 00 00 01 00 DA';
const BAREFOOT = 'CF B6 0D 3C 28 B4 B5 99 01 00 F9 CF B6 0D 3C 28 B4 B5 99 01';
const HISTORIC = 'CF 60 0E 9C 27 04 02 F0 00 00 11 07 EA 08 0C 09 0B 2B';
const NOW = 1_700_000_000_000; // 2023-11-14 22:13:20 UTC

const open = (p = ONE_BY_ONE_CLASSIC_PROTOCOL, tz = 0) => {
  const s = p.createSession({ now: NOW, timezoneOffsetMin: tz });
  const started = s.start([]);
  return { started, feed: (x: string): GattStep => s.onValue('fff0', 'fff4', h(x), NOW) };
};

describe('one-by-one frame predicates (OneByoneHandlerTest)', () => {
  const live = [SINGLE_1016, SINGLE_1014, COALESCED_1016, COALESCED_1014A, COALESCED_1014B, COALESCED_1027];

  it('captured frames carry a valid XOR checksum', () => {
    for (const f of [...live, ZERO_IMPEDANCE, SOCKS, BAREFOOT]) expect(isLiveFrame(bytes(f))).toBe(true);
  });
  it('coalesced duplicates are not history', () => {
    for (const f of [COALESCED_1016, COALESCED_1014A, COALESCED_1014B, COALESCED_1027, BAREFOOT]) {
      expect(bytes(f).length).toBeGreaterThanOrEqual(18);
      expect(hasHistoryTimestamp(bytes(f))).toBe(false);
    }
    expect(hasHistoryTimestamp(bytes(SINGLE_1016))).toBe(false);
  });
  it('a genuine history frame is history (checksum collision too)', () => {
    expect(isLiveFrame(bytes(HISTORIC))).toBe(false);
    expect(hasHistoryTimestamp(bytes(HISTORIC))).toBe(true);
    expect(hasHistoryTimestamp(bytes('CF 60 0E 9C 27 04 02 F0 00 00 EC 07 EA 08 0C 09 0B 2B'))).toBe(true);
  });
  it('final readings: 0x00 and 0x36 only', () => {
    for (const f of live) expect(isFinalReading(bytes(f))).toBe(true);
    expect(isFinalReading(bytes('CF 50 0F B0 27 10 13 51 00 36 63'))).toBe(true);
    expect(isFinalReading(bytes('CF 50 0F B0 27 10 13 51 00 01 54'))).toBe(false);
    expect(isFinalReading(bytes('CF 50 0F B0 27 10 13 51 00 02 57'))).toBe(false);
    expect(isFinalReading(new Uint8Array(4))).toBe(false);
  });
  it('rejects truncated and corrupted frames', () => {
    expect(isLiveFrame(bytes('CF 50 0F B0 27'))).toBe(false);
    expect(isLiveFrame(new Uint8Array(0))).toBe(false);
    expect(isLiveFrame(bytes('CF 50 0F B0 27 10 13 51 00 00 FF'))).toBe(false);
  });
});

describe('one-by-one matching (ScaleCatalog + OneByoneHandlerTest)', () => {
  const m = (p: typeof ONE_BY_ONE_CLASSIC_PROTOCOL, name: string | null) => p.matches({ id: 'x', name, serviceUuids: [] });
  it('Health Scale variants go to the 1byone rules only', () => {
    for (const n of ['Health Scale', 'health scale', '1byone Health Scale']) {
      expect(m(ONE_BY_ONE_CLASSIC_PROTOCOL, n)).toBe(true);
      expect(m(EUFY_ONE_BY_ONE_PROTOCOL, n)).toBe(false);
    }
  });
  it('Eufy T9146 / T9147 / T9120 go to the Eufy rules only', () => {
    for (const n of ['eufy T9146', 'eufy T9147', 'eufy T9120']) {
      expect(m(EUFY_ONE_BY_ONE_PROTOCOL, n)).toBe(true);
      expect(m(ONE_BY_ONE_CLASSIC_PROTOCOL, n)).toBe(false);
    }
    expect(m(EUFY_ONE_BY_ONE_PROTOCOL, 'eufy T9148')).toBe(false);
    expect(m(EUFY_ONE_BY_ONE_PROTOCOL, null)).toBe(false);
    expect(m(ONE_BY_ONE_CLASSIC_PROTOCOL, '')).toBe(false);
  });
});

describe('one-by-one session', () => {
  it('handshake: subscribe FFF4, FD37 mode command, F1 clock (local time, BE year)', () => {
    const { started } = open(ONE_BY_ONE_CLASSIC_PROTOCOL, 0);
    expect(started.actions).toEqual([
      { op: 'subscribe', service: 'fff0', characteristic: 'fff4' },
      { op: 'write', service: 'fff0', characteristic: 'fff1', hex: 'fd370001000000000000cb', withResponse: true },
      { op: 'write', service: 'fff0', characteristic: 'fff1', hex: 'f107e70b0e160d14', withResponse: true },
    ]);
    // +7h: 2023-11-15 05:13:20
    const hex = open(ONE_BY_ONE_CLASSIC_PROTOCOL, 420).started.actions[2];
    expect(hex).toMatchObject({ hex: 'f107e70b0f050d14' });
  });

  it('1byone: settled frame publishes weight + impedance once', () => {
    const { feed } = open();
    expect(feed(SINGLE_1016).readings).toEqual([{ weightKg: 101.6, stable: true, unit: 'kg', impedanceOhm: 392 }]);
    expect(feed(SINGLE_1016).readings).toEqual([]);
  });

  it('1byone: coalesced frame still yields its impedance (102.70 kg / 319 ohm)', () => {
    expect(open().feed(COALESCED_1027).readings).toEqual([{ weightKg: 102.7, stable: true, unit: 'kg', impedanceOhm: 319 }]);
  });

  it('1byone: settled zero-impedance frame is a plain weight', () => {
    expect(open().feed(ZERO_IMPEDANCE).readings).toEqual([{ weightKg: 102.8, stable: true, unit: 'kg' }]);
  });

  it('socks and barefoot agree on weight (103.00 kg), differ in impedance (none vs 351)', () => {
    expect(open().feed(SOCKS).readings[0]).toEqual({ weightKg: 103, stable: true, unit: 'kg' });
    expect(open().feed(BAREFOOT).readings[0]).toEqual({ weightKg: 103, stable: true, unit: 'kg', impedanceOhm: 351 });
  });

  it('1byone: in-progress status gives a live reading without impedance and does not consume the final one', () => {
    const { feed } = open();
    const live = feed('CF 50 0F B0 27 10 13 51 00 01 54');
    expect(live.readings).toEqual([{ weightKg: 101.6, stable: false, unit: 'kg' }]);
    expect(feed(SINGLE_1016).readings[0].stable).toBe(true);
  });

  it('Eufy: status 1 is live, no impedance is discarded, settled with impedance publishes', () => {
    const { feed } = open(EUFY_ONE_BY_ONE_PROTOCOL);
    expect(feed('CF 50 0F B0 27 10 13 51 00 01 54').readings[0].stable).toBe(false);
    expect(feed(ZERO_IMPEDANCE).readings).toEqual([]);
    expect(feed(SINGLE_1016).readings).toEqual([{ weightKg: 101.6, stable: true, unit: 'kg', impedanceOhm: 392 }]);
  });

  it('clock ACK triggers history request; history records carry local-time scaleTime; end clears the scale', () => {
    const { feed } = open(ONE_BY_ONE_CLASSIC_PROTOCOL, 420);
    const ack = feed('F1 00');
    expect(ack.actions).toEqual([{ op: 'write', service: 'fff0', characteristic: 'fff1', hex: 'f200', withResponse: true }]);
    const rec = feed(HISTORIC);
    expect(rec.readings).toEqual([
      { weightKg: 101.4, stable: true, unit: 'kg', impedanceOhm: 368, scaleTime: Date.UTC(2026, 7, 12, 9, 11, 43) - 420 * 60_000 },
    ]);
    const end = feed('F2 00');
    expect(end.actions).toEqual([{ op: 'write', service: 'fff0', characteristic: 'fff1', hex: 'f201', withResponse: true }]);
    expect(feed('F2 00').actions).toEqual([]);
  });

  it('empty history is not cleared', () => {
    const { feed } = open();
    feed('F1 00');
    expect(feed('F2 00').actions).toEqual([]);
  });

  it('history record with an impossible date is dropped', () => {
    const { feed } = open();
    feed('F1 00');
    expect(feed('CF 60 0E 9C 27 04 02 F0 00 00 11 07 EA 02 1E 09 0B 2B').readings).toEqual([]);
  });

  it('F1 00 without a pending clock request is ignored; other characteristics ignored', () => {
    const { feed } = open();
    feed('F1 00');
    expect(feed('F1 00').actions).toEqual([]);
    const s = ONE_BY_ONE_CLASSIC_PROTOCOL.createSession({ now: NOW, timezoneOffsetMin: 0 });
    expect(s.onValue('180f', '2a19', '5a', NOW).readings).toEqual([]);
  });

  it('never throws on short or garbage input', () => {
    const { feed } = open();
    for (const f of ['', 'cf', 'cf5000', 'cf50 0fb0 27', 'zz', 'ffffffffffffffffffffffffffffffffffffffff', 'f1', 'f2']) {
      expect(() => feed(f)).not.toThrow();
      expect(feed(f).readings).toEqual([]);
    }
  });
});
