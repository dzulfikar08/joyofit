import { describe, expect, it } from 'bun:test';

import { FakeScaleNative } from './fakeNative.testkit';
import { ScaleHub } from './hub';
import type { ScaleNative } from './native';
import { describeAdvertisement, RECORD_PREFIX, ScaleRecorder, type RecordLine } from './recorder';

const tick = () => new Promise((r) => setTimeout(r, 0));
const ID = 'AA:BB:CC:DD:EE:FF';

function setup() {
  const native = new FakeScaleNative();
  const hub = new ScaleHub(() => native as ScaleNative);
  const lines: RecordLine[] = [];
  const recorder = new ScaleRecorder(hub, (l) => lines.push(l), () => 42);
  return { native, hub, lines, recorder };
}

const ad = (manufacturerData: Record<string, string>, rssi = -60) => ({
  id: ID, name: 'ADV', rssi, ts: 0, serviceUuids: ['ffe0'], serviceData: { '181d': '0102' }, manufacturerData,
});

describe('describeAdvertisement', () => {
  it('writes address, name, services, service data and manufacturer data as hex', () => {
    expect(describeAdvertisement({ id: ID, name: 'ADV', rssi: -61, ts: 0, serviceUuids: ['ffe0', 'fff0'], serviceData: { '181d': '0102' }, manufacturerData: { '20ca': 'aabb', '0001': 'cc' } })).toBe(
      `adv ${ID} name=ADV rssi=-61 services=[ffe0,fff0] serviceData={181d=0102} manufacturer={0001=cc,20ca=aabb}`,
    );
    expect(describeAdvertisement({ id: ID, name: null, rssi: 0, ts: 0, serviceUuids: [], serviceData: {}, manufacturerData: {} })).toContain('name=- ');
  });
});

describe('ScaleRecorder', () => {
  it('logs the advertisements of the chosen device only, skipping identical repeats', async () => {
    const { native, lines, recorder } = setup();
    await recorder.start([ID], { connect: false });
    expect(native.calls).toEqual([`scan ${ID} fast`]);
    native.emit('onScaleAdvertisement', ad({ '20ca': 'aa' }));
    native.emit('onScaleAdvertisement', ad({ '20ca': 'aa' }));
    native.emit('onScaleAdvertisement', ad({ '20ca': 'bb' }));
    native.emit('onScaleAdvertisement', { ...ad({ '20ca': 'cc' }), id: '11:22:33:44:55:66' });
    const advs = lines.filter((l) => l.message.startsWith(`${RECORD_PREFIX}adv`));
    expect(advs.map((l) => l.message.match(/20ca=(\w+)/)?.[1])).toEqual(['aa', 'bb']);
    expect(lines.every((l) => l.message.startsWith(RECORD_PREFIX))).toBe(true);
    recorder.stop();
    expect(lines.at(-1)?.message).toBe(`${RECORD_PREFIX}recording stopped`);
  });

  it('with connect: subscribes to every notifying characteristic, reads readable ones, logs values, writes nothing', async () => {
    const { native, lines, recorder } = setup();
    await recorder.start([ID], { connect: true });
    native.emit('onScaleAdvertisement', ad({ '20ca': 'aa' }));
    await tick();
    expect(native.calls).toContain(`connect ${ID}`);
    native.emit('onScaleLink', {
      id: ID, state: 'connected', error: null,
      services: [
        { uuid: 'ffe0', characteristics: [{ uuid: 'ffe1', properties: ['notify', 'read'] }, { uuid: 'ffe2', properties: ['write'] }] },
        { uuid: '2a00', characteristics: [{ uuid: '2a01', properties: ['read'] }] },
      ],
    });
    await tick();
    await tick();
    expect(native.calls.filter((c) => c.startsWith('subscribe') || c.startsWith('read'))).toEqual([
      'subscribe ffe0/ffe1', 'read ffe0/ffe1', 'read 2a00/2a01',
    ]);
    expect(native.writes).toHaveLength(0);
    native.emit('onScaleValue', { id: ID, ts: 1, service: 'ffe0', characteristic: 'ffe1', value: 'cafe' });
    const value = lines.find((l) => l.message.includes('value'));
    expect(value).toMatchObject({ direction: 'rx', hex: 'cafe' });
    expect(lines.some((l) => l.message.includes('services') && l.message.includes('ffe1:notify+read'))).toBe(true);
    recorder.stop();
    await tick();
    expect(native.calls).toContain(`disconnect ${ID}`);
  });

  it('reports a connect that failed', async () => {
    const { native, lines, recorder } = setup();
    await recorder.start([ID], { connect: true });
    native.failing.add('connect');
    native.emit('onScaleAdvertisement', ad({ '20ca': 'aa' }));
    await tick();
    expect(lines.some((l) => l.direction === 'error' && l.message.includes('connect'))).toBe(true);
    recorder.stop();
  });
});
