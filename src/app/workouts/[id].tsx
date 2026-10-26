import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { CloudWorkoutLine } from '@/cloud/CloudWorkoutLine';
import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { IconChip } from '@/components/IconChip';
import { isIos } from '@/components/IosUnavailable';
import { KeyValue } from '@/components/KeyValue';
import { Metric } from '@/components/Metric';
import { HeaderIconButton } from '@/components/HeaderIconButton';
import { AskJoyoAction } from '@/features/ai/ui/AskJoyoButton';
import { Card, Screen, Section } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Notice, Skeleton } from '@/components/States';
import {
  getWorkout,
  listStepSamplesSince,
  listWorkoutPoints,
  type WorkoutPointRow,
  type WorkoutRow,
} from '@/db/queries';
import { BurnFigure, FuelBar } from '@/features/live/FuelBar';
import { startOfLocalDay } from '@/features/today/stats';
import { workoutStrain } from '@/features/today/strain';
import { useWorkoutSource } from '@/features/device/useWorkoutSource';
import { GearWorkoutSection } from '@/features/gear/ui/GearWorkoutSection';
import { CoachFeedbackSection } from '@/features/coach/ui/CoachFeedbackSection';
import { useWorkoutExport } from '@/features/export/useWorkoutExport';
import { useExportItems, WorkoutExportRow } from '@/features/export/WorkoutExportSection';
import { StravaWorkoutSection } from '@/features/strava/StravaWorkoutSection';
import { ShareRunButton } from '@/features/stickers/ui/ShareRunButton';
import { ReplayButton } from '@/features/replay/ui/ReplayButton';
import { ShareToRogoButton } from '@/features/social/ShareToRogo';
import { SaveWorkoutRouteButton, SaveWorkoutRouteNotice, useSaveWorkoutRoute } from '@/features/routes/SaveWorkoutRouteButton';
import { useRoleText } from '@/features/record/ui/roleText';
import { listWorkoutSensors, type WorkoutSensor } from '@/features/sensors/store';
import { analyzeWorkoutWithDetail } from '@/features/workouts/analysis/analyze';
import type { RouteDetail } from '@/features/workouts/analysis/route';
import { loadAnalysisHistory } from '@/features/workouts/analysis/history';
import { useAnalysisPalette, useMapTheme } from '@/features/workouts/analysis/palette';
import { workoutElevation } from '@/features/workouts/analysis/elevation';
import type { SportKind, WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { WorkoutAnalysisView, useAnalysisT, type ExtraStat } from '@/features/workouts/analysis/ui';
import { DeleteWorkoutDialog } from '@/features/workouts/ui/DeleteWorkoutDialog';
import { RefetchDynamicsAction } from '@/features/workouts/ui/RefetchDynamics';
import { RunningDynamicsSection } from '@/features/workouts/ui/RunningDynamicsSection';
import { MenuSheet, type MenuItem } from '@/features/strength/ui/Sheet';
import { sportIcon } from '@/features/workouts/sportIcon';
import { sportLabel } from '@/features/workouts/sportLabel';
import { splitWorkout } from '@/features/workouts/substrate';
import {
  formatElapsed,
  formatPace,
  formatSpeed,
  parseSummary,
  routePoints,
  workoutDistanceParts,
  type WorkoutSummary,
} from '@/features/workouts/summary';
import { averagePaceSec, averageSpeedMs, workoutTimes } from '@/features/workouts/times';
import { sourceLabel } from '@/features/fitness/format';
import { effectWord, trainingEffect } from '@/features/fitness/trainingEffect';
import { plausibleVo2 } from '@/features/fitness/vo2max';
import { hrZoneName } from '@/features/hrzones/names';
import { useHrZones, userHrZones } from '@/features/hrzones/settings';
import { useStrengthHistory } from '@/features/strength/history';
import { getStrengthWorkoutByStart } from '@/features/strength/store';
import type { StrengthWorkout } from '@/features/strength/types';
import { StrengthDetailSection } from '@/features/strength/ui/StrengthDetailSection';
import { EbikeRow } from '@/features/cycling/ui/EbikeRow';
import { RideAnalysisView } from '@/features/cycling/ui/RideAnalysisView';
import { useRideData } from '@/features/cycling/ui/useRideData';
import { withRideStats } from '@/features/cycling/ui/withRideStats';
import { sportKind } from '@/features/workouts/analysis/sport';
import { errorMessage, formatCount, formatDateTime } from '@/format';
import { fmtDecimal, fmtInt, t as translate } from '@/i18n';
import { spacing, useColors } from '@/theme';
import type { StepSample } from '@/wear';

interface Loaded {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  points: WorkoutPointRow[];
  /** Per-minute samples of the workout's day, for its share of that day's strain. */
  daySamples: StepSample[];
  /** The strength workout stored as this row (its own, or the one merged with this watch workout). */
  strength: StrengthWorkout | null;
  /** The sensors a phone recording used; empty for every other workout. */
  sensors: WorkoutSensor[];
}

/** `x,y m`, or null when the summary does not have the value. */
function metres(value: number | undefined): string | null {
  return value === undefined ? null : translate('common:units.m', { value: fmtDecimal(value, 1) });
}

/** `5,5 g` under 10 g, whole grams above. */
function grams(value: number): string {
  return value < 10 ? fmtDecimal(value, 1) : fmtInt(value);
}

/**
 * The pace or speed rows that fit the sport: swimming per 100 m, running and walking per km, the rest km/h. The summary card
 * already shows the average pace of a run or walk and the average and top speed of a ride, so those rows are left out here.
 */
function paceRows(kind: SportKind, summary: WorkoutSummary, distanceM: number, movingSec: number): { key: string; label: string; value: string }[] {
  const avgPace = translate('workouts:detail.more.avgPace');
  const bestPace = translate('workouts:detail.more.bestPace');
  if (summary.avgPaceSecPer100m !== undefined) {
    const rows = [{ key: 'avg', label: avgPace, value: formatPace(averagePaceSec(distanceM, movingSec, 100) ?? summary.avgPaceSecPer100m, '100 m') }];
    if (summary.minPaceSecPer100m !== undefined) {
      rows.push({ key: 'best', label: bestPace, value: formatPace(summary.minPaceSecPer100m, '100 m') });
    }
    return rows;
  }
  if (summary.avgPaceSecPerKm !== undefined) {
    const rows: { key: string; label: string; value: string }[] = [];
    if (kind !== 'run' && kind !== 'walk') rows.push({ key: 'avg', label: avgPace, value: formatPace(averagePaceSec(distanceM, movingSec) ?? summary.avgPaceSecPerKm, 'km') });
    if (summary.minPaceSecPerKm !== undefined) {
      rows.push({ key: 'best', label: bestPace, value: formatPace(summary.minPaceSecPerKm, 'km') });
    }
    return rows;
  }
  const rows: { key: string; label: string; value: string }[] = [];
  if (kind === 'ride') return rows;
  const avgSpeed = averageSpeedMs(distanceM, movingSec) ?? summary.avgSpeed;
  if (kind !== 'run' && kind !== 'walk' && avgSpeed !== undefined && avgSpeed !== null) rows.push({ key: 'avgSpeed', label: translate('workouts:detail.more.avgSpeed'), value: formatSpeed(avgSpeed) });
  if (summary.maxSpeed !== undefined) rows.push({ key: 'topSpeed', label: translate('workouts:detail.more.topSpeed'), value: formatSpeed(summary.maxSpeed) });
  return rows;
}

const NO_WORKOUT = { sportName: '', start: 0 };
const NO_POINTS: WorkoutPointRow[] = [];

/**
 * The analysis of the workout on screen: computed after the rest of the screen is drawn. `analysis` is what the share, the coach and the
 * cloud copy use; `shown` is the same with the phone's finer chart grid, and `route` the full-resolution track for the map.
 */
type AnalysisState =
  | { status: 'pending' }
  | { status: 'none' }
  | { status: 'ready'; analysis: WorkoutAnalysis; shown: WorkoutAnalysis; route: RouteDetail | null }
  | { status: 'error'; message: string };

export default function WorkoutDetailScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const { toast, show } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisState, setAnalysisState] = useState<AnalysisState>({ status: 'pending' });
  const [scrubbing, setScrubbing] = useState(false);
  // After a refetch from the watch changed the stored summary: read just the summary again (the analysis does not use the running form).
  const refreshSummary = useCallback(async () => {
    const found = await getWorkout(db, Number(id));
    if (found) setLoaded((prev) => (prev ? { ...prev, summary: parseSummary(found.summaryJson) } : prev));
  }, [db, id]);
  const palette = useAnalysisPalette();
  const mapTheme = useMapTheme();
  const { t } = useTranslation('workouts');
  const analysisT = useAnalysisT();
  const { catalog } = useStrengthHistory();
  const recordedBy = useWorkoutSource(Number(id));
  const roleText = useRoleText();
  const saveRoute = useSaveWorkoutRoute({ workout: loaded?.workout ?? NO_WORKOUT, points: loaded?.points ?? NO_POINTS });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const workoutId = Number(id);
      setAnalysisState({ status: 'pending' });
      (async () => {
        const found = await getWorkout(db, workoutId);
        if (!found) throw new Error(translate('workouts:detail.errors.notStored'));
        const points = await listWorkoutPoints(db, workoutId);
        const strength = await getStrengthWorkoutByStart(db, found.workout.start);
        const day = startOfLocalDay(found.workout.start);
        const daySamples = (await listStepSamplesSince(db, day)).filter((s) => s.timestamp < day + 86400);
        const summary = parseSummary(found.summaryJson);
        const sensors = summary.source === 'phone' ? await listWorkoutSensors(db, workoutId) : [];
        return { workout: found.workout, summary, points, daySamples, strength, sensors };
      })().then(
        async (value) => {
          if (cancelled) return;
          setLoaded(value);
          // The logger's own row has no heart rate, GPS or samples: there is nothing to analyse.
          if (value.strength !== null && value.points.length === 0) {
            setAnalysisState({ status: 'none' });
            return;
          }
          try {
            const zones = userHrZones();
            const history = await loadAnalysisHistory(db, value.workout, value.summary, zones.maxHr);
            // Let the summary paint before the analysis blocks the JS thread.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            if (cancelled) return;
            const { analysis, detail } = analyzeWorkoutWithDetail(
              { workout: value.workout, summary: value.summary, points: value.points, zones, daySamples: value.daySamples, history },
              { includeHr: true, includeRoute: true, includeComparison: true },
            );
            const shown = detail.series ? { ...analysis, series: detail.series } : analysis;
            setAnalysisState({ status: 'ready', analysis, shown, route: detail.route });
          } catch (e) {
            if (!cancelled) setAnalysisState({ status: 'error', message: errorMessage(e) });
          }
        },
        (e: unknown) => {
          if (!cancelled) setError(errorMessage(e));
        },
      );
      return () => {
        cancelled = true;
      };
    }, [db, id]),
  );

  const route = useMemo(() => (loaded ? routePoints(loaded.points) : []), [loaded]);
  const zones = useHrZones();
  const burn = useMemo(() => {
    if (!loaded) return null;
    return splitWorkout(loaded.workout.calories, loaded.points, zones);
  }, [loaded, zones]);
  const strain = useMemo(() => {
    if (!loaded) return null;
    return workoutStrain(loaded.points, zones.maxHr);
  }, [loaded, zones.maxHr]);
  const effect = useMemo(() => trainingEffect(loaded?.summary ?? {}, strain?.trimp ?? null), [loaded, strain]);
  const vo2 = plausibleVo2(loaded?.summary.vo2max);
  const effectShown =
    effect.aerobic !== null ||
    effect.anaerobic !== null ||
    effect.points !== null ||
    effect.load !== null ||
    (loaded?.summary.recoveryHours ?? 0) > 0 ||
    vo2 !== null;
  // One set of numbers for the whole screen, the same ones the analysis, the share card, the post and the Strava file use.
  const times = useMemo(() => (loaded ? workoutTimes(loaded.workout) : { elapsedSec: 0, movingSec: 0 }), [loaded]);
  const elevation = useMemo(() => (loaded ? workoutElevation(loaded.workout, loaded.summary, loaded.points) : null), [loaded]);
  const shareSummary = useMemo(
    () => (loaded ? { ...loaded.summary, elevationGain: elevation?.gainM, elevationLoss: elevation?.lossM } : {}),
    [loaded, elevation],
  );
  const rideInput = useMemo(
    () =>
      loaded !== null && sportKind(loaded.workout.sportName, loaded.summary.kind) === 'ride'
        ? { workout: loaded.workout, summary: loaded.summary, points: loaded.points }
        : null,
    [loaded],
  );
  const rideData = useRideData(db, rideInput);
  // The consumers of the analysis (share to JoyoRogo, coach) get the ride's own power and speed figures, not the 600-step grid's.
  const sharedAnalysis = useMemo(() => {
    if (analysisState.status !== 'ready') return null;
    return rideData.ride ? withRideStats(analysisState.analysis, rideData.ride) : analysisState.analysis;
  }, [analysisState, rideData.ride]);
  const avgRideSpeed = rideData.ride?.speed.avgMovingMs != null ? rideData.ride.speed.avgMovingMs * 3.6 : null;
  const colors = useColors();
  // The step count is the one total the analysis does not carry; it joins the summary card's grid.
  const stepStats = useMemo<ExtraStat[]>(
    () =>
      loaded !== null && loaded.workout.steps > 0
        ? [
            {
              key: 'steps',
              label: loaded.summary.kind === 'JUMP_ROPING' ? t('detail.figure.jumps') : t('detail.figure.steps'),
              value: formatCount(loaded.workout.steps),
            },
          ]
        : [],
    [loaded, t],
  );
  const exporter = useWorkoutExport(db, loaded?.workout ?? null, loaded?.points ?? NO_POINTS);
  const exportItems = useExportItems(exporter);
  const savedFolder = exporter.saved?.folder;
  useEffect(() => {
    if (savedFolder !== undefined) show(t('export.saved', { folder: savedFolder }));
  }, [savedFolder, exporter.saved, show, t]);
  // iOS cannot present a second modal while the menu is still leaving: open the export sheet once the menu is gone.
  const exportAfterMenu = useRef(false);
  const menuItems: MenuItem[] = [
    ...(exporter.entries.length > 0
      ? [
          {
            key: 'export',
            label: t('export.title'),
            icon: 'download-outline',
            onPress: () => {
              if (Platform.OS === 'ios') exportAfterMenu.current = true;
              else setExportOpen(true);
            },
          } satisfies MenuItem,
        ]
      : []),
    { key: 'delete', label: t('delete.action'), icon: 'trash-outline', danger: true, onPress: () => setDeleteOpen(true) },
  ];

  if (!loaded) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('detail.title') }} />
        {error !== null ? (
          <Notice tone="danger">{error}</Notice>
        ) : (
          <>
            <Skeleton width="100%" height={216} radius="card" />
            <Skeleton width="100%" height={280} radius="card" />
            <Skeleton width="100%" height={200} radius="card" />
          </>
        )}
      </Screen>
    );
  }

  const { workout, summary } = loaded;
  const bare = loaded.strength !== null && loaded.points.length === 0;
  const jumpRope = summary.kind === 'JUMP_ROPING';
  const swim = summary.swim;
  const sport = sportLabel(workout.sportName);
  const kind = sportKind(workout.sportName, summary.kind);
  const { value: distance, unit: distanceUnit } = workoutDistanceParts(workout.distance);
  const swimRows: { key: string; label: string; value: string | null }[] = swim
    ? [
        { key: 'style', label: t('detail.swim.style'), value: swim.style ?? null },
        { key: 'laps', label: t('detail.swim.laps'), value: swim.laps !== undefined ? fmtInt(swim.laps) : null },
        { key: 'pool', label: t('detail.swim.pool'), value: swim.poolLengthCm !== undefined ? translate('common:units.m', { value: fmtDecimal(swim.poolLengthCm / 100, 0) }) : null },
        { key: 'strokes', label: t('detail.swim.strokes'), value: swim.strokes !== undefined ? fmtInt(swim.strokes) : null },
        { key: 'rate', label: t('detail.swim.strokeRate'), value: swim.avgStrokeRate !== undefined ? t('detail.value.perMin', { value: fmtInt(swim.avgStrokeRate) }) : null },
        { key: 'swolf', label: t('detail.swim.swolf'), value: swim.avgSwolf !== undefined ? fmtInt(swim.avgSwolf) : null },
      ].filter((row) => row.value !== null)
    : [];

  // Only when there is no analysis card to carry them (a logged strength session, or an analysis that failed) the header keeps the totals itself.
  const fallbackFigures =
    analysisState.status === 'none' || analysisState.status === 'error' ? (
      <View style={styles.figures}>
        <Figure label={times.elapsedSec > times.movingSec ? t('detail.figure.movingTime') : t('detail.figure.duration')}>
          <Metric value={formatElapsed(times.movingSec)} size="md" />
        </Figure>
        {times.elapsedSec > times.movingSec ? (
          <Figure label={t('detail.figure.elapsed')}>
            <Metric value={formatElapsed(times.elapsedSec)} size="md" />
          </Figure>
        ) : null}
        {workout.distance > 0 ? (
          <Figure label={t('detail.figure.distance')}>
            <Metric value={distance} unit={distanceUnit} size="md" />
          </Figure>
        ) : null}
        {avgRideSpeed !== null ? (
          <Figure label={translate('cycling:header.avgSpeed')}>
            <Metric value={fmtDecimal(avgRideSpeed, 1)} unit={translate('cycling:unit.kmh')} size="md" />
          </Figure>
        ) : null}
        {workout.calories > 0 ? (
          <Figure label={t('detail.figure.calories')}>
            <Metric value={formatCount(workout.calories)} unit={t('detail.unit.kcal')} size="md" />
          </Figure>
        ) : null}
        {workout.steps > 0 ? (
          <Figure label={jumpRope ? t('detail.figure.jumps') : t('detail.figure.steps')}>
            <Metric value={formatCount(workout.steps)} size="md" />
          </Figure>
        ) : null}
        {workout.avgHr !== null ? (
          <Figure label={t('detail.figure.avgHr')}>
            <Metric value={String(workout.avgHr)} unit={t('detail.unit.bpm')} size="md" color={colors.heartText} />
          </Figure>
        ) : null}
        {workout.maxHr !== null ? (
          <Figure label={t('detail.figure.maxHr')}>
            <Metric value={String(workout.maxHr)} unit={t('detail.unit.bpm')} size="md" color={colors.heartText} />
          </Figure>
        ) : null}
      </View>
    ) : null;

  return (
    <Screen scrollEnabled={!scrubbing}>
      <Stack.Screen
        options={{
          title: sport,
          headerRight: () => <HeaderIconButton icon="ellipsis-vertical" label={t('delete.menu')} onPress={() => setMenuOpen(true)} />,
        }}
      />
      <MenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onDismiss={() => {
          if (exportAfterMenu.current) {
            exportAfterMenu.current = false;
            setExportOpen(true);
          }
        }}
        items={menuItems}
      />
      <MenuSheet visible={exportOpen} onClose={() => setExportOpen(false)} title={t('export.title')} items={exportItems} />
      <DeleteWorkoutDialog
        target={deleteOpen ? { start: workout.start, sportName: workout.sportName, name: loaded.strength?.name } : null}
        onClose={() => setDeleteOpen(false)}
        onConfirmed={() => (router.canGoBack() ? router.back() : router.replace('/workouts'))}
      />
      <Card>
        <View style={styles.summaryHead}>
          <IconChip sport={sportIcon(workout.sportName)} tint="workouts" size="lg" />
          <View style={styles.summaryTitle}>
            <AppText variant="heading" numberOfLines={2}>
              {sport}
            </AppText>
            <AppText variant="caption" muted>
              {formatDateTime(workout.start)}
            </AppText>
          </View>
        </View>
        <AskJoyoAction seed={{ seed: 'workout', ref: `w:${workout.start}`, label: `${sport}, ${formatDateTime(workout.start)}` }} />
        {fallbackFigures}
        {rideInput !== null ? <EbikeRow workoutStart={workout.start} /> : null}
        {bare ? null : (
          <View style={styles.actions}>
            <ShareRunButton
              workout={workout}
              summary={shareSummary}
              route={route}
              analysis={analysisState.status === 'ready' ? analysisState.analysis : null}
              ride={rideData.ride}
              strength={loaded.strength}
              variant="primary"
              style={styles.shareMain}
            />
            <ReplayButton workout={workout} analysis={sharedAnalysis} climbs={rideData.ride?.climbs ?? null} iconOnly />
            <ShareToRogoButton
              workout={workout}
              points={loaded.points}
              analysis={sharedAnalysis}
              analysisPending={analysisState.status === 'pending'}
              iconOnly
            />
            <SaveWorkoutRouteButton route={saveRoute} iconOnly />
          </View>
        )}
        {bare ? null : <SaveWorkoutRouteNotice route={saveRoute} />}
        <CloudWorkoutLine start={workout.start} />
      </Card>

      {loaded.strength ? <StrengthDetailSection strength={loaded.strength} catalog={catalog} /> : null}

      {analysisState.status === 'ready' ? (
        rideData.ride !== null ? (
          <RideAnalysisView
            analysis={analysisState.shown}
            route={analysisState.route}
            ride={rideData.ride}
            palette={palette}
            t={analysisT}
            mapTheme={mapTheme}
            onScrubActive={setScrubbing}
            ftp={rideData.ftp}
            weightKg={rideData.weightKg}
            allTime={rideData.allTime}
            records={rideData.records}
            onUseFtp={rideData.setFtpAndRefresh}
          />
        ) : rideInput !== null && rideData.error === null ? (
          <Skeleton width="100%" height={320} radius="card" />
        ) : (
          <>
            {rideData.error !== null ? <Notice tone="danger">{t('detail.errors.analysis', { message: rideData.error })}</Notice> : null}
            <WorkoutAnalysisView
              analysis={analysisState.shown}
              route={analysisState.route}
              palette={palette}
              t={analysisT}
              mapTheme={mapTheme}
              onScrubActive={setScrubbing}
              extraStats={stepStats}
              omitFuel={burn !== null}
              omitLoadExtras={effectShown}
            />
          </>
        )
      ) : analysisState.status === 'error' ? (
        <Notice tone="danger">{t('detail.errors.analysis', { message: analysisState.message })}</Notice>
      ) : analysisState.status === 'none' ? null : (
        <Skeleton width="100%" height={320} radius="card" />
      )}
      {summary.gps === 'failed' ? <Notice icon="location-outline">{t('detail.gpsFailed')}</Notice> : null}
      {kind === 'run' || kind === 'walk' ? (
        <>
          <RefetchDynamicsAction
            start={workout.start}
            sportName={workout.sportName}
            summary={summary}
            onChanged={() => void refreshSummary()}
          />
          <RunningDynamicsSection summary={summary} />
        </>
      ) : null}
      <CoachFeedbackSection workoutStart={workout.start} analysis={sharedAnalysis} />

      {effectShown ? (
        <Section title={t('detail.effect.title')} icon="fitness" tint="workouts">
          {effect.aerobic ? (
            <KeyValue
              icon="fitness-outline"
              label={t('detail.effect.aerobic')}
              value={t('detail.effect.valueWord', { value: fmtDecimal(effect.aerobic.value, 1), word: effectWord(effect.aerobic.value), source: sourceLabel(effect.aerobic.source) })}
            />
          ) : null}
          {effect.anaerobic ? (
            <KeyValue
              icon="fitness-outline"
              label={t('detail.effect.anaerobic')}
              value={t('detail.effect.valueWord', { value: fmtDecimal(effect.anaerobic.value, 1), word: effectWord(effect.anaerobic.value), source: sourceLabel('watch') })}
            />
          ) : null}
          {effect.points !== null ? (
            <KeyValue icon="ribbon-outline" label={t('detail.effect.points')} value={t('detail.effect.valueSource', { value: fmtInt(effect.points), source: sourceLabel('watch') })} />
          ) : null}
          {effect.load !== null ? (
            <KeyValue icon="barbell-outline" label={t('detail.effect.watchLoad')} value={t('detail.effect.valueSource', { value: fmtInt(effect.load), source: sourceLabel('watch') })} />
          ) : null}
          {summary.recoveryHours !== undefined && summary.recoveryHours > 0 ? (
            <KeyValue
              icon="bed-outline"
              label={t('detail.effect.recovery')}
              value={t('detail.effect.recoveryValue', { count: Math.round(summary.recoveryHours), value: fmtInt(summary.recoveryHours), source: sourceLabel('watch') })}
            />
          ) : null}
          {vo2 !== null ? (
            <KeyValue icon="pulse-outline" label={t('detail.effect.vo2max')} value={t('detail.effect.vo2Value', { value: vo2, source: sourceLabel('watch') })} />
          ) : null}
          <Details title={t('detail.effect.how')}>
            {t(effect.aerobic?.source === 'estimate' ? 'detail.effect.explainEstimate' : 'detail.effect.explainWatch')}
          </Details>
        </Section>
      ) : null}

      {burn ? (
        <Section title={t('detail.burn.title')} icon="flame" tint="workouts">
          <View style={styles.tiles}>
            <BurnFigure label={t('detail.burn.fat')} grams={burn.fatGrams} color={colors.workoutsText} />
            <BurnFigure label={t('detail.burn.carbs')} grams={burn.carbGrams} color={colors.stepsText} />
          </View>
          <FuelBar fatShare={burn.fatShare} />
          {burn.zones.map((z) => {
            const zoneName = z.zone === 0 ? t('detail.burn.below') : hrZoneName(zones.method, z.zone);
            return (
              <KeyValue
                key={z.zone}
                label={z.zone === 0 ? zoneName : t('detail.burn.zoneRow', { zone: z.zone, label: zoneName })}
                value={t('detail.burn.grams', { fat: grams(z.fatGrams), carbs: grams(z.carbGrams) })}
              />
            );
          })}
          <Details title={t('detail.burn.how')}>{t('detail.burn.explain', { kcal: formatCount(workout.calories), maxHr: zones.maxHr })}</Details>
        </Section>
      ) : null}

      <GearWorkoutSection workout={workout} />
      <WorkoutExportRow exporter={exporter} onOpen={() => setExportOpen(true)} />
      <StravaWorkoutSection workout={workout} />

      <Section title={t('detail.more.title')} icon="list">
        {recordedBy !== null ? <KeyValue icon="watch-outline" label={t('detail.more.recordedBy')} value={recordedBy} /> : null}
        {summary.source === 'phone' ? (
          <>
            <KeyValue icon="phone-portrait-outline" label={t('detail.more.recordedBy')} value={t('detail.more.phone')} />
            {loaded.sensors.map((sensor) => {
              const name = roleText(sensor.kinds) === '' ? sensor.name : `${sensor.name} (${roleText(sensor.kinds)})`;
              const silent = summary.sensors?.find((s) => s.id === sensor.id)?.frames === 0;
              return (
                <KeyValue
                  key={sensor.id}
                  icon="bluetooth-outline"
                  label={t('detail.more.sensor')}
                  value={silent ? `${name} · ${t('detail.more.sensorSilent')}` : name}
                />
              );
            })}
            {(summary.sensors ?? []).map((sensor) =>
              sensor.frames === 0 && (sensor.kinds.includes('csc') || sensor.kinds.includes('power')) ? (
                <Notice key={`${sensor.id}-silent`} icon="bluetooth">
                  {t('detail.more.sensorNoDataNotice', { name: sensor.name })}
                </Notice>
              ) : sensor.mode === 'speed' && sensor.kinds.includes('csc') ? (
                <Notice key={`${sensor.id}-speed`} icon="speedometer-outline">
                  {t('detail.more.sensorSpeedNotice', { name: sensor.name })}
                </Notice>
              ) : null,
            )}
          </>
        ) : null}
        {paceRows(kind, summary, workout.distance, times.movingSec).map((row) => (
          <KeyValue key={row.key} icon="speedometer-outline" label={row.label} value={row.value} />
        ))}
        {summary.minHr !== undefined ? (
          <KeyValue icon="heart-outline" label={t('detail.more.lowestHr')} value={`${summary.minHr} ${t('detail.unit.bpm')}`} />
        ) : null}
        {summary.maxAltitude !== undefined ? (
          <KeyValue icon="chevron-up-circle-outline" label={t('detail.more.highest')} value={metres(summary.maxAltitude)} />
        ) : null}
        {summary.minAltitude !== undefined ? (
          <KeyValue icon="chevron-down-circle-outline" label={t('detail.more.lowest')} value={metres(summary.minAltitude)} />
        ) : null}
        {summary.maxPower !== undefined ? (
          <KeyValue icon="flash-outline" label={t('detail.more.peakPower')} value={`${fmtInt(summary.maxPower)} ${t('analysis.unit.w')}`} />
        ) : null}
        {summary.maxDepth !== undefined ? (
          <KeyValue icon="water-outline" label={t('detail.more.maxDepth')} value={metres(summary.maxDepth)} />
        ) : null}
        {summary.importedFrom !== undefined ? (
          <Notice icon="document-outline">
            {t('detail.more.imported', { brand: summary.importedFrom, health: isIos ? t('detail.more.healthIos') : t('detail.more.healthAndroid') })}
          </Notice>
        ) : null}
        {summary.source === 'phone' && summary.kcalSource !== undefined ? (
          <Notice icon="flame-outline">{t(summary.kcalSource === 'hr' ? 'detail.more.kcalHr' : 'detail.more.kcalMet')}</Notice>
        ) : null}
        {!workout.complete ? <Notice icon="cloud-download-outline">{t('detail.more.partial')}</Notice> : null}
        {summary.missingData ? <Notice>{t('detail.more.missing')}</Notice> : null}
      </Section>

      {swimRows.length > 0 ? (
        <Section title={t('detail.swim.title')} icon="water" tint="workouts">
          {swimRows.map((row) => (
            <KeyValue key={row.key} label={row.label} value={row.value} />
          ))}
        </Section>
      ) : null}
      {toast}
    </Screen>
  );
}

/** A small label over one summary number. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.figure}>
      <AppText variant="label" muted>
        {label}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryTitle: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shareMain: { flex: 1 },
  figures: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.sm },
  figure: { gap: 0, minWidth: '30%' },
  tiles: { flexDirection: 'row', gap: spacing.md },
});
