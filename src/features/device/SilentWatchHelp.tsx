import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { isIos } from '@/components/IosUnavailable';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { ATUR_REPORTS_ENABLED } from '@/features/device/aturConfig';
import { AturReportForm } from '@/features/device/AturReportForm';
import { silentWatchSteps } from '@/features/device/connectFailure';
import { shareSupportReport } from '@/features/device/shareSupportReport';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

/**
 * After a connect that reached the watch over Bluetooth and got no answer (LinkParams timed out): what to check, in the order that
 * usually matters, Retry, and "Kirim laporan": the form that files the support report (and so the Bluetooth log of the attempt) in Atur, or
 * the share sheet while no Atur board is configured.
 */
export function SilentWatchHelp() {
  const { t } = useTranslation(['watch', 'common']);
  const { silentWatch, error, linkState, retryAddress, connect } = useWatch();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  if (!silentWatch || !error || linkState !== 'disconnected') return null;

  const sendReport = async () => {
    setSending(true);
    setSendError(null);
    try {
      await shareSupportReport();
    } catch (e) {
      setSendError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Section title={t('watch:device.silent.title')} icon="help-buoy">
      <AppText variant="caption" muted>
        {t('watch:device.silent.intro')}
      </AppText>
      {silentWatchSteps(isIos ? 'ios' : 'android').map((step, index) => (
        <View key={step} style={styles.step}>
          <AppText variant="caption" muted style={styles.number}>
            {index + 1}.
          </AppText>
          <AppText variant="caption" style={styles.stepText}>
            {step}
          </AppText>
        </View>
      ))}
      <AppText variant="caption" muted>
        {t('watch:device.silent.reportHelp')}
      </AppText>
      {sendError ? <Notice tone="danger">{sendError}</Notice> : null}
      {formOpen ? <AturReportForm onClose={() => setFormOpen(false)} /> : null}
      <ButtonRow>
        <Button
          label={t('common:actions.retry')}
          variant="primary"
          icon="refresh"
          disabled={!retryAddress || sending}
          onPress={() => retryAddress && void connect(retryAddress)}
        />
        <Button
          label={t('watch:device.silent.report')}
          icon={ATUR_REPORTS_ENABLED ? 'paper-plane' : 'share-social'}
          loading={sending}
          disabled={sending || formOpen}
          onPress={() => (ATUR_REPORTS_ENABLED ? setFormOpen(true) : void sendReport())}
        />
      </ButtonRow>
    </Section>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: spacing.sm },
  number: { minWidth: 18 },
  stepText: { flex: 1 },
});
