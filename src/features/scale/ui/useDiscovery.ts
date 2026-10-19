import { useCallback, useEffect, useRef, useState } from 'react';

import { foldDevice, visibleDevices, type DiscoveredDevice } from '@/features/scale/discovery';
import { scaleHub } from '@/features/scale/instance';
import { nativeErrorCode } from '@/features/scale/native';
import { ensureSensorPermissions, type Granted } from '@/features/sensors/permissions';

export interface Discovery {
  devices: DiscoveredDevice[];
  searching: boolean;
  /** An error code (ERR_BLUETOOTH_OFF, ...) when the search could not start or died. */
  error: string | null;
  /** Asks for the Bluetooth permission, then starts. Resolves with what the person answered; the search runs only on `granted`. */
  start: () => Promise<Granted>;
  stop: () => void;
}

/** The picker's search: an unfiltered scan through the shared hub, folded into one list of devices. Stops when the screen goes. */
export function useDiscovery(): Discovery {
  const [devices, setDevices] = useState<ReadonlyMap<string, DiscoveredDevice>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
    setSearching(false);
  }, []);

  const start = useCallback(async (): Promise<Granted> => {
    const permission = await ensureSensorPermissions();
    if (permission !== 'granted') return permission;
    cleanup.current?.();
    setError(null);
    setDevices(new Map());
    const offAd = scaleHub.onAdvertisement((frame) => setDevices((m) => foldDevice(m, frame, Date.now())));
    const offError = scaleHub.onScanError((code) => {
      setError(code);
      setSearching(false);
    });
    try {
      const release = await scaleHub.acquire({ ids: null, lowLatency: true });
      cleanup.current = () => {
        offAd();
        offError();
        release();
      };
      setSearching(true);
    } catch (e) {
      offAd();
      offError();
      setError(nativeErrorCode(e) ?? 'ERR_BLUETOOTH_UNAVAILABLE');
    }
    return 'granted';
  }, []);

  useEffect(() => {
    if (!searching) return;
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, [searching]);

  useEffect(() => stop, [stop]);

  return { devices: visibleDevices(devices, now), searching, error, start, stop };
}
