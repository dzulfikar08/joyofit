import type { BodyFormula } from './bodyComposition';
import { BROADCAST_PROTOCOLS } from './protocols/broadcast';
import { STANDARD_PROTOCOLS } from './protocols/standard';
import { VENDOR_MISC_PROTOCOLS } from './protocols/vendorMisc';
import { VENDOR_QN_PROTOCOLS } from './protocols/vendorQn';
import type { AdFrame, BroadcastProtocol, GattInfo, GattProtocol, ScaleProtocol } from './types';

/**
 * Every protocol, specific before generic: advertisement decoders (they recognise a frame layout), then the connected vendor protocols
 * (name rules), the Bluetooth SIG profile last because it matches nearly any device that offers 181D / 181B, Xiaomi included.
 */
export const PROTOCOLS: readonly ScaleProtocol[] = [
  ...BROADCAST_PROTOCOLS,
  ...VENDOR_QN_PROTOCOLS,
  ...VENDOR_MISC_PROTOCOLS,
  ...STANDARD_PROTOCOLS,
];

export function protocolById(id: string): ScaleProtocol | null {
  return PROTOCOLS.find((p) => p.id === id) ?? null;
}

export function gattInfoOf(frame: AdFrame): GattInfo {
  return { id: frame.id, name: frame.name, serviceUuids: frame.serviceUuids };
}

/** The protocol that claims an advertisement, or null (a heart-rate strap, a phone, any device that is not a known scale). */
export function classify(frame: AdFrame): ScaleProtocol | null {
  const info = gattInfoOf(frame);
  for (const p of PROTOCOLS) {
    if (p.kind === 'broadcast' ? p.matches(frame) : p.matches(info)) return p;
  }
  return null;
}

export const isBroadcast = (p: ScaleProtocol): p is BroadcastProtocol => p.kind === 'broadcast';
export const isGatt = (p: ScaleProtocol): p is GattProtocol => p.kind === 'gatt';

/**
 * Which published impedance formula (bodyComposition.ts, ported from openScale) stands in for a protocol whose scale does not send body
 * values itself. Only families openScale itself computes composition for are listed; the rest never get an estimate. These are
 * population regressions, not the vendor app's own numbers.
 */
const FORMULA_OF_PROTOCOL: Readonly<Record<string, BodyFormula>> = {
  'xiaomi-mi-scale': 'miscale',
  'one-by-one-health-scale': 'oneByone',
  'eufy-one-by-one': 'oneByone',
  'one-by-one-new': 'oneByoneNew',
  'qn-scale': 'trisa',
  'yunmai-mini': 'yunmai',
  'yunmai-se': 'yunmai',
  'yunmai-x': 'yunmai',
  'okok-chipsea-broadcast': 'standard',
  'ailink-broadcast': 'standard',
  'etekcity-fit8s-broadcast': 'standard',
};

export function bodyFormulaOf(protocolId: string): BodyFormula | null {
  return FORMULA_OF_PROTOCOL[protocolId] ?? null;
}
