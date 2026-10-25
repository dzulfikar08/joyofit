import { describe, expect, test } from 'bun:test';

import type { OfflineMapSendResult } from '@/wear';

import { mapTypeKey, rateKbps, seconds, sendVerdict } from './labText';

const RESULT: OfflineMapSendResult = {
  file: {
    fileName: '2000000000000003573.bin',
    mapId: '2000000000000003573',
    mapType: 0,
    bytes: 3_500_000,
    sizeMb: 4,
    formatVersion: 26102521,
    region: 'Malang (lab)',
    zooms: [10, 12, 14, 16],
    sha256: 'AB',
  },
  update: false,
  freeSpace: 1_000_000,
  handshakeCode: 0,
  uploadStatus: 1,
  uploadMs: 120_000,
  bytesPerSecond: 29_166,
  parsed: { mapId: '2000000000000003573', mapType: 0, code: 0 },
  parseMs: 12_000,
  parseBudgetMs: 50_000,
};

describe('offline map lab text', () => {
  test('map types', () => {
    expect(mapTypeKey(0)).toBe('region');
    expect(mapTypeKey(1)).toBe('contour');
    expect(mapTypeKey(2)).toBe('global');
    expect(mapTypeKey(3)).toBe('ski');
    expect(mapTypeKey(7)).toBe('other');
  });

  test('the parse result decides the verdict', () => {
    expect(sendVerdict(RESULT)).toBe('parsedOk');
    expect(sendVerdict({ ...RESULT, parsed: { mapId: null, mapType: 0, code: 3 } })).toBe('parsedFailed');
    expect(sendVerdict({ ...RESULT, parsed: null })).toBe('noParse');
  });

  test('rates and seconds', () => {
    expect(rateKbps(29_166)).toBe('29');
    expect(rateKbps(4_250)).toBe('4.3');
    expect(rateKbps(null)).toBeNull();
    expect(rateKbps(0)).toBeNull();
    expect(seconds(12_400)).toBe(12);
    expect(seconds(null)).toBeNull();
  });
});
