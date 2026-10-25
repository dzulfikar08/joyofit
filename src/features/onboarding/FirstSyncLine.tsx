import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { PopIn } from '@/components/motion';
import type { FirstSync } from '@/features/onboarding/useFirstSync';
import { fmtInt } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';

/**
 * One line under the guide's progress bar about the first history pull, which runs in the background: reading, what came in, or that
 * it stopped (with a retry while the watch is still connected). Nothing before the pull starts.
 */
export function FirstSyncLine({ sync }: { sync: FirstSync }) {
  const { t } = useTranslation(['onboarding', 'common']);
  const colors = useColors();
  const { linkState } = useWatch();
  if (sync.status === 'hidden') return null;

  const { summary } = sync;
  const text =
    sync.status === 'running'
      ? t('firstSync.running')
      : sync.status === 'failed'
        ? t('firstSync.failed', { error: sync.error ?? '' })
        : summary
          ? t('firstSync.doneCounts', { workouts: fmtInt(summary.workouts), sleep: fmtInt(summary.sleep), samples: fmtInt(summary.samples) })
          : t('firstSync.done');

  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      {sync.status === 'running' ? (
        <ActivityIndicator size="small" color={colors.link} />
      ) : (
        <PopIn>
          <Ionicons
            name={sync.status === 'failed' ? 'alert-circle' : 'checkmark-circle'}
            size={18}
            color={sync.status === 'failed' ? colors.destructive : colors.link}
          />
        </PopIn>
      )}
      <AppText variant="caption" muted style={styles.text} numberOfLines={3}>
        {text}
      </AppText>
      {sync.status === 'failed' && linkState === 'connected' ? (
        <Button label={t('common:actions.retry')} variant="ghost" onPress={sync.retry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  text: { flex: 1 },
});
