/**
 * Shared fixtures of the Huawei Hagrid tests: openScale's fake keys and payloads (HuaweiHagridWspHandlerTest.kt at
 * 87edad4813e400cd4871109fc72a0bcf4d13f336, GPL-3.0-or-later, Copyright (C) 2026 openScale contributors), the scale's GATT table and the
 * scale side of the framing. No real key is here.
 */
import { bytesToHex } from '../../sensors/gatt';
import type { DiscoveredService } from '../types';
import { buildWriteFrames, concat, crc16Modbus, FRAME_NOTIFY_ENCRYPTED, FRAME_NOTIFY_PLAIN } from './hagridLib';
import { CHR, huaweiHagridSecret } from './huaweiHagrid';

export const seq = (start: number, length = 16): Uint8Array => Uint8Array.from({ length }, (_, i) => (i + start) & 0xff);

export const ADDRESS = '0C:95:41:6E:9E:50';
/** Made up (openScale's test has a real-looking one). */
export const MANAGER_HUID = '4200000000000001';
export const RAND_A = seq(0);
export const RAND_B = seq(16);
export const WORK_KEY = seq(32);
export const WORK_KEY_IV = seq(48);
export const CAK = seq(64);
export const C1 = seq(80);
export const C2 = seq(96);
export const USER_INFO_IV = seq(112);
export const SECRET = huaweiHagridSecret.parse({ cak: bytesToHex(CAK), c1: bytesToHex(C1), c2: bytesToHex(C2) }, ADDRESS)!;

/** 2026-06-22 15:14:42 at UTC+7, the time in the openScale payloads. */
export const TZ = 420;
export const PAYLOAD_TIME = Date.UTC(2026, 5, 22, 8, 14, 42);

/** realtimePayload(): 77.32 kg, 18.5 %, low band 500..505, heart rate 72, high band 600..605. */
export const REALTIME = Uint8Array.from([
  0x34, 0x1e, 0xb9, 0x00, 0xea, 0x07, 0x06, 0x16, 0x0f, 0x0e, 0x2a, 0x00, 0xf4, 0x01, 0xf5, 0x01, 0xf6, 0x01, 0xf7, 0x01, 0xf8, 0x01, 0xf9,
  0x01, 0x48, 0x00, 0x58, 0x02, 0x59, 0x02, 0x5a, 0x02, 0x5b, 0x02, 0x5c, 0x02, 0x5d, 0x02,
]);
/** scale3CompositionRealtimePayload(): the low band in tenths of an ohm (3500 = 350 ohm). */
export const SCALE3_REALTIME = REALTIME.slice();
SCALE3_REALTIME.set([0xac, 0x0d, 0xad, 0x0d, 0xae, 0x0d, 0xaf, 0x0d, 0xb0, 0x0d, 0xb1, 0x0d], 12);
export const history = (completeFlag: number): Uint8Array => concat(REALTIME, Uint8Array.of(0x01, completeFlag));

export const SERVICE_OF: Record<string, string> = {
  [CHR.requestAuth]: '181c',
  [CHR.authToken]: '181c',
  [CHR.sendWorkKey]: '181c',
  [CHR.bindRequest]: '181c',
  [CHR.setUserInfo]: '181c',
  [CHR.getManagerInfo]: '181c',
  [CHR.currentTime]: '1805',
  [CHR.productInfo]: '1805',
  [CHR.scaleVersion]: '1805',
  [CHR.weightUnit]: '1805',
  [CHR.statusPoll]: '1805',
  [CHR.statusResult]: '1805',
  [CHR.realtimeWeight]: '181b',
  [CHR.historyWeight]: '181b',
  [CHR.weightMeasurement]: '181d',
};

/** Every Hagrid characteristic (openScale's `CapturingTransport.allHagrid()`), plus a Device Information service the scale also has. */
export const ALL_SERVICES: DiscoveredService[] = [
  ...['181c', '1805', '181b', '181d'].map((uuid) => ({
    uuid,
    characteristics: Object.keys(SERVICE_OF)
      .filter((chr) => SERVICE_OF[chr] === uuid)
      .map((chr) => ({ uuid: chr, properties: ['write' as const, 'indicate' as const] })),
  })),
  { uuid: '180a', characteristics: [{ uuid: '2a29', properties: ['read'] }] },
];

/** A message as the scale indicates it: the phone's framing re-stamped BD (plain) or CD (encrypted) with CRC-16/MODBUS. */
export function notifyFrames(payload: Uint8Array, encrypted = false): string[] {
  return buildWriteFrames(payload, encrypted).map((frame) => {
    frame[0] = encrypted ? FRAME_NOTIFY_ENCRYPTED : FRAME_NOTIFY_PLAIN;
    const crc = crc16Modbus(frame.subarray(0, frame.length - 2));
    frame[frame.length - 2] = crc & 0xff;
    frame[frame.length - 1] = crc >>> 8;
    return bytesToHex(frame);
  });
}
