import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { fmtDate } from '@/i18n';
import { spacing } from '@/theme';
import { useAiSettings } from '../hooks';
import { grantHostedConsent, hasHostedConsent, withdrawHostedConsent } from '../hostedConsent';
import { aiSettings } from '../stores';
import { HostedConsentCard, HostedConsentDetails } from './HostedConsentCard';

/** Settings, Joyo AI, Data sent to JoyoRogo's AI: what the hosted engine receives and who gets it, with Agree or Withdraw. */
export function HostedConsentScreen() {
  const { t } = useTranslation('ai');
  const router = useRouter();
  const settings = useAiSettings();
  const { toast, show } = useToast();
  const [confirming, setConfirming] = useState(false);
  const granted = hasHostedConsent(settings);
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/settings/ai'));

  return (
    <View style={styles.root}>
      <Screen>
        <Card>
          {granted ? (
            <>
              <AppText variant="heading" accessibilityRole="header">
                {t('hosted.title')}
              </AppText>
              <AppText variant="caption" muted>
                {t('hosted.agreedAt', { date: fmtDate(settings.hostedConsent?.at ?? 0, 'medium') })}
              </AppText>
              <HostedConsentDetails />
              <Button label={t('hosted.withdraw')} variant="destructive" onPress={() => setConfirming(true)} />
            </>
          ) : (
            <HostedConsentCard
              onAgree={() => {
                grantHostedConsent(aiSettings, Math.floor(Date.now() / 1000));
                show(t('hosted.agreed'));
              }}
              onLater={leave}
            />
          )}
        </Card>
      </Screen>
      {toast}
      <ConfirmDialog
        visible={confirming}
        destructive
        title={t('hosted.withdrawTitle')}
        message={t('hosted.withdrawBody')}
        confirmLabel={t('hosted.withdrawConfirm')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          withdrawHostedConsent(aiSettings);
          setConfirming(false);
          show(t('hosted.withdrawn'));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
