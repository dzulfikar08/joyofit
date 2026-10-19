import { describe, expect, it } from 'bun:test';

import { FakeScaleNative } from './fakeNative.testkit';
import { ScaleHub } from './hub';
import type { ScaleNative } from './native';

const make = () => {
  const native = new FakeScaleNative();
  return { native, hub: new ScaleHub(() => native as ScaleNative) };
};

describe('ScaleHub', () => {
  it('scans for the union of ids and widens to everything when a consumer wants everything', async () => {
    const { native, hub } = make();
    const releaseA = await hub.acquire({ ids: ['A'], lowLatency: false });
    expect(native.calls).toEqual(['scan A slow']);
    const releaseB = await hub.acquire({ ids: ['B'], lowLatency: false });
    expect(native.calls.at(-1)).toBe('scan A,B slow');
    const releaseAll = await hub.acquire({ ids: null, lowLatency: true });
    expect(native.calls.at(-1)).toBe('scan * fast');
    releaseAll();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(native.calls.at(-1)).toBe('scan A,B slow');
    releaseA();
    releaseB();
    await new Promise((r) => setTimeout(r, 0));
    expect(native.calls.at(-1)).toBe('stopScan');
  });

  it('does not restart the scan when nothing changed', async () => {
    const { native, hub } = make();
    await hub.acquire({ ids: ['A'], lowLatency: false });
    await hub.acquire({ ids: ['A'], lowLatency: false });
    expect(native.calls).toEqual(['scan A slow']);
  });

  it('delivers advertisements, normalised, to every listener and detaches when idle', async () => {
    const { native, hub } = make();
    const seen: string[] = [];
    hub.onAdvertisement((f) => seen.push(`${f.id}:${f.serviceUuids.join(',')}:${f.manufacturerData['20ca']}`));
    const release = await hub.acquire({ ids: null, lowLatency: true });
    native.emit('onScaleAdvertisement', {
      id: 'AA', name: 'ADV', rssi: -50, ts: 1,
      serviceUuids: ['0000FFE0-0000-1000-8000-00805F9B34FB'], serviceData: {}, manufacturerData: { '20ca': 'ABCD' },
    });
    expect(seen).toEqual(['AA:ffe0:abcd']);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(native.listenerCount('onScaleAdvertisement')).toBe(0);
  });

  it('starts the next window when the native scan ends by itself', async () => {
    const { native, hub } = make();
    await hub.acquire({ ids: ['A'], lowLatency: false });
    native.emit('onScaleScanState', { scanning: false, error: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(native.calls).toEqual(['scan A slow', 'scan A slow']);
  });

  it('reports a scan that died with an error and does not restart it', async () => {
    const { native, hub } = make();
    const errors: string[] = [];
    hub.onScanError((c) => errors.push(c));
    await hub.acquire({ ids: ['A'], lowLatency: false });
    native.emit('onScaleScanState', { scanning: false, error: 'ERR_BLUETOOTH_OFF' });
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toEqual(['ERR_BLUETOOTH_OFF']);
    expect(native.calls).toEqual(['scan A slow']);
  });

  it('a failed start rejects and leaves nothing held', async () => {
    const { native, hub } = make();
    native.failing.add('scan');
    await expect(hub.acquire({ ids: ['A'], lowLatency: false })).rejects.toBeDefined();
    native.failing.clear();
    await new Promise((r) => setTimeout(r, 0));
    expect(native.calls.at(-1)).toBe('stopScan');
  });
});
