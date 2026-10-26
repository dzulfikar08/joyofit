/**
 * A HUAWEI Scale 3 Pro weigh-in end to end through the native glue (`WeighSession`, `GattRun`) with the recorder running beside it, on
 * openScale's fake keys: the handshake writes go out, the history record becomes one weigh-in, and neither the support trace nor the
 * recording ever holds a key, the root key or the work key. A wrong CAK stops the session and reports the refusal.
 */
import { describe, expect, it } from 'bun:test';

import { FakeScaleNative } from './fakeNative.testkit';
import { ScaleHub } from './hub';
import type { ScaleNative } from './native';
import {
  ADDRESS,
  ALL_SERVICES,
  C1,
  C2,
  CAK,
  history,
  MANAGER_HUID,
  notifyFrames,
  PAYLOAD_TIME,
  RAND_A,
  RAND_B,
  REALTIME,
  SECRET,
  SERVICE_OF,
  seq,
  TZ,
  USER_INFO_IV,
  WORK_KEY,
  WORK_KEY_IV,
} from './protocols/hagrid.testkit';
import { buildManagerInfoPayload, c3FromBluetoothAddress, deriveRootKey, encryptedPayloadWithIv, expectedAuthResponsePayload } from './protocols/hagridLib';
import { CHR, huaweiHagridProtocol } from './protocols/huaweiHagrid';
import { ScaleRecorder, type RecordLine } from './recorder';
import { bytesToHex } from '../sensors/gatt';
import type { ScaleReading } from './types';
import { WeighSession } from './weigh';

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup(secret = SECRET) {
  const native = new FakeScaleNative();
  const hub = new ScaleHub(() => native as ScaleNative);
  const randoms = [RAND_B, WORK_KEY, WORK_KEY_IV, USER_INFO_IV];
  const log = { live: [] as ScaleReading[], final: [] as ScaleReading[], traces: [] as string[], rejected: 0 };
  const session = new WeighSession(
    hub,
    { id: ADDRESS, protocol: huaweiHagridProtocol, secret },
    {
      lowLatency: true,
      user: () => ({ heightCm: 175, ageYears: 26, male: true }),
      now: () => PAYLOAD_TIME,
      cooldownMs: 0,
      timezoneOffsetMin: () => TZ,
      randomBytes: () => randoms.shift()!,
    },
    {
      onStatus: () => {},
      onLive: (r) => log.live.push(r),
      onFinal: (r) => log.final.push(r),
      onTrace: (l) => log.traces.push(`${l.direction} ${l.message} ${l.hex ?? ''}`),
      onProblem: () => {},
      onRejected: () => log.rejected++,
    },
  );
  const recording: RecordLine[] = [];
  const recorder = new ScaleRecorder(hub, (line) => recording.push(line));
  const notify = async (chr: string, payload: Uint8Array, encrypted = false) => {
    for (const value of notifyFrames(payload, encrypted)) {
      native.emit('onScaleValue', { id: ADDRESS, ts: PAYLOAD_TIME, service: SERVICE_OF[chr], characteristic: chr, value });
    }
    await flush();
  };
  const connect = async () => {
    await session.start();
    await recorder.start([ADDRESS], { connect: false });
    native.emit('onScaleAdvertisement', { id: ADDRESS, name: 'HUAWEI Scale 3 Pro-241', rssi: -60, ts: 0, serviceUuids: ['fff0'], serviceData: {}, manufacturerData: {} });
    await flush();
    native.emit('onScaleLink', { id: ADDRESS, state: 'connected', error: null, services: ALL_SERVICES });
    await flush();
  };
  return { native, session, recorder, log, recording, notify, connect };
}

describe('HUAWEI Scale 3 Pro weigh-in through the app glue', () => {
  it('handshakes, saves the history record as one weigh-in, and keeps every key out of the trace and the recording', async () => {
    const t = setup();
    await t.connect();
    expect(t.native.calls).toContain(`connect ${ADDRESS}`);
    expect(t.native.writes[0]).toMatchObject({ service: '181c', characteristic: CHR.requestAuth, hex: 'db0300c140' });

    await t.notify(CHR.requestAuth, RAND_A);
    await t.notify(CHR.authToken, expectedAuthResponsePayload(RAND_A, RAND_B, CAK));
    await t.notify(CHR.sendWorkKey, Uint8Array.of(0x00));
    await t.notify(CHR.getManagerInfo, buildManagerInfoPayload(MANAGER_HUID, 'device'));
    await t.notify(CHR.setUserInfo, encryptedPayloadWithIv(Uint8Array.of(0x00), WORK_KEY, seq(128)), true);
    expect(t.native.writes.some((w) => w.characteristic === CHR.realtimeWeight)).toBe(true);

    await t.notify(CHR.realtimeWeight, REALTIME);
    expect(t.log.live.map((r) => r.weightKg)).toEqual([77.32]);
    await t.notify(CHR.statusResult, Uint8Array.of(0x00));
    expect(t.native.writes.some((w) => w.characteristic === CHR.historyWeight)).toBe(true);
    await t.notify(CHR.historyWeight, history(0x00));
    expect(t.log.final).toEqual([
      { weightKg: 77.32, stable: true, impedanceOhm: 600, impedanceLowOhm: 500, reported: { bodyFatPct: 18.5 }, scaleTime: PAYLOAD_TIME },
    ]);

    const redacted = t.log.traces.filter((l) => l.includes('not logged'));
    expect(new Set(redacted.map((l) => l.split(' ')[1].split('/')[1]))).toEqual(new Set([CHR.authToken, CHR.sendWorkKey, CHR.setUserInfo]));
    expect(redacted.every((l) => l.trimEnd().endsWith('not logged)'))).toBe(true);
    const rootKey = deriveRootKey(C1, C2, c3FromBluetoothAddress(ADDRESS));
    const everything = [...t.log.traces, ...t.recording.map((l) => `${l.message} ${l.hex ?? ''}`)].join('\n').toLowerCase();
    for (const secret of [CAK, C1, C2, rootKey, WORK_KEY]) expect(everything).not.toContain(bytesToHex(secret));
    expect(t.recording.some((l) => l.direction === 'rx' && l.message.includes(CHR.historyWeight))).toBe(true);

    t.session.stop();
    t.recorder.stop();
  });

  it('a wrong CAK disconnects and reports the refusal once', async () => {
    const wrong = SECRET.replace(/"cak":"[0-9a-f]+"/, `"cak":"${'11'.repeat(16)}"`);
    const t = setup(wrong);
    await t.connect();
    await t.notify(CHR.requestAuth, RAND_A);
    await t.notify(CHR.authToken, expectedAuthResponsePayload(RAND_A, RAND_B, CAK));
    expect(t.log.rejected).toBe(1);
    expect(t.native.calls).toContain(`disconnect ${ADDRESS}`);
    expect(t.native.writes.some((w) => w.characteristic === CHR.sendWorkKey)).toBe(false);
    t.session.stop();
    t.recorder.stop();
  });
});
