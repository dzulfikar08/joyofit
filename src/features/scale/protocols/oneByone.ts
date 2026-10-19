/**
 * 1byone "Health Scale" and Eufy C1 / P1 / A1 (T9146 / T9147 / T9120): service 0xFFF0, notify 0xFFF4, commands on 0xFFF1.
 *
 * Ported from openScale `scales/OneByoneHandler.kt` (wire level only; `libs/OneByoneLib.kt` is body-composition maths and is not
 * ported). Copyright (C) olie.xdev, GPL-3.0-or-later (https://github.com/oliexdev/openScale).
 * Test vectors: openScale `OneByoneHandlerTest.kt` (frames captured from a 1byone Health Scale session log, incl. coalesced
 * 20-byte notifications, zero-impedance and socks/barefoot pairs) and `ScaleCatalog.kt` (device names).
 *
 * The frame layout is shared; the acceptance rules differ per model (openScale keys them off the peripheral name), so the two
 * name families are two protocols over one session class.
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

const SVC = 'fff0';
const CHR_NOTIFY = 'fff4';
const CHR_WRITE = 'fff1';
const LIVE_FRAME_LEN = 11;
const TYPE_CF = 0xcf;

function xor(bytes: ArrayLike<number>, len: number): number {
  let x = 0;
  for (let i = 0; i < len; i++) x ^= bytes[i];
  return x & 0xff;
}

/** A complete 11-byte live frame: the XOR byte at index 10 covers bytes 0..9. */
export function isLiveFrame(b: Uint8Array): boolean {
  return b.length >= LIVE_FRAME_LEN && b[10] === xor(b, 10);
}

/** 1byone only: byte 9 of 0x00 / 0x36 means the scale locked its weight (values from the vendor app). */
export function isFinalReading(b: Uint8Array): boolean {
  return b.length >= LIVE_FRAME_LEN && (b[9] === 0x00 || b[9] === 0x36);
}

/**
 * Whether bytes 11..17 carry a history timestamp. An 11-byte live frame followed by the first 9 bytes of its duplicate (the
 * scale repeats the final frame and the two can coalesce into one 20-byte notification) is not history.
 */
export function hasHistoryTimestamp(b: Uint8Array): boolean {
  if (b.length < 18) return false;
  return !(isLiveFrame(b) && b[11] === TYPE_CF);
}

/** Local wall-clock fields of `ms` shifted by the phone's offset (read with the UTC getters). */
function localFields(ms: number, tzMin: number): Date {
  return new Date(ms + tzMin * 60_000);
}

function clockCommand(now: number, tzMin: number): number[] {
  const d = localFields(now, tzMin);
  const year = d.getUTCFullYear();
  return [0xf1, (year >>> 8) & 0xff, year & 0xff, d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
}

/** `FD 37 <unit> <group> 00..00 XOR`. The unit is always kilograms (0x00): ScaleUser carries no display unit. */
function modeUnitCommand(): number[] {
  const p = [0xfd, 0x37, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 0];
  p[10] = xor(p, 10);
  return p;
}

/** The scale's history timestamp is local wall-clock time with a big-endian year; null when it is not a real date. */
function historyTime(b: Uint8Array, tzMin: number): number | null {
  const year = (b[11] << 8) | b[12];
  const month = Math.min(12, Math.max(1, b[13]));
  const day = Math.max(1, b[14]);
  const [hh, mm, ss] = [b[15], b[16], b[17]];
  const utc = Date.UTC(year, month - 1, day, hh, mm, ss);
  const d = new Date(utc);
  const valid =
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day &&
    d.getUTCHours() === hh &&
    d.getUTCMinutes() === mm &&
    d.getUTCSeconds() === ss;
  return valid ? utc - tzMin * 60_000 : null;
}

class OneByoneSession implements GattSession {
  private waitAckClock = false;
  private historic = false;
  private historyCount = 0;
  private publishedLive = false;

  constructor(
    private readonly ctx: GattContext,
    /** True for the 1byone Health Scale rules; false for the (long-standing) Eufy rules. */
    private readonly classic: boolean,
  ) {}

  start(_services: DiscoveredService[]): GattStep {
    this.waitAckClock = true;
    return {
      actions: [
        { op: 'subscribe', service: SVC, characteristic: CHR_NOTIFY },
        this.write(modeUnitCommand()),
        this.write(clockCommand(this.ctx.now, this.ctx.timezoneOffsetMin)),
      ],
      readings: [],
    };
  }

  private write(bytes: number[]): GattAction {
    return { op: 'write', service: SVC, characteristic: CHR_WRITE, hex: bytesToHex(Uint8Array.from(bytes)), withResponse: true };
  }

  onValue(service: string, characteristic: string, hex: string, _now: number): GattStep {
    if (normalizeUuid(service) !== SVC || normalizeUuid(characteristic) !== CHR_NOTIFY) return NOTHING;
    const b = hexToBytes(hex);

    if (b.length === 2) {
      if (this.waitAckClock && b[0] === 0xf1 && b[1] === 0x00) {
        this.waitAckClock = false;
        this.historic = true;
        this.historyCount = 0;
        return { actions: [this.write([0xf2, 0x00])], readings: [] };
      }
      if (b[0] === 0xf2 && b[1] === 0x00) {
        if (!this.historic) return NOTHING;
        this.historic = false;
        // Clear the scale's history once everything was read.
        return { actions: this.historyCount > 0 ? [this.write([0xf2, 0x01])] : [], readings: [] };
      }
    }

    if (b.length >= LIVE_FRAME_LEN && b[0] === TYPE_CF) {
      if (this.historic) this.historyCount++;
      const reading = this.measurement(b, this.historic);
      return reading ? { actions: [], readings: [reading] } : NOTHING;
    }
    return NOTHING;
  }

  private measurement(b: Uint8Array, isHistoric: boolean): ScaleReading | null {
    const weightKg = (b[3] | (b[4] << 8)) / 100;
    // Impedance is ((b2 << 8) + b1) * 0.1 ohm (the byte order of the original driver).
    const impedanceTenths = (b[2] << 8) + b[1];
    const status = b[9];
    const hasTimestamp = hasHistoryTimestamp(b);

    if (isHistoric && !hasTimestamp) return null;

    let stable = true;
    if (this.classic) {
      stable = isHistoric || isFinalReading(b);
    } else {
      // Eufy: byte 9 == 1 is the only "not settled" marker and a frame without impedance is discarded.
      if (status === 1) stable = false;
      else if (impedanceTenths === 0) return null;
    }

    if (!(weightKg > 0)) return null;
    // An impossible history date drops the frame (openScale does the same).
    let scaleTime: number | undefined;
    if (hasTimestamp) {
      const t = historyTime(b, this.ctx.timezoneOffsetMin);
      if (t === null) return null;
      scaleTime = t;
    }
    // The settled live reading is sent more than once; keep the first.
    if (stable && !isHistoric) {
      if (this.publishedLive) return null;
      this.publishedLive = true;
    }

    const reading: ScaleReading = { weightKg: Math.round(weightKg * 100) / 100, stable, unit: 'kg' };
    if (stable && impedanceTenths > 0) reading.impedanceOhm = impedanceTenths / 10;
    if (scaleTime !== undefined) reading.scaleTime = scaleTime;
    return reading;
  }
}

function nameOf(info: GattInfo): string {
  return (info.name ?? '').toLowerCase();
}

export const ONE_BY_ONE_CLASSIC_PROTOCOL: GattProtocol = {
  kind: 'gatt',
  id: 'one-by-one-health-scale',
  label: '1byone Health Scale', // i18n-ok scale model name
  brands: ['1byone', 'New iWellness 4.0'],
  source: ['scales/OneByoneHandler.kt', 'libs/OneByoneLib.kt'],
  matches: (info) => nameOf(info).includes('health scale'),
  createSession: (ctx) => new OneByoneSession(ctx, true),
};

export const EUFY_ONE_BY_ONE_PROTOCOL: GattProtocol = {
  kind: 'gatt',
  id: 'eufy-one-by-one',
  label: 'Eufy Smart Scale C1 / P1 / A1', // i18n-ok scale model name
  brands: ['Eufy (T9146 C1, T9147 P1, T9120 A1)'],
  source: ['scales/OneByoneHandler.kt', 'libs/OneByoneLib.kt'],
  matches: (info) => {
    const n = nameOf(info);
    return n.includes('t9146') || n.includes('t9147') || n.includes('t9120');
  },
  createSession: (ctx) => new OneByoneSession(ctx, false),
};

export const ONE_BY_ONE_PROTOCOLS: GattProtocol[] = [ONE_BY_ONE_CLASSIC_PROTOCOL, EUFY_ONE_BY_ONE_PROTOCOL];
