/**
 * Behaviour ported from openScale (oliexdev/openScale, GPL-3.0-or-later) at 87edad4813e400cd4871109fc72a0bcf4d13f336:
 * android_app/app/src/test/java/com/health/openscale/core/bluetooth/scales/HuaweiHagridWspHandlerTest.kt. Copyright (C) 2026 openScale
 * contributors. Same fake keys (bytes 64.., 80.., 96..), fake address and payloads; the manager account id is made up here. Where JoyoFit
 * differs on purpose (no probe-only mode, no Scale 3 body-composition model, older history records not saved, weight 0 in the user info,
 * secrets kept out of the trace) the test says so.
 */
import { describe, expect, it } from 'bun:test';

import { bytesToHex, hexToBytes } from '../../sensors/gatt';
import { classify } from '../registry';
import type { GattAction, GattStep, ScaleReading, ScaleUser } from '../types';
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
  SCALE3_REALTIME,
  SECRET,
  SERVICE_OF,
  seq,
  TZ,
  USER_INFO_IV,
  WORK_KEY,
  WORK_KEY_IV,
} from './hagrid.testkit';
import {
  buildAuthTokenPayload,
  buildManagerInfoPayload,
  buildUserInfoPayload,
  c3FromBluetoothAddress,
  concat,
  decryptPayload,
  deriveRootKey,
  encryptedPayloadWithIv,
  expectedAuthResponsePayload,
} from './hagridLib';
import {
  CHR,
  HISTORY_SLACK_MS,
  huaweiHagridProtocol,
  huaweiHagridSecret,
  JOYOFIT_UID,
  MANAGER_INFO_TIMEOUT_MS,
  MAX_STATUS_POLLS,
  readHagridSecret,
  STATUS_POLL_INTERVAL_MS,
} from './huaweiHagrid';

const writes = (actions: GattAction[], chr: string) =>
  actions.filter((a): a is Extract<GattAction, { op: 'write' }> => a.op === 'write' && a.characteristic === chr);

/** The messages written to a characteristic, each reassembled from its frames. */
function messagesTo(actions: GattAction[], chr: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  let current: Uint8Array[] = [];
  for (const w of writes(actions, chr)) {
    const frame = hexToBytes(w.hex);
    current.push(frame.slice(3, 3 + frame[1] - 3));
    if ((frame[2] & 0x0f) === frame[2] >>> 4) {
      out.push(concat(...current));
      current = [];
    }
  }
  return out;
}

interface HarnessOptions {
  name?: string;
  user?: ScaleUser;
  secret?: string;
  now?: number;
  randoms?: Uint8Array[];
}

function harness(options: HarnessOptions = {}) {
  const { name = 'HUAWEI Scale 2 Pro', user, now = PAYLOAD_TIME, randoms = [RAND_B, WORK_KEY, WORK_KEY_IV, USER_INFO_IV] } = options;
  const secret = 'secret' in options ? options.secret : SECRET;
  const queue = [...randoms];
  const session = huaweiHagridProtocol.createSession({
    now,
    timezoneOffsetMin: TZ,
    secret,
    deviceName: name,
    user,
    randomBytes: (size) => {
      expect(size).toBe(16);
      return queue.shift()!;
    },
  });
  const log = { actions: [] as GattAction[], readings: [] as ScaleReading[], notes: [] as string[], done: false, rejected: false };
  const apply = (step: GattStep) => {
    log.actions.push(...step.actions);
    log.readings.push(...step.readings);
    log.notes.push(...(step.notes ?? []));
    if (step.done) log.done = true;
    if (step.rejected) log.rejected = true;
  };
  apply(session.start(ALL_SERVICES));
  const notify = (chr: string, payload: Uint8Array, options: { encrypted?: boolean; at?: number } = {}) => {
    for (const frame of notifyFrames(payload, options.encrypted)) apply(session.onValue(SERVICE_OF[chr], chr, frame, options.at ?? now));
  };
  const tick = (at: number) => apply(session.onTick!(at));
  const finals = () => log.readings.filter((r) => r.stable);
  return { session, log, notify, tick, finals };
}

const ADULT_FEMALE: ScaleUser = { heightCm: 171, ageYears: 26, male: false };
const ADULT_MALE: ScaleUser = { heightCm: 175, ageYears: 26, male: true };

/** Challenge, auth answer, work key ack, manager info, user info ack: the session is then ready. */
function authenticate(h: ReturnType<typeof harness>) {
  h.notify(CHR.requestAuth, RAND_A);
  h.notify(CHR.authToken, expectedAuthResponsePayload(RAND_A, RAND_B, CAK));
  h.notify(CHR.sendWorkKey, Uint8Array.of(0x00));
  h.notify(CHR.getManagerInfo, buildManagerInfoPayload(MANAGER_HUID, 'c55f8f03-1111-4222-8333-aabbccddee49'));
  h.notify(CHR.setUserInfo, encryptedPayloadWithIv(Uint8Array.of(0x00), WORK_KEY, seq(128)), { encrypted: true });
}

describe('Huawei Hagrid: which devices', () => {
  it('claims the Huawei and Honor names, not a generic BIA scale (openScale)', () => {
    const named = (name: string, serviceUuids: string[] = []) => ({ id: ADDRESS, name, serviceUuids });
    expect(huaweiHagridProtocol.matches(named('HUAWEI Scale 2 Pro'))).toBe(true);
    expect(huaweiHagridProtocol.matches(named('Hagrid-B29'))).toBe(true);
    expect(huaweiHagridProtocol.matches(named('HUAWEI Scale 3'))).toBe(true);
    expect(huaweiHagridProtocol.matches(named('Generic BIA', ['1805', '181b', '181c', '181d']))).toBe(false);
  });

  it("classifies the user's recorded advertisement (HUAWEI Scale 3 Pro-241, service fff0 only) as this protocol", () => {
    const frame = { id: 'F94E2300-DE49-926E-4EEA-6288AAF9A621', name: 'HUAWEI Scale 3 Pro-241', rssi: -60, ts: 0, serviceUuids: ['fff0'], serviceData: {}, manufacturerData: {} };
    expect(classify(frame)?.id).toBe('huawei-hagrid');
  });
});

describe('Huawei Hagrid: keys', () => {
  it('takes CAK, C1, C2 as 32 hex digits each; the address is the Android id, or typed on iOS', () => {
    const hex = { cak: ` ${bytesToHex(CAK).toUpperCase()} `, c1: bytesToHex(C1), c2: bytesToHex(C2) };
    expect(readHagridSecret(huaweiHagridSecret.parse(hex, ADDRESS)!)).toEqual({ cak: CAK, c1: C1, c2: C2, address: '0C95416E9E50' });
    const ios = 'F94E2300-DE49-926E-4EEA-6288AAF9A621';
    expect(huaweiHagridSecret.parse(hex, ios)).toBeNull();
    expect(readHagridSecret(huaweiHagridSecret.parse({ ...hex, address: '0c:95:41:6e:9e:50' }, ios)!)?.address).toBe('0C95416E9E50');
    expect(huaweiHagridSecret.parse({ ...hex, address: '0c:95:41:6e:9e' }, ios)).toBeNull();
    expect(huaweiHagridSecret.parse({ ...hex, c2: bytesToHex(C2).slice(2) }, ADDRESS)).toBeNull();
    expect(huaweiHagridSecret.parse({ ...hex, c1: `${bytesToHex(C1).slice(2)}zz` }, ADDRESS)).toBeNull();
    expect(readHagridSecret('not json')).toBeNull();
  });

  it('without keys it does nothing on the link and says why (openScale would probe; JoyoFit does not connect without keys)', () => {
    const h = harness({ secret: undefined });
    expect(h.log.actions).toEqual([]);
    expect(h.log.done).toBe(true);
    expect(h.log.notes).toContain('hagrid: no keys saved for this scale');
  });
});

describe('Huawei Hagrid: handshake', () => {
  it('subscribes to every Hagrid characteristic and asks for the challenge', () => {
    const h = harness();
    expect(h.log.actions.filter((a) => a.op === 'subscribe')).toHaveLength(15);
    expect(messagesTo(h.log.actions, CHR.requestAuth)).toEqual([new Uint8Array(0)]);
  });

  it('answers a challenge with a trailing status byte using its first 16 bytes (openScale)', () => {
    const h = harness({ name: 'HUAWEI Scale 3' });
    h.notify(CHR.requestAuth, concat(RAND_A, Uint8Array.of(0x00)));
    expect(messagesTo(h.log.actions, CHR.authToken)).toEqual([buildAuthTokenPayload(RAND_A, RAND_B, CAK)]);
  });

  it('with the fake keys: auth, work key under the root key, manager info, user info, then realtime and polling (openScale)', () => {
    const h = harness({ user: ADULT_FEMALE });
    h.notify(CHR.requestAuth, RAND_A);
    expect(messagesTo(h.log.actions, CHR.authToken)).toEqual([buildAuthTokenPayload(RAND_A, RAND_B, CAK)]);

    h.notify(CHR.authToken, expectedAuthResponsePayload(RAND_A, RAND_B, CAK));
    const rootKey = deriveRootKey(C1, C2, c3FromBluetoothAddress(ADDRESS));
    const [workKeyMessage] = messagesTo(h.log.actions, CHR.sendWorkKey);
    expect(workKeyMessage).toHaveLength(32);
    expect(decryptPayload(workKeyMessage, rootKey)).toEqual(WORK_KEY);

    h.notify(CHR.sendWorkKey, Uint8Array.of(0x00));
    expect(writes(h.log.actions, CHR.getManagerInfo)).toHaveLength(1);
    expect(writes(h.log.actions, CHR.setUserInfo)).toHaveLength(0);

    h.notify(CHR.getManagerInfo, buildManagerInfoPayload(MANAGER_HUID, 'c55f8f03-1111-4222-8333-aabbccddee49'));
    const [userInfo] = messagesTo(h.log.actions, CHR.setUserInfo);
    expect(userInfo).toHaveLength(85);
    // JoyoFit sends weight 0 (openScale its last weight): the profile weight is not what the scale should start from.
    expect(decryptPayload(userInfo, WORK_KEY)).toEqual(
      buildUserInfoPayload({ huid: MANAGER_HUID, uid: JOYOFIT_UID, gender: 1, ageYears: 26, heightCm: 171, weightKg: 0 }),
    );

    h.notify(CHR.setUserInfo, encryptedPayloadWithIv(Uint8Array.of(0x00), WORK_KEY, seq(128)), { encrypted: true });
    for (const chr of [CHR.currentTime, CHR.setUserInfo, CHR.productInfo, CHR.getManagerInfo, CHR.scaleVersion, CHR.weightUnit, CHR.realtimeWeight, CHR.statusPoll]) {
      expect(writes(h.log.actions, chr).length).toBeGreaterThan(0);
    }
    expect(writes(h.log.actions, CHR.historyWeight)).toHaveLength(0);

    const realtimeBefore = writes(h.log.actions, CHR.realtimeWeight).length;
    const pollsBefore = writes(h.log.actions, CHR.statusPoll).length;
    h.notify(CHR.statusResult, Uint8Array.of(0x00));
    // Scale 2 Pro: no second realtime request, one history read, polling stopped.
    expect(writes(h.log.actions, CHR.realtimeWeight)).toHaveLength(realtimeBefore);
    expect(messagesTo(h.log.actions, CHR.historyWeight)).toEqual([new Uint8Array(0)]);
    h.tick(PAYLOAD_TIME + 10 * STATUS_POLL_INTERVAL_MS);
    expect(writes(h.log.actions, CHR.statusPoll)).toHaveLength(pollsBefore);
  });

  it('writes derived from the keys are marked redact, and no key or derived key is in any note or other write', () => {
    const h = harness({ user: ADULT_FEMALE });
    authenticate(h);
    const redacted = h.log.actions.filter((a) => a.op === 'write' && a.redact).map((a) => a.characteristic);
    expect(new Set(redacted)).toEqual(new Set([CHR.authToken, CHR.sendWorkKey, CHR.setUserInfo]));
    const rootKey = deriveRootKey(C1, C2, c3FromBluetoothAddress(ADDRESS));
    const plainWrites = h.log.actions.filter((a) => a.op === 'write' && !a.redact).map((a) => (a.op === 'write' ? a.hex : ''));
    const text = [...plainWrites, ...h.log.notes].join(' ').toLowerCase();
    for (const secret of [CAK, C1, C2, rootKey, WORK_KEY]) expect(text).not.toContain(bytesToHex(secret));
    expect(h.log.notes.join(' ')).not.toContain(MANAGER_HUID);
  });

  it('a wrong CAK ends the run as rejected (JoyoFit asks for the keys again)', () => {
    const h = harness();
    h.notify(CHR.requestAuth, RAND_A);
    h.notify(CHR.authToken, expectedAuthResponsePayload(RAND_A, RAND_B, seq(1)));
    expect(h.log.rejected).toBe(true);
    expect(h.log.done).toBe(true);
    expect(writes(h.log.actions, CHR.sendWorkKey)).toHaveLength(0);
  });

  it('a refused work key ends the run as rejected', () => {
    const h = harness();
    h.notify(CHR.requestAuth, RAND_A);
    h.notify(CHR.authToken, expectedAuthResponsePayload(RAND_A, RAND_B, CAK));
    h.notify(CHR.sendWorkKey, Uint8Array.of(0x01));
    expect(h.log.rejected).toBe(true);
  });

  it('goes on without manager info after 2.5 s, and without a profile skips the user info', () => {
    const h = harness();
    h.notify(CHR.requestAuth, RAND_A);
    h.notify(CHR.authToken, expectedAuthResponsePayload(RAND_A, RAND_B, CAK));
    h.notify(CHR.sendWorkKey, Uint8Array.of(0x00));
    h.tick(PAYLOAD_TIME + MANAGER_INFO_TIMEOUT_MS - 1);
    expect(writes(h.log.actions, CHR.realtimeWeight)).toHaveLength(0);
    h.tick(PAYLOAD_TIME + MANAGER_INFO_TIMEOUT_MS);
    expect(writes(h.log.actions, CHR.setUserInfo)).toHaveLength(0);
    expect(writes(h.log.actions, CHR.realtimeWeight)).toHaveLength(1);
    expect(h.log.notes).toContain('hagrid: no profile (height, birth year, sex): user info not sent');
  });

  it('encodes the sex the Scale 3 way (male 1) and the other models the other way (male 0, female 1) (openScale)', () => {
    const genderByte = (name: string, user: ScaleUser) => {
      const h = harness({ name, user });
      h.notify(CHR.requestAuth, RAND_A);
      h.notify(CHR.authToken, expectedAuthResponsePayload(RAND_A, RAND_B, CAK));
      h.notify(CHR.sendWorkKey, Uint8Array.of(0x00));
      h.notify(CHR.getManagerInfo, buildManagerInfoPayload(MANAGER_HUID, 'device'));
      return decryptPayload(messagesTo(h.log.actions, CHR.setUserInfo)[0], WORK_KEY)[62];
    };
    expect(genderByte('HUAWEI Scale 3', ADULT_MALE)).toBe(1);
    expect(genderByte('HUAWEI Scale 2 Pro', ADULT_MALE)).toBe(0);
    expect(genderByte('HUAWEI Scale 2 Pro', ADULT_FEMALE)).toBe(1);
  });

  it('asks for the realtime weight again after status 0 only on the Scale 3 (openScale)', () => {
    const again = (name: string) => {
      const h = harness({ name, user: ADULT_MALE });
      authenticate(h);
      const before = writes(h.log.actions, CHR.realtimeWeight).length;
      h.notify(CHR.statusResult, Uint8Array.of(0x00));
      return writes(h.log.actions, CHR.realtimeWeight).length - before;
    };
    expect(again('HUAWEI Scale 3')).toBe(1);
    expect(again('HUAWEI Scale 2 Pro')).toBe(0);
    expect(again('Hagrid-B29')).toBe(0);
  });

  it('polls the measurement status every 3 s, then asks for the measurement after 30 polls', () => {
    const h = harness({ user: ADULT_MALE });
    authenticate(h);
    expect(writes(h.log.actions, CHR.statusPoll)).toHaveLength(1);
    for (let i = 1; i < MAX_STATUS_POLLS; i++) h.tick(PAYLOAD_TIME + i * STATUS_POLL_INTERVAL_MS);
    expect(writes(h.log.actions, CHR.statusPoll)).toHaveLength(MAX_STATUS_POLLS);
    expect(writes(h.log.actions, CHR.historyWeight)).toHaveLength(0);
    h.tick(PAYLOAD_TIME + MAX_STATUS_POLLS * STATUS_POLL_INTERVAL_MS);
    expect(writes(h.log.actions, CHR.historyWeight)).toHaveLength(1);
  });
});

describe('Huawei Hagrid: weigh-ins', () => {
  it('a raw standard weight notification is a weigh-in (openScale)', () => {
    const h = harness();
    const step = h.session.onValue('181d', CHR.weightMeasurement, '008c3c', PAYLOAD_TIME);
    expect(step.readings).toEqual([{ weightKg: 77.5, stable: true }]);
  });

  it('Scale 2 Pro / 3 Pro realtime frames are live only, also after status 0 (openScale)', () => {
    for (const name of ['HUAWEI Scale 2 Pro', 'HUAWEI Scale 3 Pro-241']) {
      const h = harness({ name, user: ADULT_MALE });
      authenticate(h);
      h.notify(CHR.realtimeWeight, REALTIME);
      h.notify(CHR.statusResult, Uint8Array.of(0x00));
      h.notify(CHR.realtimeWeight, REALTIME);
      expect(h.finals()).toEqual([]);
      expect(h.log.readings.at(-1)).toEqual({ weightKg: 77.32, stable: false });
    }
  });

  it('Scale 3: the realtime frame is the weigh-in at once, with 350 / 600 ohm, and status 0 does not repeat it (openScale)', () => {
    const h = harness({ name: 'HUAWEI Scale 3', user: ADULT_MALE });
    authenticate(h);
    h.notify(CHR.realtimeWeight, SCALE3_REALTIME);
    // No Scale 3 body-composition model in JoyoFit: the fat is what the scale sent (18.5 %).
    expect(h.finals()).toEqual([{ weightKg: 77.32, stable: true, impedanceOhm: 600, impedanceLowOhm: 350, reported: { bodyFatPct: 18.5 } }]);
    h.notify(CHR.statusResult, Uint8Array.of(0x00));
    h.notify(CHR.realtimeWeight, SCALE3_REALTIME);
    expect(h.finals()).toHaveLength(1);
    expect(h.log.notes.some((n) => n.includes('low=[3500,3501,3502,3503,3504,3505] high=[600,601,602,603,604,605]'))).toBe(true);
  });

  it('Scale 3 stays a Scale 3 when product info reports the shared id M0CJ (openScale)', () => {
    const h = harness({ name: 'HUAWEI Scale 3', user: ADULT_MALE });
    authenticate(h);
    h.notify(CHR.productInfo, new TextEncoder().encode('M0CJ7'));
    h.notify(CHR.realtimeWeight, SCALE3_REALTIME);
    expect(h.finals()).toHaveLength(1);
  });

  it('a history record is a weigh-in with its time, and a non-final one asks for the next (openScale)', () => {
    const h = harness();
    h.notify(CHR.historyWeight, history(0x01));
    expect(h.finals()).toEqual([
      { weightKg: 77.32, stable: true, impedanceOhm: 600, impedanceLowOhm: 500, reported: { bodyFatPct: 18.5 }, scaleTime: PAYLOAD_TIME },
    ]);
    expect(messagesTo(h.log.actions, CHR.historyWeight).at(-1)).toEqual(Uint8Array.of(0x00));
  });

  it('the same history record twice is acknowledged twice and kept once (openScale)', () => {
    const h = harness();
    h.notify(CHR.historyWeight, history(0x01));
    h.notify(CHR.historyWeight, history(0x01));
    expect(h.finals()).toHaveLength(1);
    expect(messagesTo(h.log.actions, CHR.historyWeight)).toHaveLength(2);
  });

  it('the last history record asks for nothing more (openScale)', () => {
    const h = harness();
    h.notify(CHR.historyWeight, history(0x00));
    expect(h.finals()).toHaveLength(1);
    expect(messagesTo(h.log.actions, CHR.historyWeight)).toEqual([]);
  });

  it('a history record from before this connection is logged, not saved', () => {
    const h = harness({ now: PAYLOAD_TIME + HISTORY_SLACK_MS + 1 });
    h.notify(CHR.historyWeight, history(0x00));
    expect(h.finals()).toEqual([]);
    expect(h.log.notes.some((n) => n.includes('older than this connection'))).toBe(true);
  });

  it('an encrypted notification before the work key is ignored', () => {
    const h = harness();
    h.notify(CHR.realtimeWeight, encryptedPayloadWithIv(REALTIME, WORK_KEY, seq(1)), { encrypted: true });
    expect(h.log.readings).toEqual([]);
  });

  it('decrypts encrypted realtime frames under the work key', () => {
    const h = harness({ name: 'HUAWEI Scale 3', user: ADULT_MALE });
    authenticate(h);
    h.notify(CHR.realtimeWeight, encryptedPayloadWithIv(SCALE3_REALTIME, WORK_KEY, seq(1)), { encrypted: true });
    expect(h.finals().map((r) => r.weightKg)).toEqual([77.32]);
  });
});
