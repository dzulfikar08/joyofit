import { describe, expect, it } from 'bun:test';
import type { AdFrame } from '../types';
import { BROADCAST_PROTOCOLS } from './broadcast';

const ad = (manufacturerData: Record<string, string>, name: string | null, serviceUuids: string[] = []): AdFrame => ({
  id: 'C0:FF:EE:12:34:56',
  name,
  rssi: -60,
  ts: 0,
  serviceUuids,
  serviceData: {},
  manufacturerData,
});

const firstMatch = (frame: AdFrame) => BROADCAST_PROTOCOLS.find((p) => p.kind === 'broadcast' && p.matches(frame))?.id;

describe('BROADCAST_PROTOCOLS', () => {
  it('has unique ids and only broadcast protocols', () => {
    const ids = BROADCAST_PROTOCOLS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BROADCAST_PROTOCOLS.every((p) => p.kind === 'broadcast')).toBe(true);
  });
  it('routes each fingerprint to its protocol', () => {
    expect(firstMatch(ad({ '20ca': '00'.repeat(19) }, 'ADV'))).toBe('okok-chipsea-broadcast');
    expect(firstMatch(ad({ ffff: 'aabb' + '00'.repeat(22) }, null))).toBe('qn-broadcast');
    expect(firstMatch(ad({ '06d0': '00'.repeat(20) }, null, ['ffd0']))).toBe('etekcity-fit8s-broadcast');
    expect(firstMatch(ad({ '1dd0': '00'.repeat(9) }, null))).toBe('scaleup-broadcast');
    expect(firstMatch(ad({ a0ac: '563412eeffc020cd84580db6' }, 'AAA07A', ['ffb0']))).toBe('aaax-broadcast');
    expect(firstMatch(ad({ '0301': '015f4e3d2c1b0a8f10e69cf7cb452cccffff' }, 'EL1', ['f0a0']))).toBe('ailink-broadcast');
    expect(firstMatch(ad({}, 'Mi Scale'))).toBeUndefined();
  });
});
