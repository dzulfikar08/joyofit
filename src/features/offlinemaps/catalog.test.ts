import { describe, expect, test } from 'bun:test';

import { parseCatalog, phoneState, verifies, watchState, type CatalogMap } from './catalog';

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
