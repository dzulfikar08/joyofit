/**
 * Senssun body composition scales ("SENSSUN FAT").
 *
 * Ported from openScale (https://github.com/oliexdev/openScale): scales/SenssunHandler.kt
 * Copyright (C) olie.xdev, GPL-3.0-or-later.
 *
 * openScale has no test for this handler; the test vectors are derived from the frame layout in the source, not a capture.
 *
 * Two GATT layouts: model A (service fff0, notify fff1, write fff2) and model B (service ffb0, notify+write ffb2).
 * Notifications start with a 0xFF pad byte, then the frame `A5 [b1] [b2] [b3] [b4] [type] ...`. The type at index 5 is
 * A0 live / AA stable weight (u16 BE /10 at 1), B0 fat (1) + water (3), C0 muscle (1) + bone (bytes 3,4 swapped),
 * D0 kcal, BE fat test error. Handshake messages are 9 bytes `A5 [cmd] [3 data bytes] 00 00 [sum of bytes 1..6] 00`.
 */
import { NOTHING, type DiscoveredService, type GattAction, type GattContext, type GattProtocol, type GattSession, type GattStep, type ReportedBody } from '../types';
import { bytesToHex, hexToBytes } from '../../sensors/gatt';

interface Model {
  service: string;
  notify: string;
  write: string;
}

const MODEL_A: Model = { service: 'fff0', notify: 'fff1', write: 'fff2' };
const MODEL_B: Model = { service: 'ffb0', notify: 'ffb2', write: 'ffb2' };
const USER_ID = 1;

function message(cmd: number, b2: number, b3: number, b4: number): string {
  const m = new Uint8Array(9);
  m[0] = 0xa5;
  m[1] = cmd;
  m[2] = b2 & 0xff;
  m[3] = b3 & 0xff;
  m[4] = b4 & 0xff;
  let sum = 0;
  for (let i = 1; i < 7; i++) sum = (sum + m[i]) & 0xff;
  m[7] = sum;
  return bytesToHex(m);
}

/** `A5 30 [yy] [day-of-year BE]`, in the phone's local time. */
export function senssunDateMessage(nowMs: number, tzOffsetMin: number): string {
  const d = new Date(nowMs + tzOffsetMin * 60000);
  const doy = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
  return message(0x30, d.getUTCFullYear() % 100, doy >> 8, doy & 0xff);
}

/** `A5 31 [hh] [mm] [ss]`, in the phone's local time. */
export function senssunTimeMessage(nowMs: number, tzOffsetMin: number): string {
  const d = new Date(nowMs + tzOffsetMin * 60000);
  return message(0x31, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

/** `A5 10 [(male ? 15 : 0) * 16 + id] [age] [height cm]`. */
export function senssunUserMessage(user: { heightCm: number; ageYears: number; male: boolean } | undefined): string {
  const u = user ?? { heightCm: 170, ageYears: 30, male: true };
  return message(0x10, (u.male ? 240 : 0) + USER_ID, u.ageYears, Math.trunc(u.heightCm));
}

function createSession(ctx: GattContext): GattSession {
  let active: Model | null = null;
  let weight = 0;
  let fat = 0;
  let water = 0;
  let muscle = 0;
  let bone = 0;
  let stabilized = false;
  let mask = 0;

  const write = (m: Model, hex: string): GattAction => ({ op: 'write', service: m.service, characteristic: m.write, hex, withResponse: true });
  const u16 = (f: Uint8Array, i: number) => (f[i] << 8) | f[i + 1];

  const finish = (withBody: boolean): GattStep => {
    if (!stabilized || !(weight > 0)) return { actions: [], readings: [], done: true };
    const reported: ReportedBody = {};
    if (withBody) {
      if (fat > 0) reported.bodyFatPct = fat / 10;
      if (water > 0) reported.waterPct = water / 10;
      if (muscle > 0) reported.musclePct = muscle / 10;
      if (bone > 0) reported.boneKg = bone / 10;
    }
    const reading = { weightKg: weight / 10, stable: true, unit: 'kg' as const, ...(Object.keys(reported).length ? { reported } : {}) };
    return { actions: [], readings: [reading], done: true };
  };

  return {
    start(services: DiscoveredService[]): GattStep {
      const has = (m: Model) => services.some((s) => s.uuid === m.service);
      // Subscribe to whichever layout exists; unknown (nothing matched) means try both like openScale.
      const models = [MODEL_A, MODEL_B].filter(has);
      const targets = models.length ? models : [MODEL_A, MODEL_B];
      if (models.length === 1) active = models[0];
      const actions: GattAction[] = targets.map((m) => ({ op: 'subscribe', service: m.service, characteristic: m.notify }));
      for (const m of targets) {
        actions.push(write(m, senssunDateMessage(ctx.now, ctx.timezoneOffsetMin)), write(m, senssunTimeMessage(ctx.now, ctx.timezoneOffsetMin)));
      }
      return { actions, readings: [] };
    },
    onValue(service, characteristic, hex): GattStep {
      const data = hexToBytes(hex);
      if (data.length < 7 || data[0] !== 0xff || data[1] !== 0xa5) return NOTHING;
      if (!active) active = characteristic === MODEL_B.notify && service === MODEL_B.service ? MODEL_B : characteristic === MODEL_A.notify ? MODEL_A : null;
      const f = data.subarray(1);
      let actions: GattAction[] = [];
      const readings = [];
      switch (f[5]) {
        case 0xa0:
        case 0xaa: {
          if (stabilized) break;
          stabilized = f[5] === 0xaa;
          weight = u16(f, 1);
          if (stabilized) {
            mask |= 0x01;
            const targets = active ? [active] : [MODEL_A, MODEL_B];
            actions = targets.map((m) => write(m, senssunUserMessage(ctx.user)));
          } else if (weight > 0) {
            readings.push({ weightKg: weight / 10, stable: false, unit: 'kg' as const });
          }
          break;
        }
        case 0xbe:
          return finish(false);
        case 0xb0:
          fat = u16(f, 1);
          water = u16(f, 3);
          mask |= 0x02;
          break;
        case 0xc0:
          muscle = u16(f, 1);
          bone = (f[4] << 8) | f[3];
          mask |= 0x04;
          break;
        case 0xd0:
          mask |= 0x08;
          break;
      }
      if (mask === 0x0f) return finish(true);
      return { actions, readings };
    },
  };
}

export const SENSSUN: GattProtocol = {
  id: 'senssun-fat',
  kind: 'gatt',
  label: 'Senssun Fat', // i18n-ok scale model name
  brands: ['Senssun'],
  source: ['scales/SenssunHandler.kt'],
  matches: (i) => (i.name ?? '').toLowerCase() === 'senssun fat',
  createSession,
};
