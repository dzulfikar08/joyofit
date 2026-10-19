import Storage from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { androidPairingAllowsAutoReconnect, type AutoOutcome } from '@/features/device/autoReconnect';
import { createAutoReconnect, type AutoReconnectControl, type ObservedFacts } from '@/features/device/autoReconnectControl';
import { bluetoothConnectGranted } from '@/features/device/useBluetoothPermission';
import { HuaweiWear, type BondedDevice, type LinkState } from '@/wear';

const DISCONNECTED_BY_USER_KEY = 'watch.disconnectedByUser';

/** Remembers that the person tapped Disconnect (or that they connected again), across launches. A storage failure only loses the memory. */
export async function setDisconnectedByUser(value: boolean): Promise<void> {
  try {
    if (value) await Storage.setItem(DISCONNECTED_BY_USER_KEY, '1');
    else await Storage.removeItem(DISCONNECTED_BY_USER_KEY);
  } catch {
    // The reconnect then behaves as if the person had not disconnected, which is the default.
  }
}

async function disconnectedByUser(): Promise<boolean> {
  try {
    return (await Storage.getItem(DISCONNECTED_BY_USER_KEY)) === '1';
  } catch {
    return false;
  }
}

/** Android's list of watches with their pairing state; empty on iOS (its list scans for four seconds) and when it cannot be read. */
async function androidPairedRows(): Promise<BondedDevice[]> {
  if (Platform.OS !== 'android') return [];
  try {
    return await HuaweiWear.getBondedDevices();
  } catch {
    return [];
  }
}

/** The facts the control does not keep itself, read when an attempt is due. */
async function observe(): Promise<ObservedFacts> {
  const { address, enabled } = HuaweiWear.getBackgroundStatus();
  const [userDisconnected, permitted, listed] = await Promise.all([
    disconnectedByUser(),
    bluetoothConnectGranted(),
    address === null ? [] : androidPairedRows(),
  ]);
  return {
    address,
    linkState: HuaweiWear.getState(),
    backgroundEnabled: enabled,
    disconnectedByUser: userDisconnected,
    permitted,
    appActive: AppState.currentState === 'active',
    pairingAllows: Platform.OS !== 'android' || (address !== null && androidPairingAllowsAutoReconnect(listed, address)),
  };
}

/** The control of one automatic reconnect, for the life of the component that owns the connect it drives. */
export function useAutoReconnectControl(): AutoReconnectControl {
  const [control] = useState(createAutoReconnect);
  return control;
}

/**
 * Reconnects the remembered watch by its stored address when the app opens, comes forward, or the link drops while it is open, unless
 * background mode owns the link, the person disconnected on purpose, or the watch needs a first bind or Android's pairing.
 */
export function useAutoReconnect(
  control: AutoReconnectControl,
  options: {
    linkState: LinkState;
    /** A connect or a sync is running, or the first-bind question is open. Read when an attempt is due, not when it was scheduled. */
    isBusy: () => boolean;
    attempt: (address: string) => Promise<AutoOutcome>;
  },
): void {
  const { linkState, isBusy, attempt } = options;
  useEffect(() => {
    control.bind({ observe, isBusy, attempt });
  }, [control, isBusy, attempt]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') control.foreground();
      else control.cancel();
    });
    control.foreground();
    return () => {
      subscription.remove();
      control.cancel();
    };
  }, [control]);

  useEffect(() => {
    if (linkState === 'connected') control.linked();
    if (linkState === 'disconnected') control.schedule();
  }, [linkState, control]);
}
