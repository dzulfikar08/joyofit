/**
 * Vectors ported from openScale (oliexdev/openScale, GPL-3.0-or-later) at 87edad4813e400cd4871109fc72a0bcf4d13f336:
 * android_app/app/src/test/java/com/health/openscale/core/bluetooth/libs/HuaweiHagridWspLibTest.kt. Copyright (C) 2026 openScale
 * contributors.
 *
 * Left out on purpose: that test's "Scale 3 PoC capture" derives a root key from a real C1 / C2 pair and a real address. Those are a
 * scale's keys, and JoyoFit never carries keys. What is kept from that capture: its five frames (the CRCs of three phone writes and two
 * scale notifications are checked) and the realtime measurement decrypted under the capture's work key, a random session key the phone
 * chose. The root-key derivation, the auth token and AES-CTR are checked against node:crypto with made-up keys instead.
 */
import { describe, expect, it } from 'bun:test';
import { createCipheriv, createHash, createHmac } from 'node:crypto';

import { bytesToHex, hexToBytes } from '../../sensors/gatt';
import {
  buildAuthTokenPayload,
  buildManagerInfoPayload,
  buildUserInfoPayload,
  buildWriteFrames,
  c3FromBluetoothAddress,
  concat,
  crc16,
  crc16Modbus,
  currentTimePayload,
  decryptPayload,
  deriveRootKey,
  encryptedPayloadWithIv,
  expectedAuthResponsePayload,
  extractProductMarker,
  FRAME_NOTIFY_PLAIN,
  FrameAccumulator,
  hasValidNotificationCrc,
  historyDedupeKey,
  isHistoryComplete,
  isValidAuthResponsePayload,
  parseHistoryMeasurement,
  parseManagerInfo,
  parseProductInfo,
  parseRealtimeMeasurement,
  parseScaleVersion,
  parseStandardWeightMeasurement,
  parseWeightUnit,
  productProfileForMarker,
  representativeHighOhm,
  representativeLowOhm,
} from './hagridLib';

const seq = (start: number, length = 16): Uint8Array => Uint8Array.from({ length }, (_, i) => (i + start) & 0xff);

/** openScale's `toNotifyFrame`: a phone frame re-stamped as a plain scale notification (prefix BD, CRC-16/MODBUS). */
function toNotifyFrame(writeFrame: Uint8Array): Uint8Array {
  const frame = writeFrame.slice();
  frame[0] = FRAME_NOTIFY_PLAIN;
  const crc = crc16Modbus(frame.subarray(0, frame.length - 2));
  frame[frame.length - 2] = crc & 0xff;
  frame[frame.length - 1] = crc >>> 8;
  return frame;
}

const framePayload = (frameHex: string): Uint8Array => {
  const frame = hexToBytes(frameHex);
  return frame.slice(3, frame.length - 2);
};

/** realtimePayload() of the openScale test: 77.32 kg, 18.5 %, 2026-06-22 15:14:42, low 500..505, hr 72, high 600..605. */
const REALTIME = Uint8Array.from([
  0x34, 0x1e, 0xb9, 0x00, 0xea, 0x07, 0x06, 0x16, 0x0f, 0x0e, 0x2a, 0x00, 0xf4, 0x01, 0xf5, 0x01, 0xf6, 0x01, 0xf7, 0x01, 0xf8, 0x01, 0xf9,
  0x01, 0x48, 0x00, 0x58, 0x02, 0x59, 0x02, 0x5a, 0x02, 0x5b, 0x02, 0x5c, 0x02, 0x5d, 0x02,
]);
const history = (completeFlag = 0x00): Uint8Array => concat(REALTIME, Uint8Array.of(0x01, completeFlag));

/** The openScale PoC capture (HUAWEI Scale 3): the work key write, then the realtime notification. */
const POC_WORK_KEY_WRITES = ['dc12203b033efce70954e24a3a06ac75603b418e', 'dc12218a68cb34e5250a6c185813b62e6958c13f', 'dc0522a49ddc06'];
const POC_REALTIME_NOTIFIES = ['cd1220ddae5ad500d352ad002d9ab60055a313f1', 'cd12216d4c5b1e4fa529d8fc4225d8db8b3726b3', 'cd0f222285c5b012308c6ee4a7829efa52'];
const POC_WORK_KEY = '36697370363671706d64386733696b62';

describe('Hagrid WSP framing', () => {
  it('write frames reassemble from notification frames (openScale)', () => {
    const payload = seq(0, 40);
    const frames = buildWriteFrames(payload);
    const accumulator = new FrameAccumulator();
    expect(frames).toHaveLength(3);
    expect(accumulator.ingest(toNotifyFrame(frames[0]))).toBeNull();
    expect(accumulator.ingest(toNotifyFrame(frames[1]))).toBeNull();
    expect(accumulator.ingest(toNotifyFrame(frames[2]))).toEqual(payload);
  });

  it('drops an orphan continuation frame before a packet start (openScale)', () => {
    const a = buildWriteFrames(seq(1, 26));
    const b = buildWriteFrames(seq(101, 26));
    const accumulator = new FrameAccumulator();
    expect(accumulator.ingest(toNotifyFrame(a[1]))).toBeNull();
    expect(accumulator.ingest(toNotifyFrame(b[0]))).toBeNull();
    expect(accumulator.ingest(toNotifyFrame(b[1]))).toEqual(seq(101, 26));
  });

  it('starts over when a new frame index 0 arrives (openScale)', () => {
    const a = buildWriteFrames(seq(11, 26));
    const b = buildWriteFrames(seq(41, 26));
    const accumulator = new FrameAccumulator();
    expect(accumulator.ingest(toNotifyFrame(a[0]))).toBeNull();
    expect(accumulator.ingest(toNotifyFrame(b[0]))).toBeNull();
    expect(accumulator.ingest(toNotifyFrame(b[1]))).toEqual(seq(41, 26));
  });

  it('an empty message is one 5-byte frame; frames never exceed 20 bytes', () => {
    const [empty] = buildWriteFrames(new Uint8Array(0));
    expect(empty.length).toBe(5);
    expect(bytesToHex(empty.subarray(0, 3))).toBe('db0300');
    expect(crc16(Uint8Array.of(0xdb, 0x03, 0x00, 0, 0))).toBe(empty[3] | (empty[4] << 8));
    expect(Math.max(...buildWriteFrames(seq(0, 100)).map((f) => f.length))).toBe(20);
  });

  it('the CRCs of the captured frames: CRC-16 (0x1021, init 0) over the write frame with its CRC zeroed, CRC-16/MODBUS on notifications', () => {
    for (const hex of POC_WORK_KEY_WRITES) {
      const frame = hexToBytes(hex);
      const zeroed = frame.slice();
      zeroed.set([0, 0], frame.length - 2);
      expect(crc16(zeroed)).toBe(frame[frame.length - 2] | (frame[frame.length - 1] << 8));
    }
    // The message rebuilt from its payload is the captured frames, byte for byte.
    const rebuilt = buildWriteFrames(concat(...POC_WORK_KEY_WRITES.map(framePayload)), true).map(bytesToHex);
    expect(rebuilt).toEqual(POC_WORK_KEY_WRITES);
    for (const hex of POC_REALTIME_NOTIFIES) expect(hasValidNotificationCrc(hexToBytes(hex))).toBe(true);
    const damaged = hexToBytes(POC_REALTIME_NOTIFIES[0]);
    damaged[5] ^= 1;
    expect(hasValidNotificationCrc(damaged)).toBe(false);
  });
});

describe('Hagrid authentication and encryption', () => {
  const randA = seq(0);
  const randB = seq(16);
  const cak = seq(32);

  it('auth token is randB + 32 bytes and the expected answer validates, also with a trailing status byte (openScale)', () => {
    const token = buildAuthTokenPayload(randA, randB, cak);
    const answer = expectedAuthResponsePayload(randA, randB, cak);
    expect(token.subarray(0, 16)).toEqual(randB);
    expect(token).toHaveLength(48);
    expect(answer).toHaveLength(32);
    expect(isValidAuthResponsePayload(answer, randA, randB, cak)).toBe(true);
    expect(isValidAuthResponsePayload(concat(answer, Uint8Array.of(0)), randA, randB, cak)).toBe(true);
    expect(isValidAuthResponsePayload(answer.subarray(0, 31), randA, randB, cak)).toBe(false);
  });

  it('auth token = HMAC-SHA256(rand, HMAC-SHA256(rand, CAK | "1123")), checked against node:crypto', () => {
    const rand = Buffer.concat([randA, randB]);
    const inner = createHmac('sha256', Buffer.concat([cak, Buffer.from('1123')])).update(rand).digest();
    const outer = createHmac('sha256', inner).update(rand).digest();
    expect(bytesToHex(buildAuthTokenPayload(randA, randB, cak).subarray(16))).toBe(outer.toString('hex'));
    const innerAnswer = createHmac('sha256', Buffer.concat([cak, Buffer.from('9856')])).update(rand).digest();
    expect(bytesToHex(expectedAuthResponsePayload(randA, randB, cak))).toBe(createHmac('sha256', innerAnswer).update(rand).digest('hex'));
  });

  it('an encrypted payload round trips with its IV in front (openScale)', () => {
    const plaintext = new TextEncoder().encode('hagrid-user-profile');
    const key = seq(4);
    const iv = seq(80);
    const encrypted = encryptedPayloadWithIv(plaintext, key, iv);
    expect(encrypted.subarray(0, 16)).toEqual(iv);
    expect(decryptPayload(encrypted, key)).toEqual(plaintext);
    const node = createCipheriv('aes-128-ctr', key, iv).update(plaintext);
    expect(bytesToHex(encrypted.subarray(16))).toBe(node.toString('hex'));
  });

  it('C3 is the address in upper-case ASCII plus "0000"; the root key matches a node:crypto computation (made-up keys)', () => {
    expect(new TextDecoder().decode(c3FromBluetoothAddress('0c:95:41:6e:9e:50'))).toBe('0C95416E9E500000');
    expect(() => c3FromBluetoothAddress('F94E2300-DE49-926E-4EEA-6288AAF9A621')).toThrow();
    const c1 = seq(80);
    const c2 = seq(96);
    const c3 = c3FromBluetoothAddress('0C:95:41:6E:9E:50');
    const sha16 = (data: Uint8Array) => createHash('sha256').update(data).digest().subarray(0, 16);
    const keyData = sha16(c1.map((v, i) => ((v << 4) ^ c2[i]) & 0xff));
    const expected = sha16(keyData.map((v, i) => (v >>> 6) ^ c3[i]));
    expect(bytesToHex(deriveRootKey(c1, c2, c3))).toBe(Buffer.from(expected).toString('hex'));
  });

  it('the captured Scale 3 realtime notification decrypts under its work key to 86.25 kg, 30.1 %, 97 bpm (openScale PoC)', () => {
    const encrypted = concat(...POC_REALTIME_NOTIFIES.map(framePayload));
    const plain = decryptPayload(encrypted, hexToBytes(POC_WORK_KEY));
    expect(bytesToHex(plain)).toBe('b1212d01ea07080917271da0ea13000000000000000000006100');
    const m = parseRealtimeMeasurement(plain, 0);
    expect(m).not.toBeNull();
    expect(m!.weightKg).toBeCloseTo(86.25, 4);
    expect(m!.fatPercent).toBeCloseTo(30.1, 4);
    expect(m!.heartRateBpm).toBe(97);
    expect(new Date(m!.timestamp!).toISOString()).toBe('2026-08-09T23:39:29.000Z');
  });
});

describe('Hagrid payloads', () => {
  it('realtime payload parses the low and high impedance bands (openScale)', () => {
    const m = parseRealtimeMeasurement(REALTIME)!;
    expect(m.weightKg).toBeCloseTo(77.32, 4);
    expect(m.fatPercent).toBeCloseTo(18.5, 4);
    expect(m.heartRateBpm).toBe(72);
    expect(m.lowFrequencyImpedance).toEqual([500, 501, 502, 503, 504, 505]);
    expect(m.highFrequencyImpedance).toEqual([600, 601, 602, 603, 604, 605]);
    expect(representativeLowOhm(m)).toBe(500);
    expect(representativeHighOhm(m)).toBe(600);
  });

  it('history payload parses the time in the phone zone and the terminal flag (openScale)', () => {
    const m = parseHistoryMeasurement(history(0x00), 420)!;
    expect(new Date(m.timestamp!).toISOString()).toBe('2026-06-22T08:14:42.000Z'); // 15:14:42 at UTC+7
    expect(isHistoryComplete(m)).toBe(true);
    expect(historyDedupeKey(m)).not.toBe('');
    expect(isHistoryComplete(parseHistoryMeasurement(history(0x01))!)).toBe(false);
  });

  it('realtime with an invalid time still parses; history with one is rejected (openScale)', () => {
    const realtime = REALTIME.slice();
    realtime.set([0, 0, 0], 4);
    const m = parseRealtimeMeasurement(realtime)!;
    expect(m.timestamp).toBeNull();
    expect(m.weightKg).toBeGreaterThan(0);
    const old = history();
    old.set([0, 0, 0], 4);
    expect(parseHistoryMeasurement(old)).toBeNull();
    expect(parseRealtimeMeasurement(REALTIME.subarray(0, 30))).toBeNull();
  });

  it('standard weight measurement parses kilograms (openScale)', () => {
    expect(parseStandardWeightMeasurement(Uint8Array.of(0x00, 0x8c, 0x3c))!.weightKg).toBeCloseTo(77.5, 4);
  });

  it('user info has the fixed 69-byte layout (openScale)', () => {
    const payload = buildUserInfoPayload({ huid: 'openscale:001122334455', uid: 'u:00000007', gender: 1, ageYears: 26, heightCm: 171, weightKg: 83.2 });
    expect(payload).toHaveLength(69);
    expect([payload[62], payload[63], payload[64], payload[65], payload[66], payload[67]]).toEqual([1, 26, 171, 0, 0x80, 0x20]);
  });

  it('manager info round trips; product info, version and unit decode', () => {
    expect(parseManagerInfo(buildManagerInfoPayload('4200000000000001', 'c55f8f03-1111-4222-8333-aabbccddee49'))).toMatchObject({
      huid: '4200000000000001',
      deviceId: 'c55f8f03-1111-4222-8333-aabbccddee49',
      accountInfo: null,
    });
    expect(parseManagerInfo(new Uint8Array(0))).toMatchObject({ huid: '' });
    expect(parseProductInfo(new TextEncoder().encode('M0CJ7'))).toMatchObject({ smartProductId: 'M0CJ', variant: '7' });
    expect(parseScaleVersion(Uint8Array.of(0x00, 0x20, 0x00, 0x46, 0x41, 0x42))?.version).toBe('2.0.0.17');
    expect(parseWeightUnit(Uint8Array.of(0x01))?.label).toBe('kg');
    expect(parseWeightUnit(Uint8Array.of(0x1a))?.parsed).toBe(26);
  });

  it('time payload is local time with Monday = 1 .. Sunday = 7', () => {
    // 2026-10-25 is a Sunday; 23:30 UTC is 06:30 Monday the 26th at UTC+7.
    expect([...currentTimePayload(Date.UTC(2026, 9, 25, 23, 30, 5), 420)]).toEqual([0xea, 0x07, 10, 26, 6, 30, 5, 1]);
    expect([...currentTimePayload(Date.UTC(2026, 9, 25, 12, 0, 0), 0)]).toEqual([0xea, 0x07, 10, 25, 12, 0, 0, 7]);
  });

  it('product markers: the 3 Pro is not taken for the 3, ids map to models (openScale)', () => {
    expect(extractProductMarker('HUAWEI Scale 3 Pro-241')).toBe('HUAWEI SCALE 3 PRO');
    expect(productProfileForMarker(extractProductMarker('HUAWEI Scale 3 Pro-241')).family).toBe('scale-3-pro');
    expect(productProfileForMarker(extractProductMarker('Hagrid-B29')).displayName).toBe('HUAWEI Scale 3 Pro');
    expect(productProfileForMarker(extractProductMarker('HUAWEI Scale 3')).family).toBe('scale-3');
    expect(productProfileForMarker(extractProductMarker('HUAWEI Scale 2 Pro')).family).toBe('scale-2-pro');
    expect(productProfileForMarker('M0CJ').family).toBe('dobby');
    expect(extractProductMarker('Generic BIA')).toBeNull();
  });
});
