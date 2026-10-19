import type {
  ScaleAdvertisementEvent,
  ScaleLinkEvent,
  ScanStateEvent,
  ValueEvent,
} from '../../../modules/ble-sensors/src/BleSensors.types';
import { normalizeUuid } from './uuid';
import type { AdFrame } from './types';

/** The slice of the `BleSensors` native module the scale code uses (the module satisfies it structurally); injected so everything runs under bun test. */
export interface ScaleNative {
  addListener(name: 'onScaleAdvertisement', listener: (event: ScaleAdvertisementEvent) => void): { remove(): void };
  addListener(name: 'onScaleScanState', listener: (event: ScanStateEvent) => void): { remove(): void };
  addListener(name: 'onScaleLink', listener: (event: ScaleLinkEvent) => void): { remove(): void };
  addListener(name: 'onScaleValue', listener: (event: ValueEvent) => void): { remove(): void };
  startScaleScan(ids: string[], durationMs: number, lowLatency: boolean): Promise<void>;
  stopScaleScan(): Promise<void>;
  scaleConnect(id: string): Promise<void>;
  scaleDisconnect(id: string): Promise<void>;
  scaleSubscribe(id: string, service: string, characteristic: string): Promise<void>;
  scaleRead(id: string, service: string, characteristic: string): Promise<void>;
  scaleWrite(id: string, service: string, characteristic: string, hex: string, withResponse: boolean): Promise<void>;
}

/** The native advertisement as the decoders want it (identifiers normalised, hex lowercase). */
export function toAdFrame(event: ScaleAdvertisementEvent): AdFrame {
  const lowerMap = (map: Record<string, string>, key: (k: string) => string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) out[key(k)] = v.toLowerCase();
    return out;
  };
  return {
    id: event.id,
    name: event.name,
    rssi: event.rssi,
    ts: event.ts,
    serviceUuids: event.serviceUuids.map(normalizeUuid),
    serviceData: lowerMap(event.serviceData, normalizeUuid),
    manufacturerData: lowerMap(event.manufacturerData, (k) => k.toLowerCase()),
  };
}

/** The error code of a rejected native call (`ERR_BLUETOOTH_OFF`, `ERR_SCALE_GATT_133`, ...), or null. */
export function nativeErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}
