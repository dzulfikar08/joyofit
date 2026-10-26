import { describe, expect, test } from 'bun:test';

import { parseCatalog, phoneState, verifies, watchState, type CatalogMap } from './catalog';

const SHA = '3DD25836B04E9FC212D132ABB90CC632A99B8B8E9C443D714494FF1249C1E99E';
const RAW = {
  id: '2000000000000003573',
  name: 'Malang (lab)',
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
