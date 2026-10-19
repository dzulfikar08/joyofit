/**
 * Bluetooth SIG Weight Scale Service (0x181D, Weight Measurement 0x2A9D) and Body Composition Service (0x181B, Body Composition
 * Measurement 0x2A9C), as implemented by openScale's StandardWeightProfileHandler. Many scales ship this profile (Beurer BF series,
 * Sanitas SBF series, A&D UC-352BLE, ...).
 *
 * Ported from openScale scales/StandardWeightProfileHandler.kt (https://github.com/oliexdev/openScale)
 * Copyright (C) olie.xdev, GPL-3.0-or-later.
 * Test vectors: openScale test scales/StandardWeightProfileHandlerTest.kt (unedited captures from the issues cited there).
 *
 * Not ported: the User Data Service (0x181C) user registration / consent handshake. It needs a persisted slot <-> consent code
 * mapping and an interactive picker, which the pure session contract has no place for.
 */
import { hexToBytes } from '../../sensors/gatt';
import { normalizeUuid } from '../uuid';
import {
  NOTHING,
  type DiscoveredService,
  type GattAction,
  type GattContext,
  type GattInfo,
  type GattProtocol,
  type GattSession,
  type ReportedBody,
  type ScaleProtocol,
  type ScaleReading,
} from '../types';
import { MI_SCALE_PROTOCOL } from './miscale';

const SVC_WEIGHT = '181d';
const CHR_WEIGHT = '2a9d';
const SVC_BODY = '181b';
const CHR_BODY = '2a9c';
const SVC_TIME = '1805';
const CHR_TIME = '2a2b';

const LB_TO_KG = 0.45359237;

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Epoch ms of a Bluetooth Date Time (7 bytes at `off`) taken as the scale's local time; undefined when unknown or impossible. */
function dateTime(b: Uint8Array, off: number, tzMin: number): number | undefined {
  const year = b[off] | (b[off + 1] << 8);
  const month = b[off + 2];
  const day = b[off + 3];
  const hour = b[off + 4];
  const minute = b[off + 5];
  const second = b[off + 6];
  if (year === 0 || month === 0 || day === 0) return undefined;
  const t = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(t);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second
  ) {
    return undefined;
  }
  return t - tzMin * 60_000;
}

/** Cursor that never reads past the end; `short` flips when a field was missing. */
class Cursor {
  short = false;
  pos = 0;
  constructor(readonly b: Uint8Array) {}
  u8(): number {
    if (this.pos + 1 > this.b.length) {
      this.short = true;
      return 0;
    }
    return this.b[this.pos++];
  }
  u16(): number {
    if (this.pos + 2 > this.b.length) {
      this.short = true;
      this.pos = this.b.length;
      return 0;
    }
    const v = this.b[this.pos] | (this.b[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }
  /** Position of a 7 byte date time, advancing past it. */
  skipDate(): number {
    const at = this.pos;
    if (at + 7 > this.b.length) this.short = true;
    this.pos = Math.min(this.b.length, at + 7);
    return at;
  }
}

/** Mass fields: 0.005 kg, or 0.01 lb when the imperial flag is set. */
const massKg = (raw: number, si: boolean): number => (si ? raw * 0.005 : raw * 0.01 * LB_TO_KG);

interface WeightFrame {
  weightKg: number;
  unit: 'kg' | 'lb';
  scaleTime?: number;
  userSlot?: number;
  bmi?: number;
}

/** Weight Measurement (2A9D). Null for short frames and for 0xFFFF ("measurement unsuccessful") / zero weights. */
export function decodeWeightMeasurement(bytes: Uint8Array, tzMin = 0): WeightFrame | null {
  if (bytes.length < 3) return null;
  const c = new Cursor(bytes);
  const flags = c.u8();
  const si = (flags & 0x01) === 0;
  const raw = c.u16();
  if (raw === 0xffff || raw === 0) return null;
  const frame: WeightFrame = { weightKg: round2(massKg(raw, si)), unit: si ? 'kg' : 'lb' };
  if (flags & 0x02) {
    const at = c.skipDate();
    if (!c.short) frame.scaleTime = dateTime(bytes, at, tzMin);
  }
  if (flags & 0x04) {
    const slot = c.u8();
    if (!c.short && slot !== 0xff) frame.userSlot = slot;
  }
  if (flags & 0x08) {
    const bmi = c.u16();
    // Height follows (0.001 m / 0.1 in); the value is not used.
    c.u16();
    if (!c.short && bmi > 0 && bmi !== 0xffff) frame.bmi = Math.round(bmi) / 10;
  }
  return frame;
}

interface BodyFrame {
  weightKg?: number;
  unit: 'kg' | 'lb';
  scaleTime?: number;
  userSlot?: number;
  impedanceOhm?: number;
  /** Water mass in kg, converted to a percentage once the weight is known. */
  waterKg?: number;
  reported: ReportedBody;
}

/** Body Composition Measurement (2A9C). Null for short frames. Optional fields are read in the order the SIG spec lists them. */
export function decodeBodyComposition(bytes: Uint8Array, tzMin = 0): BodyFrame | null {
  if (bytes.length < 4) return null;
  const c = new Cursor(bytes);
  const flags = c.u16();
  const si = (flags & 0x0001) === 0;
  const frame: BodyFrame = { unit: si ? 'kg' : 'lb', reported: {} };

  const fat = c.u16();
  if (fat !== 0 && fat !== 0xffff) frame.reported.bodyFatPct = fat / 10;

  if (flags & 0x0002) {
    const at = c.skipDate();
    if (!c.short) frame.scaleTime = dateTime(bytes, at, tzMin);
  }
  if (flags & 0x0004) {
    const slot = c.u8();
    if (!c.short && slot !== 0xff) frame.userSlot = slot;
  }
  if (flags & 0x0008) {
    const kj = c.u16();
    if (!c.short && kj !== 0 && kj !== 0xffff) frame.reported.bmrKcal = Math.round((kj / 4.1868) * 10) / 10;
  }
  if (flags & 0x0010) {
    const v = c.u16();
    if (!c.short && v !== 0 && v !== 0xffff) frame.reported.musclePct = v / 10;
  }
  if (flags & 0x0020) {
    const v = c.u16();
    if (!c.short && v !== 0 && v !== 0xffff) frame.reported.muscleKg = round2(massKg(v, si));
  }
  if (flags & 0x0040) {
    const v = c.u16();
    if (!c.short && v !== 0 && v !== 0xffff) frame.reported.leanKg = round2(massKg(v, si));
  }
  if (flags & 0x0080) c.u16(); // soft lean mass: not part of ReportedBody
  if (flags & 0x0100) {
    const v = c.u16();
    if (!c.short && v !== 0 && v !== 0xffff) frame.waterKg = massKg(v, si);
  }
  if (flags & 0x0200) {
    const z = c.u16();
    if (!c.short && z !== 0 && z !== 0xffff) frame.impedanceOhm = z / 10;
  }
  if (flags & 0x0400) {
    const w = c.u16();
    if (!c.short && w !== 0 && w !== 0xffff) frame.weightKg = round2(massKg(w, si));
  }
  // Height (0x0800) and the multi-packet flag (0x1000) carry nothing used here.
  return frame;
}

function hasProp(services: DiscoveredService[], service: string, chr: string, props: string[]): boolean {
  const s = services.find((x) => normalizeUuid(x.uuid) === service);
  const ch = s?.characteristics.find((x) => normalizeUuid(x.uuid) === chr);
  return !!ch && ch.properties.some((p) => props.includes(p));
}

/** Current Time (2A2B): year LE, month, day, hour, minute, second, day of week (1 = Monday), fractions, adjust reason. */
export function currentTimePayload(nowMs: number, tzMin: number): string {
  const d = new Date(nowMs + tzMin * 60_000);
  const year = d.getUTCFullYear();
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const bytes = [year & 0xff, year >> 8, d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), dow, 0, 0];
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function createSession(ctx: GattContext): GattSession {
  /** Weight of the last 2A9D frame, waiting for the 2A9C that usually follows it (as openScale merges them). */
  let pending: WeightFrame | null = null;

  return {
    start(services) {
      const actions: GattAction[] = [];
      const notif = ['notify', 'indicate'];
      if (hasProp(services, SVC_WEIGHT, CHR_WEIGHT, notif)) actions.push({ op: 'subscribe', service: SVC_WEIGHT, characteristic: CHR_WEIGHT });
      if (hasProp(services, SVC_BODY, CHR_BODY, notif)) actions.push({ op: 'subscribe', service: SVC_BODY, characteristic: CHR_BODY });
      if (hasProp(services, SVC_TIME, CHR_TIME, ['write', 'writeNoResponse'])) {
        actions.push({
          op: 'write',
          service: SVC_TIME,
          characteristic: CHR_TIME,
          hex: currentTimePayload(ctx.now, ctx.timezoneOffsetMin),
          withResponse: hasProp(services, SVC_TIME, CHR_TIME, ['write']),
        });
      }
      return actions.length ? { actions, readings: [] } : NOTHING;
    },

    onValue(service, characteristic, hex) {
      const s = normalizeUuid(service);
      const ch = normalizeUuid(characteristic);
      const bytes = hexToBytes(hex);
      const tz = ctx.timezoneOffsetMin;

      if (s === SVC_WEIGHT && ch === CHR_WEIGHT) {
        const w = decodeWeightMeasurement(bytes, tz);
        if (!w) return NOTHING;
        pending = w;
        const reading: ScaleReading = { weightKg: w.weightKg, stable: true, unit: w.unit };
        if (w.scaleTime !== undefined) reading.scaleTime = w.scaleTime;
        if (w.userSlot !== undefined) reading.userSlot = w.userSlot;
        if (w.bmi !== undefined) reading.reported = { bmi: w.bmi };
        return { actions: [], readings: [reading] };
      }

      if (s === SVC_BODY && ch === CHR_BODY) {
        const b = decodeBodyComposition(bytes, tz);
        if (!b) return NOTHING;
        const weightKg = b.weightKg ?? pending?.weightKg;
        if (weightKg === undefined) return NOTHING;
        const reported: ReportedBody = { ...b.reported };
        if (b.waterKg !== undefined) reported.waterPct = round2((b.waterKg / weightKg) * 100);
        if (pending?.bmi !== undefined) reported.bmi = pending.bmi;
        const hasBody = b.reported.bodyFatPct !== undefined || reported.waterPct !== undefined || b.reported.musclePct !== undefined || b.reported.muscleKg !== undefined || b.reported.leanKg !== undefined || b.impedanceOhm !== undefined;
        const prev = pending;
        pending = null;
        // No foot contact: the scale sends an all-zero composition; the weight reading was already emitted.
        if (!hasBody) return NOTHING;
        const reading: ScaleReading = { weightKg, stable: true, unit: b.unit, reported };
        if (b.impedanceOhm !== undefined) reading.impedanceOhm = b.impedanceOhm;
        const time = b.scaleTime ?? prev?.scaleTime;
        if (time !== undefined) reading.scaleTime = time;
        const slot = b.userSlot ?? prev?.userSlot;
        if (slot !== undefined) reading.userSlot = slot;
        return { actions: [], readings: [reading] };
      }
      return NOTHING;
    },
  };
}

/** Matches any scale that advertises the SIG Weight Scale or Body Composition service. */
export const STANDARD_WEIGHT_PROTOCOL: GattProtocol = {
  kind: 'gatt',
  id: 'standard-weight-profile',
  label: 'Bluetooth standard weight scale', // i18n-ok scale model name
  brands: ['Bluetooth SIG Weight Scale / Body Composition', 'Beurer (BF105, BF500, BF600, BF720, BF950)', 'Sanitas (SBF73, SBF76, SBF77)', 'A&D UC-352BLE'],
  source: ['scales/StandardWeightProfileHandler.kt'],
  matches(info: GattInfo): boolean {
    return info.serviceUuids.some((u) => {
      const n = normalizeUuid(u);
      return n === SVC_WEIGHT || n === SVC_BODY;
    });
  },
  createSession,
};

/** Registry entries of this file. Specific vendors first: the generic profile matches nearly everything with 181D/181B. */
export const STANDARD_PROTOCOLS: ScaleProtocol[] = [MI_SCALE_PROTOCOL, STANDARD_WEIGHT_PROTOCOL];
