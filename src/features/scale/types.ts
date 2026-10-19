/**
 * Contract of the scale decoders: pure TypeScript, no React Native imports, so every decoder is unit-tested with captured byte
 * vectors and new ones can ship over the air. The native module (`modules/ble-sensors`) only delivers advertisements and GATT
 * bytes; everything that knows a vendor protocol lives under `protocols/`.
 *
 * Two kinds of protocol:
 *  - `broadcast`: the weight rides in the advertisement (manufacturer or service data). Nothing is connected.
 *  - `gatt`: the app connects, subscribes and (for most vendors) writes a handshake. A `GattSession` is a pure state machine: the
 *    driver (`driver.ts`) feeds it discovered services and notifications and executes the actions it returns.
 *
 * Ported from openScale (https://github.com/oliexdev/openScale, GPL-3.0-or-later; JoyoFit is AGPL-3.0, compatible). Every protocol
 * names its openScale source files in `source`, and keeps openScale's copyright notice in its file header.
 */

export type WeightUnit = 'kg' | 'lb' | 'jin' | 'st';

/** The person the scale is weighing, for protocols that send user data to the scale or compute body composition. */
export interface ScaleUser {
  heightCm: number;
  ageYears: number;
  male: boolean;
}

/** Body values the scale itself computed and sent. Never filled from a formula here (see `bodyComposition.ts` for estimates). */
export interface ReportedBody {
  bodyFatPct?: number;
  /** Total body water, percent of body weight. */
  waterPct?: number;
  /** Muscle, percent of body weight. */
  musclePct?: number;
  muscleKg?: number;
  boneKg?: number;
  bmi?: number;
  /** Visceral fat rating (vendor scale, usually 1..59). */
  visceralFat?: number;
  bmrKcal?: number;
  proteinPct?: number;
  /** Fat free mass / lean body mass, kg. */
  leanKg?: number;
  bodyAge?: number;
}

/** One weigh-in frame. `stable === false` frames are the live reading while the person still steps on / settles. */
export interface ScaleReading {
  /** Kilograms, rounded to 0.01. Decoders convert lb / jin / st. */
  weightKg: number;
  /** True for the final, settled value. */
  stable: boolean;
  /** The unit the scale was showing, when its frame says. */
  unit?: WeightUnit;
  /** Bioimpedance in ohm (the main / 500 Ohm channel), when the frame carries one and it is a real measurement (> 0). */
  impedanceOhm?: number;
  /** A second-frequency impedance, when the scale sends one. */
  impedanceLowOhm?: number;
  /** The scale's own clock for this reading (epoch ms), when the frame carries one (history records of MiScale etc.). */
  scaleTime?: number;
  /** User slot on the scale (1-based), when the frame carries one. */
  userSlot?: number;
  /** Values computed by the scale itself. */
  reported?: ReportedBody;
}

/** A broadcast advertisement as the native scan reports it, with the identifiers normalised (see `uuid.ts`). */
export interface AdFrame {
  /** Android: MAC address. iOS: the peripheral identifier (a UUID, stable on this phone only). */
  id: string;
  name: string | null;
  rssi: number;
  /** Epoch ms the advertisement arrived. */
  ts: number;
  /** Advertised service UUIDs, normalised: 4 lowercase hex for Bluetooth-base UUIDs, else the full lowercase 36-char form. */
  serviceUuids: string[];
  /** Service data: normalised UUID to lowercase hex payload. */
  serviceData: Record<string, string>;
  /** Manufacturer data: company identifier as 4 lowercase hex digits of the 16-bit value (`ffff`, `20ca`) to the payload hex that follows it. */
  manufacturerData: Record<string, string>;
}

/** What a scan result tells before connecting. */
export interface GattInfo {
  id: string;
  name: string | null;
  serviceUuids: string[];
}

export type CharacteristicProperty = 'read' | 'write' | 'writeNoResponse' | 'notify' | 'indicate';

export interface DiscoveredService {
  /** Normalised UUID (see `uuid.ts`). */
  uuid: string;
  characteristics: { uuid: string; properties: CharacteristicProperty[] }[];
}

/** One thing the driver must do on the link. Executed in order, one at a time. */
export type GattAction =
  | { op: 'subscribe'; service: string; characteristic: string }
  | { op: 'read'; service: string; characteristic: string }
  | { op: 'write'; service: string; characteristic: string; hex: string; withResponse: boolean };

export interface GattStep {
  actions: GattAction[];
  readings: ScaleReading[];
  /** True once this protocol has nothing more to do (the driver may disconnect). Live-stream protocols never set it. */
  done?: boolean;
}

export const NOTHING: GattStep = Object.freeze({ actions: [], readings: [] }) as GattStep;

export interface GattContext {
  user?: ScaleUser;
  /** Epoch ms now (injected so tests are deterministic). */
  now: number;
  /** Minutes east of UTC of the phone (`-new Date().getTimezoneOffset()`), for protocols that write the local time. */
  timezoneOffsetMin: number;
}

export interface GattSession {
  /** After service discovery: subscribe, write the handshake. */
  start(services: DiscoveredService[]): GattStep;
  /** A notification / indication / read result. `hex` is lowercase without separators. */
  onValue(service: string, characteristic: string, hex: string, now: number): GattStep;
}

interface ProtocolBase {
  /** Stable id, saved with the scale the person picked. */
  id: string;
  /** Human label for the scale list ("OKOK / Chipsea"). */
  label: string;
  /** Brands / apps that use it, for the picker ("OKOK International", "Fitdays"). */
  brands: string[];
  /** openScale files this was ported from, relative to `android_app/app/src/main/java/com/health/openscale/core/bluetooth/`. */
  source: string[];
}

export interface BroadcastProtocol extends ProtocolBase {
  kind: 'broadcast';
  matches(frame: AdFrame): boolean;
  /** Null for advertisements that carry no reading (idle beacons, unknown frame types). Never throws on short or odd data. */
  decode(frame: AdFrame, user?: ScaleUser): ScaleReading | null;
}

export interface GattProtocol extends ProtocolBase {
  kind: 'gatt';
  matches(info: GattInfo): boolean;
  createSession(context: GattContext): GattSession;
}

export type ScaleProtocol = BroadcastProtocol | GattProtocol;
