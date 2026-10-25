import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Details } from '@/components/Details';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { IconChip } from '@/components/IconChip';
import { Metric } from '@/components/Metric';
import { Card, Screen, Section } from '@/components/Screen';
import { EmptyState } from '@/components/States';
import { BurnFigure, FuelBar } from '@/features/live/FuelBar';
import { elapsedSec, livePhase, showsClock } from '@/features/live/liveWorkout';
import { MetronomeRow } from '@/features/metronome/ui/MetronomeRow';
import { useMetronome, useStopMetronomeWhen } from '@/features/metronome/metronome';
import { isStrengthSport } from '@/features/strength/watchLive';
import { SPORT_ROWS } from '@/features/workouts/manual';
import { sportIcon } from '@/features/workouts/sportIcon';
import { fmtDecimal, fmtInt } from '@/i18n';
import { useNow } from '@/hooks/useNow';
import { isLinkUp } from '@/features/device/linkState';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';
import { HuaweiWear } from '@/wear';
import { sportLabel } from '@/features/workouts/sportLabel';
import { OPEN_IN_STACK } from '@/components/navigation';

import { allowLiveSteps, useLiveExtras } from './liveExtras';
import { footKind, speedFromPace, type FieldSportKind, type RunMetricId, type RunMetricValues } from './runFields';
import { useRunLayout } from './runLayoutStore';
import { useTrail } from './trail';
import { LiveRunMap } from './ui/LiveRunMap';
import { MetricGrid, useFieldEditor } from './ui/MetricGrid';
import type { LiveSession } from './liveSession';
import { setSportKind, useLiveSession } from './useLiveSession';

const TICK_MS = 1_000;
const DASH = '--';
/** The kinds the user can correct a guessed sport to. */
const CHOOSABLE_KINDS: readonly Exclude<FieldSportKind, 'other'>[] = ['run', 'walk', 'ride', 'hike'];
/** The phone's GPS fix older than this (seconds) no longer counts as a signal. */
const GPS_SIGNAL_MAX_AGE_S = 10;
/** The fields the phone's step counter fills. */
const STEP_FIELDS: readonly RunMetricId[] = ['cadence', 'steps', 'stride'];

/** A workout started on the watch, as it happens: the map with the phone's GPS, the configurable data fields, the metronome, and what is burned. */
export function LiveWorkoutScreen() {
  const { t } = useTranslation(['sharing', 'common']);
  const session = useLiveSession();
  const router = useRouter();
  const { linkState } = useWatch();
  // "Keep going" holds while the suspicion lasts; when the watch proves itself running again, a later one asks again.
  const [kept, setKept] = useState(false);
  const live = session?.raw ?? null;
  const suspected = live?.endSuspected === true;
  // Adjusting state while rendering (not in an effect): the answer is forgotten as soon as the suspicion is gone.
  if (kept && !suspected) setKept(false);
  // The metronome belongs to the workout: it stops when the workout is over or gone.
  useStopMetronomeWhen(session === null || session.state === 'ended');

  if (!session || !live) {
    return (
      <Screen>
        <HiddenTabHeader title={t('live.title')} />
        <EmptyState
          icon="walk"
          title={t('live.emptyTitle')}
          description={t('live.emptyDescription')}
          action={isLinkUp(linkState) ? { label: t('live.start'), icon: 'play', onPress: () => HuaweiWear.startLiveWorkout() } : undefined}
        />
      </Screen>
    );
  }

  const active = session.state !== 'ended';
  // A strength workout belongs in the strength logger, not here.
  if (active && !session.gpsSport && isStrengthSport(live.sportType)) return <Redirect href="/strength/watch-pick" />;

  const kind = session.sportKind;
  const title = kind !== null && kind !== 'other' ? t(`live.sport.${kind}`) : live.sportName ? sportLabel(live.sportName) : t('live.title');
  // Only a workout whose sport nobody knows can be a strength one; a GPS sport never is.
  const offerStrength = active && live.sportType === null && kind === null && !session.gpsSport;
  const endPrompt = live.status !== 'ended' && live.source !== 'watch' && suspected && !kept;

  return (
    <Screen>
      <HiddenTabHeader title={title} />
      {offerStrength ? (
        <Button label={t('live.logStrength')} icon="barbell" onPress={() => router.push('/strength/watch-pick', OPEN_IN_STACK)} />
      ) : null}
      {endPrompt ? (
        <Card>
          <AppText variant="bodyStrong">{t('live.endPrompt.title')}</AppText>
          <AppText variant="caption" muted>
            {t('live.endPrompt.body')}
          </AppText>
          <Button label={t('live.endPrompt.finish')} variant="primary" icon="stop" onPress={() => HuaweiWear.finishLiveWorkout()} />
          <Button label={t('live.endPrompt.keep')} onPress={() => setKept(true)} />
        </Card>
      ) : null}
      <LiveBody session={session} title={title} />
      {live.status === 'ended' ? (
        <Button
          label={t('common:actions.done')}
          variant="primary"
          icon="checkmark"
          onPress={() => {
            HuaweiWear.dismissLiveWorkout();
            router.replace('/workouts');
          }}
        />
      ) : live.source === 'manual' ? (
        <Button label={t('live.finish')} icon="stop" onPress={() => HuaweiWear.finishLiveWorkout()} />
      ) : live.source !== 'watch' ? (
        // The watch takes no stop from the phone (every 17/01 is refused with 123002 on the Fit 4 Pro, docs/live-run.md): the workout
        // ends on the watch, and the phone can only stop following it.
        <>
          <AppText variant="caption" muted>
            {t('live.finishOnWatch')}
          </AppText>
          <Button label={t('live.stopFollowing')} onPress={() => HuaweiWear.finishLiveWorkout()} />
        </>
      ) : null}
    </Screen>
  );
}

function LiveBody({ session, title }: { session: LiveSession; title: string }) {
  const { t } = useTranslation('sharing');
  const colors = useColors();
  const nowMs = useNow(TICK_MS);
  const editor = useFieldEditor();
  const live = session.raw;
  const metrics = session.metrics;
  const location = session.location;
  const kind: FieldSportKind = session.sportKind ?? 'other';
  const [layout] = useRunLayout(kind);
  const trail = useTrail(location);
  const metronome = useMetronome();
  const phase = livePhase(live);
  const extras = useLiveExtras(session, nowMs);
  const active = session.state !== 'ended';
  const statusColor = live.status === 'running' ? colors.link : live.status === 'paused' ? colors.warning : colors.mutedForeground;
  const showMap = session.gpsSport || location !== null || (session.sportKind !== null && session.sportKind !== 'other');

  // The screen stays on while the metronome beats: a timer of a sleeping app may be throttled (see `metronome.ts`).
  const hold = active && metronome.enabled;
  useEffect(() => {
    if (!hold) return;
    void activateKeepAwakeAsync('live-metronome');
    return () => void deactivateKeepAwake('live-metronome');
  }, [hold]);

  // The watch's own numbers win when it sends them (a `17/11` report); else the phone's step counter fills cadence, steps and stride.
  const watchCadence = metrics.cadence ?? live.stepRate;
  const watchSteps = live.steps !== null && live.steps > 0 ? live.steps : null;
  const values: RunMetricValues = {
    duration: showsClock(live) ? elapsedSec(live, nowMs) : null,
    distance: metrics.distanceM,
    pace: metrics.paceSPerKm,
    avgPace: metrics.avgPaceSPerKm,
    speed: live.speedKmh ?? speedFromPace(metrics.paceSPerKm),
    hr: metrics.hr,
    avgHr: extras.figures.avgHr,
    maxHr: extras.figures.maxHr,
    calories: metrics.calories,
    cadence: watchCadence ?? extras.figures.cadence,
    steps: watchSteps ?? extras.figures.steps,
    stride: watchSteps === null ? extras.figures.strideM : null,
    elevationGain: metrics.elevationGainM,
    altitude: metrics.altitudeM,
  };
  const phoneMeasured: RunMetricId[] = [];
  if (watchCadence === null && extras.figures.cadence !== null) phoneMeasured.push('cadence');
  if (watchSteps === null && extras.figures.steps !== null) phoneMeasured.push('steps', 'stride');
  const shown = new Set(layout.ids);
  const askSteps = extras.steps === 'ask' && active && STEP_FIELDS.some((id) => shown.has(id));
  const fixAge = location !== null && live.locationAt ? Math.max(0, (nowMs - live.locationAt) / 1000) : null;
  const signal =
    location !== null && session.gpsFix && (fixAge === null || fixAge <= GPS_SIGNAL_MAX_AGE_S)
      ? { accuracyM: location.accuracy, ageSec: fixAge ?? 0 }
      : null;

  return (
    <>
      <Card>
        <View style={styles.head}>
          <IconChip sport={sportIcon(kind !== 'other' ? SPORT_ROWS[kind].name : (live.sportName ?? ''))} tint="workouts" size="lg" />
          <View style={styles.headText}>
            <AppText variant="heading" numberOfLines={1}>
              {title}
            </AppText>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: statusColor }]} />
              <AppText variant="label" color={statusColor}>
                {t(`live.status.${phase}`)}
              </AppText>
            </View>
          </View>
          <Button label={t('live.fields.edit')} icon="options" variant="ghost" iconOnly onPress={() => editor.open()} />
        </View>
        {phase === 'searching' ? (
          <AppText variant="caption" muted>
            {t('live.searchingHint')}
          </AppText>
        ) : null}
        {session.sportKindInferred && active ? (
          <View style={styles.kinds}>
            <AppText variant="caption" muted>
              {t('live.sport.inferred')}
            </AppText>
            <View style={styles.kindRow}>
              {CHOOSABLE_KINDS.map((option) => (
                <Chip
                  key={option}
                  label={t(`live.sport.${option}`)}
                  selected={session.sportKind === option}
                  role="radio"
                  onPress={() => setSportKind(session.id, option)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </Card>

      {showMap ? <LiveRunMap position={location ? { lat: location.lat, lon: location.lon, headingDeg: location.bearing } : null} trail={trail} fix={signal} /> : null}

      <MetricGrid kind={kind} values={values} editor={editor} phoneMeasured={phoneMeasured} />

      {askSteps ? (
        <Card>
          <AppText variant="caption" muted>
            {t('live.steps.ask')}
          </AppText>
          <Button label={t('live.steps.allow')} icon="footsteps-outline" variant="secondary" onPress={() => void allowLiveSteps()} />
        </Card>
      ) : null}

      {active ? (
        <Card>
          <MetronomeRow />
        </Card>
      ) : null}

      <Section title={t('live.burned.title')} icon="flame" tint="workouts">
        <View style={styles.burnRow}>
          <BurnFigure label={t('live.burned.fat')} grams={live.fatGrams} color={colors.workoutsText} />
          <BurnFigure label={t('live.burned.carbs')} grams={live.carbGrams} color={colors.stepsText} />
          {shown.has('calories') ? null : (
            <View style={styles.burnFigure}>
              <AppText variant="label" muted>
                {t('live.burned.calories')}
              </AppText>
              <Metric value={metrics.calories !== null ? fmtInt(metrics.calories) : DASH} unit="kcal" size="md" />
            </View>
          )}
        </View>
        <FuelBar fatShare={live.fatShare} />
        <Details title={t('live.calc.title')}>
          {t(live.source !== 'watch' ? 'live.calc.phone' : 'live.calc.watch', { max: live.maxHeartRate })}
        </Details>
      </Section>

      <Section title={t('live.more.title')} icon="list">
        <View style={styles.grid}>
          {values.steps !== null && values.steps !== undefined && !shown.has('steps') ? <Pair label={t('live.more.steps')} value={fmtInt(values.steps)} /> : null}
          {values.cadence !== null && values.cadence !== undefined && values.cadence > 0 && !shown.has('cadence') ? (
            <Pair
              label={t('live.more.cadence')}
              value={footKind(kind) ? t('live.more.stepRate', { value: fmtInt(values.cadence) }) : `${fmtInt(values.cadence)} rpm`}
            />
          ) : null}
          {!shown.has('speed') && live.speedKmh !== null ? <Pair label={t('live.more.speed')} value={`${fmtDecimal(live.speedKmh, 1)} km/h`} /> : null}
          {metrics.altitudeM !== null && !shown.has('altitude') ? <Pair label={t('live.more.altitude')} value={`${fmtInt(metrics.altitudeM)} m`} /> : null}
          {metrics.elevationGainM !== null && !shown.has('elevationGain') ? <Pair label={t('live.more.climb')} value={`${fmtInt(metrics.elevationGainM)} m`} /> : null}
          {live.descentM !== null ? <Pair label={t('live.more.descent')} value={`${fmtInt(live.descentM)} m`} /> : null}
          {live.aerobicTe !== null ? <Pair label={t('live.more.aerobicEffect')} value={fmtDecimal(live.aerobicTe, 1)} /> : null}
          {live.anaerobicTe !== null ? <Pair label={t('live.more.anaerobicEffect')} value={fmtDecimal(live.anaerobicTe, 1)} /> : null}
        </View>
        {live.durationSec === null ? (
          <AppText variant="caption" muted>
            {t('live.more.waiting')}
          </AppText>
        ) : null}
        {live.status === 'ended' ? <Details>{t('live.more.ended')}</Details> : null}
      </Section>
    </>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.pair}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={styles.pairValue}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  kinds: { gap: spacing.xs },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  burnRow: { flexDirection: 'row', gap: spacing.md },
  burnFigure: { flex: 1, gap: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, columnGap: spacing.md },
  pair: { width: '47%' },
  pairValue: { fontVariant: ['tabular-nums'] },
});
