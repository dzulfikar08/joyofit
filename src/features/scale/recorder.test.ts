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

  describe('Huawei link probe (fe86)', () => {
    /** The answer of our own Fit 4 Pro to the same question (Fixtures/real-ble-frames.txt of modules/huawei-wear). */
    const REPLY =
      '5a0035000101010102020203fe030202020402000005120001a307c9871921bef4d039a123fc542d330701040901000d01000f0101100100d50f';
    const services = [
      { uuid: '180a', characteristics: [{ uuid: '2a29', properties: ['read'] }] },
      { uuid: 'fe86', characteristics: [{ uuid: 'fe01', properties: ['writeNoResponse'] }, { uuid: 'fe02', properties: ['notify'] }] },
      { uuid: 'fff0', characteristics: [{ uuid: 'fff1', properties: ['write', 'indicate'] }] },
    ];

    async function connected() {
      const s = setup();
      await s.recorder.start([ID], { connect: true });
      s.native.emit('onScaleAdvertisement', ad({}));
      await tick();
      s.native.emit('onScaleLink', { id: ID, state: 'connected', error: null, services });
      for (let i = 0; i < 5; i++) await tick();
      return s;
    }

    it('subscribes fe02 and asks the link params first, then records the rest without subscribing fe02 twice', async () => {
      const { native, lines, recorder } = await connected();
      expect(native.calls.filter((c) => !c.startsWith('scan') && !c.startsWith('connect'))).toEqual([
        'subscribe fe86/fe02', 'write fe86/fe01 5a000b0001010100020003000400f13b', 'read 180a/2a29', 'subscribe fff0/fff1',
      ]);
      expect(native.writes).toEqual([{ service: 'fe86', characteristic: 'fe01', hex: '5a000b0001010100020003000400f13b', withResponse: false }]);
      expect(lines.find((l) => l.direction === 'tx')).toMatchObject({ message: `${RECORD_PREFIX}huawei-link ${ID} fe86/fe01 link params request`, hex: '5a000b0001010100020003000400f13b' });
      recorder.stop();
    });

    it('logs each notification raw and the answer decoded once its pieces are in', async () => {
      const { native, lines, recorder } = await connected();
      native.emit('onScaleValue', { id: ID, ts: 1, service: 'fe86', characteristic: 'fe02', value: REPLY.slice(0, 40) });
      expect(lines.some((l) => l.message.includes('link params:'))).toBe(false);
      native.emit('onScaleValue', { id: ID, ts: 2, service: 'fe86', characteristic: 'fe02', value: REPLY.slice(40) });
      expect(lines.filter((l) => l.direction === 'rx' && l.message.includes('fe86/fe02')).map((l) => l.hex)).toEqual([REPLY.slice(0, 40), REPLY.slice(40)]);
      const decoded = lines.find((l) => l.message.includes('link params:'));
      expect(decoded?.direction).toBe('info');
      expect(decoded?.message).toContain('protocolVersion=2 authVersion=1 bondState=0 mtu=514 sliceSize=1022');
      recorder.stop();
      expect(lines.some((l) => l.message.includes('no answer'))).toBe(false);
    });

    it('says so when the link closes without an answer', async () => {
      const { native, lines, recorder } = await connected();
      native.emit('onScaleLink', { id: ID, state: 'disconnected', error: 'timeout', services: [] });
      expect(lines.at(-1)?.message).toBe(`${RECORD_PREFIX}huawei-link ${ID}: no answer to the link params request`);
      recorder.stop();
    });

    it('falls back to the plain recording when fe02 cannot be subscribed', async () => {
      const s = setup();
      await s.recorder.start([ID], { connect: true });
      s.native.emit('onScaleAdvertisement', ad({}));
      await tick();
      s.native.failing.add('subscribe');
      s.native.emit('onScaleLink', { id: ID, state: 'connected', error: null, services });
      for (let i = 0; i < 5; i++) await tick();
      expect(s.native.writes).toHaveLength(0);
      expect(s.native.calls.filter((c) => c === 'subscribe fe86/fe02')).toHaveLength(2);
      s.recorder.stop();
    });
  });
});
