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
 * names its openScale source files in `source`, and keeps openScale's copyright notice in its file header. `protocols/tuyaBeacon.ts` is the exception: reverse
 * engineered from a real scale, `source` is empty.
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
  /** Settled again within the same weigh-in at a slightly different weight: replaces the weigh-in already saved for it, never adds one. */
  revision?: true;
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
  | {
      op: 'write';
      service: string;
      characteristic: string;
      hex: string;
      withResponse: boolean;
      /** The bytes derive from the scale's secret (an authentication token, an encrypted session key): the trace says how many bytes went, never which. */
      redact?: true;
    };

export interface GattStep {
  actions: GattAction[];
  readings: ScaleReading[];
  /** True once this protocol has nothing more to do (the driver may disconnect). Live-stream protocols never set it. */
  done?: boolean;
  /** Lines for the support log (what the protocol understood). Never a secret or anything derived from one. */
  notes?: string[];
  /** The scale refused the saved secret: the driver disconnects and the app asks for the secret again instead of retrying. */
  rejected?: true;
}

export const NOTHING: GattStep = Object.freeze({ actions: [], readings: [] }) as GattStep;

export interface GattContext {
  user?: ScaleUser;
  /** Epoch ms now (injected so tests are deterministic). */
  now: number;
  /** Minutes east of UTC of the phone (`-new Date().getTimezoneOffset()`), for protocols that write the local time. */
  timezoneOffsetMin: number;
  /** The saved secret of this scale (what `ProtocolSecret.parse` returned), for a protocol that has one. */
  secret?: string;
  /** The name in the advertisement that made the app connect (some protocols tell models apart by it). */
  deviceName?: string | null;
  /** Cryptographically secure random bytes (the app passes expo-crypto), for protocols whose handshake needs nonces or session keys. */
  randomBytes?: (size: number) => Uint8Array;
}

export interface GattSession {
  /** After service discovery: subscribe, write the handshake. */
  start(services: DiscoveredService[]): GattStep;
  /** A notification / indication / read result. `hex` is lowercase without separators. */
  onValue(service: string, characteristic: string, hex: string, now: number): GattStep;
  /** Called about once a second while connected, for protocols that poll or give up on an answer after a while. */
  onTick?(now: number): GattStep;
}

interface ProtocolBase {
  /** Stable id, saved with the scale the person picked. */
  id: string;
  /** Human label for the scale list ("OKOK / Chipsea"). */
  label: string;
  /** Brands / apps that use it, for the picker ("OKOK International", "Fitdays"). */
  brands: string[];
  /** openScale files this was ported from, relative to `android_app/app/src/main/java/com/health/openscale/core/bluetooth/`. Empty for a protocol that is not from openScale. */
  source: string[];
  /** The scale sends the weight and nothing else (no impedance, no body values), so none is ever shown for it. */
  weightOnly?: true;
  /** The decoder was checked against a real scale in hand, not only against vectors built from a layout description. */
  realScaleTested?: true;
  /** Present when the scale only talks with a secret: it is unusable until the person saves this secret for it. */
  secret?: ProtocolSecret;
}

export interface SecretField {
  /** Key of the typed text in `parse`'s values; i18n `secret.fields.<id>` labels it. */
  id: 'key' | 'cak' | 'c1' | 'c2' | 'address';
  /** Longest text the input takes (room for pasted separators). */
  maxLength: number;
  /** Characters a valid value has; the hint counts the typed text against it. */
  length: number;
  /** Hex digits: the count leaves out spaces, `:` and `-`. */
  hex?: true;
  /** Asked only when the phone does not give the scale's Bluetooth address (iOS shows a per-phone identifier instead). */
  onlyWithoutAddress?: true;
}

/** A per-scale secret the person types in because the scale encrypts with it (never sent anywhere, kept in the secure store). */
export interface ProtocolSecret {
  /** Selects the labels and the explanation the screen shows (i18n `secret.<kind>`). */
  kind: 'tuya-local-key' | 'huawei-hagrid';
  fields: readonly SecretField[];
  /**
   * What to keep, from the text typed per field (cleaned of paste whitespace), or null when a field is not usable. `scaleId` is the
   * address on Android (fields marked `onlyWithoutAddress` are then not asked and not in `values`).
   */
  parse(values: Readonly<Record<string, string>>, scaleId: string): string | null;
}

export interface BroadcastProtocol extends ProtocolBase {
  kind: 'broadcast';
  matches(frame: AdFrame): boolean;
  /** Null for advertisements that carry no reading (idle beacons, unknown frame types). Never throws on short or odd data. */
  decode(frame: AdFrame, user?: ScaleUser): ScaleReading | null;
  /**
   * A decoder for one scale with the secret and a memory of the frames it saw (the scale's frame counter decides what is settled). One
   * per listening session. When this exists the session uses it instead of `decode` (which reads nothing for a protocol with a
   * `secret`), and what it marks `stable` is final at once: the protocol has its own settle rule, so the gate does not wait for a second
   * equal frame.
   */
  createDecoder?(secret: string): (frame: AdFrame, user?: ScaleUser) => ScaleReading | null;
}

export interface GattProtocol extends ProtocolBase {
  kind: 'gatt';
  matches(info: GattInfo): boolean;
  createSession(context: GattContext): GattSession;
}

export type ScaleProtocol = BroadcastProtocol | GattProtocol;
