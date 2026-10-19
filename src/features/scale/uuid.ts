/** UUID helpers shared by the scale decoders. Bluetooth-base UUIDs are 4 lowercase hex digits; vendor UUIDs keep the full 36-char form. */

const BASE_SUFFIX = '-0000-1000-8000-00805f9b34fb';

/** `0000ffe0-0000-1000-8000-00805f9b34fb` -> `ffe0`; `FFE0` -> `ffe0`; any other 128-bit UUID -> its lowercase full form. */
export function normalizeUuid(uuid: string): string {
  const lower = uuid.trim().toLowerCase();
  if (/^[0-9a-f]{4}$/.test(lower)) return lower;
  if (/^[0-9a-f]{8}$/.test(lower)) return lower.startsWith('0000') ? lower.slice(4) : lower;
  if (lower.length === 36 && lower.startsWith('0000') && lower.endsWith(BASE_SUFFIX)) return lower.slice(4, 8);
  return lower;
}

/** Inverse of `normalizeUuid` for the native side (it wants the full form for everything). */
export function fullUuid(uuid: string): string {
  const lower = uuid.trim().toLowerCase();
  return /^[0-9a-f]{4}$/.test(lower) ? `0000${lower}${BASE_SUFFIX}` : lower;
}
