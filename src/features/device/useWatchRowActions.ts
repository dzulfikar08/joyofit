import { useMemo } from 'react';

import type { BondedDevices } from '@/features/device/useBondedDevices';
import { useWatch } from '@/state/WatchProvider';

export interface WatchRowActions {
  /** Stops a running scan (it competes with the connect for the radio) and moves the one link to this watch. */
  connect: (address: string) => void;
  disconnect: () => void;
  /** Forgets the watch's keys, then reloads the list so its row reflects it. */
  forget: (address: string) => void;
}

/** What a watch's buttons do, the same in the Watch tab's list and the setup guide's scan cards. */
export function useWatchRowActions(bonded: Pick<BondedDevices, 'stopScan' | 'reload'>): WatchRowActions {
  const { switchTo, disconnect, forget } = useWatch();
  const { stopScan, reload } = bonded;
  return useMemo(
    () => ({
      connect: (address: string) => {
        void stopScan();
        void switchTo(address);
      },
      disconnect: () => void disconnect(),
      forget: (address: string) => {
        void forget(address).then(() => void reload());
      },
    }),
    [stopScan, reload, switchTo, disconnect, forget],
  );
}
