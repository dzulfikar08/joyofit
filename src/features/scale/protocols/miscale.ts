/**
 * Xiaomi Mi Scale v1 (MI_SCALE, weight only, services 0x181D) and v2 / Mi Body Composition Scale (MIBCS, MIBFS, MI SCALE2, 0x181B
 * with the vendor 0x1530 config service), as implemented by openScale's MiScaleHandler.
 *
 * Ported from openScale scales/MiScaleHandler.kt (https://github.com/oliexdev/openScale)
 * Copyright (C) olie.xdev, GPL-3.0-or-later.
 * Test material: openScale test scales/MiScaleHandlerVariantTest.kt (variant detection from the GATT table and the 10 byte frame
 * layout). That test has no captured 13 byte v2 frame; the v2 test frames here are built from the layout the handler parses.
 *
 * Wire level only: MiScaleLib's body composition formulas are not ported; the impedance is output as is.
 * openScale's "last imported timestamp" bookkeeping is not here; each reading carries `scaleTime` so the app can dedupe.
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
  type GattStep,
  type ScaleReading,
  type WeightUnit,
} from '../types';

const SVC_BODY = '181b';
const SVC_WEIGHT = '181d';
const CHR_TIME = '2a2b';
const CHR_WEIGHT = '2a9d';
const SVC_CFG = '00001530-0000-3512-2118-0009af100700';
const CHR_CFG = '00001542-0000-3512-2118-0009af100700';
const CHR_HISTORY = '00002a2f-0000-3512-2118-0009af100700';

const ENABLE_HISTORY_MAGIC = '01968abd62';
const LB_TO_KG = 0.45359237;
const PLAUSIBLE_MS = 20 * 365.25 * 86_400_000;
/** openScale sends the app user id as the transfer marker; the contract has no user id, so slot 1 stands in. */
const UNIQ = 1;

const hex2 = (b: number): string => b.toString(16).padStart(2, '0');

function isMiName(name: string | null): boolean {
  if (!name) return false;
  const n = name.toUpperCase();
  return n.startsWith('MIBCS') || n.startsWith('MIBFS') || n === 'MI SCALE2' || n.startsWith('MI_SCALE');
}

/** Epoch ms of a minute-resolution local date; undefined when the fields cannot be a date. */
function localTime(year: number, month: number, day: number, hour: number, minute: number, second: number, tzMin: number): number | undefined {
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined;
  const t = Date.UTC(year, month - 1, day, hour, minute, second);
  if (new Date(t).getUTCDate() !== day) return undefined;
  return t - tzMin * 60_000;
}

function weightOf(raw: number, lbs: boolean, catty: boolean): { kg: number; unit: WeightUnit } {
  if (lbs) return { kg: (raw / 100) * LB_TO_KG, unit: 'lb' };
  if (catty) return { kg: (raw / 100) * 0.5, unit: 'jin' };
  return { kg: raw / 200, unit: 'kg' };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** v2 13 byte frame: [c0][c1][yearLE(2)][mon][day][h][min][s?][imp LE(2)][weight LE(2)]. Removed frames and zero weights give null. */
export function parseLive13(d: Uint8Array, tzMin = 0): ScaleReading | null {
  if (d.length !== 13) return null;
  const c0 = d[0];
  const c1 = d[1];
  if (c1 & 0x80) return null; // removed
  const raw = d[11] | (d[12] << 8);
  if (raw === 0) return null;
  const { kg, unit } = weightOf(raw, (c0 & 0x01) !== 0, (c1 & 0x40) !== 0);
  const reading: ScaleReading = { weightKg: round2(kg), stable: (c1 & 0x20) !== 0, unit };
  const time = localTime(d[2] | (d[3] << 8), d[4], d[5], d[6], d[7], 0, tzMin);
  if (time !== undefined) reading.scaleTime = time;
  if (c1 & 0x02) {
    const imp = d[9] | (d[10] << 8);
    if (imp > 0) reading.impedanceOhm = imp;
  }
  return reading;
}

/** 10 byte record: [status][weight LE(2)][yearLE(2)][mon][day][h][min][s]. History needs a plausible date, like openScale. */
export function parseHistory10(d: Uint8Array, now: number, tzMin = 0): ScaleReading | null {
  if (d.length !== 10) return null;
  const status = d[0];
  if (status & 0x80) return null; // removed
  const raw = d[1] | (d[2] << 8);
  if (raw === 0) return null;
  const { kg, unit } = weightOf(raw, (status & 0x01) !== 0, (status & 0x10) !== 0);
  const time = localTime(d[3] | (d[4] << 8), d[5], d[6], d[7], d[8], 0, tzMin);
  if (time === undefined || Math.abs(time - now) > PLAUSIBLE_MS) return null;
  return { weightKg: round2(kg), stable: (status & 0x20) !== 0, unit, scaleTime: time };
}

function findService(services: DiscoveredService[], uuid: string): DiscoveredService | undefined {
  return services.find((s) => normalizeUuid(s.uuid) === uuid);
}

const hasChar = (s: DiscoveredService | undefined, chr: string): boolean => !!s?.characteristics.some((c) => normalizeUuid(c.uuid) === chr);

/** Same detection order as openScale: the vendor history characteristic first, plain service presence as fallback. */
export function detectVariant(services: DiscoveredService[]): { variant: 'v1' | 'v2'; primary: string; alternate: string } | null {
  const body = findService(services, SVC_BODY);
  const weight = findService(services, SVC_WEIGHT);
  if (hasChar(body, CHR_HISTORY) || (body && !hasChar(weight, CHR_HISTORY))) return { variant: 'v2', primary: SVC_BODY, alternate: SVC_WEIGHT };
  if (weight) return { variant: 'v1', primary: SVC_WEIGHT, alternate: SVC_BODY };
  return null;
}

/** Current Time (2A2B) as the Mi scale wants it: year LE, month, day, hour, minute, second, 00 00 01. */
export function miTimePayload(nowMs: number, tzMin: number): string {
  const d = new Date(nowMs + tzMin * 60_000);
  const y = d.getUTCFullYear();
  return [y & 0xff, y >> 8, d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), 0, 0, 1].map(hex2).join('');
}

const onlyLast = `01ffff${hex2(UNIQ >> 8)}${hex2(UNIQ & 0xff)}`;

function createSession(ctx: GattContext): GattSession {
  let history = new Uint8Array(0);
  let variant: 'v1' | 'v2' = 'v1';

  /** Whole 10 byte records of the buffer; the remainder stays buffered. */
  function drainHistory(now: number): ScaleReading[] {
    const readings: ScaleReading[] = [];
    const full = Math.floor(history.length / 10) * 10;
    for (let off = 0; off < full; off += 10) {
      const r = parseHistory10(history.subarray(off, off + 10), now, ctx.timezoneOffsetMin);
      if (r) readings.push(r);
    }
    history = history.slice(full);
    return readings;
  }

  return {
    start(services) {
      const found = detectVariant(services);
      if (!found) return { actions: [], readings: [], done: true };
      variant = found.variant;
      const { primary, alternate } = found;
      const actions: GattAction[] = [];
      const write = (service: string, characteristic: string, hex: string): void => {
        actions.push({ op: 'write', service, characteristic, hex, withResponse: true });
      };
      const subscribe = (service: string, characteristic: string): void => {
        actions.push({ op: 'subscribe', service, characteristic });
      };

      if (variant === 'v2' && hasChar(findService(services, SVC_CFG), CHR_CFG)) write(SVC_CFG, CHR_CFG, '06040000'); // unit: kg

      const timeService = [primary, alternate].find((s) => hasChar(findService(services, s), CHR_TIME));
      if (timeService) write(timeService, CHR_TIME, miTimePayload(ctx.now, ctx.timezoneOffsetMin));

      if (variant === 'v1') {
        write(primary, CHR_HISTORY, ENABLE_HISTORY_MAGIC);
        subscribe(primary, CHR_HISTORY);
        if (hasChar(findService(services, primary), CHR_WEIGHT)) subscribe(primary, CHR_WEIGHT);
      } else {
        subscribe(primary, CHR_HISTORY);
        write(primary, CHR_HISTORY, ENABLE_HISTORY_MAGIC);
      }
      write(primary, CHR_HISTORY, onlyLast);
      write(primary, CHR_HISTORY, '02');
      return { actions, readings: [] };
    },

    onValue(service, characteristic, hex, now): GattStep {
      const s = normalizeUuid(service);
      const ch = normalizeUuid(characteristic);
      const d = hexToBytes(hex);
      if (d.length === 0) return NOTHING;

      if (ch === CHR_WEIGHT) {
        if (variant !== 'v1' || d.length !== 10) return NOTHING;
        const r = parseHistory10(d, now, ctx.timezoneOffsetMin);
        return r ? { actions: [], readings: [r] } : NOTHING;
      }
      if (ch !== CHR_HISTORY) return NOTHING;

      // End of transfer: flush, acknowledge, finished.
      if (d.length === 1 && d[0] === 0x03) {
        const readings = history.length % 10 === 0 ? drainHistory(now) : [];
        history = new Uint8Array(0);
        const ack = `04ffff${hex2(UNIQ >> 8)}${hex2(UNIQ & 0xff)}`;
        return {
          actions: [
            { op: 'write', service: s, characteristic: CHR_HISTORY, hex: '03', withResponse: true },
            { op: 'write', service: s, characteristic: CHR_HISTORY, hex: ack, withResponse: true },
          ],
          readings,
          done: true,
        };
      }

      // 0x01 <count> 0x00 <marker>: response to "only last" / "all". Other markers are echoes of the magic write.
      if (d.length >= 6 && d[0] === 0x01) {
        const marker = (d[2] << 8) | d[3];
        if (marker === 0xffff || marker === 0) history = new Uint8Array(0);
        return NOTHING;
      }

      if (d.length === 13 || d.length === 26) {
        const readings: ScaleReading[] = [];
        for (let off = 0; off < d.length; off += 13) {
          const r = parseLive13(d.subarray(off, off + 13), ctx.timezoneOffsetMin);
          if (r) readings.push(r);
        }
        return readings.length ? { actions: [], readings } : NOTHING;
      }

      if (d.length < 2) return NOTHING;
      const joined = new Uint8Array(history.length + d.length);
      joined.set(history);
      joined.set(d, history.length);
      history = joined;
      const readings = drainHistory(now);
      return readings.length ? { actions: [], readings } : NOTHING;
    },
  };
}

export const MI_SCALE_PROTOCOL: GattProtocol = {
  kind: 'gatt',
  id: 'xiaomi-mi-scale',
  label: 'Xiaomi Mi Scale (v1 / v2)', // i18n-ok scale model name
  brands: ['Xiaomi Mi Smart Scale', 'Xiaomi Mi Body Composition Scale', 'Mi Fit / Zepp Life'],
  source: ['scales/MiScaleHandler.kt', 'libs/MiScaleLib.kt'],
  matches(info: GattInfo): boolean {
    return isMiName(info.name);
  },
  createSession,
};
