import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { rogo } from '@/cloud/rogo';
import { publishSleepInsightsStatus, useSleepInsightsStatus } from '@/features/sleep/sleepInsightsStatus';
import { errorMessage, formatCount } from '@/format';
import { useCloud } from '@/state/CloudProvider';

type Load = 'loading' | 'ready' | 'unsupported' | 'offline';

/**
 * Settings, Koneksi, JoyoRogo: the Wawasan tidur switch. The switch lives on the JoyoRogo server (one switch, also editable in
 * JoyoRogo), so this shows the server's answer and every change goes to the server first. Turning on shows what is sent before
 * anything is; turning off warns that JoyoRogo deletes the stored nights. Shown only when signed in to JoyoRogo.
 */
export function SleepInsightsSection() {
  const { t } = useTranslation('settings');
  const cloud = useCloud();
  const status = useSleepInsightsStatus();
  const [load, setLoad] = useState<Load>(status ? 'ready' : 'loading');
  const [busy, setBusy] = useState(false);

  const readStatus = useCallback(async (): Promise<Load> => {
    try {
      const s = await rogo.sleepInsightsStatus();
      if (s === null) return 'unsupported';
      publishSleepInsightsStatus(s);
      return 'ready';
    } catch {
      return 'offline';
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoad('loading');
    setLoad(await readStatus());
  }, [readStatus]);

  // Signing in starts a fresh read, shown as loading.
  const [wasSignedIn, setWasSignedIn] = useState(false);
  if (cloud.signedIn !== wasSignedIn) {
    setWasSignedIn(cloud.signedIn);
    if (cloud.signedIn) setLoad('loading');
  }

  useEffect(() => {
    if (cloud.signedIn) void readStatus().then(setLoad);
  }, [cloud.signedIn, readStatus]);

  const change = useCallback(
    async (enabled: boolean, version: number) => {
      setBusy(true);
      try {
        publishSleepInsightsStatus(await rogo.setSleepInsightsConsent(enabled, version));
      } catch (e) {
        Alert.alert(t('joyorogo.sleep.errorTitle'), errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const onToggle = (next: boolean) => {
    if (!status) return;
    if (next) {
      Alert.alert(t('joyorogo.sleep.consent.title'), t('joyorogo.sleep.consent.body'), [
        { text: t('joyorogo.sleep.consent.cancel'), style: 'cancel' },
        { text: t('joyorogo.sleep.consent.confirm'), onPress: () => void change(true, status.currentVersion) },
      ]);
    } else {
      Alert.alert(t('joyorogo.sleep.disable.title'), t('joyorogo.sleep.disable.body'), [
        { text: t('joyorogo.sleep.disable.cancel'), style: 'cancel' },
        { text: t('joyorogo.sleep.disable.confirm'), style: 'destructive', onPress: () => void change(false, status.currentVersion) },
      ]);
    }
  };

  if (!cloud.signedIn) return null;

  return (
    <Section title={t('joyorogo.sleep.title')} icon="moon">
      {status ? (
        <>
          <SwitchRow label={t('joyorogo.sleep.label')} hint={t('joyorogo.sleep.hint')} value={status.enabled} onValueChange={onToggle} disabled={busy || load === 'loading'} />
          {status.enabled && status.nights > 0 ? (
            <AppText variant="caption" muted>
              {t('joyorogo.sleep.state.nights', { count: status.nights, n: formatCount(status.nights) })}
            </AppText>
          ) : null}
          <AppText variant="caption" muted>
            {t('joyorogo.sleep.viewIn')}
          </AppText>
        </>
      ) : (
        <>
          <Notice icon={load === 'unsupported' ? 'information-circle-outline' : 'cloud-offline-outline'}>
            {t(load === 'loading' ? 'joyorogo.sleep.state.loading' : load === 'unsupported' ? 'joyorogo.sleep.state.unsupported' : 'joyorogo.sleep.state.offline')}
          </Notice>
          {load !== 'loading' ? <Button label={t('joyorogo.sleep.state.retry')} variant="ghost" icon="refresh" onPress={() => void refresh()} /> : null}
        </>
      )}
    </Section>
  );
}
