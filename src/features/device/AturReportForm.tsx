import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { authClient } from '@/cloud/auth';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Field } from '@/components/Input';
import { Notice } from '@/components/States';
import { MESSAGE_MAX } from '@/features/device/aturReport';
import { ReportRefusedError, sendSupportReport } from '@/features/device/aturReports';
import { errorMessage } from '@/format';
import { spacing } from '@/theme';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Outcome = { kind: 'sent'; sequenceId: number } | { kind: 'queued' } | { kind: 'error'; message: string };

/**
 * "Kirim laporan": what went wrong in the person's words, an email to answer to (the account's, until changed or cleared),
 * and the support report as a file. It goes to the JoyoFit board in Atur, so the maintainers get the whole log, the phone,
 * the watch and the disconnect history in one issue, and can write back. Offline, the report waits in the queue.
 */
export function AturReportForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['watch', 'common']);
  const user = authClient.useSession().data?.user;
  const [message, setMessage] = useState('');
  // Filled from the account once; after that the person's edit, including an empty field, wins.
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const email = typedEmail ?? user?.email ?? '';
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const trimmedEmail = email.trim();
  const emailInvalid = trimmedEmail !== '' && !EMAIL.test(trimmedEmail);

  const send = async () => {
    setSending(true);
    setOutcome(null);
    try {
      const result = await sendSupportReport(message, {
        email: trimmedEmail || null,
        accountId: user?.id ?? null,
        name: user?.name?.trim() || null,
      });
      setOutcome(result.state === 'sent' ? { kind: 'sent', sequenceId: result.sequenceId } : { kind: 'queued' });
      setMessage('');
    } catch (e) {
      const reason = e instanceof ReportRefusedError ? e.message : errorMessage(e);
      setOutcome({ kind: 'error', message: t('watch:device.support.atur.failed', { reason }) });
    } finally {
      setSending(false);
    }
  };

  const done = outcome?.kind === 'sent' || outcome?.kind === 'queued';
  return (
    <View style={styles.form}>
      {outcome?.kind === 'sent' ? <Notice>{t('watch:device.support.atur.sent', { number: outcome.sequenceId })}</Notice> : null}
      {outcome?.kind === 'queued' ? <Notice icon="cloud-offline-outline">{t('watch:device.support.atur.queued')}</Notice> : null}
      {outcome?.kind === 'error' ? <Notice tone="danger">{outcome.message}</Notice> : null}
      {done ? null : (
        <>
          <Field
            label={t('watch:device.support.atur.messageLabel')}
            hint={t('watch:device.support.atur.messageHint')}
            placeholder={t('watch:device.support.atur.messagePlaceholder')}
            value={message}
            onChangeText={setMessage}
            maxLength={MESSAGE_MAX}
            multiline
            textAlignVertical="top"
            style={styles.message}
          />
          <Field
            label={t('watch:device.support.atur.emailLabel')}
            hint={emailInvalid ? t('watch:device.support.atur.emailInvalid') : t('watch:device.support.atur.emailHint')}
            value={email}
            onChangeText={setTypedEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
          />
        </>
      )}
      <ButtonRow>
        <Button label={done ? t('common:actions.done') : t('common:actions.cancel')} onPress={onClose} disabled={sending} />
        {done ? null : (
          <Button
            label={t('watch:device.support.atur.submit')}
            variant="primary"
            icon="paper-plane"
            loading={sending}
            disabled={sending || emailInvalid}
            onPress={() => void send()}
          />
        )}
      </ButtonRow>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.sm },
  message: { minHeight: 96, paddingTop: spacing.sm },
});
