import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { prepareDatabase, startNativeErrorWatch, useDbHealth } from '@/db/recovery';
import { spacing, useTheme } from '@/theme';

import { RepairDetails } from './RepairDetails';

type Phase = 'preparing' | 'repairing' | 'ready' | 'failed';

/**
 * Shows its children once `joyofit.db` is ready: schema built and, when the file turned out to be damaged, repaired
 * (`prepareDatabase`). Draws nothing while the usual quick check runs, a progress screen while a repair runs, and a way to try
 * again when the repair could not finish. An error that is not about a damaged file is thrown from here, to the error screen,
 * as it was when the schema was built by the database provider.
 */
export function DatabaseGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('preparing');
  const [failure, setFailure] = useState<unknown>(null);

  const run = useCallback(() => {
    prepareDatabase(() => setPhase('repairing')).then(
      (ok) => setPhase(ok ? 'ready' : 'failed'),
      (e: unknown) => setFailure(e),
    );
  }, []);

  // The first run starts from the initial 'preparing' phase; only a retry has to set it again.
  const retry = useCallback(() => {
    setPhase('preparing');
    run();
  }, [run]);

  useEffect(() => {
    run();
  }, [run]);

  // From the first render on: a native writer already running in the background may hit the damage before the gate is open.
  useEffect(() => startNativeErrorWatch(), []);

  if (failure !== null) throw failure;
  if (phase === 'ready') return <>{children}</>;
  if (phase === 'preparing') return null;
  return <RepairScreen failed={phase === 'failed'} onRetry={retry} onContinue={() => setPhase('ready')} />;
}

function RepairScreen({ failed, onRetry, onContinue }: { failed: boolean; onRetry: () => void; onContinue: () => void }) {
  const { t } = useTranslation('common');
  const { colors } = useTheme();
  const { notice } = useDbHealth();
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {failed ? null : <ActivityIndicator color={colors.primary} />}
      <AppText variant="heading" style={styles.centered} accessibilityRole="header">
        {failed ? t('dbRecovery.failedTitle') : t('dbRecovery.repairingTitle')}
      </AppText>
      <AppText variant="caption" muted style={styles.centered} accessibilityLiveRegion="polite">
        {failed ? t('dbRecovery.failedBody') : t('dbRecovery.repairingBody')}
      </AppText>
      {failed ? <RepairDetails reason={notice?.kind === 'failed' ? notice.reason : null} /> : null}
      {failed ? <Button label={t('dbRecovery.retry')} variant="primary" onPress={onRetry} /> : null}
      {failed ? <Button label={t('dbRecovery.continue')} variant="ghost" onPress={onContinue} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  centered: { textAlign: 'center' },
});
