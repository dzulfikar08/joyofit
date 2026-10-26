import type { OfflineMapOnWatch } from '@/wear';

import type { CatalogMap, RegionKind } from './catalog';

/**
 * Finding a map in the lab's catalog (514 regions): search, filters, nearest regions and the grouped default view. Pure: the screen keeps the
 * state, this decides what is shown. Everything runs on the phone; the position is only an argument here and never leaves it.
 */

/** Kabupaten, kota or both. */
export type KindFilter = 'all' | RegionKind;

export interface ListFilter {
  query: string;
  /** Null = every province. */
  province: string | null;
  kind: KindFilter;
  /** Only maps the watch lists. */
  onWatch: boolean;
}

export const NO_FILTER: ListFilter = { query: '', province: null, kind: 'all', onWatch: false };

/** How many regions "Terdekat" shows. */
export const NEAR_COUNT = 10;

/** Lowercase, without accents, every run of other characters one space: "Kab. Bandung" and "kab bandung" read the same. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The leading "Kabupaten", "Kab.", "Kota" (and "Administrasi") of a normalised name. */
const PREFIX = /^(?:kabupaten|kab|kotamadya|kota)(?: administrasi| adm)? /;

/** What a query's first word says about the kind, when it is one of the prefixes. */
const PREFIX_KIND: Record<string, RegionKind> = { kabupaten: 'kabupaten', kab: 'kabupaten', kota: 'kota', kotamadya: 'kota' };

/** A normalised name without its kind prefix: "Kota Malang" and "Kabupaten Malang" are both "malang". */
export function baseName(name: string): string {
  return normalize(name).replace(PREFIX, '');
}

interface SearchKey {
  base: string;
  /** Base name and province: what the words of a query are looked up in. */
  text: string;
}

const keys = new WeakMap<CatalogMap, SearchKey>();

/** Normalised once per catalog entry, not on every keystroke. */
function keyOf(map: CatalogMap): SearchKey {
  let key = keys.get(map);
  if (!key) {
    const base = baseName(map.name);
    key = { base, text: `${base} ${normalize(map.province)}` };
    keys.set(map, key);
  }
  return key;
}

interface Query {
  /** The normalised words, prefix removed. */
  words: string[];
  needle: string;
  /** A query that starts with "kota" or "kab"/"kabupaten" keeps to that kind. */
  kind: RegionKind | null;
}

function parseQuery(raw: string): Query {
  const words = normalize(raw).split(' ').filter((w) => w !== '');
  const kind = words.length > 0 ? (PREFIX_KIND[words[0]] ?? null) : null;
  const rest = kind ? words.slice(words[1] === 'administrasi' || words[1] === 'adm' ? 2 : 1) : words;
  return { words: rest, needle: rest.join(' '), kind };
}

/** Every word in the base name or province, or a leading part of the BPS code ("35" = Jawa Timur, "3573" = Kota Malang). */
function matchesWords(map: CatalogMap, words: readonly string[]): boolean {
  const { text } = keyOf(map);
  return words.every((word) => text.includes(word) || (map.code !== '' && map.code.startsWith(word)));
}

/** 0 best: the name or code itself, then names that start with the query, then a word of the name, then anything else that matched. */
function rank(map: CatalogMap, query: Query): number {
  if (query.needle === '') return 0;
  const { base } = keyOf(map);
  if (base === query.needle || map.code === query.needle) return 0;
  if (base.startsWith(query.needle)) return 1;
  if (base.includes(` ${query.needle}`)) return 2;
  return 3;
}

/** The region-map ids (type 0) the watch lists; empty when its list was never read. */
export function watchIdsOf(onWatch: readonly OfflineMapOnWatch[] | null): Set<string> {
  return new Set((onWatch ?? []).filter((m) => m.mapType === 0).map((m) => m.mapId));
}

/** A search or a filter is on: the list is one flat list of results instead of the grouped view. */
export function isFiltered(filter: ListFilter): boolean {
  return normalize(filter.query) !== '' || filter.province !== null || filter.kind !== 'all' || filter.onWatch;
}

export type MapWithDistance<T extends CatalogMap = CatalogMap> = T & { distanceKm?: number };

const byName = (a: CatalogMap, b: CatalogMap) => a.name.localeCompare(b.name, 'id');

/**
 * The maps that pass `filter`, best match first (then nearest when `here` is known, then by name). Kind and province filters combine with
 * the search; a query starting with "kota" or "kab" also keeps to that kind.
 */
export function searchMaps<T extends CatalogMap>(
  maps: readonly T[],
  filter: ListFilter,
  watchIds: ReadonlySet<string>,
  here: { lat: number; lon: number } | null = null,
): MapWithDistance<T>[] {
  const query = parseQuery(filter.query);
  const found: { map: MapWithDistance<T>; rank: number }[] = [];
  for (const map of maps) {
    if (filter.province !== null && map.province !== filter.province) continue;
    if (filter.kind !== 'all' && map.kind !== filter.kind) continue;
    if (query.kind !== null && map.kind !== query.kind) continue;
    if (filter.onWatch && !watchIds.has(map.id)) continue;
    if (!matchesWords(map, query.words)) continue;
    const row: MapWithDistance<T> = here ? { ...map, distanceKm: distanceKmToBbox(here.lat, here.lon, map.bbox) } : map;
    found.push({ map: row, rank: rank(map, query) });
  }
  return found
    .sort((a, b) => a.rank - b.rank || (a.map.distanceKm ?? 0) - (b.map.distanceKm ?? 0) || byName(a.map, b.map))
    .map((f) => f.map);
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

/** The `count` maps nearest to `here`, nearest first, ties by name, each with its distance. */
export function nearest<T extends CatalogMap>(maps: readonly T[], here: { lat: number; lon: number }, count: number): (T & { distanceKm: number })[] {
  return maps
    .map((map) => ({ ...map, distanceKm: distanceKmToBbox(here.lat, here.lon, map.bbox) }))
    .sort((a, b) => a.distanceKm - b.distanceKm || byName(a, b))
    .slice(0, count);
}

export interface ProvinceTotal {
  /** '' = maps from a server that sends no province. */
  province: string;
  count: number;
  totalBytes: number;
}

/** Every province the catalog covers with its map count and size, sorted by name; maps without a province last under ''. */
export function provinceTotals(maps: readonly CatalogMap[]): ProvinceTotal[] {
  const totals = new Map<string, ProvinceTotal>();
  for (const map of maps) {
    const total = totals.get(map.province) ?? { province: map.province, count: 0, totalBytes: 0 };
    total.count += 1;
    total.totalBytes += map.sizeBytes;
    totals.set(map.province, total);
  }
  return [...totals.values()].sort((a, b) => Number(a.province === '') - Number(b.province === '') || a.province.localeCompare(b.province, 'id'));
}

export type SectionKind = 'watch' | 'near' | 'province' | 'results';

export interface MapSection<T> {
  /** 'watch', 'near', 'results' or `province:<name>`. */
  key: string;
  kind: SectionKind;
  /** The province of a province section, else ''. */
  province: string;
  /** Maps in the section, also while it is collapsed. */
  count: number;
  totalBytes: number;
  /** A collapsed province section: its header with count and size, no rows. */
  collapsed: boolean;
  data: T[];
}

export interface Listing<T extends CatalogMap> {
  sections: MapSection<MapWithDistance<T>>[];
  /** The search or a filter is on (one "results" section). */
  filtered: boolean;
  /** Maps shown or behind a collapsed header. */
  matched: number;
}

export const provinceKey = (province: string) => `province:${province}`;

function section<T extends CatalogMap>(key: string, kind: SectionKind, province: string, maps: T[], collapsed = false): MapSection<T> {
  return {
    key,
    kind,
    province,
    count: maps.length,
    totalBytes: maps.reduce((sum, m) => sum + m.sizeBytes, 0),
    collapsed,
    data: collapsed ? [] : maps,
  };
}

/**
 * What the list shows. With a search or a filter: one section of results. Without: the maps on the watch, then the `NEAR_COUNT` regions nearest
 * to `here` (when known), then every other map by province, each province collapsed unless its key is in `expanded`.
 */
export function buildListing<T extends CatalogMap>(
  maps: readonly T[],
  options: { filter: ListFilter; watchIds: ReadonlySet<string>; here: { lat: number; lon: number } | null; expanded: ReadonlySet<string> },
): Listing<T> {
  const { filter, watchIds, here, expanded } = options;
  if (isFiltered(filter)) {
    const results = searchMaps(maps, filter, watchIds, here);
    return { sections: results.length > 0 ? [section('results', 'results', '', results)] : [], filtered: true, matched: results.length };
  }
  const sections: MapSection<MapWithDistance<T>>[] = [];
  const onWatch = maps.filter((m) => watchIds.has(m.id)).sort(byName);
  if (onWatch.length > 0) sections.push(section('watch', 'watch', '', onWatch));
  let rest = maps.filter((m) => !watchIds.has(m.id));
  if (here) {
    const near = nearest(rest, here, NEAR_COUNT);
    if (near.length > 0) sections.push(section('near', 'near', '', near));
    const shown = new Set(near.map((m) => m.id));
    rest = rest.filter((m) => !shown.has(m.id));
  }
  const byProvince = new Map<string, T[]>();
  for (const map of rest) {
    const list = byProvince.get(map.province);
    if (list) list.push(map);
    else byProvince.set(map.province, [map]);
  }
  for (const { province } of provinceTotals(rest)) {
    const key = provinceKey(province);
    sections.push(section(key, 'province', province, (byProvince.get(province) ?? []).sort(byName), !expanded.has(key)));
  }
  return { sections, filtered: false, matched: maps.length };
}
