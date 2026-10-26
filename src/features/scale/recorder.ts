import {
  describeLinkFrame,
  fromHex,
  HUAWEI_LINK_NOTIFY,
  HUAWEI_LINK_SERVICE,
  HUAWEI_LINK_WRITE,
  LINK_PARAMS_REQUEST,
  LinkFrameAssembler,
  toHex,
} from './huaweiLink';
import { nativeErrorCode, type ScaleNative } from './native';
import type { ScaleHub } from './hub';
import type { AdFrame, CharacteristicProperty } from './types';

type ServiceTable = { uuid: string; characteristics: { uuid: string; properties: CharacteristicProperty[] }[] }[];

const HUAWEI_LINK_NOTIFY_KEY = `${HUAWEI_LINK_SERVICE}/${HUAWEI_LINK_NOTIFY}`;

/** Every line of this recording starts with this, so the support log can be filtered down to it. */
export const RECORD_PREFIX = 'scale: ';

export interface RecordLine {
  ts: number;
  direction: 'rx' | 'tx' | 'info' | 'error';
  message: string;
  hex: string | null;
}

const dataText = (map: Record<string, string>): string =>
  Object.keys(map)
    .sort()
    .map((k) => `${k}=${map[k]}`)
    .join(',');

/** The advertisement as one support-log line: everything a decoder could need, nothing the scale did not send. */
export function describeAdvertisement(frame: AdFrame): string {
  return [
    `adv ${frame.id}`,
    `name=${frame.name ?? '-'}`,
    `rssi=${frame.rssi}`,
    `services=[${frame.serviceUuids.join(',')}]`,
    `serviceData={${dataText(frame.serviceData)}}`,
    `manufacturer={${dataText(frame.manufacturerData)}}`,
  ].join(' ');
}

/**
 * "Rekam data timbangan": logs what the chosen devices send, so a scale JoyoFit cannot read yet can be added from the log.
 *  - every advertisement of the chosen devices (address, name, service UUIDs, service data, manufacturer data as hex);
 *  - optionally a connection to each: the service table with its properties, then every notification and indication of every
 *    characteristic that offers them, and a read of every readable one, as hex. It writes nothing to the device, with one exception: a
 *    device with the Huawei link service (fe86: fe01 write, fe02 notify; the HUAWEI Scale 3 Pro has it) gets the link parameters question
 *    first (`huaweiLink.ts`; a query that changes nothing on the device), and its answer is logged raw and decoded. Any other scale that
 *    wants a handshake stays quiet here; the log then shows the table the handshake has to be built from.
 * Lines go to `sink` (the app's support log). Stop with `stop()`.
 */
export class ScaleRecorder {
  private release: (() => void) | null = null;
  private off: (() => void)[] = [];
  private connected = new Set<string>();
  private lastFingerprint = new Map<string, string>();
  private linkSubs: { remove(): void }[] = [];
  private chain: Promise<void> = Promise.resolve();
  private ids = new Set<string>();
  /** Devices asked the Huawei link question on their current connection; `answered` once a frame came back on fe02. */
  private probes = new Map<string, { assembler: LinkFrameAssembler; answered: boolean }>();
  private connect = false;

  constructor(
    private readonly hub: ScaleHub,
    private readonly sink: (line: RecordLine) => void,
    private readonly now: () => number = Date.now,
  ) {}

  get running(): boolean {
    return this.release !== null;
  }

  private write(direction: RecordLine['direction'], message: string, hex: string | null = null): void {
    this.sink({ ts: this.now(), direction, message: RECORD_PREFIX + message, hex });
  }

  async start(ids: readonly string[], options: { connect: boolean }): Promise<void> {
    if (this.running) this.stop();
    this.ids = new Set(ids);
    this.connect = options.connect;
    this.connected.clear();
    this.probes.clear();
    this.lastFingerprint.clear();
    this.off = [
      this.hub.onAdvertisement((frame) => this.onAdvertisement(frame)),
      this.hub.onScanError((code) => {
        this.write('error', `scan ended: ${code}`);
        this.stop();
      }),
    ];
    const native = this.hub.native;
    this.linkSubs = [
      native.addListener('onScaleLink', (e) => {
        if (!this.ids.has(e.id)) return;
        this.write('info', `link ${e.id} ${e.state}${e.error ? ` (${e.error})` : ''}`);
        if (e.state === 'connected') {
          this.write(
            'info',
            `services ${e.id} ${e.services.map((s) => `${s.uuid}[${s.characteristics.map((c) => `${c.uuid}:${c.properties.join('+')}`).join(' ')}]`).join(' ')}`,
          );
          this.enqueue(async () => {
            const probed = await this.probeHuaweiLink(native, e.id, e.services);
            await this.subscribeAll(native, e.id, e.services, probed ? HUAWEI_LINK_NOTIFY_KEY : null);
          });
        } else if (e.state === 'disconnected') {
          this.endProbe(e.id);
          this.connected.delete(e.id);
        }
      }),
      native.addListener('onScaleValue', (e) => {
        if (!this.ids.has(e.id)) return;
        this.write('rx', `value ${e.id} ${e.service}/${e.characteristic}`, e.value);
        const probe = this.probes.get(e.id);
        const bytes = probe && `${e.service}/${e.characteristic}` === HUAWEI_LINK_NOTIFY_KEY ? fromHex(e.value) : null;
        if (!probe || !bytes) return;
        for (const frame of probe.assembler.push(bytes)) {
          probe.answered = true;
          this.write('info', `huawei-link ${e.id} ${describeLinkFrame(frame)}`);
        }
      }),
    ];
    this.write('info', `recording ${[...this.ids].join(' ')} connect=${this.connect}`);
    this.release = await this.hub.acquire({ ids: [...this.ids], lowLatency: true });
  }

  stop(): void {
    const wasRunning = this.running;
    this.release?.();
    this.release = null;
    for (const o of this.off) o();
    this.off = [];
    for (const s of this.linkSubs) s.remove();
    this.linkSubs = [];
    for (const id of this.connected) {
      this.endProbe(id);
      void this.hub.native.scaleDisconnect(id).catch(() => {});
    }
    this.connected.clear();
    if (wasRunning) this.write('info', 'recording stopped');
  }

  private onAdvertisement(frame: AdFrame): void {
    if (!this.ids.has(frame.id)) return;
    const line = describeAdvertisement(frame);
    if (this.lastFingerprint.get(frame.id) === line) return;
    this.lastFingerprint.set(frame.id, line);
    this.write('rx', line);
    if (this.connect && !this.connected.has(frame.id)) {
      this.connected.add(frame.id);
      void this.hub.native.scaleConnect(frame.id).catch((e: unknown) => {
        this.connected.delete(frame.id);
        this.write('error', `connect ${frame.id} failed: ${nativeErrorCode(e) ?? String(e)}`);
      });
    }
  }

  private enqueue(job: () => Promise<void>): void {
    this.chain = this.chain.then(job).catch(() => {});
  }

  /**
   * The Huawei link probe: on a device with fe86 (fe01 write, fe02 notify), turn fe02 on and send the link parameters question before
   * anything else is subscribed, since the Scale 3 Pro drops a link that stays silent for about 22 s. True when fe02 was subscribed here
   * (so `subscribeAll` skips it).
   */
  private async probeHuaweiLink(native: ScaleNative, id: string, services: ServiceTable): Promise<boolean> {
    const link = services.find((s) => s.uuid === HUAWEI_LINK_SERVICE)?.characteristics;
    const write = link?.find((c) => c.uuid === HUAWEI_LINK_WRITE && (c.properties.includes('write') || c.properties.includes('writeNoResponse')));
    const notify = link?.find((c) => c.uuid === HUAWEI_LINK_NOTIFY && (c.properties.includes('notify') || c.properties.includes('indicate')));
    if (!write || !notify || !this.running || !this.connected.has(id)) return false;
    try {
      await native.scaleSubscribe(id, HUAWEI_LINK_SERVICE, HUAWEI_LINK_NOTIFY);
    } catch (e) {
      this.write('error', `${id} ${HUAWEI_LINK_NOTIFY_KEY}: ${nativeErrorCode(e) ?? String(e)}`);
      return false;
    }
    this.write('info', `subscribed ${id} ${HUAWEI_LINK_NOTIFY_KEY}`);
    this.probes.set(id, { assembler: new LinkFrameAssembler(), answered: false });
    const hex = toHex(LINK_PARAMS_REQUEST);
    const where = `${HUAWEI_LINK_SERVICE}/${HUAWEI_LINK_WRITE}`;
    this.write('tx', `huawei-link ${id} ${where} link params request`, hex);
    try {
      await native.scaleWrite(id, HUAWEI_LINK_SERVICE, HUAWEI_LINK_WRITE, hex, !write.properties.includes('writeNoResponse'));
    } catch (e) {
      this.write('error', `huawei-link ${id} ${where}: ${nativeErrorCode(e) ?? String(e)}`);
    }
    return true;
  }

  /** The link of `id` closed or the recording stopped: say so when the probe got no answer. */
  private endProbe(id: string): void {
    const probe = this.probes.get(id);
    if (!probe) return;
    this.probes.delete(id);
    if (!probe.answered) this.write('info', `huawei-link ${id}: no answer to the link params request`);
  }

  private async subscribeAll(native: ScaleNative, id: string, services: ServiceTable, skip: string | null): Promise<void> {
    for (const service of services) {
      for (const c of service.characteristics) {
        if (!this.running || !this.connected.has(id)) return;
        const where = `${service.uuid}/${c.uuid}`;
        if (where === skip) continue;
        try {
          if (c.properties.includes('notify') || c.properties.includes('indicate')) {
            await native.scaleSubscribe(id, service.uuid, c.uuid);
            this.write('info', `subscribed ${id} ${where}`);
          }
          if (c.properties.includes('read')) await native.scaleRead(id, service.uuid, c.uuid);
        } catch (e) {
          this.write('error', `${id} ${where}: ${nativeErrorCode(e) ?? String(e)}`);
        }
      }
    }
  }
}
