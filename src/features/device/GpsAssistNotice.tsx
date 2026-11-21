import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { Notice } from '@/components/States';
import { ensureLocation, locationState } from '@/features/sensors/permissions';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { useWatch } from '@/state/WatchProvider';

/**
 * A watch is paired, precise location is not allowed: the phone cannot lend the watch its GPS position, which is what shortens the first fix
 * of an outdoor run (and for non-GPS bands, provides the only route map).
 * Stays visible until the permission is given. Asks once; after refusal it opens the app's settings instead.
 */
export function GpsAssistNotice() {
  const { t } = useTranslation('watch');
  const linked = useWatch().device !== null;
  const [state, setState] = useState<'granted' | 'blocked' | 'unknown'>('granted');

  const check = useCallback(() => {
    void locationState().then(setState);
  }, []);
  useNativeRefresh(check);

  if (!linked || state === 'granted') return null;

  const allow = async () => {
    if (state === 'blocked') {
      void Linking.openSettings();
      return;
    }
    const result = await ensureLocation();
    setState(result === 'granted' ? 'granted' : result === 'blocked' ? 'blocked' : 'unknown');
  };

  return (
    <Notice icon="locate" action={{ label: state === 'blocked' ? t('gpsAssist.openSettings') : t('gpsAssist.allow'), onPress: () => void allow() }}>
      {t('gpsAssist.body')}
    </Notice>
  );
}
