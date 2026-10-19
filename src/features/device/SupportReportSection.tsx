import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { ATUR_REPORTS_ENABLED } from '@/features/device/aturConfig';
import { AturReportForm } from '@/features/device/AturReportForm';
import { shareSupportReport } from '@/features/device/shareSupportReport';
import { issueUrl, reportText } from '@/features/device/supportIssue';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';

type Busy = 'github' | 'share' | null;

/**
 * JoyoFit is tested on one watch; owners of other models make it work on theirs by sending what their watch answered.
 * "Kirim laporan" files the report in Atur (whole log, phone, watch, disconnect history, a way to write back) once a board is configured.
 * "Report on GitHub" opens a prefilled issue in the browser (the user reviews and submits it with their own account);
 * the log is too long for the link, so it goes to the clipboard to paste into the issue's Log field.
 */
export function SupportReportSection() {
  const { t } = useTranslation('watch');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const reportOnGitHub = () =>
    run('github', async () => {
      const report = await HuaweiWear.getSupportReport();
      await Clipboard.setStringAsync(reportText(report));
      setCopied(true);
      await Linking.openURL(issueUrl(report));
    });

  return (
    <Section title={t('device.support.title')} icon="chatbubbles">
      <Details>
        {t('device.support.intro')}
      </Details>
      {copied ? (
        <Notice>
          {t('device.support.copied')}
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ATUR_REPORTS_ENABLED ? (
        formOpen ? (
          <AturReportForm onClose={() => setFormOpen(false)} />
        ) : (
          <Button label={t('device.support.atur.send')} variant="primary" icon="paper-plane" onPress={() => setFormOpen(true)} />
        )
      ) : null}
      <ButtonRow>
        <Button
          label={t('device.support.github')}
          variant={ATUR_REPORTS_ENABLED ? 'secondary' : 'primary'}
          icon="logo-github"
          loading={busy === 'github'}
          disabled={busy !== null}
          onPress={() => void reportOnGitHub()}
        />
        <Button
          label={t('device.support.share')}
          icon="share-social"
          loading={busy === 'share'}
          disabled={busy !== null}
          onPress={() => void run('share', shareSupportReport)}
        />
      </ButtonRow>
    </Section>
  );
}
