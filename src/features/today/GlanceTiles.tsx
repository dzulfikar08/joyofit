import { useRouter } from 'expo-router';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Polygon, Polyline, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { Metric } from '@/components/Metric';
import { FadeIn } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { Skeleton } from '@/components/States';
import { heartTrail, type TrailPoint } from '@/features/today/glance';
import { heartRateStats } from '@/features/today/stats';
import { formatClock, formatCount } from '@/format';
import { radius as fixedRadius, spacing, tintColors, useTheme, type Tint } from '@/theme';
import type { StepSample } from '@/wear';

const MAX_POINTS = 48;
/** Room above the line for the bubble that carries the latest value. */
const BUBBLE_ROOM = 28;
const CHART_PAD = 6;

interface GlanceTilesProps {
  /** Today's data is still being read. */
  loading: boolean;
  steps: number;
  goal: number;
  /** Today's stored samples, oldest first. */
  samples: readonly StepSample[];
}

interface TileProps {
  tint: Tint;
  icon: IconName;
  label: string;
  a11y: string;
  onPress: () => void;
  children: ReactNode;
}

/** A square tinted tile that opens its screen: chip and label on top, the content below. */
function Tile({ tint, icon, label, a11y, onPress, children }: TileProps) {
  const { theme, colors, radius } = useTheme();
  const scheme = tintColors(colors, tint);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      scaleTo={0.98}
      style={[
        styles.tile,
        { backgroundColor: scheme.soft, borderRadius: radius.tile },
        theme.outlined ? { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline } : null,
      ]}>
      <View style={styles.head}>
        <IconChip icon={icon} tint={tint} size="sm" background={colors.card} />
        <AppText variant="label" color={scheme.text} numberOfLines={1} style={styles.label}>
          {label}
        </AppText>
      </View>
      {children}
    </PressableScale>
  );
}

/**
 * Two square tiles side by side: today's steps (the number, the goal, a bar) and today's heart rate (a small line through the day's
 * readings with the latest in a bubble). The numbers are the ones the watch card and the cards below already use.
 */
export function GlanceTiles({ loading, steps, goal, samples }: GlanceTilesProps) {
  const router = useRouter();
  const { t } = useTranslation('today');
  const { colors } = useTheme();
  const [square, setSquare] = useState(150);
  const stats = useMemo(() => heartRateStats(samples), [samples]);
  const trail = useMemo(() => heartTrail(samples, MAX_POINTS), [samples]);

  if (loading) {
    return (
      <View style={styles.row}>
        <View style={styles.skeleton} onLayout={(e) => setSquare(e.nativeEvent.layout.width)}>
          <Skeleton width="100%" height={square} radius="tile" />
        </View>
        <View style={styles.skeleton}>
          <Skeleton width="100%" height={square} radius="tile" />
        </View>
      </View>
    );
  }

  const share = goal > 0 ? Math.min(1, steps / goal) : 0;
  const stepsText = tintColors(colors, 'steps').text;
  const heartText = tintColors(colors, 'heart').text;

  return (
    <FadeIn>
      <View style={styles.row}>
        <Tile
          tint="steps"
          icon="footsteps"
          label={t('home.stepsTitle')}
          a11y={t('glance.stepsA11y', { steps: formatCount(steps), goal: formatCount(goal) })}
          onPress={() => router.push('/steps')}>
          <View style={styles.stepsBody}>
            <Metric value={formatCount(steps)} size="lg" color={stepsText} unitColor={stepsText} />
            <AppText variant="caption" color={stepsText} numberOfLines={1}>
              {t('glance.goal', { goal: formatCount(goal) })}
            </AppText>
          </View>
          <View style={[styles.track, { backgroundColor: colors.card }]}>
            <View style={[styles.fill, { backgroundColor: colors.steps, width: `${Math.round(share * 100)}%` }]} />
          </View>
        </Tile>
        <Tile
          tint="heart"
          icon="heart"
          label={t('home.heartTitle')}
          a11y={
            stats
              ? t('glance.heartA11y', { bpm: stats.latest.bpm, time: formatClock(stats.latest.timestamp), min: stats.min, max: stats.max })
              : `${t('home.heartTitle')}: ${t('glance.heartNone')}`
          }
          onPress={() => router.push('/heart')}>
          {stats ? (
            <>
              <HeartMini points={trail} latest={stats.latest.bpm} color={colors.heart} text={heartText} />
              <AppText variant="caption" color={heartText} numberOfLines={1}>
                {t('home.latest', { time: formatClock(stats.latest.timestamp) })}
              </AppText>
            </>
          ) : (
            <View style={styles.heartEmpty}>
              <AppText variant="caption" color={heartText}>
                {t('glance.heartNone')}
              </AppText>
            </View>
          )}
        </Tile>
      </View>
    </FadeIn>
  );
}

/** The day's readings as a line with a soft fill under it; the latest reading sits in a bubble above the line's end. */
function HeartMini({ points, latest, color, text }: { points: readonly TrailPoint[]; latest: number; color: string; text: string }) {
  const { colors } = useTheme();
  const id = useId();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { width, height } = size;

  let line: { x: number; y: number }[] = [];
  if (width > 0 && height > BUBBLE_ROOM + 2 * CHART_PAD && points.length > 0) {
    const first = points[0].timestamp;
    const span = points[points.length - 1].timestamp - first;
    const lo = Math.min(...points.map((p) => p.bpm));
    const range = Math.max(...points.map((p) => p.bpm)) - lo;
    const top = BUBBLE_ROOM;
    const bottom = height - CHART_PAD;
    line = points.map((p) => ({
      // A single reading, or all at one instant, sits at the right end where the bubble is.
      x: span === 0 ? width - CHART_PAD : CHART_PAD + ((p.timestamp - first) / span) * (width - 2 * CHART_PAD),
      // A flat day sits in the middle of the room instead of on the floor.
      y: range === 0 ? (top + bottom) / 2 : top + (1 - (p.bpm - lo) / range) * (bottom - top),
    }));
  }
  const end = line[line.length - 1];

  return (
    <View style={styles.chart} onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {end ? (
        <>
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={0.35} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {line.length > 1 ? (
              <>
                <Polygon points={`${line[0].x},${height} ${line.map((p) => `${p.x},${p.y}`).join(' ')} ${end.x},${height}`} fill={`url(#${id})`} />
                <Polyline
                  points={line.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </>
            ) : null}
            <Circle cx={end.x} cy={end.y} r={4} fill={color} stroke={colors.card} strokeWidth={2} />
          </Svg>
          <View style={[styles.bubble, { backgroundColor: colors.card, borderColor: color }]}>
            <AppText variant="label" color={text} numberOfLines={1}>
              {latest}
            </AppText>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  skeleton: { flex: 1 },
  tile: { flex: 1, aspectRatio: 1, padding: spacing.md, gap: spacing.sm, justifyContent: 'space-between' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { flex: 1 },
  stepsBody: { gap: 0 },
  track: { height: 8, borderRadius: fixedRadius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: fixedRadius.pill },
  chart: { flex: 1, minHeight: 0 },
  bubble: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 32,
    height: 22,
    paddingHorizontal: spacing.sm,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartEmpty: { flex: 1, justifyContent: 'flex-end' },
});
