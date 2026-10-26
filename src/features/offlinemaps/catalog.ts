import type { OfflineMapOnWatch } from '@/wear';

/** One map JoyoFit's server offers (`GET /v1/maps`, server/src/maps.ts). */
export interface CatalogMap {
  /** Decimal map id (u64): the file is `<id>.bin` on the watch. */
  id: string;
  name: string;
  /** West, south, east, north in degrees. */
  bbox: [number, number, number, number];
  sizeBytes: number;
  /** SHA-256 of the file, upper-case hex. */
  sha256: string;
  /** The `offvmp` header's version (YYMMDDHH), which the watch lists back. */
  version: number;
  builtAt: string;
  /** When the OpenStreetMap extract was taken. */
  osmDate: string;
  attribution: string;
}

/** What the app keeps next to a downloaded `<id>.bin` (`<id>.json`): the catalog entry it was checked against. */
export interface StoredMap {
  id: string;
  sha256: string;
  version: number;
  sizeBytes: number;
  downloadedAt: number;
}

const ID = /^[0-9]{1,20}$/;
const SHA = /^[0-9A-Fa-f]{64}$/;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The catalog from the server's JSON; entries that do not fit are dropped (an old app must not break on a new field's absence). */
export function parseCatalog(json: unknown): CatalogMap[] {
  if (!Array.isArray(json)) return [];
  const maps: CatalogMap[] = [];
  for (const raw of json) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const { id, name, bbox, sizeBytes, sha256, version, builtAt, osmDate, attribution } = entry;
    if (typeof id !== 'string' || !ID.test(id)) continue;
    if (typeof name !== 'string' || name.trim() === '') continue;
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(isFiniteNumber)) continue;
    if (!isFiniteNumber(sizeBytes) || sizeBytes <= 0) continue;
    if (typeof sha256 !== 'string' || !SHA.test(sha256)) continue;
    if (!isFiniteNumber(version)) continue;
    maps.push({
      id,
      name,
      bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
      sizeBytes,
      sha256: sha256.toUpperCase(),
      version,
      builtAt: typeof builtAt === 'string' ? builtAt : '',
      osmDate: typeof osmDate === 'string' ? osmDate : '',
      attribution: typeof attribution === 'string' && attribution !== '' ? attribution : '© OpenStreetMap contributors',
    });
  }
  return maps;
}

/** The phone's copy: none, the catalog's current file, or an older build. */
export type PhoneState = 'none' | 'current' | 'outdated';

/** The watch's copy: none, the same version as the catalog, or another version. */
export type WatchState = 'none' | 'same' | 'other';

export function phoneState(map: CatalogMap, stored: StoredMap | null): PhoneState {
  if (stored === null) return 'none';
  return stored.sha256.toUpperCase() === map.sha256 ? 'current' : 'outdated';
}

/** Region maps only (type 0): a contour file of the same id is a different file. Null `onWatch` = the list was never read. */
export function watchState(map: CatalogMap, onWatch: OfflineMapOnWatch[] | null): WatchState | null {
  if (onWatch === null) return null;
  const listed = onWatch.find((m) => m.mapId === map.id && m.mapType === 0);
  if (!listed) return 'none';
  return listed.version === map.version ? 'same' : 'other';
}

/** The stored copy matches what the native side read from the downloaded file. */
export function verifies(map: CatalogMap, file: { sha256: string; bytes: number; mapId: string }): boolean {
  return file.sha256.toUpperCase() === map.sha256 && file.bytes === map.sizeBytes && file.mapId === map.id;
}
