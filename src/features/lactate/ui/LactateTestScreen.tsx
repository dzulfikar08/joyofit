import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { KeyValue } from '@/components/KeyValue';
import { Metric } from '@/components/Metric';
import { PressableScale } from '@/components/PressableScale';
import { Divider, Screen, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useToast } from '@/components/Toast';
import { listWorkoutPoints, listWorkoutsSince, type WorkoutPointRow, type WorkoutRow } from '@/db/queries';
import { getHrZoneSettings, saveHrZoneSettings, useHrZones } from '@/features/hrzones/settings';
import { sportKind } from '@/features/workouts/analysis/sport';
import { formatDuration, formatPace } from '@/features/workouts/analysis/types';
import { parseSummary } from '@/features/workouts/summary';
import { useNow } from '@/hooks/useNow';
import { fmtDate, fmtInt, useTranslation } from '@/i18n';
import { radius, spacing, useColors, useTheme } from '@/theme';

import { guideState, type Guide } from '../guide';
import { getGuide, startGuide, stopGuide } from '../guideStore';
import { clearLactateTest, saveLactateTest, useLactateTest } from '../lactate';
import { analyseTrial, BLOCKING, EFFORT_SEC, findEffortStart, WARNING_PROBLEMS, type TrialProblem } from '../trial';
import { OPEN_IN_STACK } from '@/components/navigation';

/** Only runs that can hold the 30 minutes (with a minute to spare) are offered. */
const MIN_RUN_SEC = 31 * 60;
const LOOKBACK_DAYS = 30;

const PROBLEM_ORDER: readonly TrialProblem[] = [...BLOCKING, ...WARNING_PROBLEMS];

/** Where the effort most likely started inside the workout: the guide's time when the workout holds it, else the hardest 30 minutes. */
function baseStart(points: readonly WorkoutPointRow[], guide: Guide | null): { start: number; from: 'guide' | 'auto' } | null {
  if (guide) {
    // The effort window depends only on when the guide started, not on the clock.
    const { effortStart, effortEnd } = guideState(guide, guide.startedAt);
    const first = points[0]?.ts;
    const last = points[points.length - 1]?.ts;
    if (first !== undefined && last !== undefined && first <= effortStart + 30 && last >= effortEnd - 60) return { start: effortStart, from: 'guide' };
  }
  const found = findEffortStart(points);
  return found === null ? null : { start: found, from: 'auto' };
}

/**
 * Tes ambang laktat: the guide of Friel's 30-minute time trial (phases and cues; the run itself is recorded by the watch or JoyoFit's recorder)
 * and the analysis of the recorded run into an LTHR and a threshold pace, with the checks that say whether to trust it. The result is kept, shown in
 * Kebugaran and can become the base of the heart-rate zones (Zona HR > LTHR). Never derived from a personal best.
 */
export function LactateTestScreen() {
  const { t } = useTranslation('health');
  const router = useRouter();
  const db = useSQLiteContext();
  const colors = useColors();
  const { radius: shape } = useTheme();
  const zones = useHrZones();
  const saved = useLactateTest();
  const { toast, show } = useToast();
  const [guide, setGuide] = useState<Guide | null>(() => getGuide());
  const now = useNow(guide ? 1000 : 60_000);
  const [cues, setCues] = useState(true);
  const [runs, setRuns] = useState<WorkoutRow[] | null>(null);
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [points, setPoints] = useState<WorkoutPointRow[] | null>(null);
  const [shiftMin, setShiftMin] = useState(0);
  const [stored, setStored] = useState(false);

  const state = guide ? guideState(guide, now) : null;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const nowSec = Math.floor(Date.now() / 1000);
      listWorkoutsSince(db, nowSec - LOOKBACK_DAYS * 86_400, nowSec + 60, -1).then(
        (rows) => {
          if (cancelled) return;
          setRuns(rows.filter(({ workout, summaryJson }) => workout.duration >= MIN_RUN_SEC && sportKind(workout.sportName, parseSummary(summaryJson).kind) === 'run').map(({ workout }) => workout));
        },
        () => {
          if (!cancelled) setRuns([]);
        },
      );
      return () => {
        cancelled = true;
      };
    }, [db]),
  );

  // When the guide ran, the run that holds its effort is the likely one.
  const guideMatchId = useMemo(() => {
    if (!guide || !runs) return null;
    const { effortStart, effortEnd } = guideState(guide, guide.startedAt);
    return runs.find((r) => r.start <= effortStart + 30 && r.end >= effortEnd - 60)?.id ?? null;
  }, [runs, guide]);
  if (pickedId === null && guideMatchId !== null) setPickedId(guideMatchId);

  // A new pick starts from a clean slate while its points load.
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  if (loadedFor !== pickedId) {
    setLoadedFor(pickedId);
    setPoints(null);
    setShiftMin(0);
    setStored(false);
  }

  useEffect(() => {
    if (pickedId === null) return;
    let cancelled = false;
    listWorkoutPoints(db, pickedId).then(
      (rows) => {
        if (!cancelled) setPoints(rows);
      },
      () => {
        if (!cancelled) setPoints([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, pickedId]);

  const base = useMemo(() => (points ? baseStart(points, guide) : null), [points, guide]);
  const trial = useMemo(() => (points && base ? analyseTrial(points, base.start + shiftMin * 60, zones.maxHr) : null), [points, base, shiftMin, zones.maxHr]);
  const picked = runs?.find((r) => r.id === pickedId) ?? null;

  const begin = async () => {
    setGuide({ startedAt: Date.now() });
    setCues(await startGuide());
  };
  const cancel = async () => {
    setGuide(null);
    await stopGuide();
  };

  const save = () => {
    if (!trial || trial.lthr === null || !picked) return;
    saveLactateTest({ lthr: trial.lthr, paceSecKm: trial.paceSecKm, at: trial.start, workoutId: picked.id });
    setStored(true);
    show(t('lactate.result.saved'));
  };

  const applyToZones = async () => {
    if (!trial || trial.lthr === null) return;
    const outcome = await saveHrZoneSettings({ ...getHrZoneSettings(), method: 'lthr', lthr: trial.lthr, limits: null });
    show(outcome === 'failed' ? t('lactate.result.zonesFailed') : t('lactate.result.zonesDone', { lthr: fmtInt(trial.lthr) }));
  };

  const say = state ? t(state.phase === 'effort' ? (state.measuring ? 'lactate.say.measure' : 'lactate.say.settle') : (`lactate.say.${state.phase}` as 'lactate.say.done')) : '';
  const elapsed = state && state.lengthSec > 0 ? 1 - state.leftSec / state.lengthSec : 1;

  return (
    <Screen>
      <HiddenTabHeader title={t('lactate.title')} />

      <Section title={t('lactate.title')} icon="speedometer" tint="heart">
        <AppText variant="body">{t('lactate.intro')}</AppText>
        <Details title={t('lactate.how.title')}>{t('lactate.how.body')}</Details>

        {state && state.phase !== 'done' ? (
          <View style={styles.block} accessibilityLiveRegion="polite">
            <AppText variant="label" muted>
              {t(`lactate.phase.${state.phase}`)}
            </AppText>
            <Metric value={formatDuration(state.leftSec)} unit={t('lactate.phase.left')} size="lg" color={colors.heartText} />
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(elapsed * 100) }}
              style={[styles.track, { backgroundColor: colors.muted }]}>
              <View style={[styles.fill, { width: `${elapsed * 100}%`, backgroundColor: colors.heart }]} />
            </View>
            <AppText variant="body">{say}</AppText>
            {!cues ? <Notice icon="notifications-off-outline">{t('lactate.noCues')}</Notice> : null}
            <ButtonRow>
              <Button label={t('lactate.record')} variant="secondary" icon="radio-button-on" onPress={() => router.push('/workouts/record', OPEN_IN_STACK)} />
              <Button label={t('lactate.cancel')} variant="ghost" onPress={() => void cancel()} />
            </ButtonRow>
          </View>
        ) : (
          <View style={styles.block}>
            {state ? <AppText variant="body">{say}</AppText> : null}
            <Button label={t('lactate.start')} variant={state ? 'secondary' : 'primary'} icon="play" onPress={() => void begin()} />
          </View>
        )}
      </Section>

      <Section title={t('lactate.result.title')} icon="analytics" tint="heart">
        {runs === null ? null : runs.length === 0 ? (
          <AppText variant="body" muted>
            {t('lactate.result.none')}
          </AppText>
        ) : (
          <>
            <AppText variant="caption" muted>
              {t('lactate.result.pick')}
            </AppText>
            {runs.slice(0, 8).map((run, i) => (
              <View key={run.id}>
                {i > 0 ? <Divider /> : null}
                <PressableScale
                  accessibilityRole="radio"
                  accessibilityState={{ selected: run.id === pickedId }}
                  onPress={() => setPickedId(run.id)}
                  style={[styles.run, { borderRadius: shape.control }, run.id === pickedId ? { backgroundColor: colors.heartSoft } : null]}>
                  <AppText variant={run.id === pickedId ? 'bodyStrong' : 'body'}>{t('lactate.result.runRow', { date: fmtDate(run.start, 'weekday'), duration: formatDuration(run.duration) })}</AppText>
                </PressableScale>
              </View>
            ))}
          </>
        )}

        {pickedId !== null && points === null ? (
          <AppText variant="caption" muted>
            {t('lactate.result.loading')}
          </AppText>
        ) : null}

        {picked && points && base === null ? <Notice tone="danger">{t('lactate.problem.tooShort')}</Notice> : null}

        {picked && trial && base ? (
          <View style={styles.block}>
            <AppText variant="caption" muted>
              {t('lactate.result.start', { minute: fmtInt(Math.max(0, Math.round((trial.start - picked.start) / 60))) })} · {t(base.from === 'guide' ? 'lactate.result.startGuide' : 'lactate.result.startAuto')}
            </AppText>
            <ButtonRow>
              <Button label={t('lactate.result.earlier')} variant="ghost" icon="remove" onPress={() => setShiftMin((m) => m - 1)} />
              <Button label={t('lactate.result.later')} variant="ghost" icon="add" onPress={() => setShiftMin((m) => m + 1)} />
            </ButtonRow>

            {trial.lthr !== null ? (
              <View style={styles.figures}>
                <View style={styles.figure}>
                  <AppText variant="caption" muted>
                    {t('lactate.result.lthr')}
                  </AppText>
                  <Metric value={fmtInt(trial.lthr)} unit={t('lactate.unit.bpm')} size="lg" color={colors.heartText} />
                </View>
                {trial.paceSecKm !== null ? (
                  <View style={styles.figure}>
                    <AppText variant="caption" muted>
                      {t('lactate.result.pace')}
                    </AppText>
                    <Metric value={formatPace(trial.paceSecKm)} unit={t('lactate.unit.pace')} size="lg" />
                  </View>
                ) : null}
              </View>
            ) : null}
            {trial.lthr !== null && trial.paceSecKm === null ? (
              <AppText variant="caption" muted>
                {t('lactate.result.noPace')}
              </AppText>
            ) : null}
            {trial.halves ? <KeyValue label={t('lactate.result.halves', { a: fmtInt(trial.halves[0]), b: fmtInt(trial.halves[1]) })} value={null} /> : null}
            <AppText variant="caption" muted>
              {t('lactate.result.coverage', { percent: fmtInt(Math.round(trial.coverage * 100)) })}
            </AppText>
            {PROBLEM_ORDER.filter((p) => trial.problems.includes(p)).map((p) => (
              <Notice key={p} tone={BLOCKING.includes(p) ? 'danger' : 'info'}>
                {t(`lactate.problem.${p}`)}
              </Notice>
            ))}

            <ButtonRow>
              <Button label={t('lactate.result.save')} variant="primary" icon="checkmark" disabled={!trial.usable || stored} onPress={save} />
              <Button label={t('lactate.result.useZones')} variant="secondary" icon="pulse" disabled={!trial.usable} onPress={() => void applyToZones()} />
            </ButtonRow>
          </View>
        ) : null}
      </Section>

      {saved?.source === 'test' ? (
        <Section title={t('lactate.card.title')} icon="speedometer" tint="heart">
          <KeyValue label={t('lactate.card.lthr')} value={`${fmtInt(saved.lthr)} ${t('lactate.unit.bpm')}`} />
          {saved.paceSecKm !== null ? <KeyValue label={t('lactate.card.pace')} value={`${formatPace(saved.paceSecKm)} ${t('lactate.unit.pace')}`} /> : null}
          <AppText variant="caption" muted>
            {t('lactate.card.fromTest', { date: fmtDate(saved.at, 'weekday') })}
          </AppText>
          <Button label={t('lactate.clear')} variant="ghost" icon="trash-outline" onPress={clearLactateTest} />
        </Section>
      ) : null}
      {toast}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
  run: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, minHeight: 44, justifyContent: 'center' },
  figures: { flexDirection: 'row', gap: spacing.lg },
  figure: { gap: 2 },
});
