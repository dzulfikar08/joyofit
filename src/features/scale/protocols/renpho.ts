/**
 * RENPHO ES-WBE28 ("RENPHO-SCALE-xxxx" without the QN services 0xFFE0 / 0xFFF0): standard Body Composition / User Data / Weight
 * Scale / Current Time services with a vendor handshake and a proprietary weight frame on 0x2A9D.
 *
 * Ported from openScale `scales/RenphoHandler.kt`. Copyright (C) olie.xdev, GPL-3.0-or-later
 * (https://github.com/oliexdev/openScale).
 *
 * openScale has no test vectors for this handler (RenphoHandler has no test file, ScaleCatalog.kt lists only the name), so the
 * tests are built from the frame documented in the handler: `2E <raw lo> <raw hi>`, kg = raw / 20.
 *
 * Differences from openScale: ScaleUser carries no birth date, so the Date-of-Birth write (0x2A85) is left out (the age write
 * 0x2A80 is kept); the athlete flag is always the non-athlete value (no activity level); the Body Composition indication (0x2A9C)
 * is vendor-specific and openScale does not decode it either. Frames carry no stability marker, openScale publishes every
 * 0x2E frame as a measurement, and so does this port (`stable: true`).
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
} from '../types';
import { normalizeUuid } from '../uuid';

const SVC_BODY_COMP = '181b';
const SVC_USER_DATA = '181c';
const SVC_WEIGHT = '181d';
const SVC_TIME = '1805';

/** Current Time payload: year LE, month, day, h, m, s, day of week (1 = Monday .. 7 = Sunday), fractions, adjust reason. */
function currentTimePayload(nowMs: number, tzMin: number): number[] {
  const d = new Date(nowMs + tzMin * 60_000);
  const year = d.getUTCFullYear();
  const dow = ((d.getUTCDay() + 6) % 7) + 1;
  return [year & 0xff, (year >>> 8) & 0xff, d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), dow, 0, 0];
}

class RenphoSession implements GattSession {
  constructor(private readonly ctx: GattContext) {}

  start(_services: DiscoveredService[]): GattStep {
    const sub = (service: string, characteristic: string): GattAction => ({ op: 'subscribe', service, characteristic });
    const write = (service: string, characteristic: string, bytes: number[]): GattAction => ({
      op: 'write',
      service,
      characteristic,
      hex: bytesToHex(Uint8Array.from(bytes)),
      withResponse: true,
    });
    const actions: GattAction[] = [
      sub(SVC_TIME, '2a2b'),
      sub(SVC_USER_DATA, '2a9f'),
      sub(SVC_TIME, 'fff1'),
      sub(SVC_BODY_COMP, 'ffe1'),
      write(SVC_TIME, '2a2b', currentTimePayload(this.ctx.now, this.ctx.timezoneOffsetMin)),
      write(SVC_BODY_COMP, 'ffe2', [0x10, 0x01, 0x00, 0x11]),
      write(SVC_BODY_COMP, 'ffe2', [0x03, 0x00, 0x01, 0x04]),
      // User Data Control Point: consent (0x02), user index 0xAA, consent code 0x270F.
      write(SVC_USER_DATA, '2a9f', [0x02, 0xaa, 0x0f, 0x27]),
    ];
    const u = this.ctx.user;
    if (u) {
      const height = Math.min(300, Math.max(0, Math.trunc(u.heightCm)));
      actions.push(
        write(SVC_USER_DATA, '2a8c', [u.male ? 0 : 1]),
        write(SVC_USER_DATA, '2a8e', [height & 0xff, (height >>> 8) & 0xff]),
        write(SVC_USER_DATA, '2a80', [Math.min(120, Math.max(0, Math.trunc(u.ageYears)))]),
        write(SVC_USER_DATA, '2aff', [0x03, 0x00]),
      );
    }
    actions.push(
      { op: 'read', service: SVC_BODY_COMP, characteristic: '2a9b' },
      sub(SVC_WEIGHT, '2a9d'),
      sub(SVC_BODY_COMP, '2a9c'),
    );
    return { actions, readings: [] };
  }

  onValue(service: string, characteristic: string, hex: string, _now: number): GattStep {
    if (normalizeUuid(service) !== SVC_WEIGHT || normalizeUuid(characteristic) !== '2a9d') return NOTHING;
    const b = hexToBytes(hex);
    if (b.length < 3 || b[0] !== 0x2e) return NOTHING;
    const weightKg = ((b[2] << 8) | b[1]) / 20;
    if (!(weightKg > 0)) return NOTHING;
    return { actions: [], readings: [{ weightKg: Math.round(weightKg * 100) / 100, stable: true, unit: 'kg' }] };
  }
}

export const RENPHO_PROTOCOL: GattProtocol = {
  kind: 'gatt',
  id: 'renpho-es-wbe28',
  label: 'RENPHO ES-WBE28', // i18n-ok scale model name
  brands: ['Renpho'],
  source: ['scales/RenphoHandler.kt'],
  matches: (info: GattInfo) => {
    const uuids = info.serviceUuids.map(normalizeUuid);
    // QN-based Renpho scales are handled by the QN protocol.
    if (uuids.includes('ffe0') || uuids.includes('fff0')) return false;
    return (info.name ?? '').toLowerCase().includes('renpho-scale');
  },
  createSession: (ctx) => new RenphoSession(ctx),
};
