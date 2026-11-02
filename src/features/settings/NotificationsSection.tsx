import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PermissionsAndroid, Platform } from 'react-native';

import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { isIos } from '@/components/IosUnavailable';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { NotificationsSectionIos } from '@/features/settings/NotificationsSectionIos';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';
import { appAlert } from '@/components/AppAlert';

/** Android 13 (API 33) introduced the runtime POST_NOTIFICATIONS permission. */
const RUNTIME_NOTIFICATION_API = 33;

export function NotificationsSection() {
  return isIos ? <NotificationsSectionIos /> : <NotificationsSectionAndroid />;
}

function NotificationsSectionAndroid() {
  const { t } = useTranslation(['settings', 'common']);
  const [access, setAccess] = useState(() => HuaweiWear.getNotificationAccess());
  const [morning, setMorning] = useState(() => HuaweiWear.getMorningSummaryEnabled());
  const [morningDenied, setMorningDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setAccess(HuaweiWear.getNotificationAccess()), []);
  useNativeRefresh(refresh);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      refresh();
    }
  };

  const toggleMorning = (next: boolean) =>
    run(async () => {
      setMorningDenied(false);
      if (next && Platform.OS === 'android' && Number(Platform.Version) >= RUNTIME_NOTIFICATION_API) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        setMorningDenied(result !== PermissionsAndroid.RESULTS.GRANTED);
      }
      await HuaweiWear.setMorningSummaryEnabled(next);
      setMorning(next);
    });

  return (
    <Section title={t('notifications.title')} icon="notifications">
      <KeyValue icon="key" label={t('notifications.access')} value={access.granted ? t('notifications.granted') : t('notifications.notGranted')} />
      <Button
        label={t('notifications.openAccess')}
        variant="secondary"
        icon="open-outline"
        onPress={() =>
          appAlert(t('notifications.readTitle'), t('notifications.disclosure'), [
            { text: t('common:actions.cancel'), style: 'cancel' },
            { text: t('common:actions.next'), onPress: () => void run(() => HuaweiWear.openNotificationAccess()) },
          ])
        }
      />
      {HuaweiWear.distribution === 'sideload' ? (
        <Notice>{t('notifications.restricted')}</Notice>
      ) : null}
      <SwitchRow
        icon="notifications"
        label={t('notifications.forward')}
        hint={access.granted ? undefined : t('notifications.grantFirst')}
        value={access.enabled}
        onValueChange={(enabled) => run(() => HuaweiWear.setNotificationsEnabled(enabled))}
        disabled={!access.granted}
      />
      <SwitchRow
        icon="sunny"
        label={t('notifications.morning')}
        value={morning}
        onValueChange={toggleMorning}
      />
      {morning && morningDenied ? (
        <Notice>{t('notifications.morningDenied')}</Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Details>{t('notifications.details')}</Details>
    </Section>
  );
}
