/**
 * QN-Scale / Yolanda / Renpho-QN / FITINDEX family (vendor protocol on services 0xFFE0 or 0xFFF0).
 *
 * Ported from openScale `scales/QNHandler.kt`.
 * Copyright (C) olie.xdev, GPL-3.0-or-later (https://github.com/oliexdev/openScale).
 * Test vectors: openScale `QNHandlerProtocolTest.kt` (real BTSnoop capture of a GE CS 10 G "Fit Plus", protocolType 0xFF, plus the
 * classic-layout frames of that test) and `QNHandlerMatchTest.kt` (name / service matching).
 *
 * Not ported: the Trisa body-composition derivation (lives in bodyComposition.ts), the Device-Information reads (their values are
 * not used by openScale either) and the 5 s retry timer of the stored-record query (a pure session has no timers).
 */
import { bytesToHex, hexToBytes } from '../../sensors/gatt';
import {
  NOTHING,
  type DiscoveredService,
  type GattAction,
  type GattContext,
  type GattInfo,
  type GattProtocol,
  type GattSession,
  type GattStep,
  type ScaleReading,
} from '../types';
import { normalizeUuid } from '../uuid';

/** Seconds from the Unix epoch to the vendor epoch exactly as openScale defines it (`SCALE_UNIX_TIMESTAMP_OFFSET`). */
const SCALE_EPOCH_OFFSET_S = 946_702_800;
const MAX_STORED_QUERY_ATTEMPTS = 10;
const MAX_STORED_RECORD_AGE_BEFORE_SESSION_S = 90;

const SVC_T1 = 'ffe0';
const CHR_T1_NOTIFY = 'ffe1';
const CHR_T1_INDICATE = 'ffe2';
const CHR_T1_WRITE_CONFIG = 'ffe3';
const CHR_T1_WRITE_TIME = 'ffe4';
const SVC_T2 = 'fff0';
const CHR_T2_NOTIFY = 'fff1';
const CHR_T2_WRITE = 'fff2';

function checksum(bytes: number[]): number {
  let s = 0;
  for (const b of bytes) s = (s + b) & 0xff;
  return s;
}

function withChecksum(bytesWithoutSum: number[]): number[] {
  return [...bytesWithoutSum, checksum(bytesWithoutSum)];
}

function hex(bytes: number[]): string {
  return bytesToHex(Uint8Array.from(bytes));
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1];
}
function u16le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}
function u32le(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Vendor clock, little-endian 32 bit (wraps like Kotlin's `Long.toInt()`). */
function vendorTimeLe(nowMs: number): number[] {
  const t = (Math.floor(nowMs / 1000) - SCALE_EPOCH_OFFSET_S) | 0;
  return [t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, (t >>> 24) & 0xff];
}

export function matchesQn(info: GattInfo): boolean {
  const name = (info.name ?? '').toLowerCase();
  const uuids = info.serviceUuids.map(normalizeUuid);
  const hasQn = uuids.includes(SVC_T1) || uuids.includes(SVC_T2);
  const nameIsQn =
    name.includes('qn-scale') || name.includes('renpho-scale') || name.includes('seb-scale') || name === 'fit plus';
  // ae00 is a QN-only service, so it identifies QN scales that carry a non-QN name (it only relaxes the name gate).
  return hasQn && (nameIsQn || uuids.includes('ae00'));
}

class QnSession implements GattSession {
  private t1 = false;
  private t1Write = false;
  private t1Time = false;
  private t2 = false;
  private t2Write = false;
  private published = false;
  private factor = 100;
  private protocolType = 0;
  private configSent = false;
  private storedQueries = 0;
  private readonly sessionStartScaleS: number;

  constructor(private readonly ctx: GattContext) {
    this.sessionStartScaleS = Math.floor(ctx.now / 1000) - SCALE_EPOCH_OFFSET_S;
  }

  start(services: DiscoveredService[]): GattStep {
    const has = (svc: string, chr: string) =>
      services.some((s) => normalizeUuid(s.uuid) === svc && s.characteristics.some((c) => normalizeUuid(c.uuid) === chr));
    this.t1 = has(SVC_T1, CHR_T1_NOTIFY);
    this.t1Write = has(SVC_T1, CHR_T1_WRITE_CONFIG);
    this.t1Time = has(SVC_T1, CHR_T1_WRITE_TIME);
    this.t2 = has(SVC_T2, CHR_T2_NOTIFY);
    this.t2Write = has(SVC_T2, CHR_T2_WRITE);
    const actions: GattAction[] = [];
    if (this.t1) actions.push({ op: 'subscribe', service: SVC_T1, characteristic: CHR_T1_NOTIFY });
    if (has(SVC_T1, CHR_T1_INDICATE)) actions.push({ op: 'subscribe', service: SVC_T1, characteristic: CHR_T1_INDICATE });
    if (this.t2) actions.push({ op: 'subscribe', service: SVC_T2, characteristic: CHR_T2_NOTIFY });
    // The configuration waits for the scale's 0x12 frame (it carries the protocol type that every reply echoes).
    return { actions, readings: [] };
  }

  onValue(service: string, characteristic: string, valueHex: string, now: number): GattStep {
    const svc = normalizeUuid(service);
    const chr = normalizeUuid(characteristic);
    const isWeightChr = (svc === SVC_T1 && chr === CHR_T1_NOTIFY) || (svc === SVC_T2 && chr === CHR_T2_NOTIFY);
    if (!isWeightChr) return NOTHING;
    const data = hexToBytes(valueHex);
    if (data.length < 3) return NOTHING;
    if (this.protocolType === 0) this.protocolType = data[2];

    switch (data[0]) {
      case 0x10:
        return this.liveFrame(data);
      case 0x14:
        return {
          actions: this.shared([withChecksum([0x20, 0x08, this.protocolType, ...vendorTimeLe(now)])]),
          readings: [],
        };
      case 0x12:
        return this.scaleInfoFrame(data, now);
      case 0x21:
        return this.handshake21();
      case 0x23:
        return this.storedFrame(data);
      default:
        return NOTHING;
    }
  }

  /** The "Fit Plus" family reports protocolType 0xFF; several fixes in openScale are verified only for it. */
  private get isUniversal(): boolean {
    return this.protocolType === 0xff;
  }

  /** Writes to the shared FFF2 characteristic of layout 2, else to FFE3 of layout 1. */
  private shared(frames: number[][]): GattAction[] {
    if (this.t2Write) return frames.map((f) => this.write(SVC_T2, CHR_T2_WRITE, f));
    if (this.t1Write) return frames.map((f) => this.write(SVC_T1, CHR_T1_WRITE_CONFIG, f));
    return [];
  }

  private write(service: string, characteristic: string, bytes: number[]): GattAction {
    return { op: 'write', service, characteristic, hex: hex(bytes), withResponse: true };
  }

  private liveFrame(data: Uint8Array): GattStep {
    if (data.length < 5) return NOTHING;
    const byte4 = data[4];
    const es30m = byte4 <= 0x02 && this.factor === 10;
    let stable: boolean;
    let raw: number;
    let r1: number;
    if (es30m) {
      if (data.length < 11) return NOTHING;
      // Only state 2 carries real impedance on the captured 0xFF family (state 1 always has R1=R2=0).
      stable = this.isUniversal ? byte4 === 0x02 : byte4 === 0x02 || byte4 === 0x01;
      raw = u16be(data, 5);
      r1 = u16be(data, 7);
    } else {
      if (data.length < 10) return NOTHING;
      stable = data[5] === 1;
      raw = u16be(data, 3);
      r1 = u16be(data, 6);
    }

    const actions: GattAction[] = [];
    if (stable && this.isUniversal) {
      // Vendor SDK CmdBuilder.buildOverCmd: every stable frame is acknowledged.
      actions.push(...this.shared([withChecksum([0x1f, 0x05, this.protocolType, 0x10])]));
    }
    if (stable && this.published) return { actions, readings: [] };

    let weight = raw / this.factor;
    // Some type-2 devices report /10 before the 0x12 frame arrives.
    if (weight <= 5 || weight >= 250) weight /= 10;
    if (!(weight > 0)) return { actions, readings: [] };

    const reading = this.reading(weight, r1, stable);
    if (stable) this.published = true;
    return { actions, readings: [reading] };
  }

  private reading(weightKg: number, r1: number, stable: boolean, scaleTime?: number): ScaleReading {
    // On the 0xFF family the resistance is in tenths of an ohm.
    const impedance = this.isUniversal ? r1 / 10 : r1;
    const r: ScaleReading = { weightKg: round2(weightKg), stable, unit: 'kg' };
    if (impedance > 0) r.impedanceOhm = impedance;
    if (scaleTime !== undefined) r.scaleTime = scaleTime;
    return r;
  }

  private scaleInfoFrame(data: Uint8Array, now: number): GattStep {
    if (data.length <= 10) return NOTHING;
    this.factor = data[10] === 1 ? 100 : 10;
    if (this.configSent) return NOTHING;
    this.configSent = true;

    const u = this.ctx.user;
    const real = this.isUniversal && u !== undefined;
    const height = real ? Math.min(220, Math.max(60, Math.trunc(u.heightCm))) : 0;
    const age = real ? Math.min(80, Math.max(6, Math.trunc(u.ageYears))) : 0;
    const gender = real ? (u.male ? 0 : 1) : 0;
    // The scale unit is not part of ScaleUser, so the config always asks for kilograms (0x01).
    const cfg = withChecksum([0x13, 0x09, this.protocolType, 0x01, 0x10, height, age, gender]);
    const timeMagic = [0x02, ...vendorTimeLe(now)];

    const actions: GattAction[] = [];
    if (this.t1Write) actions.push(this.write(SVC_T1, CHR_T1_WRITE_CONFIG, cfg));
    if (this.t2Write) actions.push(this.write(SVC_T2, CHR_T2_WRITE, cfg));
    if (this.t1Time) actions.push(this.write(SVC_T1, CHR_T1_WRITE_TIME, timeMagic));
    if (this.t2Write) actions.push(this.write(SVC_T2, CHR_T2_WRITE, timeMagic));
    return { actions, readings: [] };
  }

  private handshake21(): GattStep {
    // ES-30M needs two 0xA0 responses (openScale, from BLE capture analysis), then the stored-record query.
    const frames = [
      withChecksum([0xa0, 0x0d, 0x04, 0xfe, 0, 0, 0, 0, 0, 0, 0, 0]),
      withChecksum([0xa0, 0x0d, 0x02, 0x01, 0x00, 0x08, 0x00, 0x21, 0x06, 0xb8, 0x04, 0x02]),
    ];
    if (!this.published && this.storedQueries < MAX_STORED_QUERY_ATTEMPTS) {
      this.storedQueries += 1;
      frames.push(withChecksum([0x22, 0x06, this.protocolType, 0x00, 0x03]));
    }
    return { actions: this.shared(frames), readings: [] };
  }

  private storedFrame(data: Uint8Array): GattStep {
    if (this.published || data.length < 17) return NOTHING;
    const weight = u16be(data, 10) / 100;
    const recordScaleS = u32le(data, 6);
    if (weight <= 5 || weight >= 300) return NOTHING;
    if (recordScaleS + MAX_STORED_RECORD_AGE_BEFORE_SESSION_S < this.sessionStartScaleS) return NOTHING;
    const r1 = u16le(data, 13);
    this.published = true;
    return { actions: [], readings: [this.reading(weight, r1, true, (recordScaleS + SCALE_EPOCH_OFFSET_S) * 1000)] };
  }
}

export const QN_PROTOCOL: GattProtocol = {
  kind: 'gatt',
  id: 'qn-scale',
  label: 'QN-Scale / Yolanda / Renpho-QN', // i18n-ok scale model name
  brands: ['QN-Scale', 'Yolanda', 'Renpho (QN models)', 'FITINDEX', 'GE Fit Plus', 'SEB / Tefal'],
  source: ['scales/QNHandler.kt'],
  matches: matchesQn,
  createSession: (ctx) => new QnSession(ctx),
};
