import { useRouter } from 'expo-router';
import { Fragment, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Metric } from '@/components/Metric';
import { NavRow } from '@/components/NavRow';
import { Card, Screen, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { StatTile } from '@/components/StatTile';
import { elapsedSec, formatGrams, isActive } from '@/features/live/liveWorkout';
import { useLiveSession } from '@/features/live/useLiveSession';
import { scoreFor } from '@/features/sleep/nights';
import { SetupChecklistCard } from '@/features/setup/SetupChecklistCard';
import { StepsWeekCard } from '@/features/steps/StepsWeekCard';
import { SleepSummaryView } from '@/features/today/SleepSummaryView';
import { ownTotalsOf } from '@/features/device/watchDayTotals';
import { isLinkUp } from '@/features/device/linkState';
import { activeWatchName } from '@/features/device/watchName';
import { shownName } from '@/features/device/shownName';
import { SyncButton } from '@/features/device/SyncButton';
import {
  heartRateStats,
  lastSleepSession,
  pickHeartReading,
  sumTotals,
} from '@/features/today/stats';
import { useLiveHeartRate } from '@/features/today/useLiveHeartRate';
import { useStepGoal } from '@/features/today/useStepGoal';
import { useNightHrvAvailability } from '@/features/today/useNightHrvAvailability';
import { useRestingToday } from '@/features/today/useRestingToday';
import { useTodayData } from '@/features/today/useTodayData';
import { WatchHero } from '@/features/today/WatchHero';
import { computeScores } from '@/features/today/scores';
import { MorningCheckin } from '@/features/today/MorningCheckin';
import { FitnessTodayCards } from '@/features/fitness/FitnessTodayCards';
import { IntensityWeekCard } from '@/features/fitness/IntensityWeekCard';
import { CoachTodayCard } from '@/features/coach/ui/CoachTodayCard';
import { LoopShortcut } from '@/features/loops/ui/LoopShortcut';
import { FamilyCard } from '@/features/today/FamilyCard';
import { ScoresCard } from '@/features/today/ScoresCard';
import { visibleHomeCards, type HomeCardId } from '@/features/today/homeCards';
import { useHomeCards } from '@/features/today/homeCardsStore';
import { useRogoScoresPush } from '@/features/today/useRogoScoresPush';
import { useSleepNightsPush } from '@/features/sleep/useSleepNightsPush';
import { useRogoActiveKcal } from '@/features/today/useRogoActiveKcal';
import { rogoDailyMetrics, rogoSleepHoursByDate } from '@/features/today/rogoScores';
import { useFitnessData } from '@/features/fitness/useFitnessData';
import { AskJoyoHeaderButton } from '@/features/ai/ui/AskJoyoButton';
import { ShareTodayButton } from '@/features/stickers/ui/ShareTodayButton';
import { isStrengthSport } from '@/features/strength/watchLive';
import { formatElapsed } from '@/features/workouts/summary';
import { formatClock, formatCount, formatDistance } from '@/format';
import { useNow } from '@/hooks/useNow';
import { getLocale, INTL_TAG, useLocale } from '@/i18n';
import { useLiveWorkout } from '@/state/LiveWorkoutProvider';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { showsWatchUi } from '@/features/device/presence';
import { TodayNoWatch } from '@/features/today/TodayNoWatch';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';
import { sportLabel } from '@/features/workouts/sportLabel';
import { OPEN_IN_STACK } from '@/components/navigation';

/** Splits `1.23 km` into its number and unit. */
function splitDistance(meters: number): { value: string; unit: string } {
  const [value, unit] = formatDistance(meters).split(' ');
  return { value, unit };
}

const WEEKDAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

/** How often the hero re-checks whether the live reading is stale and re-words "5 min ago". */
const HERO_TICK_MS = 5_000;

function WatchToday() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useTranslation(['today', 'common']);
  const { t: tLive } = useTranslation('sharing');
  const locale = useLocale();
  const { linkState, device, battery, lastSync, totals, watches, error, dataVersion, sync } = useWatch();
  const { data, error: loadError } = useTodayData(dataVersion);
  const nightHrv = useNightHrvAvailability(dataVersion);
  const { goal, isDefault: goalIsDefault } = useStepGoal();
  const live = useLiveHeartRate(isLinkUp(linkState));
  const liveWorkout = useLiveWorkout();
  const liveSession = useLiveSession();
  // Until the watch says the workout runs (its GPS or start screen), the banner waits instead of counting.
  const liveSearching = liveSession?.state === 'preparing';
  const liveKind = liveSession?.sportKind ?? null;

  const view = useMemo(() => {
    if (!data) return null;
    const watchTotals = ownTotalsOf(totals, watches, data.dayStart);
    const sleep = lastSleepSession(data.sleep);
    const dayTotals = watchTotals ?? sumTotals(data.samples);
    const scores = computeScores(data, nightHrv);
    return {
      totals: dayTotals,
      share: { steps: dayTotals.steps, sleep, readiness: scores.readiness, strain: scores.today },
      totalsFromWatch: watchTotals !== null,
      heart: heartRateStats(data.samples),
      sleep,
      sleepScore: sleep ? scoreFor(sleep.start, sleep.end, data.sleepScores) : null,
      hasSamples: data.samples.length > 0,
      scores,
    };
  }, [data, totals, watches, nightHrv, locale]);

  // One read of the fitness inputs for the cards below and for the body metrics JoyoRogo gets.
  const { data: fitness } = useFitnessData(dataVersion, 'full');
  const rogoMetrics = useMemo(() => (fitness && data ? rogoDailyMetrics(fitness, data.dayStart) : undefined), [fitness, data]);
  const rogoSleepHours = useMemo(() => (fitness && data ? rogoSleepHoursByDate(fitness, data.dayStart) : undefined), [fitness, data]);
  const rogoActiveKcal = useRogoActiveKcal(dataVersion);
  useRogoScoresPush(view?.scores ?? null, data?.dayStart ?? null, rogoMetrics, rogoActiveKcal, rogoSleepHours);
  useSleepNightsPush(dataVersion);

  const canSync = linkState === 'connected' && device !== null;
  const syncing = linkState === 'syncing';
  const loading = view === null && loadError === null;
  const distance = splitDistance(view?.totals.distance ?? 0);
  const nowMs = useNow(HERO_TICK_MS);
  const heartReading = pickHeartReading(live, data?.latestHeart ?? null, nowMs);
  // Total = active (watch) + resting so far (BMR prorated). Only this tile: everything pushed or exported stays active-only.
  const resting = useRestingToday(data?.dayStart ?? null, Math.floor(nowMs / 1000));
  const activeKcal = view?.totals.calories ?? 0;

  const homeCards = useHomeCards().prefs;
  const cards: Record<HomeCardId, ReactNode> = {
    scores: view ? <ScoresCard readiness={view.scores.readiness} today={view.scores.today} onPress={() => router.push('/readiness')} /> : null,
    activity: loading ? (
      <View style={styles.tiles}>
        <Skeleton width="48%" height={84} radius={18} />
        <Skeleton width="48%" height={84} radius={18} />
      </View>
    ) : (
      <View style={styles.activity}>
        <View style={styles.tiles}>
          <StatTile
            icon="flame"
            tint="workouts"
            label={t('home.calories')}
            value={formatCount(resting ? activeKcal + resting.kcal : activeKcal)}
            unit={t('home.kcal')}
            sub={resting ? t('home.caloriesSplit', { active: formatCount(activeKcal), resting: formatCount(resting.kcal) }) : t('home.caloriesActiveOnly')}
          />
          <StatTile icon="trail-sign" tint="steps" label={t('home.distance')} value={distance.value} unit={distance.unit} />
        </View>
        {resting ? null : (
          <AppText variant="caption" muted>
            {t('home.caloriesHint')}
          </AppText>
        )}
      </View>
    ),
    heart: (
      <Section title={t('home.heartTitle')} icon="heart" tint="heart" onPress={() => router.push('/heart')}>
        {view?.heart ? (
          <View style={styles.heartRow}>
            <View style={styles.heartCol}>
              <Metric value={String(view.heart.latest.bpm)} unit="bpm" size="md" color={colors.heartText} unitColor={colors.mutedForeground} />
              <AppText variant="caption" muted>
                {t('home.latest', { time: formatClock(view.heart.latest.timestamp) })}
              </AppText>
            </View>
            <View style={styles.heartCol}>
              <Metric value={String(view.heart.min)} unit="bpm" size="md" />
              <AppText variant="caption" muted>
                {t('home.low')}
              </AppText>
            </View>
            <View style={styles.heartCol}>
              <Metric value={String(view.heart.max)} unit="bpm" size="md" />
              <AppText variant="caption" muted>
                {t('home.high')}
              </AppText>
            </View>
          </View>
        ) : loading ? (
          <Skeleton width="60%" height={38} />
        ) : (
          <AppText variant="caption" muted>
            {t('home.noHeart')}
          </AppText>
        )}
      </Section>
    ),
    steps: (
      <StepsWeekCard
        dayStart={data?.dayStart ?? null}
        todaySteps={view?.totals.steps ?? 0}
        goal={goal}
        goalIsDefault={goalIsDefault}
        dataVersion={dataVersion}
      />
    ),
    sleep: (
      <Section title={t('home.sleepTitle')} icon="moon" tint="sleep" onPress={() => router.push('/sleep')}>
        {loading ? <Skeleton width="50%" height={38} /> : <SleepSummaryView summary={view?.sleep ?? null} score={view?.sleepScore ?? null} />}
      </Section>
    ),
    energy: <FitnessTodayCards data={fitness} availability={nightHrv} />,
    fitness: <IntensityWeekCard data={fitness} />,
    coach: <CoachTodayCard dataVersion={dataVersion} availability={nightHrv} />,
    checkin: data ? (
      <MorningCheckin hrv={data.hrv} dayStart={data.dayStart} nowMs={nowMs} connected={isLinkUp(linkState)} onMeasure={() => router.push('/hrv')} />
    ) : null,
    family: <FamilyCard />,
    loop: <LoopShortcut />,
    health: (
      <Card>
        <NavRow icon="pulse" tint="heart" title={t('home.healthTitle')} subtitle={t('home.healthSubtitle')} onPress={() => router.push('/health')} />
      </Card>
    ),
  };

  return (
    <Screen
      title={t('common:nav.today')}
      decorated
      caption={new Date().toLocaleDateString(INTL_TAG[getLocale()], WEEKDAY_FORMAT)}
      right={
        <View style={styles.headerActions}>
          <AskJoyoHeaderButton />
          {data && view ? <ShareTodayButton day={view.share} nowMs={data.nowSec * 1000} stepGoal={goal} restingHr={data.resting.get(data.dayStart) ?? null} /> : null}
        </View>
      }
      refresh={{ refreshing: syncing, onRefresh: () => void sync(), enabled: canSync }}>
      <View style={styles.stack}>
        <WatchHero
          linkState={linkState}
          deviceName={device ? shownName(activeWatchName(device, watches)) : null}
          steps={view?.totals.steps ?? 0}
          goal={goal}
          heart={heartReading}
          nowSec={Math.floor(nowMs / 1000)}
          onEnableHeartRate={() => router.push('/settings/sync', OPEN_IN_STACK)}
          battery={battery}
          lastSync={lastSync}
          action={
            canSync || syncing ? (
              <SyncButton variant="inverse" />
            ) : linkState === 'disconnected' ? (
              <Button label={t('home.connectWatch')} variant="inverse" icon="bluetooth" onPress={() => router.push('/watch')} />
            ) : null
          }
        />
        {isActive(liveWorkout) ? (
          <Card>
            <NavRow
              icon="pulse"
              tint="workouts"
              title={
                isStrengthSport(liveWorkout.sportType)
                  ? t('home.strengthOnWatch')
                  : t(liveSearching ? 'home.workoutSearching' : liveWorkout.status === 'paused' ? 'home.workoutPaused' : 'home.workoutInProgress', {
                      sport:
                        liveKind !== null && liveKind !== 'other'
                          ? tLive(`live.sport.${liveKind}`)
                          : liveWorkout.sportName
                            ? sportLabel(liveWorkout.sportName)
                            : t('home.workoutDefault'),
                    })
              }
              subtitle={
                liveSearching
                  ? t('home.workoutSearchingSubtitle')
                  : t(liveWorkout.heartRate !== null ? 'home.workoutSubtitleHr' : 'home.workoutSubtitle', {
                      elapsed: formatElapsed(elapsedSec(liveWorkout, nowMs)),
                      bpm: liveWorkout.heartRate,
                      fat: formatGrams(liveWorkout.fatGrams),
                      carbs: formatGrams(liveWorkout.carbGrams),
                    })
              }
              onPress={() => router.push(isStrengthSport(liveWorkout.sportType) ? '/strength/watch-pick' : '/workout-live', OPEN_IN_STACK)}
            />
          </Card>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <SetupChecklistCard />
        {loadError ? <Notice tone="danger">{t('home.loadError', { error: loadError })}</Notice> : null}
      </View>

      {visibleHomeCards(homeCards).map((id) => (
        <Fragment key={id}>{cards[id]}</Fragment>
      ))}
      <Details title={t('home.aboutTitle')}>
        {`${t(view?.totalsFromWatch ? 'home.aboutWatch' : view?.hasSamples ? 'home.aboutSamples' : 'home.aboutNone')}\n\n${t(
          resting?.source === 'rogo' ? 'home.aboutKcalRogo' : resting ? 'home.aboutKcalProfile' : 'home.aboutKcalActive',
        )}`}
      </Details>
      <Card>
        <NavRow icon="albums" tint="neutral" title={t('cards.entry')} subtitle={t('cards.entrySubtitle')} onPress={() => router.push('/home-cards')} />
      </Card>
    </Screen>
  );
}

/**
 * Today. With a watch (or data from one) it is the watch's day: ring, scores, sleep, heart rate. A phone that has never had a watch
 * gets `TodayNoWatch`, built around the strength logger and Coach, instead of a screen of empty cards. The first moment, before the
 * database says which one applies, shows only the title.
 */
export default function TodayScreen() {
  const { t } = useTranslation('common');
  const presence = useWatchPresence();
  if (presence === null) {
    return (
      <Screen title={t('nav.today')} decorated>
        {null}
      </Screen>
    );
  }
  return showsWatchUi(presence) ? <WatchToday /> : <TodayNoWatch />;
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stack: { gap: spacing.md },
  activity: { gap: spacing.sm },
  tiles: { flexDirection: 'row', gap: spacing.md },
  heartRow: { flexDirection: 'row', gap: spacing.md },
  heartCol: { flex: 1, gap: 0 },
});
