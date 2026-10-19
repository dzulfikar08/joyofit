import { GattRun, type TraceLine } from './driver';
import { ReadingGate } from './gate';
import type { ScaleHub } from './hub';
import type { AdFrame, GattContext, ScaleProtocol, ScaleReading, ScaleUser } from './types';

export type WeighStatus = 'starting' | 'waiting' | 'connecting' | 'connected';

export interface WeighHandlers {
  onStatus(status: WeighStatus): void;
  /** A reading still settling: show it live. */
  onLive(reading: ScaleReading): void;
  /** A settled weigh-in. `upgrade`: the same weigh-in again, now with impedance. */
  onFinal(reading: ScaleReading, upgrade: boolean): void;
  onTrace(line: TraceLine): void;
  /** The scan cannot run (permission revoked, Bluetooth off): the native error code. The session has stopped. */
  onProblem(code: string): void;
}

export interface WeighOptions {
  /** Waiting for a step-on all day (auto-capture) uses the slow radio duty cycle; a screen the person is looking at the fast one. */
  lowLatency: boolean;
  user: () => ScaleUser | null;
  now?: () => number;
  /** After a connected weigh-in ends, how long until the scale is looked for again. */
  cooldownMs?: number;
  timezoneOffsetMin?: () => number;
}

/**
 * Waits for one picked scale and turns what it sends into weigh-ins.
 *  - Broadcast scale: every advertisement of that scale is decoded; the gate decides what is live and what is final.
 *  - Connected scale: it only advertises while awake, so the session waits for its advertisement (cheap, scan-only), then connects, runs
 *    the protocol until the scale is done or drops, and goes back to waiting.
 * The scan is shared through the hub, so a picker or a recording can run beside it.
 */
export class WeighSession {
  private active = false;
  private release: (() => void) | null = null;
  private off: (() => void)[] = [];
  private run: GattRun | null = null;
  private cooldownUntil = 0;
  private readonly gate: ReadingGate;
  private readonly now: () => number;

  constructor(
    private readonly hub: ScaleHub,
    private readonly scale: { id: string; protocol: ScaleProtocol },
    private readonly options: WeighOptions,
    private readonly handlers: WeighHandlers,
  ) {
    this.gate = new ReadingGate({ repeats: scale.protocol.kind === 'broadcast' ? 2 : 1 });
    this.now = options.now ?? Date.now;
  }

  get running(): boolean {
    return this.active;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.handlers.onStatus('starting');
    this.off = [
      this.hub.onAdvertisement((frame) => this.onAdvertisement(frame)),
      this.hub.onScanError((code) => {
        this.stop();
        this.handlers.onProblem(code);
      }),
    ];
    try {
      this.release = await this.hub.acquire({ ids: [this.scale.id], lowLatency: this.options.lowLatency });
    } catch (e) {
      this.stop();
      throw e;
    }
    if (!this.active) {
      this.release();
      this.release = null;
      return;
    }
    this.handlers.onStatus('waiting');
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    for (const o of this.off) o();
    this.off = [];
    this.release?.();
    this.release = null;
    this.run?.stop();
    this.run = null;
    this.gate.reset();
  }

  private emit(reading: ScaleReading): void {
    const out = this.gate.push(reading, this.now());
    if (out.live) this.handlers.onLive(out.live);
    if (out.final) this.handlers.onFinal(out.final, out.upgrade === true);
  }

  private onAdvertisement(frame: AdFrame): void {
    if (!this.active || frame.id !== this.scale.id) return;
    const protocol = this.scale.protocol;
    if (protocol.kind === 'broadcast') {
      if (!protocol.matches(frame)) return;
      let reading: ScaleReading | null;
      try {
        reading = protocol.decode(frame, this.options.user() ?? undefined);
      } catch (e) {
        this.handlers.onTrace({ direction: 'error', message: `decoder failed: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }
      if (reading) this.emit(reading);
      return;
    }
    if (this.run || this.now() < this.cooldownUntil) return;
    this.connect(protocol);
  }

  private connect(protocol: Extract<ScaleProtocol, { kind: 'gatt' }>): void {
    const context = (): GattContext => ({
      user: this.options.user() ?? undefined,
      now: this.now(),
      timezoneOffsetMin: this.options.timezoneOffsetMin?.() ?? -new Date().getTimezoneOffset(),
    });
    const run = new GattRun(this.hub.native, protocol, this.scale.id, context, {
      onReading: (reading) => this.emit(reading),
      onTrace: (line) => this.handlers.onTrace(line),
      onLink: (state) => {
        if (this.run !== run) return;
        if (state === 'disconnected') {
          this.run = null;
          this.gate.reset();
          this.cooldownUntil = this.now() + (this.options.cooldownMs ?? 3000);
          if (this.active) this.handlers.onStatus('waiting');
        } else {
          this.handlers.onStatus(state);
        }
      },
    });
    this.run = run;
    this.handlers.onStatus('connecting');
    void run.start();
  }
}
