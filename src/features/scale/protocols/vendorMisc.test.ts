import { describe, expect, it } from 'bun:test';
import { VENDOR_MISC_PROTOCOLS } from './vendorMisc';

describe('VENDOR_MISC_PROTOCOLS', () => {
  it('has unique kebab-case ids and complete metadata', () => {
    const ids = VENDOR_MISC_PROTOCOLS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of VENDOR_MISC_PROTOCOLS) {
      expect(p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.brands.length).toBeGreaterThan(0);
      expect(p.source.length).toBeGreaterThan(0);
    }
  });
});
