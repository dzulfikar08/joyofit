import type { ScaleNative } from './native';

type Listener = (event: never) => void;

/** A scripted `BleSensors` for the scale code: records calls, lets a test emit native events, and can refuse operations. */
export class FakeScaleNative implements ScaleNative {
  calls: string[] = [];
  writes: { service: string; characteristic: string; hex: string; withResponse: boolean }[] = [];
  failing = new Set<string>();
  private listeners = new Map<string, Set<Listener>>();

  addListener(name: string, listener: (event: never) => void): { remove(): void } {
    const set = this.listeners.get(name) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(name, set);
    return { remove: () => void set.delete(listener) };
  }

  emit(name: string, event: unknown): void {
    for (const l of [...(this.listeners.get(name) ?? [])]) (l as (e: unknown) => void)(event);
  }

  listenerCount(name: string): number {
    return this.listeners.get(name)?.size ?? 0;
  }

  private async op(call: string, kind: string): Promise<void> {
    this.calls.push(call);
    if (this.failing.has(kind)) throw Object.assign(new Error(kind), { code: 'ERR_SCALE_NO_CHARACTERISTIC' });
  }

  startScaleScan(ids: string[], durationMs: number, lowLatency: boolean) {
    return this.op(`scan ${ids.length === 0 ? '*' : ids.join(',')} ${lowLatency ? 'fast' : 'slow'}`, 'scan');
  }
  stopScaleScan() {
    return this.op('stopScan', 'stopScan');
  }
  scaleConnect(id: string) {
    return this.op(`connect ${id}`, 'connect');
  }
  scaleDisconnect(id: string) {
    return this.op(`disconnect ${id}`, 'disconnect');
  }
  scaleSubscribe(id: string, service: string, characteristic: string) {
    return this.op(`subscribe ${service}/${characteristic}`, 'subscribe');
  }
  scaleRead(id: string, service: string, characteristic: string) {
    return this.op(`read ${service}/${characteristic}`, 'read');
  }
  async scaleWrite(id: string, service: string, characteristic: string, hex: string, withResponse: boolean) {
    this.writes.push({ service, characteristic, hex, withResponse });
    await this.op(`write ${service}/${characteristic} ${hex}`, 'write');
  }
}
