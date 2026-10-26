import { describe, expect, test } from 'bun:test';

import {
  distanceKmToBbox,
  filterMaps,
  parseCatalog,
  phoneState,
  provincesOf,
  sortByDistance,
  verifies,
  watchState,
  type CatalogMap,
} from './catalog';

const SHA = '3DD25836B04E9FC212D132ABB90CC632A99B8B8E9C443D714494FF1249C1E99E';
const RAW = {
  id: '2000000000000003573',
  code: '3573',
  name: 'Kota Malang',
  province: 'Jawa Timur',
  kind: 'kota' as const,
  bbox: [112.5, -8.05, 112.72, -7.88],
  sizeBytes: 9616061,
  sha256: SHA.toLowerCase(),
  version: 26102522,
  builtAt: '2026-10-25T15:04:21Z',
  osmDate: '2026-10-24T20:20:51Z',
  attribution: '© OpenStreetMap contributors, ODbL 1.0',
};
const MAP: CatalogMap = { ...RAW, sha256: SHA, bbox: [112.5, -8.05, 112.72, -7.88] };

describe('offline map catalog', () => {
  test('the server list parses, the hash is upper-cased', () => {
    expect(parseCatalog([RAW])).toEqual([MAP]);
  });

  test('an entry from an older server, without code, province or kind, still parses', () => {
    const { code: _code, province: _province, kind: _kind, ...old } = RAW;
    expect(parseCatalog([old])).toEqual([{ ...MAP, code: '', province: '', kind: null }]);
    expect(parseCatalog([{ ...RAW, kind: 'desa', province: 7 }])[0]).toMatchObject({ kind: null, province: '' });
  });

  test('a split region keeps its part; a part that does not fit is left out', () => {
    const split = { ...RAW, id: '2000000000000023201', code: '3201', name: 'Kabupaten Bogor 2/3', kind: 'kabupaten', part: { index: 2, count: 3 } };
    expect(parseCatalog([split])[0].part).toEqual({ index: 2, count: 3 });
    expect(parseCatalog([{ ...split, part: { index: 4, count: 3 } }])[0]).not.toHaveProperty('part');
    expect(parseCatalog([{ ...split, part: { index: '2', count: 3 } }])[0]).not.toHaveProperty('part');
    expect(parseCatalog([RAW])[0]).not.toHaveProperty('part');
  });

  test('entries that do not fit are dropped, not the list', () => {
    const bad = [
      null,
      'x',
      { ...RAW, id: 'abc' },
      { ...RAW, id: 2000000000000003573 },
      { ...RAW, name: ' ' },
      { ...RAW, bbox: [1, 2, 3] },
      { ...RAW, sizeBytes: 0 },
      { ...RAW, sha256: 'AB' },
      { ...RAW, version: '26102522' },
    ];
    expect(parseCatalog([...bad, RAW])).toEqual([MAP]);
    expect(parseCatalog({ maps: [RAW] })).toEqual([]);
    expect(parseCatalog([{ ...RAW, attribution: undefined }])[0].attribution).toBe('© OpenStreetMap contributors');
  });

  test('the phone copy is current only with the catalog hash', () => {
    expect(phoneState(MAP, null)).toBe('none');
    const stored = { id: MAP.id, sha256: SHA.toLowerCase(), version: MAP.version, sizeBytes: MAP.sizeBytes, downloadedAt: 1 };
    expect(phoneState(MAP, stored)).toBe('current');
    expect(phoneState(MAP, { ...stored, sha256: 'A'.repeat(64) })).toBe('outdated');
  });

  test('the watch copy is matched by id, region type and version', () => {
    expect(watchState(MAP, null)).toBeNull();
    expect(watchState(MAP, [])).toBe('none');
    const listed = { mapId: MAP.id, mapType: 0, version: 26102522, downloadType: 0 };
    expect(watchState(MAP, [listed])).toBe('same');
    expect(watchState(MAP, [{ ...listed, version: 26100100 }])).toBe('other');
    expect(watchState(MAP, [{ ...listed, mapType: 1 }])).toBe('none');
  });

  test('a download verifies against hash, size and id', () => {
    const file = { sha256: SHA.toLowerCase(), bytes: MAP.sizeBytes, mapId: MAP.id };
    expect(verifies(MAP, file)).toBe(true);
    expect(verifies(MAP, { ...file, bytes: 1 })).toBe(false);
    expect(verifies(MAP, { ...file, sha256: 'A'.repeat(64) })).toBe(false);
    expect(verifies(MAP, { ...file, mapId: '1' })).toBe(false);
  });
});

const region = (id: string, name: string, province: string, code: string, bbox: [number, number, number, number]): CatalogMap => ({
  ...MAP,
  id,
  name,
  province,
  code,
  bbox,
});
const MALANG = region('1', 'Kota Malang', 'Jawa Timur', '3573', [112.57, -8.05, 112.69, -7.9]);
const BATU = region('2', 'Kota Batu', 'Jawa Timur', '3579', [112.45, -7.95, 112.6, -7.75]);
const BOGOR = region('3', 'Kabupaten Bogor 1/3', 'Jawa Barat', '3201', [106.4, -6.8, 106.9, -6.3]);
const BADUNG = region('4', 'Kabupaten Badung', 'Bali', '5103', [115.1, -8.85, 115.3, -8.4]);
const OLD = region('5', 'Malang (lab)', '', '', [112.5, -8.05, 112.72, -7.88]);
const ALL = [MALANG, BATU, BOGOR, BADUNG, OLD];

describe('finding a map', () => {
  test('provinces are unique, sorted and never blank', () => {
    expect(provincesOf(ALL)).toEqual(['Bali', 'Jawa Barat', 'Jawa Timur']);
    expect(provincesOf([])).toEqual([]);
  });

  test('the province filter and the search combine', () => {
    expect(filterMaps(ALL, { province: null, query: '' })).toEqual(ALL);
    expect(filterMaps(ALL, { province: 'Jawa Timur', query: '' })).toEqual([MALANG, BATU]);
    expect(filterMaps(ALL, { province: null, query: '  malang ' })).toEqual([MALANG, OLD]);
    expect(filterMaps(ALL, { province: 'Jawa Timur', query: 'MALANG' })).toEqual([MALANG]);
    expect(filterMaps(ALL, { province: null, query: 'jawa barat' })).toEqual([BOGOR]);
    expect(filterMaps(ALL, { province: null, query: '5103' })).toEqual([BADUNG]);
    expect(filterMaps(ALL, { province: 'Bali', query: 'bogor' })).toEqual([]);
  });

  test('distance to a box is 0 inside and great-circle to the nearest edge or corner outside', () => {
    expect(distanceKmToBbox(-7.98, 112.63, MALANG.bbox)).toBe(0);
    // Straight south of the box: 0.1° of latitude is about 11.1 km.
    expect(distanceKmToBbox(-8.15, 112.6, MALANG.bbox)).toBeCloseTo(11.12, 1);
    // South-west of the box: to the corner (-8.05, 112.57), 0.1° south and 0.1° west.
    const corner = distanceKmToBbox(-8.15, 112.47, MALANG.bbox);
    expect(corner).toBeCloseTo(Math.hypot(11.12, 11.12 * Math.cos((8.1 * Math.PI) / 180)), 0);
  });

  test('nearest first, ties by name, with the distance', () => {
    const sorted = sortByDistance([BOGOR, BADUNG, OLD, BATU, MALANG], { lat: -7.97, lon: 112.63 });
    expect(sorted.map((m) => m.name)).toEqual(['Kota Malang', 'Malang (lab)', 'Kota Batu', 'Kabupaten Badung', 'Kabupaten Bogor 1/3']);
    expect(sorted[0].distanceKm).toBe(0);
    expect(sorted[1].distanceKm).toBe(0);
    expect(sorted[2].distanceKm).toBeCloseTo(4, 0);
    expect(sorted[4].distanceKm).toBeGreaterThan(500);
  });
});
