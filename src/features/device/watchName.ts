/**
 * What the screens call a watch. The Bluetooth name is often a codename (`Seiya-B29F` is the Huawei Watch Fit 4 Pro), so the model is
 * looked up first. The prefix list mirrors `WatchModels.kt` / `WatchModels.swift` (a test keeps the names in step); the codenames are
 * the watches that advertise something other than their product name.
 */
export interface WatchNameSource {
  /** The Bluetooth name the watch advertises. */
  name: string;
  /** What the person called it (the `device.alias` column); a set one always wins. */
  alias?: string | null;
  /** The model the native side matched (`BondedDevice.model`, `DeviceInfo.model`). */
  model?: string | null;
}

/** [model name, lower case start of the Bluetooth name]. */
export const WATCH_MODEL_PREFIXES: readonly (readonly [string, string])[] = [
  ['Huawei Watch Fit 4 Pro', 'huawei watch fit 4 pro-'],
  ['Huawei Watch Fit 4', 'huawei watch fit 4-'],
  ['Huawei Watch Fit 5', 'huawei watch fit 5-'],
  ['Huawei Watch Fit 5 Pro', 'huawei watch fit 5 pro-'],
  ['Huawei Watch Fit 3', 'huawei watch fit 3-'],
  ['Huawei Watch Fit 2', 'huawei watch fit 2-'],
  ['Huawei Watch GT 2', 'huawei watch gt 2-'],
  ['Huawei Watch GT 2 Pro', 'huawei watch gt 2 pro-'],
  ['Huawei Watch GT 3', 'huawei watch gt 3-'],
  ['Huawei Watch GT 3 Pro', 'huawei watch gt 3 pro-'],
  ['Huawei Watch GT 3 SE', 'huawei watch gt 3 se-'],
  ['Huawei Watch GT 4', 'huawei watch gt 4-'],
  ['Huawei Watch GT 5', 'huawei watch gt 5-'],
  ['Huawei Watch GT 5 Pro', 'huawei watch gt 5 pro-'],
  ['Huawei Watch GT 6', 'huawei watch gt 6-'],
  ['Huawei Watch GT 6 Pro', 'huawei watch gt 6 pro-'],
  ['Huawei Watch GT 7', 'huawei watch gt 7-'],
  ['Huawei Watch GT 7 Pro', 'huawei watch gt 7 pro-'],
  ['Huawei Watch GT Runner', 'huawei watch gt runner-'],
  ['Huawei Watch GT Runner 2', 'watch gt runner 2-'],
  ['Huawei Watch GT Cyber', 'huawei watch gt cyber-'],
  ['Huawei Watch 3', 'huawei watch 3-'],
  ['Huawei Watch 3 Pro', 'huawei watch 3 pro-'],
  ['Huawei Watch 4', 'huawei watch 4-'],
  ['Huawei Watch 4 Pro', 'huawei watch 4 pro-'],
  ['Huawei Watch 5', 'huawei watch 5-'],
  ['Huawei Watch D2', 'huawei watch d2-'],
  ['Huawei Watch Ultimate', 'huawei watch ultimate-'],
  ['Huawei Watch Ultimate 2', 'watch ultimate 2-'],
  ['Huawei TalkBand B6', 'huawei b6-'],
  ['Honor MagicWatch 2', 'honor magicwatch 2-'],
  ['Honor Watch GS 3', 'honor watch gs 3-'],
  ['Honor Watch GS Pro', 'honor watch gs pro-'],
  ['Honor Watch 4', 'honor watch 4-'],
  ['Honor Watch 4 Pro', 'honor watch 4 pro-'],
  ['Honor Watch 5', 'honor watch 5-'],
  ['Honor Watch 5 Pro', 'honor watch 5 pro-'],
  ['Honor Watch 6', 'honor watch 6-'],
  ['Huawei Watch Fit', 'huawei watch fit-'],
  ['Huawei Watch GT', 'huawei watch gt-'],
  ['Huawei Watch GT 2e', 'huawei watch gt 2e-'],
  ['Huawei Band 2', 'huawei band 2-'],
  ['Huawei Band 2 Pro', 'huawei band 2 pro-'],
  ['Huawei Band 3', 'huawei band 3-'],
  ['Huawei Band 3 Pro', 'huawei band 3 pro-'],
  ['Huawei Band 3e', 'huawei band 3e-'],
  ['Huawei Band 4', 'huawei band 4-'],
  ['Huawei Band 4 Pro', 'huawei band 4 pro-'],
  ['Huawei Band 4e', 'huawei band 4e-'],
  ['Huawei Band 6', 'huawei band 6-'],
  ['Huawei Band 7', 'huawei band 7-'],
  ['Huawei Band 8', 'huawei band 8-'],
  ['Huawei Band 8', 'huawei b8-'],
  ['Huawei Band 8', 'band 8-'],
  ['Huawei Band 9', 'huawei band 9-'],
  ['Huawei Band 9', 'huawei b9-'],
  ['Huawei Band 9', 'band 9-'],
  ['Huawei Band 10', 'huawei band 10-'],
  ['Huawei Band 10', 'huawei b10-'],
  ['Huawei Band 10', 'huawei band 10'],
  ['Huawei Band 10', 'band 10-'],
  ['Huawei Band 11', 'huawei band 11-'],
  ['Huawei Band 11 Pro', 'huawei band 11 pro-'],
  ['Honor Band 3', 'honor band 3-'],
  ['Honor Band 4', 'honor band 4-'],
  ['Honor Band 5', 'honor band 5-'],
  ['Honor Band 6', 'honor band 6-'],
  ['Honor Band 7', 'honor band 7-'],
  ['Honor Band 9', 'honor band 9-'],
  ['Honor Band 10', 'honor band 10-'],
  ['Honor Watch', 'honor watch-'],
];

/** Codename (the Bluetooth name before the `-`, lower case) to model name. */
export const WATCH_CODENAMES: Readonly<Record<string, string>> = {
  seiya: 'Huawei Watch Fit 4 Pro',
};

/** The model name a Bluetooth name belongs to, or null when it is in no list. */
export function modelOfBluetoothName(bluetoothName: string | null | undefined): string | null {
  const lower = bluetoothName?.trim().toLowerCase() ?? '';
  if (!lower) return null;
  let best: string | null = null;
  let bestLength = 0;
  for (const [model, prefix] of WATCH_MODEL_PREFIXES) {
    if (prefix.length > bestLength && lower.startsWith(prefix)) {
      best = model;
      bestLength = prefix.length;
    }
  }
  if (best) return best;
  const codename = lower.split('-')[0]?.trim() ?? '';
  return WATCH_CODENAMES[codename] ?? null;
}

/** "<Brand> <Model>" when the watch is known, else the Bluetooth name as it is. The person's own name for the watch wins. */
export function watchDisplayName(watch: WatchNameSource): string {
  return watch.alias?.trim() || watch.model?.trim() || modelOfBluetoothName(watch.name) || watch.name.trim();
}

/** The unit suffix of the Bluetooth name (`B29F` of `Seiya-B29F`), up to 4 characters; null when there is none. */
export function watchSuffix(bluetoothName: string): string | null {
  const match = /-([0-9A-Za-z]{2,4})$/.exec(bluetoothName.trim());
  return match ? match[1]!.toUpperCase() : null;
}

/** For lists that can hold two of the same model: "Huawei Watch Fit 4 Pro · B29F". Unchanged when there is no model or suffix to add. */
export function watchListName(watch: WatchNameSource): string {
  const display = watchDisplayName(watch);
  const suffix = watchSuffix(watch.name);
  const showsModel = !watch.alias?.trim() && display !== watch.name.trim();
  return showsModel && suffix ? `${display} · ${suffix}` : display;
}

/** The connected watch's display name, with the alias from its stored row (`useWatch().watches`) when it has one. */
export function activeWatchName(
  device: { address: string; name: string; model?: string | null },
  watches: readonly { address: string; alias: string | null }[],
): string {
  return watchDisplayName({ name: device.name, model: device.model, alias: watches.find((w) => w.address === device.address)?.alias });
}

const LEADING_BRAND = /^(?:huawei|honor)(?:\s*\/\s*(?:huawei|honor))?\s+/i;

/**
 * The name without its leading maker word ("Huawei Watch Fit 4 Pro" and "HUAWEI WATCH FIT 4 Pro-B29F" lose "Huawei ", "Honor Band 9" loses
 * "Honor ", "Huawei/Honor WSP Scale" loses both). Only a whole leading word followed by a space goes, so "Honorable" stays; a name that
 * is nothing but the brand stays as it is. Display only: matching and what is sent to the watch or the cloud keep the full name.
 */
export function withoutBrand(name: string): string {
  const stripped = name.replace(LEADING_BRAND, '');
  return stripped.trim() === '' ? name : stripped;
}
