// Vectors from openScale QNHandlerProtocolTest.kt / QNHandlerMatchTest.kt (olie.xdev, GPL-3.0-or-later).
import { describe, expect, it } from 'bun:test';
import { bytesToHex } from '../../sensors/gatt';
import type { DiscoveredService, GattStep } from '../types';
import { QN_PROTOCOL } from './qn';

const NOW = 1_700_000_000_000;
const USER = { heightCm: 181, ageYears: 40, male: true };

const T2: DiscoveredService[] = [
  {
    uuid: 'fff0',
    characteristics: [
      { uuid: 'fff1', properties: ['notify'] },
      { uuid: 'fff2', properties: ['write'] },
    ],
  },
];
const T1: DiscoveredService[] = [
  {
    uuid: 'ffe0',
    characteristics: [
      { uuid: 'ffe1', properties: ['notify'] },
      { uuid: 'ffe2', properties: ['indicate'] },
      { uuid: 'ffe3', properties: ['write'] },
      { uuid: 'ffe4', properties: ['write'] },
    ],
  },
];

function open(services: DiscoveredService[] = T2, user = USER) {
  const s = QN_PROTOCOL.createSession({ user, now: NOW, timezoneOffsetMin: 0 });
  const started = s.start(services);
  const feed = (hex: string, svc = services[0].uuid, chr = services[0].characteristics[0].uuid): GattStep =>
    s.onValue(svc, chr, hex, NOW);
  return { s, started, feed };
}

const writes = (step: GattStep): string[] => step.actions.flatMap((a) => (a.op === 'write' ? [a.hex] : []));
const chars = (step: GattStep): string[] => step.actions.map((a) => a.characteristic);

// openScale QNHandlerProtocolTest: real capture of the GE CS 10 G "Fit Plus" (BD_ADDR placeholder, checksum recomputed).
const INFO_FF = '1212ff112233445566130710000105' + '9f3289';
const STATE0 = '100fff' + 'fe0021570000000000000094';
const STATE1 = '100fff' + 'fe0121570000000000000095';
const STATE2 = '100fff' + 'fe022157' + '10fe10fc00ac005c';

describe('qn matching (QNHandlerMatchTest)', () => {
  const m = (name: string | null, ...serviceUuids: string[]) => QN_PROTOCOL.matches({ id: 'x', name, serviceUuids });
  it('claims ae00 + fff0 with a non-QN name', () => expect(m('Fit Plus', 'ae00', 'fff0')).toBe(true));
  it('does not claim a bare fff0 device with an unrelated name', () => expect(m('Unrelated Scale', 'fff0')).toBe(false));
  it('claims Fit Plus advertising only ffe0', () => expect(m('Fit Plus', 'ffe0')).toBe(true));
  it('does not claim ae00 without ffe0/fff0', () => expect(m('Fit Plus', 'ae00')).toBe(false));
  it('claims QN-Scale + fff0', () => expect(m('QN-Scale', 'fff0')).toBe(true));
  it('claims QN-Scale + ffe0 (catalog) and accepts full-form UUIDs', () => {
    expect(m('QN-Scale', 'ffe0')).toBe(true);
    expect(m('QN-Scale', '0000ffe0-0000-1000-8000-00805f9b34fb')).toBe(true);
  });
  it('claims RENPHO-SCALE and SEB-Scale only with QN services', () => {
    expect(m('RENPHO-SCALE-1234', 'ffe0')).toBe(true);
    expect(m('RENPHO-SCALE-1234')).toBe(false);
    expect(m('SEB-Scale', 'fff0')).toBe(true);
  });
  it('handles a missing name', () => expect(m(null, 'ffe0')).toBe(false));
});

describe('qn session', () => {
  it('subscribes to the layouts it finds', () => {
    expect(open(T2).started.actions).toEqual([{ op: 'subscribe', service: 'fff0', characteristic: 'fff1' }]);
    expect(chars(open(T1).started)).toEqual(['ffe1', 'ffe2']);
  });

  it('0xFF family: 0x12 triggers config with real profile + time magic', () => {
    const { feed } = open();
    expect(writes(feed(INFO_FF))).toEqual(['1309ff0110b5280009', '023067e62c']);
    // only once
    expect(feed(INFO_FF).actions).toEqual([]);
  });

  it('classic protocolType: config carries zero height/age/gender', () => {
    const { feed } = open();
    const classicInfo = '12 0f 07 00 00 00 00 00 00 00 01 00 00 00 00'.replace(/ /g, '');
    // 0x13 0x09 0x07 unit=1 light=0x10 0 0 0 sum
    expect(writes(feed(classicInfo))[0]).toBe('1309070110000000' + ((19 + 9 + 7 + 1 + 16) & 0xff).toString(16).padStart(2, '0'));
  });

  it('config goes to both layouts when both are present', () => {
    const { feed } = open([...T1, ...T2], USER);
    const out = writes(feed(INFO_FF, 'fff0', 'fff1'));
    expect(out).toHaveLength(4);
  });

  it('real hardware: states 0/1 are live only, state 2 publishes 85.35 kg / 435 ohm and is acked', () => {
    const { feed } = open();
    feed(INFO_FF);
    for (const f of [STATE0, STATE1]) {
      const step = feed(f);
      expect(step.readings.every((r) => !r.stable)).toBe(true);
      expect(writes(step)).toEqual([]);
    }
    const step = feed(STATE2);
    expect(step.readings).toEqual([{ weightKg: 85.35, stable: true, unit: 'kg', impedanceOhm: 435 }]);
    expect(writes(step)).toEqual(['1f05ff1033']);
    // repeated stable frame: acked again, not published twice
    const again = feed(STATE2);
    expect(again.readings).toEqual([]);
    expect(writes(again)).toEqual(['1f05ff1033']);
  });

  it('classic frame 70.00 kg, no 0x1F ack for other protocol types', () => {
    const { feed } = open();
    const step = feed('100a07' + '1b58' + '01' + '01f4' + '01f4');
    expect(step.readings).toEqual([{ weightKg: 70, stable: true, unit: 'kg', impedanceOhm: 500 }]);
    expect(step.actions).toEqual([]);
  });

  it('classic factor-100 frame with low weight byte 0x00 is not read as ES-30M (71.68 kg)', () => {
    const { feed } = open();
    feed('120f07' + '0000000000000001' + '0000' + '0000'.slice(0, 0));
    const step = feed('100a07' + '1c00' + '01' + '01f4' + '01f4');
    expect(step.readings[0]).toMatchObject({ weightKg: 71.68, stable: true });
  });

  it('classic ES-30M type (factor 10): state 1 counts as stable', () => {
    const { feed } = open();
    feed('120f07' + '00'.repeat(7) + '00' + '0000'); // byte10 == 0 -> factor 10
    const step = feed('100e07' + 'fe01' + '2157' + '00000000' + '000000');
    expect(step.readings).toEqual([{ weightKg: 85.35, stable: true, unit: 'kg' }]);
  });

  it('0x14 answers with the 0x20 time sync, echoing the protocol type', () => {
    const { feed } = open();
    feed(STATE0); // captures protocol type 0xff
    expect(writes(feed('1405ff0000'))).toEqual(['2008ff3067e62cd0']);
  });

  it('0x21 answers with both 0xA0 frames then the stored-data query', () => {
    const { feed } = open();
    feed(STATE0);
    expect(writes(feed('2110ff'))).toEqual(['a00d04fe0000000000000000af', 'a00d02010008002106b804029d', '2206ff00032a']);
  });

  it('0x21 falls back to FFE3 on a layout-1 scale', () => {
    const { feed, s } = open(T1);
    const step = s.onValue('ffe0', 'ffe1', '2110ff', NOW);
    expect(step.actions.every((a) => a.op === 'write' && a.characteristic === 'ffe3')).toBe(true);
    expect(feed).toBeDefined();
  });

  it('stored 0x23 record: weight BE/100, resistance LE, vendor clock', () => {
    const { feed } = open();
    const sessionS = Math.floor(NOW / 1000) - 946_702_800;
    const t = sessionS + 5;
    const le = [t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, (t >>> 24) & 0xff];
    const frame = [0x23, 0x11, 0x07, 0, 0, 0, ...le, 0x1b, 0x58, 0, 0xf4, 0x01, 0, 0];
    const step = feed(bytesToHex(Uint8Array.from(frame)));
    expect(step.readings).toEqual([
      { weightKg: 70, stable: true, unit: 'kg', impedanceOhm: 500, scaleTime: (t + 946_702_800) * 1000 },
    ]);
  });

  it('stored record older than the session is rejected', () => {
    const { feed } = open();
    const t = Math.floor(NOW / 1000) - 946_702_800 - 1000;
    const le = [t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, (t >>> 24) & 0xff];
    const frame = [0x23, 0x11, 0x07, 0, 0, 0, ...le, 0x1b, 0x58, 0, 0xf4, 0x01, 0, 0];
    expect(feed(bytesToHex(Uint8Array.from(frame))).readings).toEqual([]);
  });

  it('never throws on short or garbage input', () => {
    const { feed } = open();
    for (const h of ['', '10', '1005', '100a07', '1010', '10ffff00', '12', '1205ff', '23', '2305ff', 'zz', '0000', '14']) {
      expect(() => feed(h)).not.toThrow();
    }
    expect(feed('10').readings).toEqual([]);
    expect(feed('abcdef').actions).toEqual([]);
    expect(open().s.onValue('180f', '2a19', '5a', NOW).readings).toEqual([]);
  });
});
