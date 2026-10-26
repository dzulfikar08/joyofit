import { nativeErrorCode, type ScaleNative } from './native';
import type { ScaleHub } from './hub';
import type { AdFrame, CharacteristicProperty } from './types';

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
 *    characteristic that offers them, and a read of every readable one, as hex. It sends nothing to the device (a scale that wants a
 *    handshake before it talks stays quiet here; the log then shows the table the handshake has to be built from).
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
          this.enqueue(() => this.subscribeAll(native, e.id, e.services));
        } else if (e.state === 'disconnected') {
          this.connected.delete(e.id);
        }
      }),
      native.addListener('onScaleValue', (e) => {
        if (this.ids.has(e.id)) this.write('rx', `value ${e.id} ${e.service}/${e.characteristic}`, e.value);
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
    for (const id of this.connected) void this.hub.native.scaleDisconnect(id).catch(() => {});
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

  private async subscribeAll(
    native: ScaleNative,
    id: string,
    services: { uuid: string; characteristics: { uuid: string; properties: CharacteristicProperty[] }[] }[],
  ): Promise<void> {
    for (const service of services) {
      for (const c of service.characteristics) {
        if (!this.running || !this.connected.has(id)) return;
        const where = `${service.uuid}/${c.uuid}`;
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
