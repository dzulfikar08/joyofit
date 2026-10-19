import { describe, expect, it } from 'bun:test';
import { VENDOR_QN_PROTOCOLS } from './vendorQn';

const catalog: [string, string[], string][] = [
  ['QN-Scale', ['ffe0'], 'qn-scale'],
  ['Health Scale', [], 'one-by-one-health-scale'],
  ['eufy T9146', [], 'eufy-one-by-one'],
  ['eufy T9147', [], 'eufy-one-by-one'],
  ['eufy T9120', [], 'eufy-one-by-one'],
  ['1byone scale', [], 'one-by-one-new'],
  ['RENPHO-SCALE-1234', [], 'renpho-es-wbe28'],
];

describe('VENDOR_QN_PROTOCOLS (ScaleCatalog.kt names)', () => {
  it('has unique ids and every protocol is GATT with sources and brands', () => {
    const ids = VENDOR_QN_PROTOCOLS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of VENDOR_QN_PROTOCOLS) {
      expect(p.kind).toBe('gatt');
      expect(p.source.length).toBeGreaterThan(0);
      expect(p.brands.length).toBeGreaterThan(0);
    }
  });

  it('each catalog device is claimed by exactly the expected protocol', () => {
    for (const [name, serviceUuids, id] of catalog) {
      const hits = VENDOR_QN_PROTOCOLS.filter((p) => p.kind === 'gatt' && p.matches({ id: 'x', name, serviceUuids }));
      expect(hits.map((p) => p.id)).toEqual([id]);
    }
  });
});
