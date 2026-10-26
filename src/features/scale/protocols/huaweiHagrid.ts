/**
 * HUAWEI Scale 2 Pro, Scale 3 and Scale 3 Pro (and HONOR Scale 2): the Hagrid WSP session on the vendor characteristics under 181C,
 * 1805 and 181B (`hagridLib.ts` has the bytes). The scale answers nothing until the phone proves it knows the scale's keys:
 *   1. subscribe, write an empty request-auth; the scale indicates a 16-byte challenge randA;
 *   2. auth token `randB | HMAC(CAK)`; the scale answers with its own HMAC, which proves the CAK matches;
 *   3. a fresh work key, AES-CTR encrypted under the root key from C1, C2 and the scale's Bluetooth address; the scale acks it;
 *   4. time sync, manager info, the person's height / age / sex encrypted under the work key (set-user-info);
 *   5. realtime weight request and measurement-status polling every 3 s; when the scale reports the measurement done, the history read.
 * The Scale 3 sends its result as a realtime frame; the Scale 2 Pro / 3 Pro send realtime frames while weighing (shown live) and the
 * result as a history record.
 *
 * Derived from openScale (oliexdev/openScale, GPL-3.0-or-later),
 * android_app/app/src/main/java/com/health/openscale/core/bluetooth/scales/HuaweiHagridWspHandler.kt at
 * 87edad4813e400cd4871109fc72a0bcf4d13f336. Copyright (C) 2026 openScale contributors. Modified for JoyoFit:
 *  - a pure state machine on the `GattSession` contract; openScale's coroutine delays are deadlines checked in `onTick`;
 *  - no probe-only mode: without keys the app does not connect at all (the recorder still logs what the scale sends);
 *  - the keys come from the secure store per scale (`huaweiHagridSecret`); on iOS, which hides the address, the person types it too;
 *  - openScale's Scale 3 body-composition model (libs/HuaweiScale3BodyComposition.kt) is not ported: a weigh-in carries the body fat
 *    the scale sends, the impedances, and nothing computed;
 *  - the six low- and six high-frequency impedance samples and the heart rate go to the support log as raw values only;
 *  - a history record taken before this connection (older weigh-ins the scale kept) is logged and not saved, since a weigh-in is
 *    stored at the time it arrives.
 * Test material: openScale scales/HuaweiHagridWspHandlerTest.kt (`huaweiHagrid.test.ts`), with fake keys.
 */
import { bytesToHex, hexToBytes } from '../../sensors/gatt';
import { normalizeUuid } from '../uuid';
import type { DiscoveredService, GattContext, GattProtocol, GattStep, ProtocolSecret, ScaleReading } from '../types';
import {
  buildAuthTokenPayload,
  buildEncryptedWriteFrames,
  buildUserInfoPayload,
  buildWriteFrames,
  c3FromBluetoothAddress,
  compactBluetoothAddress,
  currentTimePayload,
  decryptPayload,
  deriveRootKey,
  extractProductMarker,
  FrameAccumulator,
  hasNotificationFramePrefix,
  historyDedupeKey,
  isGenericFamily,
  isHistoryComplete,
  isValidAuthResponsePayload,
  parseHistoryMeasurement,
  parseManagerInfo,
  parseProductInfo,
  parseRealtimeMeasurement,
  parseScaleVersion,
  parseStandardBodyCompositionMeasurement,
  parseStandardWeightMeasurement,
  parseWeightUnit,
  productProfileForMarker,
  representativeHighOhm,
  representativeLowOhm,
  type HagridMeasurement,
} from './hagridLib';

export const SVC_USER_DATA = '181c';
export const SVC_CURRENT_TIME = '1805';
export const SVC_BODY_COMPOSITION = '181b';
export const SVC_WEIGHT_SCALE = '181d';

export const CHR = {
  requestAuth: '02b2a08e-f8b0-4047-b1fd-f4e0efeee679',
  authToken: '32330a04-15d9-421a-91c5-2a2d5c7525c9',
  sendWorkKey: 'a3d330f8-b84f-4f48-a78c-f8d1e33b597a',
  bindRequest: '42596cbe-d291-4da3-8ca6-d1ae5d1c9174',
  setUserInfo: '8cc61d7d-66c0-4802-89c3-38c5a163592e',
  getManagerInfo: '4338c65e-ed8e-4085-bbea-a25e33ca6b54',
  currentTime: '2a2b',
  productInfo: '75143e79-f878-4a00-a628-edc40509de7e',
  scaleVersion: '1f5d3d5c-496d-4290-af03-c7a8d5419741',
  weightUnit: '7e6dbc73-42e7-45b9-a6ec-6aa2d7834695',
  statusPoll: 'bfc36f6e-4150-4a4b-9052-3d359e52962e',
  statusResult: 'ba216311-1787-472b-bef6-3eb29e62293e',
  weightMeasurement: '2a9d',
  bodyCompositionMeasurement: '2a9c',
  realtimeWeight: '46797c17-d639-488d-9476-4789e8472878',
  historyWeight: '0212f42a-5f19-4bc1-ba52-d7ec7ccb71a4',
} as const;

/** What gets notifications, in openScale's order. */
const SUBSCRIPTIONS: readonly (readonly [string, string])[] = [
  [SVC_USER_DATA, CHR.requestAuth],
  [SVC_USER_DATA, CHR.authToken],
  [SVC_USER_DATA, CHR.sendWorkKey],
  [SVC_USER_DATA, CHR.bindRequest],
  [SVC_USER_DATA, CHR.setUserInfo],
  [SVC_USER_DATA, CHR.getManagerInfo],
  [SVC_CURRENT_TIME, CHR.currentTime],
  [SVC_CURRENT_TIME, CHR.productInfo],
  [SVC_CURRENT_TIME, CHR.scaleVersion],
  [SVC_CURRENT_TIME, CHR.weightUnit],
  [SVC_CURRENT_TIME, CHR.statusPoll],
  [SVC_CURRENT_TIME, CHR.statusResult],
  [SVC_BODY_COMPOSITION, CHR.bodyCompositionMeasurement],
  [SVC_WEIGHT_SCALE, CHR.weightMeasurement],
  [SVC_BODY_COMPOSITION, CHR.realtimeWeight],
  [SVC_BODY_COMPOSITION, CHR.historyWeight],
];

const LABELS: Readonly<Record<string, string>> = {
  [CHR.requestAuth]: 'request-auth',
  [CHR.authToken]: 'auth-token',
  [CHR.sendWorkKey]: 'send-work-key',
  [CHR.bindRequest]: 'bind-request',
  [CHR.setUserInfo]: 'set-user-info',
  [CHR.getManagerInfo]: 'get-manager-info',
  [CHR.currentTime]: 'current-time',
  [CHR.productInfo]: 'product-info',
  [CHR.scaleVersion]: 'scale-version',
  [CHR.weightUnit]: 'weight-unit',
  [CHR.statusPoll]: 'measurement-status-poll',
  [CHR.statusResult]: 'measurement-status-result',
  [CHR.weightMeasurement]: 'weight-measurement',
  [CHR.bodyCompositionMeasurement]: 'body-composition-measurement',
  [CHR.realtimeWeight]: 'realtime-weight',
  [CHR.historyWeight]: 'history-weight',
};

export const MANAGER_INFO_TIMEOUT_MS = 2500;
export const USER_INFO_ACK_TIMEOUT_MS = 3000;
export const STATUS_POLL_INTERVAL_MS = 3000;
export const REARM_POLL_INTERVAL_MS = 3000;
export const MAX_STATUS_POLLS = 30;
const MAX_HISTORY_RECORDS = 64;
/** A history record this long before the connection began still counts as this weigh-in (the scale's clock is set at every connection). */
export const HISTORY_SLACK_MS = 2 * 60 * 1000;
/** The user id JoyoFit writes for its one person (openScale writes `u:` and its own user id in hex). */
export const JOYOFIT_UID = 'u:00000001';

const EMPTY = new Uint8Array(0);
const HEX32 = /^[0-9a-f]{32}$/;

export interface HagridKeys {
  cak: Uint8Array;
  c1: Uint8Array;
  c2: Uint8Array;
  /** The scale's Bluetooth address, 12 hex digits in upper case. */
  address: string;
}

/** The secret as saved: CAK, C1, C2 (32 hex digits each) and the address. JSON, so the fields stay named. */
export function readHagridSecret(stored: string): HagridKeys | null {
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  const v = value as { cak?: unknown; c1?: unknown; c2?: unknown; address?: unknown } | null;
  const parts = [v?.cak, v?.c1, v?.c2];
  if (!parts.every((p): p is string => typeof p === 'string' && HEX32.test(p))) return null;
  const address = typeof v?.address === 'string' ? compactBluetoothAddress(v.address) : null;
  if (!address) return null;
  const [cak, c1, c2] = parts.map(hexToBytes);
  return { cak, c1, c2, address };
}

/**
 * CAK, C1 and C2 as 32 hex digits each (spaces from a paste dropped, any case), plus the scale's address: Android's scale id is the
 * address; iOS only gives a per-phone identifier, so the person types it (`address`, asked only there).
 */
export const huaweiHagridSecret: ProtocolSecret = {
  kind: 'huawei-hagrid',
  fields: [
    { id: 'cak', maxLength: 48, length: 32, hex: true },
    { id: 'c1', maxLength: 48, length: 32, hex: true },
    { id: 'c2', maxLength: 48, length: 32, hex: true },
    { id: 'address', maxLength: 17, length: 12, hex: true, onlyWithoutAddress: true },
  ],
  parse(values, scaleId) {
    const [cak, c1, c2] = [values.cak, values.c1, values.c2].map((text) => (text ?? '').replace(/\s/g, '').toLowerCase());
    if (![cak, c1, c2].every((h) => HEX32.test(h))) return null;
    const address = compactBluetoothAddress(scaleId) ?? compactBluetoothAddress(values.address ?? '');
    return address ? JSON.stringify({ cak, c1, c2, address }) : null;
  },
};

type Handshake = 'waiting-challenge' | 'auth-token-sent' | 'work-key-sent' | 'user-info-sent' | 'ready' | 'failed';

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round1 = (v: number): number => Math.round(v * 10) / 10;

function createSession(ctx: GattContext) {
  const keys = ctx.secret === undefined ? null : readHagridSecret(ctx.secret);
  const tz = ctx.timezoneOffsetMin;
  let profile = productProfileForMarker(extractProductMarker(ctx.deviceName ?? null));
  const present = new Set<string>();
  const accumulators = new Map<string, FrameAccumulator>();
  let state: Handshake = 'waiting-challenge';
  let randA: Uint8Array | null = null;
  let randB: Uint8Array | null = null;
  let workKey: Uint8Array | null = null;
  let managerHuid = '';
  let managerInfoDeadline: number | null = null;
  let userInfoDeadline: number | null = null;
  const connectedAt = ctx.now;
  let polling = false;
  let pollCount = 0;
  let nextPollAt = 0;
  let statusReady = false;
  let postReadsStarted = false;
  let cycleCompleted = false;
  let published = false;
  let pending: HagridMeasurement | null = null;
  let nextRearmAt: number | null = null;
  let historyCount = 0;
  const historyKeys = new Set<string>();

  let out: GattStep & { notes: string[] } = { actions: [], readings: [], notes: [] };
  const begin = (): void => {
    out = { actions: [], readings: [], notes: [] };
  };
  const note = (line: string): void => {
    out.notes.push(`hagrid: ${line}`);
  };
  const has = (service: string, characteristic: string): boolean => present.has(`${service}/${characteristic}`);
  const isScale3 = (): boolean => profile.family === 'scale-3';

  function writeFrames(service: string, characteristic: string, frames: Uint8Array[], redact = false): void {
    if (!has(service, characteristic)) return;
    for (const frame of frames) {
      out.actions.push({ op: 'write', service, characteristic, hex: bytesToHex(frame), withResponse: true, ...(redact ? { redact: true as const } : {}) });
    }
  }

  const writePlain = (service: string, characteristic: string, payload: Uint8Array, redact = false): void =>
    writeFrames(service, characteristic, buildWriteFrames(payload), redact);

  function random16(): Uint8Array {
    const bytes = ctx.randomBytes?.(16);
    if (!bytes || bytes.length !== 16) throw new Error('no secure random source');
    return bytes;
  }

  function reject(reason: string): void {
    state = 'failed';
    note(reason);
    out.rejected = true;
    out.done = true;
  }

  // Handshake.

  function onAuthChallenge(payload: Uint8Array): void {
    // Some firmwares append a status byte to the 16-byte challenge (Scale 3 fw 2.0.0.70 sends 17).
    if (!keys || payload.length < 16) {
      note(`auth challenge of ${payload.length} bytes ignored`);
      return;
    }
    randA = payload.slice(0, 16);
    randB = random16();
    state = 'auth-token-sent';
    note('auth challenge received, answering');
    writePlain(SVC_USER_DATA, CHR.authToken, buildAuthTokenPayload(randA, randB, keys.cak), true);
  }

  function onAuthResponse(payload: Uint8Array): void {
    if (!keys || !randA || !randB) {
      note('auth response without a pending challenge, ignored');
      return;
    }
    if (!isValidAuthResponsePayload(payload, randA, randB, keys.cak)) {
      reject('the scale refused the keys: its auth answer does not match the CAK');
      return;
    }
    const rootKey = deriveRootKey(keys.c1, keys.c2, c3FromBluetoothAddress(keys.address));
    workKey = random16();
    state = 'work-key-sent';
    note('auth answer matches the CAK; sending the work key');
    writeFrames(SVC_USER_DATA, CHR.sendWorkKey, buildEncryptedWriteFrames(workKey, rootKey, random16()), true);
  }

  function onWorkKeyAck(payload: Uint8Array, now: number): void {
    const status = payload.length > 0 ? payload[0] : -1;
    if (status !== 0) {
      reject(`the scale refused the work key (status ${status})`);
      return;
    }
    note('work key accepted; setting the time');
    writePlain(SVC_CURRENT_TIME, CHR.currentTime, currentTimePayload(now, tz));
    if (!has(SVC_USER_DATA, CHR.getManagerInfo)) {
      beginUserSync(now);
      return;
    }
    managerInfoDeadline = now + MANAGER_INFO_TIMEOUT_MS;
    writePlain(SVC_USER_DATA, CHR.getManagerInfo, EMPTY);
  }

  function onManagerInfo(payload: Uint8Array, now: number): void {
    const parsed = parseManagerInfo(payload);
    if (!parsed) {
      note(`manager info of ${payload.length} bytes not understood`);
      return;
    }
    managerHuid = parsed.huid;
    note(`manager info: ${parsed.huid.trim() === '' ? 'no account id' : 'account id present'}`);
    if (managerInfoDeadline !== null) {
      managerInfoDeadline = null;
      beginUserSync(now);
    }
  }

  function beginUserSync(now: number): void {
    if (!sendUserInfo()) {
      state = 'ready';
      postUserReads(now);
      return;
    }
    state = 'user-info-sent';
    userInfoDeadline = now + USER_INFO_ACK_TIMEOUT_MS;
  }

  /** The person's height, age and sex for the scale's own body fat; skipped without a profile. */
  function sendUserInfo(): boolean {
    const user = ctx.user;
    if (!workKey || !keys || !has(SVC_USER_DATA, CHR.setUserInfo)) return false;
    if (!user) {
      note('no profile (height, birth year, sex): user info not sent');
      return false;
    }
    // The Scale 3 encodes male = 1, female = 0; the other models the other way round.
    const gender = isScale3() ? (user.male ? 1 : 0) : user.male ? 0 : 1;
    const plaintext = buildUserInfoPayload({
      huid: managerHuid.trim() === '' ? `joyofit:${keys.address}` : managerHuid,
      uid: JOYOFIT_UID,
      gender,
      ageYears: user.ageYears,
      heightCm: Math.round(user.heightCm),
      weightKg: 0,
    });
    note('sending user info (height, age, sex)');
    writeFrames(SVC_USER_DATA, CHR.setUserInfo, buildEncryptedWriteFrames(plaintext, workKey, random16()), true);
    return true;
  }

  function onUserInfoAck(payload: Uint8Array, now: number): void {
    const status = payload.length > 0 ? payload[0] : -1;
    note(status === 0 ? 'user info accepted' : `user info answered status ${status}`);
    if (state !== 'user-info-sent') return;
    userInfoDeadline = null;
    state = 'ready';
    postUserReads(now);
  }

  // Measurement cycle.

  function postUserReads(now: number): void {
    postReadsStarted = false;
    statusReady = false;
    cycleCompleted = false;
    pending = null;
    note('ready, step on the scale');
    requestRealtime();
    startStatusPolling(now);
    writePlain(SVC_CURRENT_TIME, CHR.productInfo, EMPTY);
    writePlain(SVC_USER_DATA, CHR.getManagerInfo, EMPTY);
    writePlain(SVC_CURRENT_TIME, CHR.scaleVersion, EMPTY);
    writePlain(SVC_CURRENT_TIME, CHR.weightUnit, EMPTY);
  }

  function requestRealtime(): void {
    if (state !== 'ready' || cycleCompleted) return;
    writePlain(SVC_BODY_COMPOSITION, CHR.realtimeWeight, EMPTY);
  }

  function startStatusPolling(now: number): void {
    if (!has(SVC_CURRENT_TIME, CHR.statusPoll)) {
      requestMeasurementData();
      return;
    }
    polling = true;
    statusReady = false;
    pollCount = 0;
    sendStatusPoll(now);
  }

  function sendStatusPoll(now: number): void {
    pollCount += 1;
    nextPollAt = now + STATUS_POLL_INTERVAL_MS;
    writePlain(SVC_CURRENT_TIME, CHR.statusPoll, EMPTY);
  }

  function stopStatusPolling(): void {
    polling = false;
    pollCount = 0;
  }

  function requestMeasurementData(): void {
    stopStatusPolling();
    postMeasurementReads();
  }

  function postMeasurementReads(): void {
    if (state !== 'ready' || cycleCompleted || postReadsStarted) return;
    postReadsStarted = true;
    if (isScale3()) requestRealtime();
    requestHistory();
  }

  function requestHistory(): void {
    if (!has(SVC_BODY_COMPOSITION, CHR.historyWeight)) return;
    historyCount = 0;
    writePlain(SVC_BODY_COMPOSITION, CHR.historyWeight, EMPTY);
  }

  function onStatus(payload: Uint8Array, now: number): void {
    const status = payload.length > 0 ? payload[0] : -1;
    if (state !== 'ready') return;
    if (cycleCompleted) {
      if (status === 1) {
        note('the scale is measuring again');
        rearm(now);
      }
      return;
    }
    if (status === 0) {
      statusReady = true;
      if (!isScale3()) {
        stopStatusPolling();
        postMeasurementReads();
      } else if (published || publishPending()) {
        finishCycle(now);
      } else {
        postMeasurementReads();
      }
    } else if (status === 1) {
      statusReady = false;
    }
  }

  function rearm(now: number): void {
    nextRearmAt = null;
    cycleCompleted = false;
    published = false;
    statusReady = false;
    postReadsStarted = false;
    pending = null;
    historyCount = 0;
    requestRealtime();
    startStatusPolling(now);
  }

  function finishCycle(now: number): void {
    if (cycleCompleted) return;
    cycleCompleted = true;
    statusReady = true;
    pending = null;
    stopStatusPolling();
    nextRearmAt = has(SVC_CURRENT_TIME, CHR.statusPoll) ? now + REARM_POLL_INTERVAL_MS : null;
    note('weigh-in complete');
    requestHistory();
  }

  /** A weigh-in from a Hagrid record: weight, the body fat the scale computed, the impedance of each band. */
  function readingOf(m: HagridMeasurement, fromHistory: boolean): ScaleReading {
    const low = representativeLowOhm(m);
    // The Scale 3 sends its low-frequency sample in tenths of an ohm, which the generic rule would keep as ohms.
    const scale3Low = isScale3() && m.lowFrequencyImpedance[0] > 0 ? m.lowFrequencyImpedance[0] / 10 : null;
    const publishedLow = scale3Low ?? low;
    const high = representativeHighOhm(m) ?? publishedLow;
    const reading: ScaleReading = { weightKg: round2(m.weightKg), stable: true };
    if (high !== null && high > 0) reading.impedanceOhm = round1(high);
    if (publishedLow !== null && publishedLow > 0) reading.impedanceLowOhm = round1(publishedLow);
    if (m.fatPercent > 0 && m.fatPercent < 80) reading.reported = { bodyFatPct: round1(m.fatPercent) };
    if (fromHistory && m.timestamp !== null) reading.scaleTime = m.timestamp;
    note(
      `measurement ${fromHistory ? 'history' : 'realtime'} weight=${reading.weightKg} fat=${round1(m.fatPercent)} hr=${m.heartRateBpm ?? '-'} ` +
        `low=[${m.lowFrequencyImpedance.join(',')}] high=[${m.highFrequencyImpedance.join(',')}]`,
    );
    return reading;
  }

  function publishPending(): boolean {
    if (published || !pending) return false;
    published = true;
    // Realtime frames carry the scale's clock, which can be stale: the weigh-in takes the phone's time.
    out.readings.push(readingOf(pending, false));
    return true;
  }

  function onRealtime(payload: Uint8Array, now: number): void {
    const parsed = parseRealtimeMeasurement(payload, tz);
    if (!parsed || parsed.weightKg <= 0) {
      note(`realtime payload of ${payload.length} bytes not understood`);
      return;
    }
    if (cycleCompleted) return;
    out.readings.push({ weightKg: round2(parsed.weightKg), stable: false });
    // The other models send the result as a history record; their realtime frames are progress only.
    if (!isScale3()) return;
    pending = parsed;
    if (publishPending() && statusReady) finishCycle(now);
  }

  function onHistory(payload: Uint8Array): void {
    const parsed = parseHistoryMeasurement(payload, tz);
    if (!parsed || parsed.weightKg <= 0) {
      note(`history read finished (${payload.length} bytes)`);
      return;
    }
    historyCount += 1;
    const key = historyDedupeKey(parsed);
    const fresh = key === null || !historyKeys.has(key);
    if (key !== null) historyKeys.add(key);
    if (!fresh) {
      note('history record already seen');
    } else if (parsed.timestamp !== null && parsed.timestamp < connectedAt - HISTORY_SLACK_MS) {
      note(`history record of ${new Date(parsed.timestamp).toISOString()} is older than this connection, not saved`);
    } else {
      out.readings.push(readingOf(parsed, true));
    }
    if (isHistoryComplete(parsed) !== true && historyCount < MAX_HISTORY_RECORDS) {
      writePlain(SVC_BODY_COMPOSITION, CHR.historyWeight, Uint8Array.of(0x00));
    } else {
      note(`history read stopped after ${historyCount} records`);
    }
  }

  function onProductInfo(payload: Uint8Array): void {
    const parsed = parseProductInfo(payload);
    if (!parsed) return;
    const reported = productProfileForMarker(parsed.smartProductId);
    // The 4-character product id is coarser than the name and shared between models (a Scale 3 on fw 2.0.0.70 reports M0CJ):
    // it never replaces a specific model with a generic one.
    if (!isGenericFamily(profile.family) && isGenericFamily(reported.family)) {
      note(`product ${parsed.smartProductId}, keeping ${profile.displayName}`);
      return;
    }
    profile = reported;
    note(`product ${parsed.smartProductId}: ${profile.displayName}`);
  }

  function onStandard(characteristic: string, payload: Uint8Array): void {
    const parsed =
      characteristic === CHR.weightMeasurement ? parseStandardWeightMeasurement(payload, tz) : parseStandardBodyCompositionMeasurement(payload, tz);
    if (!parsed?.weightKg || parsed.weightKg <= 0) {
      note(`${LABELS[characteristic]} of ${payload.length} bytes without a weight`);
      return;
    }
    const reading: ScaleReading = { weightKg: round2(parsed.weightKg), stable: true };
    if (parsed.impedanceOhm !== undefined && parsed.impedanceOhm > 0) reading.impedanceOhm = round1(parsed.impedanceOhm);
    if (parsed.fatPercent !== undefined && parsed.fatPercent > 0 && parsed.fatPercent < 80) reading.reported = { bodyFatPct: round1(parsed.fatPercent) };
    if (parsed.timestamp !== undefined) reading.scaleTime = parsed.timestamp;
    out.readings.push(reading);
  }

  /** The messages both paths share (framed or not). False when the characteristic is not one of them. */
  function onCommon(characteristic: string, payload: Uint8Array, now: number): boolean {
    switch (characteristic) {
      case CHR.realtimeWeight:
      case CHR.bindRequest:
        onRealtime(payload, now);
        return true;
      case CHR.setUserInfo:
        onUserInfoAck(payload, now);
        return true;
      case CHR.getManagerInfo:
        onManagerInfo(payload, now);
        return true;
      case CHR.productInfo:
        onProductInfo(payload);
        return true;
      case CHR.scaleVersion: {
        const v = parseScaleVersion(payload);
        if (v) note(`firmware ${v.version}`);
        return true;
      }
      case CHR.weightUnit: {
        const u = parseWeightUnit(payload);
        if (u) note(`display unit ${u.label}`);
        return true;
      }
      case CHR.statusPoll:
      case CHR.statusResult:
        onStatus(payload, now);
        return true;
      case CHR.historyWeight:
        onHistory(payload);
        return true;
      default:
        return false;
    }
  }

  function onWsp(characteristic: string, raw: Uint8Array, encrypted: boolean, now: number): void {
    let payload = raw;
    if (encrypted) {
      if (!workKey) {
        note(`encrypted ${LABELS[characteristic] ?? characteristic} before the work key, ignored`);
        return;
      }
      try {
        payload = decryptPayload(raw, workKey);
      } catch {
        note(`encrypted ${LABELS[characteristic] ?? characteristic} of ${raw.length} bytes could not be decrypted`);
        return;
      }
    }
    switch (characteristic) {
      case CHR.bodyCompositionMeasurement:
      case CHR.weightMeasurement:
        onRealtime(payload, now);
        return;
      case CHR.requestAuth:
        onAuthChallenge(payload);
        return;
      case CHR.authToken:
        onAuthResponse(payload);
        return;
      case CHR.sendWorkKey:
        onWorkKeyAck(payload, now);
        return;
      case CHR.currentTime:
        return;
      default:
        if (!onCommon(characteristic, payload, now)) note(`${characteristic} sent ${payload.length} bytes, not used`);
    }
  }

  function onRaw(characteristic: string, payload: Uint8Array, now: number): void {
    if (characteristic === CHR.weightMeasurement || characteristic === CHR.bodyCompositionMeasurement) {
      onStandard(characteristic, payload);
      return;
    }
    onCommon(characteristic, payload, now);
  }

  function done(): GattStep {
    const step: GattStep = { actions: out.actions, readings: out.readings };
    if (out.notes.length > 0) step.notes = out.notes;
    if (out.done) step.done = true;
    if (out.rejected) step.rejected = true;
    return step;
  }

  return {
    start(services: DiscoveredService[]): GattStep {
      begin();
      for (const s of services) for (const c of s.characteristics) present.add(`${normalizeUuid(s.uuid)}/${normalizeUuid(c.uuid)}`);
      note(`model ${profile.displayName}`);
      if (!keys) {
        note('no keys saved for this scale');
        out.done = true;
        return done();
      }
      if (!ctx.randomBytes) {
        note('no secure random source');
        out.done = true;
        return done();
      }
      for (const [service, characteristic] of SUBSCRIPTIONS) {
        if (has(service, characteristic)) out.actions.push({ op: 'subscribe', service, characteristic });
      }
      writePlain(SVC_USER_DATA, CHR.requestAuth, EMPTY);
      return done();
    },

    onValue(_service: string, characteristic: string, hex: string, now: number): GattStep {
      begin();
      const chr = normalizeUuid(characteristic);
      const data = hexToBytes(hex);
      try {
        if (hasNotificationFramePrefix(data)) {
          let accumulator = accumulators.get(chr);
          if (!accumulator) {
            accumulator = new FrameAccumulator();
            accumulators.set(chr, accumulator);
          }
          const payload = accumulator.ingest(data);
          if (payload) onWsp(chr, payload, accumulator.lastCompletedEncrypted, now);
        } else {
          onRaw(chr, data, now);
        }
      } catch (e) {
        note(`failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return done();
    },

    onTick(now: number): GattStep {
      begin();
      if (managerInfoDeadline !== null && now >= managerInfoDeadline) {
        managerInfoDeadline = null;
        note('manager info did not come, going on without it');
        beginUserSync(now);
      }
      if (state === 'user-info-sent' && userInfoDeadline !== null && now >= userInfoDeadline) {
        userInfoDeadline = null;
        note('user info was not acknowledged, going on');
        state = 'ready';
        postUserReads(now);
      }
      if (polling && !statusReady && now >= nextPollAt) {
        if (pollCount < MAX_STATUS_POLLS) {
          sendStatusPoll(now);
        } else {
          note('measurement status timed out, asking for the measurement');
          requestMeasurementData();
        }
      }
      if (state === 'ready' && cycleCompleted && nextRearmAt !== null && now >= nextRearmAt) {
        nextRearmAt = now + REARM_POLL_INTERVAL_MS;
        writePlain(SVC_CURRENT_TIME, CHR.statusPoll, EMPTY);
      }
      return done();
    },
  };
}

export const huaweiHagridProtocol: GattProtocol = {
  kind: 'gatt',
  id: 'huawei-hagrid',
  label: 'HUAWEI Scale 2 Pro / 3 / 3 Pro', // i18n-ok scale model names
  brands: ['HUAWEI Scale 3 Pro', 'HUAWEI Scale 3', 'HUAWEI Scale 2 Pro', 'HONOR Scale 2'],
  source: ['scales/HuaweiHagridWspHandler.kt', 'libs/HuaweiHagridWspLib.kt'],
  secret: huaweiHagridSecret,
  matches: (info) => extractProductMarker(info.name) !== null,
  createSession,
};
