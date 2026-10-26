/**
 * Vectors: the advertisements of the owner's HAN RIVER HRTZC01 (DC:23:53:DC:E1:95, company id 0xD007, company id stripped) recorded
 * 2026-10-20 by the JoyoFit recorder and the Python reference decoder: same sn, same decrypted DP values, same frame layout. The display
 * locked at 108.6 kg and the Tuya cloud's `broadcast_data` DP read 043e009c212100 for the sn 20 / 21 frames.
 * The scale's own local key is a secret and is not in the repo: the ciphertext here is the captured plaintext encrypted with the fake key
 * below (the cipher itself was checked against the real ciphertext with the real key, outside the repo). The head 0x01 idle frames are
 * the scale's own bytes; they do not decrypt under any key.
 */
import { describe, expect, it } from 'bun:test';

import { hexToBytes } from '../../sensors/gatt';
import type { AdFrame, ScaleReading } from '../types';
import { BROADCAST_PROTOCOLS } from './broadcast';
import {
  crc8, parseLocalKey, parseTuyaBeacon, tuyaBeaconProtocol, weightTenths, xxteaDecrypt, xxteaEncrypt,
} from './tuyaBeacon';

const LOCAL_KEY = 'TestKey012345678';
const ID = 'DC:23:53:DC:E1:95';
const ascii = (s: string) => new TextEncoder().encode(s);
const KEY = ascii(LOCAL_KEY);

/** [sn, frame hex, dp1 value hex, kg] */
const REAL: [number, string, string, number][] = [
  [7, '05dc2353dce19500000007568bcacd499aa7e191489b1297acf89c', '0019009c212100', 2.5],
  [9, '05dc2353dce195000000095e5ffe545d6eb0c7c54cb3a32721381f', '043d009c212100', 108.5],
  [10, '05dc2353dce1950000000a113457c3031fed16b820d88f9ba2c094', '043d009c212100', 108.5],
  [16, '05dc2353dce195000000109394e4ad7a7e974d417c205ac1be1873', '0437009c212100', 107.9],
  [17, '05dc2353dce19500000011973590e78716f0662f0d3f3482f9e7dc', '0437009c212100', 107.9],
  [18, '05dc2353dce1950000001209e5f063534a71eeddcf5138b00fd75a', '0437009c212100', 107.9],
  [19, '05dc2353dce19500000013634307f6b1f76cf27e071f7e605a1dc1', '0433009c212100', 107.5],
  [20, '05dc2353dce195000000147ae0e1e1c8536c607b66042e7eac39b1', '043e009c212100', 108.6],
  [21, '05dc2353dce195000000150211f8168321f2c38c7e6b28085eb05a', '043e009c212100', 108.6],
];
const IDLE = [
  '01dc2353dce195000000002637b0ecd953b3f55686724bcab34e92',
  '01dc2353dce195000000013e327042326d45292ce2d8c0f9dbf2c3',
  '01dc2353dce195000000023c6dc2fca65666b9120080164e6f3a73',
];
const FINAL = REAL[7][1];

type Decoder = (frame: AdFrame) => ScaleReading | null;

const frame = (hex: string, ts = 0, id = ID): AdFrame => ({
  id, name: null, rssi: -66, ts, serviceUuids: [], serviceData: {}, manufacturerData: { d007: hex },
});
const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A beacon built the way the scale builds it. */
function forge(sn: number, value: string, key = KEY, head = 0x05): string {
  const body = new Uint8Array(14);
  new DataView(body.buffer).setUint32(0, sn);
  body.set([1, 0, 7, ...hexToBytes(value)], 4);
  const plain = new Uint8Array(16);
  plain.set(body);
  plain[14] = crc8(body);
  const out = new Uint8Array(27);
  out[0] = head;
  out.set([0xdc, 0x23, 0x53, 0xdc, 0xe1, 0x95], 1);
  new DataView(out.buffer).setUint32(7, sn);
  out.set(xxteaEncrypt(plain, key), 11);
  return toHex(out);
}

describe('XXTEA and CRC-8', () => {
  it('round-trips a block', () => {
    const block = Uint8Array.from({ length: 16 }, (_, i) => i);
    expect(xxteaDecrypt(xxteaEncrypt(block, KEY), KEY)).toEqual(block);
    expect(xxteaEncrypt(block, KEY)).not.toEqual(block);
  });
  it('CRC-8/SMBUS check value', () => {
    expect(crc8(ascii('123456789'))).toBe(0xf4);
  });
  it('decrypts a real frame to the sn, the dp1 header, the value and its CRC', () => {
    const plain = xxteaDecrypt(hexToBytes(FINAL).subarray(11), KEY);
    expect(toHex(plain.subarray(0, 4))).toBe('00000014');
    expect(toHex(plain.subarray(4, 7))).toBe('010007');
    expect(toHex(plain.subarray(7, 14))).toBe('043e009c212100');
    expect(plain[14]).toBe(crc8(plain.subarray(0, 14)));
    expect(plain[15]).toBe(0);
  });
});

describe('parseTuyaBeacon (real frames)', () => {
  it.each(REAL)('sn %i decodes to its dp1 value and weight', (sn, hex, value, kg) => {
    const beacon = parseTuyaBeacon(hexToBytes(hex), KEY);
    expect(beacon?.sn).toBe(sn);
    expect(beacon?.mac).toBe(ID);
    expect(toHex(beacon!.value)).toBe(value);
    expect(weightTenths(beacon!.value) / 10).toBe(kg);
  });
  it('the 108.6 kg frame decodes exactly', () => {
    const beacon = parseTuyaBeacon(hexToBytes(FINAL), KEY);
    expect(weightTenths(beacon!.value)).toBe(1086);
  });
  it('rejects a wrong key', () => {
    for (const [, hex] of REAL) expect(parseTuyaBeacon(hexToBytes(hex), ascii('TestKey012345679'))).toBeNull();
    expect(parseTuyaBeacon(hexToBytes(FINAL), ascii('0'.repeat(16)))).toBeNull();
  });
  it('rejects a key of the wrong length', () => {
    expect(parseTuyaBeacon(hexToBytes(FINAL), ascii('short'))).toBeNull();
  });
  it('rejects a damaged ciphertext, sn and CRC alike', () => {
    const bytes = hexToBytes(FINAL);
    for (const index of [7, 10, 11, 18, 26]) {
      const bad = bytes.slice();
      bad[index] ^= 0x01;
      expect(parseTuyaBeacon(bad, KEY)).toBeNull();
    }
  });
  it('rejects a bad CRC even when the sn echoes', () => {
    const body = new Uint8Array(16);
    new DataView(body.buffer).setUint32(0, 5);
    body.set([1, 0, 7, 0x04, 0x3e, 0, 0x9c, 0x21, 0x21, 0], 4);
    body[14] = crc8(body.subarray(0, 14)) ^ 0xff;
    const data = new Uint8Array(27);
    data[0] = 0x05;
    new DataView(data.buffer).setUint32(7, 5);
    data.set(xxteaEncrypt(body, KEY), 11);
    expect(parseTuyaBeacon(data, KEY)).toBeNull();
    body[14] = crc8(body.subarray(0, 14));
    data.set(xxteaEncrypt(body, KEY), 11);
    expect(parseTuyaBeacon(data, KEY)?.sn).toBe(5);
  });
  it('ignores the head 0x01 frames, short data and other heads', () => {
    for (const hex of IDLE) expect(parseTuyaBeacon(hexToBytes(hex), KEY)).toBeNull();
    expect(parseTuyaBeacon(hexToBytes(FINAL).subarray(0, 26), KEY)).toBeNull();
    expect(parseTuyaBeacon(hexToBytes(forge(3, '043e009c212100', KEY, 0x04)), KEY)).toBeNull();
  });
  it('reads a frame built the way the scale builds it', () => {
    const beacon = parseTuyaBeacon(hexToBytes(forge(42, '0bb8001388e800')), KEY);
    expect(beacon && weightTenths(beacon.value)).toBe(3000);
  });
  it('accepts only dp 1 raw with 7 bytes', () => {
    const plain = new Uint8Array(16);
    new DataView(plain.buffer).setUint32(0, 9);
    plain.set([2, 0, 7, 4, 0x3e, 0, 0x9c, 0x21, 0x21, 0], 4);
    plain[14] = crc8(plain.subarray(0, 14));
    const data = new Uint8Array(27);
    data[0] = 0x05;
    new DataView(data.buffer).setUint32(7, 9);
    data.set(xxteaEncrypt(plain, KEY), 11);
    expect(parseTuyaBeacon(data, KEY)).toBeNull();
  });
});

describe('local key', () => {
  it('needs 16 printable ASCII characters; paste whitespace around them is dropped', () => {
    expect(parseLocalKey(LOCAL_KEY)).toBe(LOCAL_KEY);
    expect(parseLocalKey(`  ${LOCAL_KEY}\n`)).toBe(LOCAL_KEY);
    expect(parseLocalKey('TestKey01234567')).toBeNull();
    expect(parseLocalKey(`${LOCAL_KEY}0`)).toBeNull();
    expect(parseLocalKey('TestKey01234567é')).toBeNull();
    expect(parseLocalKey('TestKey0123456\t1')).toBeNull();
    expect(parseLocalKey('')).toBeNull();
    expect(parseLocalKey('a!b#c$d%e^f&g*h(')).toBe('a!b#c$d%e^f&g*h(');
  });
});

describe('Tuya beacon protocol', () => {
  const decoderOf = (): Decoder => tuyaBeaconProtocol.createDecoder!(LOCAL_KEY);
  const feed = (decode: Decoder, hex: string, ts: number): ScaleReading | null => decode(frame(hex, ts));

  it('is weight only, tested on a real scale, and needs a local key', () => {
    expect(tuyaBeaconProtocol).toMatchObject({ id: 'tuya-beacon-broadcast', kind: 'broadcast', weightOnly: true, realScaleTested: true });
    expect(tuyaBeaconProtocol.secret?.kind).toBe('tuya-local-key');
    expect(tuyaBeaconProtocol.secret?.parse({ key: ` ${LOCAL_KEY}` }, 'DC:23:53:DC:E1:95')).toBe(LOCAL_KEY);
  });
  it('claims reading and idle frames of company 0xD007, nothing else', () => {
    expect(tuyaBeaconProtocol.matches(frame(FINAL))).toBe(true);
    expect(tuyaBeaconProtocol.matches(frame(IDLE[0]))).toBe(true);
    expect(tuyaBeaconProtocol.matches(frame(FINAL.slice(0, 52)))).toBe(false);
    expect(tuyaBeaconProtocol.matches(frame(forge(1, '043e009c212100', KEY, 0x04)))).toBe(false);
    expect(tuyaBeaconProtocol.matches({ ...frame(FINAL), manufacturerData: { '20ca': FINAL } })).toBe(false);
  });
  it('is found by the broadcast registry before Scale Up', () => {
    expect(BROADCAST_PROTOCOLS.find((p) => p.kind === 'broadcast' && p.matches(frame(FINAL)))?.id).toBe('tuya-beacon-broadcast');
  });
  it('reads nothing without the key', () => {
    expect(tuyaBeaconProtocol.decode(frame(FINAL))).toBeNull();
  });
  it('a wrong key reads nothing', () => {
    const decode = tuyaBeaconProtocol.createDecoder!('TestKey012345679');
    for (const [, hex] of REAL) expect(feed(decode, hex, 0)).toBeNull();
  });
  it('trims the key it was given', () => {
    expect(tuyaBeaconProtocol.createDecoder!(` ${LOCAL_KEY} `)(frame(FINAL))?.weightKg).toBe(108.6);
  });
  it('gives weight only: no impedance, no body values', () => {
    const reading = feed(decoderOf(), FINAL, 0);
    expect(reading).toEqual({ weightKg: 108.6, stable: false });
  });
  it('the first frame is live; the same value again with a higher sn settles it', () => {
    const decode = decoderOf();
    expect(feed(decode, REAL[7][1], 1_000)).toEqual({ weightKg: 108.6, stable: false });
    expect(feed(decode, REAL[8][1], 18_000)).toEqual({ weightKg: 108.6, stable: true });
  });
  it('the same advertisement again keeps its verdict, live or settled', () => {
    const decode = decoderOf();
    feed(decode, REAL[7][1], 1_000);
    expect(feed(decode, REAL[7][1], 1_300)?.stable).toBe(false);
    expect(feed(decode, REAL[8][1], 18_000)?.stable).toBe(true);
    expect(feed(decode, REAL[8][1], 18_300)?.stable).toBe(true);
  });
  it('follows the captured settling sequence: a changed weight is live again', () => {
    const decode = decoderOf();
    const stable = REAL.slice(3).map(([, hex], i) => feed(decode, hex, i * 20_000)?.stable);
    // 107.9 (16), 107.9 (17), 107.9 (18), 107.5 (19), 108.6 (20), 108.6 (21)
    expect(stable).toEqual([false, true, true, false, false, true]);
  });
  it('marks a second settled weight in the same weigh-in as a revision: 107.9 settles, then 108.6 replaces it', () => {
    const decode = decoderOf();
    const out = REAL.slice(3).map(([, hex], i) => feed(decode, hex, [0, 36_900, 56_000, 126_600, 184_100, 200_900][i]));
    expect(out.map((r) => [r?.weightKg, r?.stable, r?.revision])).toEqual([
      [107.9, false, undefined],
      [107.9, true, undefined],
      [107.9, true, undefined],
      [107.5, false, undefined],
      [108.6, false, undefined],
      [108.6, true, true],
    ]);
  });
  it('a settled weight far from the earlier one (someone else steps on) is a new weigh-in, not a revision', () => {
    const decode = decoderOf();
    feed(decode, forge(40, '0438009c212100'), 0);
    expect(feed(decode, forge(41, '0438009c212100'), 10_000)?.stable).toBe(true);
    feed(decode, forge(42, '0258009c212100'), 20_000);
    expect(feed(decode, forge(43, '0258009c212100'), 30_000)).toEqual({ weightKg: 60, stable: true });
  });
  it('after a silence longer than the weigh-in gap the next settled weight is not a revision', () => {
    const decode = decoderOf();
    feed(decode, REAL[3][1], 0);
    feed(decode, REAL[4][1], 10_000); // 107.9 settles
    feed(decode, REAL[7][1], 200_000);
    expect(feed(decode, REAL[8][1], 210_000)).toEqual({ weightKg: 108.6, stable: true });
  });
  it('session 1: 108.5 kg settles at sn 10', () => {
    const decode = decoderOf();
    expect(feed(decode, REAL[1][1], 0)?.stable).toBe(false);
    expect(feed(decode, REAL[2][1], 9_900)).toEqual({ weightKg: 108.5, stable: true });
  });
  it('the same value after a long silence belongs to a new weigh-in', () => {
    const decode = decoderOf();
    feed(decode, REAL[7][1], 0);
    expect(feed(decode, REAL[8][1], 3 * 60_000)?.stable).toBe(false);
  });
  it('a lower sn (the scale restarted its counter) does not settle', () => {
    const decode = decoderOf();
    feed(decode, REAL[8][1], 0);
    expect(feed(decode, forge(2, '043e009c212100'), 1_000)?.stable).toBe(false);
    expect(feed(decode, forge(3, '043e009c212100'), 2_000)?.stable).toBe(true);
  });
  it('idle frames and the sub-0.5 kg values read nothing; the 2.5 kg noise frame is a (tiny) live reading', () => {
    const decode = decoderOf();
    for (const hex of IDLE) expect(feed(decode, hex, 0)).toBeNull();
    expect(feed(decode, forge(30, '0000009c212100'), 0)).toBeNull();
    expect(feed(decode, REAL[0][1], 0)).toEqual({ weightKg: 2.5, stable: false });
  });
  it('ignores a device that sends no 0xD007 record', () => {
    expect(decoderOf()({ ...frame(FINAL), manufacturerData: {} })).toBeNull();
  });
});
