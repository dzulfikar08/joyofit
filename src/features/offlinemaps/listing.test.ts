import { describe, expect, test } from 'bun:test';

import type { CatalogMap, RegionKind } from './catalog';
import {
  baseName,
  buildListing,
  distanceKmToBbox,
  isFiltered,
  NEAR_COUNT,
  NO_FILTER,
  nearest,
  normalize,
  provinceKey,
  provinceTotals,
  searchMaps,
  watchIdsOf,
  type ListFilter,
} from './listing';

const MB = 1_048_576;

const region = (
  id: string,
  name: string,
  province: string,
  code: string,
  kind: RegionKind | null,
  bbox: [number, number, number, number],
  sizeBytes = 2 * MB,
): CatalogMap => ({
  id,
  code,
  name,
  province,
  kind,
  bbox,
  sizeBytes,
  sha256: 'A'.repeat(64),
  version: 26102522,
  builtAt: '2026-10-25T15:04:21Z',
  osmDate: '2026-10-24T20:20:51Z',
  attribution: '© OpenStreetMap contributors',
});

const KOTA_MALANG = region('3573', 'Kota Malang', 'Jawa Timur', '3573', 'kota', [112.57, -8.05, 112.69, -7.9], 10 * MB);
const KAB_MALANG = region('3507', 'Kabupaten Malang', 'Jawa Timur', '3507', 'kabupaten', [112.28, -8.45, 112.96, -7.75], 30 * MB);
const BATU = region('3579', 'Kota Batu', 'Jawa Timur', '3579', 'kota', [112.45, -7.95, 112.6, -7.75], 3 * MB);
const BOGOR = region('13201', 'Kabupaten Bogor 1/3', 'Jawa Barat', '3201', 'kabupaten', [106.4, -6.8, 106.9, -6.3]);
const BADUNG = region('5103', 'Kabupaten Badung', 'Bali', '5103', 'kabupaten', [115.1, -8.85, 115.3, -8.4]);
const SERIBU = region('3101', 'Kabupaten Administrasi Kepulauan Seribu', 'DKI Jakarta', '3101', 'kabupaten', [106.4, -6.0, 106.7, -5.2]);
const OLD = region('9', 'Malang (lab)', '', '', null, [112.5, -8.05, 112.72, -7.88]);
const ALL = [KOTA_MALANG, KAB_MALANG, BATU, BOGOR, BADUNG, SERIBU, OLD];

const NONE = new Set<string>();
const find = (filter: Partial<ListFilter>, maps: readonly CatalogMap[] = ALL, watchIds: ReadonlySet<string> = NONE) =>
  searchMaps(maps, { ...NO_FILTER, ...filter }, watchIds).map((m) => m.name);

describe('normalising names', () => {
  test('case, accents and punctuation are folded', () => {
    expect(normalize('  Kab. Bandung  ')).toBe('kab bandung');
    expect(normalize('MÁLANG')).toBe('malang');
    expect(normalize('Bogor 1/3')).toBe('bogor 1 3');
  });

  test('the kind prefix is not part of the name', () => {
    expect(baseName('Kota Malang')).toBe('malang');
    expect(baseName('Kabupaten Malang')).toBe('malang');
    expect(baseName('Kab. Malang')).toBe('malang');
    expect(baseName('Kabupaten Administrasi Kepulauan Seribu')).toBe('kepulauan seribu');
    expect(baseName('Kabupaten Kotawaringin Barat')).toBe('kotawaringin barat');
  });
});

describe('searching', () => {
  test('"malang" finds Kota Malang and Kabupaten Malang', () => {
    expect(find({ query: 'malang' })).toEqual(['Kabupaten Malang', 'Kota Malang', 'Malang (lab)']);
  });

  test('case and accents do not matter', () => {
    expect(find({ query: '  MÁLANG ' })).toEqual(find({ query: 'malang' }));
    expect(find({ query: 'jawa BARAT' })).toEqual(['Kabupaten Bogor 1/3']);
  });

  test('a "Kota", "Kab." or "Kabupaten" in the query picks the kind; alone it lists that kind', () => {
    expect(find({ query: 'kota malang' })).toEqual(['Kota Malang']);
    expect(find({ query: 'Kab. Malang' })).toEqual(['Kabupaten Malang']);
    expect(find({ query: 'kabupaten malang' })).toEqual(['Kabupaten Malang']);
    expect(find({ query: 'kota' })).toEqual(['Kota Batu', 'Kota Malang']);
    expect(find({ query: 'kab administrasi seribu' })).toEqual(['Kabupaten Administrasi Kepulauan Seribu']);
  });

  test('the prefix itself is not searched: "ko" does not list every kota', () => {
    expect(find({ query: 'ko' })).toEqual([]);
    expect(find({ query: 'upaten' })).toEqual([]);
  });

  test('the BPS code, whole or its leading digits', () => {
    expect(find({ query: '3573' })).toEqual(['Kota Malang']);
    expect(find({ query: '35' })).toEqual(['Kabupaten Malang', 'Kota Batu', 'Kota Malang']);
    expect(find({ query: '573' })).toEqual([]);
  });

  test('the name itself first, then names that start with the query, then the rest', () => {
    const maps = [region('1', 'Kabupaten Lombok Barat', 'Nusa Tenggara Barat', '5201', 'kabupaten', [116, -8.8, 116.3, -8.3]), region('2', 'Kabupaten Barito Kuala', 'Kalimantan Selatan', '6304', 'kabupaten', [114.4, -3.4, 114.9, -2.6]), region('3', 'Kabupaten Barito', 'Kalimantan Tengah', '6200', 'kabupaten', [114, -2, 115, -1])];
    expect(find({ query: 'barito' }, maps)).toEqual(['Kabupaten Barito', 'Kabupaten Barito Kuala']);
    expect(find({ query: 'barat' }, maps)).toEqual(['Kabupaten Lombok Barat']);
  });

  test('province and kind combine with each other and the search', () => {
    expect(find({ province: 'Jawa Timur', kind: 'kota' })).toEqual(['Kota Batu', 'Kota Malang']);
    expect(find({ province: 'Jawa Timur', kind: 'kabupaten' })).toEqual(['Kabupaten Malang']);
    expect(find({ province: 'Jawa Timur', kind: 'kota', query: 'malang' })).toEqual(['Kota Malang']);
    expect(find({ kind: 'kabupaten', query: 'kota malang' })).toEqual([]);
    expect(find({ province: 'Bali', query: 'bogor' })).toEqual([]);
  });

  test('"Di jam" keeps the maps the watch lists', () => {
    const watchIds = watchIdsOf([
      { mapId: BATU.id, mapType: 0, version: 1, downloadType: 0 },
      { mapId: BOGOR.id, mapType: 1, version: 1, downloadType: 0 },
    ]);
    expect(watchIds).toEqual(new Set([BATU.id]));
    expect(watchIdsOf(null)).toEqual(new Set());
    expect(find({ onWatch: true }, ALL, watchIds)).toEqual(['Kota Batu']);
    expect(find({ onWatch: true, kind: 'kabupaten' }, ALL, watchIds)).toEqual([]);
  });

  test('a filter is on only when it narrows the list', () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, query: '  ' })).toBe(false);
    expect(isFiltered({ ...NO_FILTER, query: 'b' })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, province: 'Bali' })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, kind: 'kota' })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, onWatch: true })).toBe(true);
  });
});

describe('nearest regions', () => {
  test('distance to a box is 0 inside and great-circle to the nearest edge or corner outside', () => {
    expect(distanceKmToBbox(-7.98, 112.63, KOTA_MALANG.bbox)).toBe(0);
    // Straight south of the box: 0.1° of latitude is about 11.1 km.
    expect(distanceKmToBbox(-8.15, 112.6, KOTA_MALANG.bbox)).toBeCloseTo(11.12, 1);
    // South-west of the box: to the corner (-8.05, 112.57), 0.1° south and 0.1° west.
    const corner = distanceKmToBbox(-8.15, 112.47, KOTA_MALANG.bbox);
    expect(corner).toBeCloseTo(Math.hypot(11.12, 11.12 * Math.cos((8.1 * Math.PI) / 180)), 0);
  });

  test('a point inside: the boxes around it first at 0 km, ties by name, then by distance', () => {
    const near = nearest(ALL, { lat: -7.98, lon: 112.63 }, 5);
    expect(near.map((m) => m.name)).toEqual(['Kabupaten Malang', 'Kota Malang', 'Malang (lab)', 'Kota Batu', 'Kabupaten Badung']);
    expect(near.slice(0, 3).map((m) => m.distanceKm)).toEqual([0, 0, 0]);
    expect(near[3].distanceKm).toBeCloseTo(4.7, 0);
    expect(near[4].distanceKm).toBeGreaterThan(200);
  });

  test('a point outside every box: nearest edge first', () => {
    // At sea south of Malang: Kabupaten Malang's south edge (-8.45) is nearer than Kota Malang's (-8.05).
    const near = nearest([KOTA_MALANG, BATU, KAB_MALANG], { lat: -8.6, lon: 112.6 }, 10);
    expect(near.map((m) => m.name)).toEqual(['Kabupaten Malang', 'Kota Malang', 'Kota Batu']);
    expect(near[0].distanceKm).toBeCloseTo(16.7, 0);
    expect(near[0].distanceKm).toBeLessThan(near[1].distanceKm);
  });
});

describe('the list', () => {
  const ACEH = Array.from({ length: 12 }, (_, i) =>
    region(`11${i}`, `Kabupaten Aceh ${String.fromCharCode(65 + i)}`, 'Aceh', `11${String(i).padStart(2, '0')}`, 'kabupaten', [95 + i * 0.1, 4, 95.05 + i * 0.1, 4.05]),
  );
  const CATALOG = [...ALL, ...ACEH];
  const IN_MALANG = { lat: -7.98, lon: 112.63 };

  test('provinces with their count and size, sorted, the unknown province last', () => {
    expect(provinceTotals(ALL)).toEqual([
      { province: 'Bali', count: 1, totalBytes: 2 * MB },
      { province: 'DKI Jakarta', count: 1, totalBytes: 2 * MB },
      { province: 'Jawa Barat', count: 1, totalBytes: 2 * MB },
      { province: 'Jawa Timur', count: 3, totalBytes: 43 * MB },
      { province: '', count: 1, totalBytes: 2 * MB },
    ]);
  });

  test('without a search: on the watch, then the nearest ten, then the rest by province, collapsed', () => {
    const listing = buildListing(CATALOG, { filter: NO_FILTER, watchIds: new Set([BATU.id]), here: IN_MALANG, expanded: new Set() });
    expect(listing.filtered).toBe(false);
    expect(listing.matched).toBe(CATALOG.length);
    const [watch, near, ...provinces] = listing.sections;
    expect(watch).toMatchObject({ key: 'watch', count: 1, totalBytes: 3 * MB, collapsed: false });
    expect(watch.data.map((m) => m.name)).toEqual(['Kota Batu']);
    expect(near.key).toBe('near');
    expect(near.data).toHaveLength(NEAR_COUNT);
    expect(near.data.slice(0, 3).map((m) => m.name)).toEqual(['Kabupaten Malang', 'Kota Malang', 'Malang (lab)']);
    expect(near.data.some((m) => m.id === BATU.id)).toBe(false);
    // 19 maps: 1 on the watch, 10 near (the three around the point, Bali, Jawa Barat, Jakarta and the four easternmost of Aceh), 8 left.
    expect(provinces.map((s) => [s.province, s.count, s.collapsed, s.data.length])).toEqual([['Aceh', 8, true, 0]]);
    expect(provinces[0].totalBytes).toBe(16 * MB);
  });

  test('without a position or watch list: only provinces; an expanded province shows its maps by name', () => {
    const listing = buildListing(ALL, { filter: NO_FILTER, watchIds: NONE, here: null, expanded: new Set([provinceKey('Jawa Timur')]) });
    expect(listing.sections.map((s) => s.key)).toEqual(['province:Bali', 'province:DKI Jakarta', 'province:Jawa Barat', 'province:Jawa Timur', 'province:']);
    const jatim = listing.sections[3];
    expect(jatim).toMatchObject({ count: 3, totalBytes: 43 * MB, collapsed: false });
    expect(jatim.data.map((m) => m.name)).toEqual(['Kabupaten Malang', 'Kota Batu', 'Kota Malang']);
    expect(listing.sections[0]).toMatchObject({ count: 1, collapsed: true, data: [] });
  });

  test('a search or filter is one flat list of results, with distances when the position is known', () => {
    const listing = buildListing(CATALOG, { filter: { ...NO_FILTER, query: 'malang' }, watchIds: NONE, here: IN_MALANG, expanded: new Set() });
    expect(listing.filtered).toBe(true);
    expect(listing.matched).toBe(3);
    expect(listing.sections).toHaveLength(1);
    expect(listing.sections[0].key).toBe('results');
    expect(listing.sections[0].data.map((m) => [m.name, m.distanceKm])).toEqual([
      ['Kabupaten Malang', 0],
      ['Kota Malang', 0],
      ['Malang (lab)', 0],
    ]);
  });

  test('nothing matches: no sections, so the screen shows "Tidak ada wilayah yang cocok"', () => {
    for (const filter of [{ query: 'xyz' }, { province: 'Bali', query: 'bogor' }, { onWatch: true }]) {
      const listing = buildListing(CATALOG, { filter: { ...NO_FILTER, ...filter }, watchIds: NONE, here: null, expanded: new Set() });
      expect(listing).toEqual({ sections: [], filtered: true, matched: 0 });
    }
    expect(buildListing([], { filter: NO_FILTER, watchIds: NONE, here: IN_MALANG, expanded: new Set() }).sections).toEqual([]);
  });
});
