import type { ScaleLinkEvent, ValueEvent } from '../../../modules/ble-sensors/src/BleSensors.types';
import { nativeErrorCode, type ScaleNative } from './native';
import type { DiscoveredService, GattAction, GattContext, GattProtocol, GattSession, GattStep, ScaleReading } from './types';

/** One line of what happened on the link, for the support log ("Rekam data timbangan") and for tests. */
export interface TraceLine {
  direction: 'tx' | 'rx' | 'info' | 'error';
  message: string;
  hex?: string;
}

export interface GattRunHandlers {
  onReading(reading: ScaleReading): void;
  onLink(state: 'connecting' | 'connected' | 'disconnected', error: string | null): void;
  onTrace(line: TraceLine): void;
}

/**
 * Runs one `GattProtocol` session against a scale: connects, hands the discovered services to the session, executes the actions it
 * returns in order and feeds it every notification. All protocol knowledge is in the session (pure, tested with byte vectors); this class
 * is the glue to the native module. A failed GATT operation is traced and skipped (a scale may lack an optional characteristic); the link
 * ending ends the run. `stop()` drops the link.
 */
export class GattRun {
  private session: GattSession | null = null;
  private chain: Promise<void> = Promise.resolve();
  private listeners: { remove(): void }[] = [];
  private ended = false;

  constructor(
    private readonly native: ScaleNative,
    private readonly protocol: GattProtocol,
    readonly id: string,
    private readonly context: () => GattContext,
    private readonly handlers: GattRunHandlers,
  ) {}

  async start(): Promise<void> {
    this.listeners = [
      this.native.addListener('onScaleLink', (event) => this.onLink(event)),
      this.native.addListener('onScaleValue', (event) => this.onValue(event)),
    ];
    try {
      await this.native.scaleConnect(this.id);
    } catch (e) {
      this.finish(nativeErrorCode(e) ?? 'connect failed');
    }
  }

  stop(): void {
    if (this.ended) return;
    this.ended = true;
    this.detach();
    void this.native.scaleDisconnect(this.id).catch(() => {});
    this.handlers.onLink('disconnected', null);
  }

  private detach(): void {
    for (const l of this.listeners) l.remove();
    this.listeners = [];
  }

  private finish(error: string | null): void {
    if (this.ended) return;
    this.ended = true;
    this.detach();
    this.handlers.onLink('disconnected', error);
  }

  private onLink(event: ScaleLinkEvent): void {
    if (event.id !== this.id || this.ended) return;
    if (event.state === 'connecting') {
      this.handlers.onLink('connecting', null);
      return;
    }
    if (event.state === 'disconnected') {
      this.finish(event.error);
      return;
    }
    this.handlers.onLink('connected', null);
    const services: DiscoveredService[] = event.services;
    this.handlers.onTrace({
      direction: 'info',
      message: `services ${services.map((s) => `${s.uuid}[${s.characteristics.map((c) => `${c.uuid}:${c.properties.join('+')}`).join(' ')}]`).join(' ')}`,
    });
    this.session = this.protocol.createSession(this.context());
    const session = this.session;
    this.enqueue(() => session.start(services));
  }

  private onValue(event: ValueEvent): void {
    if (event.id !== this.id || this.ended || !this.session) return;
    const session = this.session;
    this.handlers.onTrace({ direction: 'rx', message: `${event.service}/${event.characteristic}`, hex: event.value });
    this.enqueue(() => session.onValue(event.service, event.characteristic, event.value, event.ts));
  }

  /** Steps run strictly one after the other, so a notification that arrives during a handshake is handled after it. */
  private enqueue(produce: () => GattStep): void {
    this.chain = this.chain.then(async () => {
      if (this.ended) return;
      let step: GattStep;
      try {
        step = produce();
      } catch (e) {
        this.handlers.onTrace({ direction: 'error', message: `decoder failed: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }
      for (const reading of step.readings) this.handlers.onReading(reading);
      for (const action of step.actions) {
        if (this.ended) return;
        await this.execute(action);
      }
      if (step.done && !this.ended) this.stop();
    });
  }

  private async execute(action: GattAction): Promise<void> {
    const where = `${action.service}/${action.characteristic}`;
    try {
      if (action.op === 'subscribe') {
        this.handlers.onTrace({ direction: 'info', message: `subscribe ${where}` });
        await this.native.scaleSubscribe(this.id, action.service, action.characteristic);
      } else if (action.op === 'read') {
        this.handlers.onTrace({ direction: 'info', message: `read ${where}` });
        await this.native.scaleRead(this.id, action.service, action.characteristic);
      } else {
        this.handlers.onTrace({ direction: 'tx', message: where, hex: action.hex });
        await this.native.scaleWrite(this.id, action.service, action.characteristic, action.hex, action.withResponse);
      }
    } catch (e) {
      this.handlers.onTrace({ direction: 'error', message: `${action.op} ${where} failed: ${nativeErrorCode(e) ?? String(e)}` });
    }
  }
}
