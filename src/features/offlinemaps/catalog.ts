import type { OfflineMapOnWatch } from '@/wear';

/** Kota or kabupaten: the two kinds of Indonesian second-level region (BPS kab/kota). */
export type RegionKind = 'kota' | 'kabupaten';

/** One map JoyoFit's server offers (`GET /v1/maps`, server/src/maps.ts). */
export interface CatalogMap {
  /** Decimal map id (u64): the file is `<id>.bin` on the watch. */
  id: string;
  /** The region's 4-digit BPS kab/kota code; '' from a server that does not send it. */
  code: string;
  name: string;
  /** '' from a server that does not send it. */
  province: string;
  /** Null from a server that does not send it. */
  kind: RegionKind | null;
  /** Which part of a region split into several maps (1-based); absent for a whole region. */
  part?: { index: number; count: number };
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
    const { id, code, name, province, kind, part, bbox, sizeBytes, sha256, version, builtAt, osmDate, attribution } = entry;
    if (typeof id !== 'string' || !ID.test(id)) continue;
    if (typeof name !== 'string' || name.trim() === '') continue;
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(isFiniteNumber)) continue;
    if (!isFiniteNumber(sizeBytes) || sizeBytes <= 0) continue;
    if (typeof sha256 !== 'string' || !SHA.test(sha256)) continue;
    if (!isFiniteNumber(version)) continue;
    const map: CatalogMap = {
      id,
      code: typeof code === 'string' ? code : '',
      name,
      province: typeof province === 'string' ? province.trim() : '',
      kind: kind === 'kota' || kind === 'kabupaten' ? kind : null,
      bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
      sizeBytes,
      sha256: sha256.toUpperCase(),
      version,
      builtAt: typeof builtAt === 'string' ? builtAt : '',
      osmDate: typeof osmDate === 'string' ? osmDate : '',
      attribution: typeof attribution === 'string' && attribution !== '' ? attribution : '© OpenStreetMap contributors',
    };
    const split = parsePart(part);
    if (split) map.part = split;
    maps.push(map);
  }
  return maps;
}

function parsePart(value: unknown): { index: number; count: number } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { index, count } = value as Record<string, unknown>;
  if (!Number.isInteger(index) || !Number.isInteger(count)) return null;
  const i = index as number;
  const n = count as number;
  return i >= 1 && i <= n ? { index: i, count: n } : null;
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

/** The provinces the catalog covers, sorted, without blanks (an old server sends none). */
export function provincesOf(maps: readonly CatalogMap[]): string[] {
  const names = new Set<string>();
  for (const map of maps) if (map.province !== '') names.add(map.province);
  return [...names].sort((a, b) => a.localeCompare(b, 'id'));
}

/** Maps in `province` (null = all) whose name, province or BPS code contains `query` (trimmed, case-insensitive). */
export function filterMaps<T extends CatalogMap>(maps: readonly T[], filter: { province: string | null; query: string }): T[] {
  const needle = filter.query.trim().toLowerCase();
  return maps.filter(
    (map) =>
      (filter.province === null || map.province === filter.province) &&
      (needle === '' || map.name.toLowerCase().includes(needle) || map.province.toLowerCase().includes(needle) || map.code.includes(needle)),
  );
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Kilometres from a point to a `[w, s, e, n]` box: 0 inside, else to the box's nearest point (the clamped corner or edge). */
export function distanceKmToBbox(lat: number, lon: number, bbox: readonly [number, number, number, number]): number {
  const [w, s, e, n] = bbox;
  const nearLat = Math.min(Math.max(lat, s), n);
  const nearLon = Math.min(Math.max(lon, w), e);
  if (nearLat === lat && nearLon === lon) return 0;
  return haversineKm(lat, lon, nearLat, nearLon);
}

export type MapWithDistance<T extends CatalogMap = CatalogMap> = T & { distanceKm: number };

/** Maps nearest first from `here` (computed on the phone; the position is never sent), ties by name. */
export function sortByDistance<T extends CatalogMap>(maps: readonly T[], here: { lat: number; lon: number }): MapWithDistance<T>[] {
  return maps
    .map((map) => ({ ...map, distanceKm: distanceKmToBbox(here.lat, here.lon, map.bbox) }))
    .sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name, 'id'));
}
