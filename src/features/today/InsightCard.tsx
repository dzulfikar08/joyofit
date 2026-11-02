import { useRouter } from 'expo-router';
import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip, type IconName } from '@/components/IconChip';
import { FadeIn } from '@/components/motion';
import { Skeleton } from '@/components/States';
import { bodyText, headlineText } from '@/features/coach/format';
import { useCoach } from '@/features/coach/useCoach';
import { useCoachAccess } from '@/features/coach/useCoachAccess';
import { pickInsights, type Insight } from '@/features/today/insights';
import type { NightHrvAvailability } from '@/features/today/nightHrv';
import { headlineHint, headlineLabel, type Readiness } from '@/features/today/readiness';
import { formatCount } from '@/format';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { spacing, useTheme, type Tint } from '@/theme';

/** How strongly the tint glows in two corners of the panel. Text on it is the theme's `foreground`, checked at 5.8:1 or better on every palette. */
const GLOW = 0.2;
const DOT = 8;
const DOT_ACTIVE = 20;

interface CoachLine {
  headline: string;
  body: string | null;
}

interface InsightCardProps {
  /** Today's data is still being read. */
  loading: boolean;
  /** Today's steps as the watch card shows them; null until the data is read. */
  steps: number | null;
  goal: number;
  readiness: Readiness | null;
  dataVersion: number;
  availability: NightHrvAvailability | null;
}

/**
 * The first card of Today: one short, honest sentence from what the app already knows (step goal, readiness, last night's sleep,
 * and for Pro the Coach suggestion), with one button to the screen behind it. More than one sentence pages sideways with dots.
 * It says nothing when there is nothing true to say yet (no steps to speak of, no readiness, no night), so it never fills a gap with a guess.
 *
 * Pro accounts also hear Coach; the Coach hook only runs for them (`WithCoach`), like the Coach card.
 */
export function InsightCard(props: InsightCardProps) {
  const access = useCoachAccess();
  return access === 'pro' ? <WithCoach {...props} /> : <InsightPager {...props} coach={null} />;
}

function WithCoach(props: InsightCardProps) {
  const coach = useCoach(props.dataVersion, props.availability);
  const line = coach ? { headline: headlineText(coach.suggestion), body: bodyText(coach.suggestion) } : null;
  return <InsightPager {...props} coach={line} />;
}

interface InsightView {
  icon: IconName;
  tint: Tint;
  eyebrow: string;
  text: string;
  action: string;
  route: '/steps' | '/readiness' | '/sleep' | '/coach';
}

function InsightPager({ loading, steps, goal, readiness, coach }: InsightCardProps & { coach: CoachLine | null }) {
  const { t } = useTranslation('today');
  const router = useRouter();
  const reduced = useReducedMotion();
  const { theme, colors, radius } = useTheme();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);

  const sleep = readiness?.signals.find((s) => s.key === 'sleep') ?? null;
  const insights = useMemo(
    () =>
      pickInsights({
        steps,
        goal,
        headline: readiness?.headline ?? null,
        recoveryPercent: readiness?.recovery?.percent ?? null,
        sleepTone: sleep?.tone ?? null,
        coach: coach !== null,
      }),
    [steps, goal, readiness, sleep?.tone, coach],
  );

  const view = (insight: Insight): InsightView => {
    switch (insight.kind) {
      case 'stepsReached':
        return {
          icon: 'footsteps',
          tint: 'steps',
          eyebrow: t('insight.eyebrow.steps'),
          text: t('insight.text.stepsReached', { steps: formatCount(insight.steps) }),
          action: t('insight.action.steps'),
          route: '/steps',
        };
      case 'stepsClose':
        return {
          icon: 'footsteps',
          tint: 'steps',
          eyebrow: t('insight.eyebrow.steps'),
          text: t('insight.text.stepsClose', { count: insight.left, left: formatCount(insight.left) }),
          action: t('insight.action.steps'),
          route: '/steps',
        };
      case 'readiness': {
        const headline = headlineLabel(insight.headline);
        return {
          icon: 'pulse',
          tint: 'link',
          eyebrow:
            insight.recoveryPercent !== null
              ? t('insight.eyebrow.readinessRecovery', { headline, percent: insight.recoveryPercent })
              : t('insight.eyebrow.readiness', { headline }),
          text: headlineHint(insight.headline),
          action: t('insight.action.readiness'),
          route: '/readiness',
        };
      }
      case 'sleep':
        return {
          icon: 'moon',
          tint: 'sleep',
          eyebrow: t('insight.eyebrow.sleep'),
          text: t(insight.tone === 'good' ? 'insight.text.sleepGood' : insight.tone === 'neutral' ? 'insight.text.sleepClose' : 'insight.text.sleepShort', {
            detail: sleep?.detail ?? '',
          }),
          action: t('insight.action.sleep'),
          route: '/sleep',
        };
      case 'coach':
        return {
          icon: 'barbell',
          tint: 'workouts',
          eyebrow: t('insight.eyebrow.coach'),
          text: coach?.body ? t('insight.text.coach', { headline: coach.headline, body: coach.body }) : t('insight.text.coachShort', { headline: coach?.headline ?? '' }),
          action: t('insight.action.coach'),
          route: '/coach',
        };
    }
  };

  // A page that no longer exists (the list shrank after a sync) falls back to the last one.
  const total = insights.length;
  const current = Math.min(page, Math.max(0, total - 1));

  if (total === 0) return loading ? <Skeleton width="100%" height={150} radius="card" /> : null;

  const pages = insights.map(view);
  const paged = total > 1;
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width === 0) return;
    const next = Math.min(total - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width)));
    setPage((prev) => (prev === next ? prev : next));
  };

  const renderPage = (item: InsightView, kind: string, pageWidth?: number) => (
    <View key={kind} style={[styles.page, !paged && styles.pageAlone, pageWidth ? { width: pageWidth } : null]}>
      <View style={styles.eyebrowRow}>
        <IconChip icon={item.icon} tint={item.tint} size="sm" background={colors.card} />
        <AppText variant="label" color={colors.foreground} numberOfLines={2} style={styles.eyebrow}>
          {item.eyebrow}
        </AppText>
      </View>
      <AppText variant="heading" color={colors.foreground}>
        {item.text}
      </AppText>
      <Button label={item.action} variant="secondary" icon="chevron-forward" onPress={() => router.push(item.route)} style={styles.action} />
    </View>
  );

  return (
    <FadeIn>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={[
          styles.panel,
          { backgroundColor: colors.card, borderRadius: radius.card, borderColor: colors.hairline },
        ]}>
        {theme.outlined ? null : <Backdrop />}
        {paged && width > 0 ? (
          <ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onScroll}
            accessibilityLabel={t('insight.a11y', { n: current + 1, total })}>
            {pages.map((item, i) => renderPage(item, insights[i].kind, width))}
          </ScrollView>
        ) : (
          renderPage(pages[0], insights[0].kind)
        )}
        {paged ? (
          <View style={styles.dots}>
            {insights.map((insight, i) => (
              <Pressable
                key={insight.kind}
                accessibilityRole="button"
                accessibilityLabel={t('insight.dotA11y', { n: i + 1, total })}
                accessibilityState={{ selected: i === current }}
                hitSlop={12}
                onPress={() => scroller.current?.scrollTo({ x: i * width, animated: !reduced })}
                style={[
                  styles.dot,
                  { backgroundColor: colors.foreground, opacity: i === current ? 0.85 : 0.3, width: i === current ? DOT_ACTIVE : DOT },
                ]}
              />
            ))}
          </View>
        ) : null}
      </View>
    </FadeIn>
  );
}

/** Soft link-to-sleep gradient with a glow in two corners: the frosted look, from the theme's own tints so every palette (light and dark) gets its own. */
function Backdrop() {
  const { colors } = useTheme();
  const id = useId();
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none" width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={`${id}-base`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.linkSoft} />
          <Stop offset="1" stopColor={colors.sleepSoft} />
        </LinearGradient>
        <RadialGradient id={`${id}-top`} cx="0.92" cy="0" r="0.75">
          <Stop offset="0" stopColor={colors.link} stopOpacity={GLOW} />
          <Stop offset="1" stopColor={colors.link} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}-bottom`} cx="0.05" cy="1" r="0.75">
          <Stop offset="0" stopColor={colors.sleep} stopOpacity={GLOW} />
          <Stop offset="1" stopColor={colors.sleep} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}-base)`} />
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}-top)`} />
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}-bottom)`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  panel: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  page: { padding: spacing.md + 4, paddingBottom: spacing.sm, gap: spacing.md },
  pageAlone: { paddingBottom: spacing.md + 4 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eyebrow: { flex: 1 },
  action: { alignSelf: 'flex-start' },
  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, paddingBottom: spacing.md + 4 },
  dot: { height: DOT, borderRadius: DOT / 2 },
});
