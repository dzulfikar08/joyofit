import { describe, expect, it } from 'bun:test';

import { foldDevice, STALE_MS, visibleDevices, type DiscoveredDevice } from './discovery';
import type { AdFrame } from './types';

const frame = (over: Partial<AdFrame>): AdFrame => ({
  id: 'AA', name: null, rssi: -60, ts: 0, serviceUuids: [], serviceData: {}, manufacturerData: {}, ...over,
});

const OKOK_FINAL = '01020304050605001b8f12c561112233445566'; // okok.test.ts: 70.55 kg, final

describe('discovery', () => {
  it('recognises a broadcast scale and shows its live weight', () => {
    const map = foldDevice(new Map(), frame({ name: 'ADV', manufacturerData: { '20ca': OKOK_FINAL } }), 1_000);
    expect(map.get('AA')).toMatchObject({ protocolId: 'okok-chipsea-broadcast', name: 'ADV', preview: { weightKg: 70.55 } });
  });

  it('recognises a connected scale by name and keeps name and protocol when a later frame lacks them', () => {
    let map = foldDevice(new Map(), frame({ id: 'BB', name: 'QN-Scale', serviceUuids: ['ffe0'] }), 1_000);
    expect(map.get('BB')?.protocolId).toBe('qn-scale');
    map = foldDevice(map, frame({ id: 'BB', name: null, rssi: -50 }), 2_000);
    expect(map.get('BB')).toMatchObject({ name: 'QN-Scale', protocolId: 'qn-scale', rssi: -50 });
  });

  it('lists a heart-rate strap as not a scale', () => {
    const map = foldDevice(new Map(), frame({ id: 'CC', name: 'Polar H10', serviceUuids: ['180d'] }), 1_000);
    expect(map.get('CC')?.protocolId).toBeNull();
  });

  it('does not mutate the previous map', () => {
    const first = new Map<string, DiscoveredDevice>();
    foldDevice(first, frame({}), 1);
    expect(first.size).toBe(0);
  });

  it('puts scales before other devices, strong signal first, and drops stale ones', () => {
    let map = new Map<string, DiscoveredDevice>();
    map = foldDevice(map, frame({ id: 'P', name: 'Phone', rssi: -40 }), 0);
    map = foldDevice(map, frame({ id: 'S1', name: 'QN-Scale', serviceUuids: ['ffe0'], rssi: -80 }), 0);
    map = foldDevice(map, frame({ id: 'S2', name: 'QN-Scale', serviceUuids: ['ffe0'], rssi: -55 }), 0);
    map = foldDevice(map, frame({ id: 'OLD', name: 'QN-Scale', serviceUuids: ['ffe0'], rssi: -30 }), -STALE_MS - 1);
    expect(visibleDevices(map, 0).map((d) => d.id)).toEqual(['S2', 'S1', 'P']);
  });
});
