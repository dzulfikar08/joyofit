import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { HeroGradient } from '@/components/HeroGradient';
import { Metric } from '@/components/Metric';
import { PressableScale } from '@/components/PressableScale';
import { Ring } from '@/components/Ring';
import { ringInnerWidth } from '@/components/ringMath';
import { StatusDot } from '@/components/StatusDot';
import { isLinkLive, isLinkUp, linkLabel } from '@/features/device/linkState';
import type { HeartReading } from '@/features/today/stats';
import { formatAgo, formatCount, formatSyncTime } from '@/format';
import { spacing, useTheme } from '@/theme';
import type { LinkState } from '@/wear';

const LOW_BATTERY = 20;
const RING_SIZE = 120;
const RING_STROKE = 11;
/** What the steps in the ring's centre may take: 100,000 in a dot-matrix face is wider than the ring. */
const RING_TEXT_WIDTH = ringInnerWidth(RING_SIZE, RING_STROKE);

interface WatchHeroProps {
  linkState: LinkState;
  /** Watch model or name; null while nothing is connected. */
  deviceName: string | null;
  steps: number;
  goal: number;
  /** Live reading, else the newest stored one; null shows `--` and the hint to turn continuous heart rate on. */
  heart: HeartReading | null;
  /** Current unix seconds, ticking, for the "5 min ago" caption. */
  nowSec: number;
  /** Opens the setting that makes the watch record heart rate. */
  onEnableHeartRate: () => void;
  battery: number | null;
  lastSync: number | null;
  /** The one action: sync when the watch is connected, otherwise go and connect it. */
  action: ReactNode;
}

function batteryIcon(level: number) {
  if (level <= LOW_BATTERY) return 'battery-dead';
  return level <= 60 ? 'battery-half' : 'battery-full';
}

/**
 * The watch "screen": today's steps as a ring against the goal, latest heart rate and battery, and
 * the live link state. Dark in both themes on purpose, so the live numbers read like a watch face.
 */
export function WatchHero({ linkState, deviceName, steps, goal, heart, nowSec, battery, lastSync, onEnableHeartRate, action }: WatchHeroProps) {
  const { colors, radius } = useTheme();
  const { t } = useTranslation('today');
  const up = isLinkUp(linkState);
  const dot = up ? colors.heroLink : linkState === 'disconnected' ? colors.heroMuted : colors.heroWarn;
  const lowBattery = battery !== null && battery <= LOW_BATTERY;
  const batteryColor = lowBattery ? colors.heroWarn : colors.heroLink;

  return (
    <View style={[styles.hero, { backgroundColor: colors.hero, borderRadius: radius.card }]}>
      <HeroGradient />
      <View
        style={styles.top}
        accessible
        accessibilityLabel={t('hero.linkA11y', { state: linkLabel(linkState) })}>
        <StatusDot color={dot} live={isLinkLive(linkState)} pulse={!up} />
        <AppText variant="bodyStrong" color={colors.heroForeground} style={styles.link}>
          {linkLabel(linkState)}
        </AppText>
        {deviceName ? (
          <AppText variant="caption" color={colors.heroMuted} numberOfLines={1} style={styles.device}>
            {deviceName}
          </AppText>
        ) : null}
      </View>

      <View style={styles.body}>
        <Ring
          size={RING_SIZE}
          stroke={RING_STROKE}
          value={steps}
          max={goal}
          color={colors.heroSteps}
          track={colors.heroTrack}
          accessibilityLabel={t('hero.stepsA11y', { steps: formatCount(steps), goal: formatCount(goal) })}>
          <Metric value={formatCount(steps)} size="md" color={colors.heroForeground} fit={RING_TEXT_WIDTH} />
          <AppText variant="caption" color={colors.heroMuted} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.of}>
            {t('hero.of', { goal: formatCount(goal) })}
          </AppText>
        </Ring>

        <View style={styles.stats}>
          <View
            style={styles.stat}
            accessible={heart !== null}
            accessibilityLabel={
              heart
                ? t('hero.heartA11y', { bpm: heart.bpm, when: heart.live ? t('hero.live') : formatAgo(heart.timestamp, nowSec) })
                : undefined
            }>
            <View style={styles.statLabel}>
              <Ionicons name="heart" size={15} color={colors.heroHeart} />
              <AppText variant="label" color={colors.heroMuted}>
                {t('hero.heartRate')}
              </AppText>
            </View>
            <Metric value={heart ? String(heart.bpm) : '--'} unit="bpm" size="md" color={colors.heroForeground} unitColor={colors.heroMuted} />
            {heart ? (
              <AppText variant="caption" color={heart.live ? colors.heroLink : colors.heroMuted}>
                {heart.live ? t('hero.live') : formatAgo(heart.timestamp, nowSec)}
              </AppText>
            ) : (
              <PressableScale
                accessibilityRole="link"
                accessibilityLabel={t('hero.turnOnA11y')}
                hitSlop={8}
                onPress={onEnableHeartRate}>
                <AppText variant="caption" color={colors.heroLink}>
                  {t('hero.turnOn')}
                </AppText>
              </PressableScale>
            )}
          </View>
          <View
            style={styles.stat}
            accessible
            accessibilityLabel={battery === null ? t('hero.batteryUnknown') : t('hero.batteryA11y', { level: battery })}>
            <View style={styles.statLabel}>
              <Ionicons name={battery === null ? 'battery-half' : batteryIcon(battery)} size={15} color={batteryColor} />
              <AppText variant="label" color={colors.heroMuted}>
                {t('hero.battery')}
              </AppText>
            </View>
            <Metric value={battery === null ? '--' : String(battery)} unit="%" size="md" color={colors.heroForeground} unitColor={colors.heroMuted} />
          </View>
        </View>
      </View>

      <View style={[styles.footer, { borderTopColor: colors.heroDivider }]}>
        <View style={styles.sync}>
          <AppText variant="label" color={colors.heroMuted}>
            {t('hero.lastSync')}
          </AppText>
          <AppText variant="bodyStrong" color={colors.heroForeground}>
            {lastSync !== null ? formatSyncTime(lastSync) : t('hero.notSynced')}
          </AppText>
        </View>
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { padding: spacing.md + 4, gap: spacing.md, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginLeft: -8, minHeight: 28 },
  link: { flexShrink: 0 },
  device: { flex: 1, textAlign: 'right' },
  body: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stats: { flex: 1, gap: spacing.md },
  stat: { gap: 2 },
  statLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
  },
  sync: { flex: 1 },
  of: { maxWidth: RING_TEXT_WIDTH, textAlign: 'center' },
});
