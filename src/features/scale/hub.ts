import { nativeErrorCode, toAdFrame, type ScaleNative } from './native';
import type { AdFrame } from './types';

/** What a consumer needs from the shared scan. */
export interface ScanRequest {
  /** Only these scales (addresses / identifiers), or null for every device around (discovery, recording). */
  ids: string[] | null;
  /** Foreground "find my scale" wants the fast radio duty cycle; waiting for a weigh-in all day does not. */
  lowLatency: boolean;
}

/** Longest the native scan runs before the hub starts it again (the native side caps one scan at 180 s). */
const WINDOW_MS = 120_000;

/**
 * One owner of the radio scan for every scale feature. The native module has a single scale scan, but several screens want it at once
 * (the picker lists everything, the live weigh-in and the auto-capture each want their own scale). Consumers `acquire` a request; the hub
 * runs one scan for the union (everything if any consumer wants everything, else the union of ids), delivers each advertisement to every
 * listener (they filter by id themselves), restarts it when a window ends, and stops it when the last consumer lets go.
 */
export class ScaleHub {
  private holders = new Map<symbol, ScanRequest>();
  private listeners = new Set<(frame: AdFrame) => void>();
  private errorListeners = new Set<(code: string) => void>();
  private nativeSubs: { remove(): void }[] = [];
  private appliedKey: string | null = null;
  private applying: Promise<void> = Promise.resolve();

  constructor(private readonly getNative: () => ScaleNative) {}

  get native(): ScaleNative {
    return this.getNative();
  }

  /** Every advertisement of the running scan (already normalised). */
  onAdvertisement(listener: (frame: AdFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A scan that failed to restart on its own (Bluetooth turned off, permission revoked): the error code. */
  onScanError(listener: (code: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  /** Starts (or widens) the scan. Rejects with the native error code's error (permission, Bluetooth off) and then holds nothing. */
  async acquire(request: ScanRequest): Promise<() => void> {
    const key = Symbol('scan');
    this.holders.set(key, request);
    try {
      await this.apply();
    } catch (e) {
      this.holders.delete(key);
      void this.apply().catch(() => {});
      throw e;
    }
    return () => {
      if (this.holders.delete(key)) void this.apply().catch(() => {});
    };
  }

  private attach(): void {
    if (this.nativeSubs.length > 0) return;
    const native = this.native;
    this.nativeSubs = [
      native.addListener('onScaleAdvertisement', (event) => {
        const frame = toAdFrame(event);
        for (const l of this.listeners) l(frame);
      }),
      native.addListener('onScaleScanState', (event) => {
        if (event.scanning) return;
        this.appliedKey = null;
        if (event.error) {
          for (const l of this.errorListeners) l(event.error);
        } else if (this.holders.size > 0) {
          void this.apply().catch((e: unknown) => {
            for (const l of this.errorListeners) l(nativeErrorCode(e) ?? 'ERR_BLUETOOTH_UNAVAILABLE');
          });
        }
      }),
    ];
  }

  private detach(): void {
    for (const s of this.nativeSubs) s.remove();
    this.nativeSubs = [];
  }

  /** Serialised: the scan always reflects the latest set of holders. */
  private apply(): Promise<void> {
    const run = this.applying.then(() => this.applyNow());
    this.applying = run.catch(() => {});
    return run;
  }

  private async applyNow(): Promise<void> {
    const wanted = [...this.holders.values()];
    if (wanted.length === 0) {
      this.appliedKey = null;
      this.detach();
      await this.native.stopScaleScan();
      return;
    }
    this.attach();
    const everything = wanted.some((w) => w.ids === null);
    const ids = everything ? [] : [...new Set(wanted.flatMap((w) => w.ids ?? []))].sort();
    const lowLatency = wanted.some((w) => w.lowLatency);
    const key = `${ids.join(',')}|${lowLatency}`;
    if (key === this.appliedKey) return;
    await this.native.startScaleScan(ids, WINDOW_MS, lowLatency);
    this.appliedKey = key;
  }
}
