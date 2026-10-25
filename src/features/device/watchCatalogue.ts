import { WATCH_FAMILIES, type WatchFamily } from './watchFamilies';
import { modelOfBluetoothName, WATCH_CODENAMES, WATCH_MODEL_PREFIXES } from './watchName';

/**
 * The model-by-model catalogue for "Add manually" in the setup guide, the way Huawei Health lists its series: every model the name list
 * knows (`WATCH_MODEL_PREFIXES`, which mirrors `WatchModels.kt`), grouped under the families the onboarding screens already show, with
 * how that kind of watch is put in pairing mode. No product photos ship with the app, so the screens draw a watch glyph.
 */

/** How a watch of this kind shows that it is ready to pair; each has its own help text. */
export type PairingMode = 'huaweiWatch' | 'huaweiBand' | 'honor';

export interface CatalogueGroup {
  family: WatchFamily;
  pairingMode: PairingMode;
  /** Product names, not translated. */
  models: string[];
}

const NEW_HONOR: Readonly<Record<string, true>> = { 'Honor Watch 5': true, 'Honor Watch 5 Pro': true, 'Honor Watch 6': true };

/** The family a catalogue model belongs to (a `WATCH_FAMILIES` id). */
export function familyOfModel(model: string): WatchFamily['id'] {
  if (model === 'Huawei Watch Fit 4 Pro') return 'fit4pro';
  if (model.startsWith('Huawei Watch Fit')) return 'fit';
  if (model.startsWith('Huawei Watch GT')) return 'gt';
  if (model.startsWith('Huawei Band')) return 'band';
  if (NEW_HONOR[model]) return 'honorNew';
  if (model.startsWith('Honor')) return 'honor';
  return 'watch';
}

const MODE: Record<WatchFamily['id'], PairingMode> = {
  fit4pro: 'huaweiWatch',
  fit: 'huaweiWatch',
  gt: 'huaweiWatch',
  watch: 'huaweiWatch',
  band: 'huaweiBand',
  honor: 'honor',
  honorNew: 'honor',
};

/** Every known model once, grouped by family in the families' order, each group sorted by name ("GT 2" before "GT 10"). */
export const WATCH_CATALOGUE: readonly CatalogueGroup[] = (() => {
  const models = [...new Set([...WATCH_MODEL_PREFIXES.map(([model]) => model), ...Object.values(WATCH_CODENAMES)])];
  return WATCH_FAMILIES.map((family) => ({
    family,
    pairingMode: MODE[family.id] ?? 'huaweiWatch',
    models: models.filter((m) => familyOfModel(m) === family.id).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
  })).filter((group) => group.models.length > 0);
})();

/** The pairing-mode help for a model. */
export function pairingModeOf(model: string): PairingMode {
  return MODE[familyOfModel(model)] ?? 'huaweiWatch';
}

/**
 * The catalogue narrowed to models whose name holds every word of `query` (any case, any order), as the search box of Huawei Health's
 * list does. An empty query is the whole catalogue; groups left without a model are dropped.
 */
export function searchCatalogue(query: string): CatalogueGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...WATCH_CATALOGUE];
  return WATCH_CATALOGUE.map((group) => ({
    ...group,
    models: group.models.filter((model) => {
      const name = model.toLowerCase();
      return words.every((w) => name.includes(w));
    }),
  })).filter((group) => group.models.length > 0);
}

/** The catalogue model a listed watch is: what the native side matched, else its Bluetooth name looked up; null when unknown. */
export function catalogueModelOf(device: { name: string; model?: string | null }): string | null {
  return device.model?.trim() || modelOfBluetoothName(device.name);
}
