import { useEventListener } from 'expo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { listBonded, sortBonded, withDiscovered } from '@/features/device/bondedList';
import { ensureBluetoothScan } from '@/features/device/useBluetoothPermission';
import { errorMessage } from '@/format';
import { t } from '@/i18n';
import { HuaweiWear, type BondedDevice } from '@/wear';

interface BondedState {
  devices: BondedDevice[];
  loading: boolean;
  scanning: boolean;
  /** Devices seen by the scan that is running or just ended (the same watch counts each time it is seen); null when none ran. */
  scanFound: number | null;
  error: string | null;
  /** True once a load has finished, so "no watch found" is not shown before the first answer. */
  loaded: boolean;
}

type TimeoutHandle = ReturnType<typeof setTimeout>;

/** The watch list and its actions, as `useBondedDevices` returns them. */
export interface BondedDevices extends BondedState {
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
}

/** Loads bonded and nearby BLE devices when permission is granted. */
export function useBondedDevices(enabled: boolean): BondedDevices {
  const [state, setState] = useState<BondedState>({
    devices: [],
    loading: false,
    scanning: false,
    scanFound: null,
    error: null,
    loaded: false,
  });
  const deviceMapRef = useRef<Map<string, BondedDevice>>(new Map());
  const scanTimeoutRef = useRef<TimeoutHandle | null>(null);

  const load = useCallback(async (fetchDevices: () => Promise<BondedDevice[]>) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const bonded = await fetchDevices();
      const activeDev = HuaweiWear.getDevice();
      const { address, name } = HuaweiWear.getBackgroundStatus();
      const devices = listBonded({
        bonded,
        discovered: HuaweiWear.getDiscoveredDevices(),
        active: activeDev,
        remembered: { address, name },
      });
      deviceMapRef.current = new Map<string, BondedDevice>(devices.map((d) => [d.address, d]));
      setState((s) => ({
        ...s,
        devices,
        loading: false,
        error: null,
        loaded: true,
      }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errorMessage(e), loaded: true }));
    }
  }, []);

  const reload = useCallback(() => load(() => HuaweiWear.getBondedDevices()), [load]);
  /** The Refresh button: on iOS the last scan is ignored and the scan runs longer, so a watch that was just released shows up. */
  const refresh = useCallback(() => load(() => HuaweiWear.refreshBondedDevices()), [load]);

  const stopScan = useCallback(async () => {
    clearTimeout(scanTimeoutRef.current ?? undefined);
    scanTimeoutRef.current = null;
    try {
      await HuaweiWear.stopScan();
      setState((s) => ({ ...s, scanning: false }));
    } catch {
      // ignore
    }
  }, []);

  const startScan = useCallback(async () => {
    if (Platform.OS === 'android') {
      // Below Android 12 a BLE scan needs the location permission, which JoyoFit does not ask for a Bluetooth scan.
      if (Number(Platform.Version) < 31) {
        setState((s) => ({ ...s, error: t('watch:device.scan.needsAndroid12') }));
        return;
      }
      if ((await ensureBluetoothScan()) !== 'granted') {
        setState((s) => ({
          ...s,
          error: t('watch:device.scan.permission'),
        }));
        return;
      }
    }
    try {
      clearTimeout(scanTimeoutRef.current ?? undefined);
      setState((s) => ({ ...s, scanning: true, scanFound: 0, error: null }));
      await HuaweiWear.startScan();
      scanTimeoutRef.current = setTimeout(() => {
        void stopScan();
      }, 12000);
    } catch (e) {
      setState((s) => ({ ...s, scanning: false, scanFound: null, error: errorMessage(e) }));
    }
  }, [stopScan]);

  useEventListener(HuaweiWear, 'onDeviceDiscovered', (device) => {
    const map = deviceMapRef.current;
    const existing = map.get(device.address);
    if (!existing || existing.name !== device.name) {
      map.set(device.address, withDiscovered(existing, device));
      setState((s) => ({
        ...s,
        devices: sortBonded(Array.from(map.values())),
        scanFound: (s.scanFound ?? 0) + 1,
      }));
    } else {
      setState((s) => ({ ...s, scanFound: (s.scanFound ?? 0) + 1 }));
    }
  });

  useEventListener(HuaweiWear, 'onScanStateChange', (event) => {
    setState((s) => ({
      ...s,
      scanning: event.scanning,
      error: event.error ?? s.error,
    }));
  });

  useFocusEffect(
    useCallback(() => {
      if (enabled) {
        void reload();
      }
      return () => {
        void stopScan();
      };
    }, [enabled, reload, stopScan]),
  );

  return { ...state, reload, refresh, startScan, stopScan };
}
