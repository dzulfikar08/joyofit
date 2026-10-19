import { useCallback, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

export type PermissionStatus = 'checking' | 'granted' | 'denied' | 'blocked';

/** Android 12 (API 31) introduced the runtime BLUETOOTH_CONNECT permission; older versions grant it at install. */
const RUNTIME_BLUETOOTH_API = 31;

export async function ensureBluetoothConnect(): Promise<Exclude<PermissionStatus, 'checking'>> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < RUNTIME_BLUETOOTH_API) {
    return 'granted';
  }
  const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  if (await PermissionsAndroid.check(permission)) return 'granted';
  const result = await PermissionsAndroid.request(permission);
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
}

/** Whether BLUETOOTH_CONNECT is granted already. Unlike `ensureBluetoothConnect` it never asks: for what the app does by itself. */
export async function bluetoothConnectGranted(): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < RUNTIME_BLUETOOTH_API) return true;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
}

/** The Bluetooth permission as the hook tracks it, and the button that asks for it. */
export interface BluetoothPermission {
  status: PermissionStatus;
  request: () => Promise<void>;
}

/** Checks BLUETOOTH_CONNECT on mount and asks for it when it is not yet granted. */
export function useBluetoothPermission(): BluetoothPermission {
  const [status, setStatus] = useState<PermissionStatus>('checking');

  useEffect(() => {
    let live = true;
    void ensureBluetoothConnect().then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, []);

  const request = useCallback(async () => {
    setStatus(await ensureBluetoothConnect());
  }, []);

  return { status, request };
}

/** BLUETOOTH_SCAN (declared neverForLocation): the Scan nearby devices button and the developer Bluetooth LE mode, which scan for LE addresses. */
export async function ensureBluetoothScan(): Promise<Exclude<PermissionStatus, 'checking'>> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < RUNTIME_BLUETOOTH_API) {
    return 'granted';
  }
  const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN;
  if (await PermissionsAndroid.check(permission)) return 'granted';
  const result = await PermissionsAndroid.request(permission);
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
}
