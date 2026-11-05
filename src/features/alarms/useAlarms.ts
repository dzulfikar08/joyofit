import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { notePrefChanged } from '@/cloud/prefsSync';
import { ALARM_BACKUP_PREF, alarmBackup, hasAlarms, rememberAlarms, shouldOfferRestore, storeAlarmBackup, type AlarmBackup } from '@/features/alarms/alarmBackup';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type WatchAlarms, type WatchAlarmsUpdate } from '@/wear';

/**
 * The watch's alarms: the stored copy at first, replaced by a read from the watch whenever this
 * screen gains focus with a connected watch. `save` pushes a whole new list and shows what the
 * watch reports back.
 */
export function useAlarms() {
  const { linkState } = useWatch();
  const connected = linkState === 'connected' || linkState === 'syncing';
  const [alarms, setAlarms] = useState<WatchAlarms>(() => HuaweiWear.getAlarms());
  const [backup, setBackup] = useState<AlarmBackup | null>(() => alarmBackup());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<WatchAlarms>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      setAlarms(result);
      // Keep a copy of what a watch with alarms holds; an emptied (reset) watch leaves the copy alone.
      rememberAlarms(result);
      setBackup(alarmBackup());
      return true;
    } catch (e) {
      setError(errorMessage(e));
      setAlarms(HuaweiWear.getAlarms());
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(() => run(() => HuaweiWear.refreshAlarms()), [run]);
  const save = useCallback(
    (update: WatchAlarmsUpdate) =>
      run(async () => {
        const result = await HuaweiWear.setAlarms(update);
        // Emptied on purpose by the person: the backup goes too, so Restore is not offered for alarms they removed.
        if (!hasAlarms(update)) {
          storeAlarmBackup(null);
          void notePrefChanged(ALARM_BACKUP_PREF);
        }
        return result;
      }),
    [run],
  );
  /** Puts the backed-up alarms on the watch: only ever on the person's tap. */
  const restore = useCallback(() => (backup ? save({ event: backup.event, smart: backup.smart }) : Promise.resolve(false)), [backup, save]);
  const restorable = connected && alarms.supported && shouldOfferRestore(alarms, backup) ? backup : null;

  useFocusEffect(
    useCallback(() => {
      setAlarms(HuaweiWear.getAlarms());
      setBackup(alarmBackup());
      if (connected) void refresh();
    }, [connected, refresh]),
  );

  return { alarms, connected, busy, error, refresh, save, restorable, restore };
}
