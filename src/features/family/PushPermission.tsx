import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { NoticeDialog } from '@/components/NoticeDialog';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { enablePush, pushStatus, type PushOutcome } from '@/features/family/push';

interface PushPermissionProps {
  /** Why notifications, as the person reads it before the system prompt (`prePermissionBody`). */
  body: string;
  /** Added to the "cannot get notifications on this phone" notice: what else still works. */
  unavailableHint?: string;
}

/**
 * Turning notifications on. The button opens an explanation first; its one button ("Lanjut") always starts the system prompt and
 * registers this phone's push token with the Worker. Nothing on the explanation skips the prompt (Apple 5.1.1(iv)). A refusal that the
 * system can no longer ask again shows the way to the settings instead of the explanation.
 */
export function PushPermission({ body, unavailableHint }: PushPermissionProps) {
  const { t } = useTranslation(['family', 'common']);
  const [outcome, setOutcome] = useState<PushOutcome | 'idle' | 'checking'>('checking');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void pushStatus().then((status) => live && setOutcome(status));
    return () => {
      live = false;
    };
  }, []);

  const proceed = async () => {
    setAsking(false);
    setBusy(true);
    try {
      setOutcome(await enablePush());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('family:push.section')} icon="notifications" tint="steps">
      {outcome === 'enabled' ? (
        <AppText variant="caption" muted>
          {t('family:push.enabled', { late: t('family:push.late') })}
        </AppText>
      ) : null}
      {outcome === 'denied' ? (
        <Notice icon="notifications-off" action={{ label: t('family:push.openSettings'), onPress: () => void Linking.openSettings() }}>
          {t('family:push.denied')}
        </Notice>
      ) : null}
      {outcome === 'unavailable' ? (
        <Notice icon="notifications-off">
          {unavailableHint ? t('family:push.unavailableWithHint', { hint: unavailableHint }) : t('family:push.unavailable')}
        </Notice>
      ) : null}
      {outcome === 'idle' || outcome === 'denied' || outcome === 'checking' ? (
        <Button
          label={t('family:push.enable')}
          icon="notifications"
          variant="primary"
          disabled={outcome === 'checking' || outcome === 'denied'}
          loading={busy}
          onPress={() => setAsking(true)}
        />
      ) : null}
      <NoticeDialog
        visible={asking}
        title={t('family:push.askTitle')}
        message={body}
        confirmLabel={t('common:actions.next')}
        onConfirm={() => void proceed()}
      />
    </Section>
  );
}
