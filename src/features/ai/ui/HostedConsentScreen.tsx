import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { OPEN_IN_STACK } from '@/components/navigation';
import { NavRow } from '@/components/NavRow';
import { Card, Screen, Section } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { fmtDate } from '@/i18n';
import { aiRecipients } from '../aiPrivacy';
import { useAiSettings } from '../hooks';
import { grantHostedConsent, hasHostedConsent, withdrawHostedConsent } from '../hostedConsent';
import { aiRemoveProvider, aiSettings } from '../stores';
import type { ProviderId } from '../types';
import { HostedConsentCard, HostedConsentDetails } from './HostedConsentCard';

type Confirm = { kind: 'hosted' } | { kind: 'own'; provider: ProviderId } | null;

/**
 * Settings, "AI and your data" (`/settings/ai-consent`): every AI recipient this phone may send personal data to and the person's answer
 * for each (`aiRecipients`), with a way to withdraw: the hosted Joyo AI (full text, Allow or Withdraw), each own-key provider with a yes
 * (withdraw deletes the key and the consent), and the ChatGPT or Claude connector (its own screen). Apple 5.1.1(i), 5.1.2(i).
 */
export function HostedConsentScreen() {
  const { t } = useTranslation('ai');
  const router = useRouter();
  const settings = useAiSettings();
  const { toast, show } = useToast();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const granted = hasHostedConsent(settings);
  const recipients = aiRecipients(settings);
  const own = recipients.filter((r) => r.kind === 'own');
  const connector = recipients.find((r) => r.kind === 'connector');
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/settings/ai'));
  const status = (at: number | null) => (at !== null ? t('privacy.allowed', { date: fmtDate(at, 'medium') }) : t('privacy.notAllowed'));

  const onConfirm = async () => {
    const current = confirm;
    setConfirm(null);
    if (!current) return;
    if (current.kind === 'hosted') {
      withdrawHostedConsent(aiSettings);
      show(t('hosted.withdrawn'));
      return;
    }
    try {
      await aiRemoveProvider(current.provider);
      show(t('prefs.data.keyDeleted'));
    } catch {
      show(t('prefs.data.deleteFailed'));
    }
  };
  const confirmName = confirm?.kind === 'own' ? t(`provider.${confirm.provider}`) : '';

  return (
    <View style={styles.root}>
      <Screen>
        <AppText variant="caption" muted>
          {t('privacy.intro')}
        </AppText>

        <Section title={t('privacy.hostedTitle')} icon="cloud" tint="link">
          <AppText variant="caption" muted>
            {`${t('privacy.hostedTo')}. ${status(granted ? (settings.hostedConsent?.at ?? null) : null)}`}
          </AppText>
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
                <Button label={t('hosted.withdraw')} variant="destructive" onPress={() => setConfirm({ kind: 'hosted' })} />
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
        </Section>

        <Section title={t('privacy.ownTitle')} icon="key" tint="link">
          {own.length === 0 ? (
            <NavRow icon="key-outline" title={t('privacy.ownNone')} onPress={() => router.push('/settings/ai-setup', OPEN_IN_STACK)} />
          ) : (
            own.map((r) =>
              r.kind === 'own' ? (
                <NavRow
                  key={r.provider}
                  icon="key-outline"
                  destructive
                  title={t('privacy.withdrawOwn')}
                  subtitle={`${t('privacy.ownTo', { provider: t(`provider.${r.provider}`), host: r.host })}. ${status(r.at)}`}
                  onPress={() => setConfirm({ kind: 'own', provider: r.provider })}
                />
              ) : null,
            )
          )}
        </Section>

        <Section title={t('privacy.connectorTitle')} icon="link" tint="link">
          <NavRow
            icon="link-outline"
            title={t('privacy.manage')}
            subtitle={`${t('privacy.connectorTo')}. ${status(connector?.kind === 'connector' ? connector.at : null)}`}
            onPress={() => router.push('/settings/koneksi', OPEN_IN_STACK)}
          />
        </Section>
      </Screen>
      {toast}
      <ConfirmDialog
        visible={confirm !== null}
        destructive
        title={confirm?.kind === 'own' ? t('prefs.data.deleteKeyTitle', { provider: confirmName }) : t('hosted.withdrawTitle')}
        message={confirm?.kind === 'own' ? t('prefs.data.deleteKeyMessage', { provider: confirmName }) : t('hosted.withdrawBody')}
        confirmLabel={confirm?.kind === 'own' ? t('prefs.data.deleteKeyConfirm') : t('hosted.withdrawConfirm')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void onConfirm()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
