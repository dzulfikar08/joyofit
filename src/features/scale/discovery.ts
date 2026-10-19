import { classify } from './registry';
import type { AdFrame, ScaleReading } from './types';

export interface DiscoveredDevice {
  id: string;
  /** The advertised name; kept from an earlier advertisement when a later one leaves it out (broadcast scales do). */
  name: string | null;
  rssi: number;
  seenAt: number;
  /** The protocol that claims it, null for any device that is not a known scale. */
  protocolId: string | null;
  protocolLabel: string | null;
  /** What a broadcast scale shows right now (the live weight), as proof it is the right device. */
  preview: ScaleReading | null;
}

/** A device not heard from for this long is gone from the list. */
export const STALE_MS = 20_000;

/** Folds one advertisement into the picker's list (returns a new map). */
export function foldDevice(devices: ReadonlyMap<string, DiscoveredDevice>, frame: AdFrame, now: number): Map<string, DiscoveredDevice> {
  const next = new Map(devices);
  const before = devices.get(frame.id);
  const protocol = classify(frame);
  let preview: ScaleReading | null = before?.preview ?? null;
  if (protocol?.kind === 'broadcast') {
    try {
      preview = protocol.decode(frame) ?? preview;
    } catch {
      // A decoder must not take the picker down; the device stays listed without a preview.
    }
  }
  next.set(frame.id, {
    id: frame.id,
    name: frame.name ?? before?.name ?? null,
    rssi: frame.rssi,
    seenAt: now,
    protocolId: protocol?.id ?? before?.protocolId ?? null,
    protocolLabel: protocol?.label ?? before?.protocolLabel ?? null,
    preview,
  });
  return next;
}

/** Recognised scales first, then the others; each by signal strength. Devices that went quiet are dropped. */
export function visibleDevices(devices: ReadonlyMap<string, DiscoveredDevice>, now: number): DiscoveredDevice[] {
  return [...devices.values()]
    .filter((d) => now - d.seenAt <= STALE_MS)
    .sort((a, b) => Number(b.protocolId !== null) - Number(a.protocolId !== null) || b.rssi - a.rssi || a.id.localeCompare(b.id));
}
