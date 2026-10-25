import { supportRank } from '@/features/device/modelSupport';
import type { BondedDevice, DeviceInfo } from '@/wear';

/** Tested watches first, then experimental, unknown and unsupported, each by name. */
export function sortBonded(devices: BondedDevice[]): BondedDevice[] {
  return [...devices].sort((a, b) => supportRank(a.support) - supportRank(b.support) || a.name.localeCompare(b.name));
}

const keyOf = (address: string) => address.toUpperCase();

/**
 * A scan result for a device the list already has: the scan's fields win (a fresher name, the signal), the list's own stay (`remembered`,
 * `paired`, `classic`, `nearby`), which a scan cannot know. Without this a scan that sees a remembered watch would drop what says it is one.
 */
export function withDiscovered(existing: BondedDevice | undefined, discovered: BondedDevice): BondedDevice {
  return existing ? { ...existing, ...discovered } : discovered;
}

export interface BondedListInput {
  /** `getBondedDevices` or `refreshBondedDevices`. */
  bonded: BondedDevice[];
  /** `getDiscoveredDevices`: what the latest scan saw. */
  discovered: BondedDevice[];
  /** The watch the link is on, if any. */
  active: { address: string; name: string; model: string | null; support: BondedDevice['support'] } | null;
  /** `getBackgroundStatus()`: the watch JoyoFit connected to last. Its address and keys are stored, so it needs no scan to be found. */
  remembered: { address: string | null; name: string | null };
}

/**
 * The Watch tab's list, one row per address: what the system lists, what a scan saw, the watch in use, and the remembered watch.
 * The remembered watch is always a row, also from a build whose native list does not carry it, so a watch that is off, out of
 * reach or not advertising (a watch that holds a phone does not) can still be connected by its address instead of waiting to be found.
 * The row says `remembered` either way; nothing is removed or reset by listing it.
 */
export function listBonded({ bonded, discovered, active, remembered }: BondedListInput): BondedDevice[] {
  const map = new Map<string, BondedDevice>();
  for (const d of bonded) map.set(keyOf(d.address), d);
  for (const d of discovered) {
    if (!map.has(keyOf(d.address))) map.set(keyOf(d.address), d);
  }
  if (active && !map.has(keyOf(active.address))) {
    map.set(keyOf(active.address), {
      address: active.address,
      name: active.name || active.address,
      model: active.model,
      support: active.support,
      reason: null,
    });
  }
  if (remembered.address) {
    const key = keyOf(remembered.address);
    const known = map.get(key);
    map.set(
      key,
      known
        ? { ...known, remembered: true }
        : {
            address: remembered.address,
            name: remembered.name || remembered.address,
            model: null,
            support: 'unknown',
            reason: null,
            remembered: true,
          },
    );
  }
  return sortBonded(Array.from(map.values()));
}

/**
 * The rows a watch list shows: the watch in use first (added from the link when the list does not hold it yet, e.g. right after a
 * connect from another screen), then the ones JoyoFit can talk to best. The Watch tab's list and the setup guide's scan cards share it.
 */
export function withActiveWatch(
  devices: readonly BondedDevice[],
  activeAddress: string | null,
  device: Pick<DeviceInfo, 'name' | 'model' | 'support'> | null,
): BondedDevice[] {
  const list = [...devices];
  if (activeAddress && !list.some((d) => d.address === activeAddress)) {
    list.unshift({
      address: activeAddress,
      name: device?.name || activeAddress,
      model: device?.model ?? null,
      support: device?.support ?? 'tested',
      reason: null,
    });
  }
  return list.sort(
    (a, b) => Number(b.address === activeAddress) - Number(a.address === activeAddress) || supportRank(a.support) - supportRank(b.support),
  );
}
