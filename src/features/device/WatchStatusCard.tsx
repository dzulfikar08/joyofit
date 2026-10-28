import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { HeroGradient } from '@/components/HeroGradient';
import { Metric } from '@/components/Metric';
import { StatusDot } from '@/components/StatusDot';
import { Notice } from '@/components/States';
import { isLinkLive, isLinkUp, linkLabel } from '@/features/device/linkState';
import { activeWatchName } from '@/features/device/watchName';
import { shownName } from '@/features/device/shownName';
import { useBackgroundStatus } from '@/features/settings/useBackgroundStatus';
import { formatSyncTime } from '@/format';
import { fmtPercent } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { radius, spacing, useTheme } from '@/theme';

/** Battery at or under this percent turns the bar to the warning color. */
const LOW_BATTERY = 20;

/**
 * The dark "watch screen" panel at the top of the Watch tab: link state, which watch, battery and
 * last sync. The dot pulses only while the link is up or being set up.
 */
export function WatchStatusCard() {
  const { t } = useTranslation(['watch', 'common']);
  const { colors, radius: themeRadius } = useTheme();
  const { linkState, device, watches, battery, lastSync, error, retryAddress, connect } = useWatch();
  const { status: background } = useBackgroundStatus();

  const label = linkLabel(linkState);
  const dotColor = isLinkUp(linkState) ? colors.heroLink : linkState === 'disconnected' ? colors.heroMuted : colors.heroWarn;
  const batteryColor = battery !== null && battery <= LOW_BATTERY ? colors.heroWarn : colors.heroLink;

  return (
    <View style={[styles.card, { backgroundColor: colors.hero, borderRadius: themeRadius.card }]}>
      <HeroGradient />
      <View style={styles.linkRow} accessible accessibilityLabel={t('watch:device.status.linkA11y', { label })}>
        <StatusDot color={dotColor} live={isLinkLive(linkState)} />
        <AppText variant="heading" color={colors.heroForeground} style={styles.linkLabel}>
          {label}
        </AppText>
        {battery !== null ? (
          <View style={styles.batteryRow} accessible accessibilityLabel={t('watch:device.status.batteryA11y', { value: fmtPercent(battery) })}>
            <AppText variant="label" color={colors.heroMuted}>
              {t('watch:device.status.battery')}
            </AppText>
            <Metric value={String(battery)} unit="%" size="md" color={colors.heroForeground} unitColor={colors.heroMuted} />
          </View>
        ) : null}
      </View>

      <View style={styles.identity}>
        <AppText variant="heading" color={colors.heroForeground} numberOfLines={1}>
          {device ? shownName(activeWatchName(device, watches)) : t('watch:device.status.noWatch')}
        </AppText>
        <AppText variant="caption" color={colors.heroMuted} numberOfLines={1}>
          {device ? (shownName(device.productModel) ?? t('watch:device.status.modelUnknown')) : t('watch:device.status.connectBelow')}
        </AppText>
      </View>

      {battery !== null ? (
        <View style={styles.battery} importantForAccessibility="no-hide-descendants">
          <View style={[styles.track, { backgroundColor: colors.heroTrack }]}>
            <View style={[styles.fill, { backgroundColor: batteryColor, width: `${Math.min(100, Math.max(0, battery))}%` }]} />
          </View>
        </View>
      ) : null}

      {error ? (
        <Notice
          tone="danger"
          action={retryAddress && linkState === 'disconnected' ? { label: t('common:actions.retry'), onPress: () => void connect(retryAddress) } : undefined}>
          {error}
        </Notice>
      ) : null}

      {lastSync !== null || background.address ? (
        <View style={[styles.footer, { borderTopColor: colors.heroDivider }]}>
          {lastSync !== null ? (
            <AppText variant="caption" color={colors.heroMuted}>
              {t('watch:device.status.lastSync', { time: formatSyncTime(lastSync) })}
            </AppText>
          ) : null}
          {background.address ? (
            <AppText variant="caption" color={colors.heroMuted} numberOfLines={1}>
              {t('watch:device.status.background', { name: shownName(background.name) ?? background.address })}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md + 4, gap: spacing.sm + 2, overflow: 'hidden' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  linkLabel: { flex: 1 },
  batteryRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  identity: { gap: 2 },
  battery: { gap: spacing.xs },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
