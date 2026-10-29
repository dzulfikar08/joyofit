import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Chip } from '@/components/Chip';
import { Details } from '@/components/Details';
import { Divider, Screen, Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useToast } from '@/components/Toast';
import { showsWatchUi } from '@/features/device/presence';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { listWorkoutPoints, listWorkoutsSince } from '@/db/queries';
import { useLactateTest } from '@/features/lactate/lactate';
import { isRunSport, lthrFromHardestRun, RUN_LOOKBACK_DAYS, type HardestRunInput } from '@/features/lactate/fromHardestRun';
import { watchLactate, type LactateValue } from '@/features/lactate/values';
import { parseSummary } from '@/features/workouts/summary';
import { useAnalysisPalette } from '@/features/workouts/analysis/palette';
import { hrZoneColor } from '@/features/workouts/analysis/ui';
import { fmtDate, fmtInt } from '@/i18n';
import { spacing } from '@/theme';
import { hasNative, HuaweiWear } from '@/wear';

import { getHrZoneSettings, saveHrZoneSettings, userAge, type WatchZonesOutcome } from '../settings';
import { loadZoneSuggestion } from '../suggest';
import {
  DEFAULT_HR_ZONE_SETTINGS,
  MAX_HR_MAX,
  MAX_HR_MIN,
  REST_HR_GAP,
  REST_HR_MAX,
  REST_HR_MIN,
  LTHR_MIN,
  WARNING_MIN,
  ZONE_NAME_KEYS,
  estimateLthr,
  clampRest,
  maxHrFromAge,
  maxHrTanaka,
  moveLimit,
  resolveHrZones,
  sameSettings,
  type HrZoneMethod,
  type HrZoneSettings,
  type HrZoneSuggestion,
} from '../zones';
import { BpmStepper } from './BpmStepper';
import { ValueRow } from './ValueRow';
import { ZoneBand } from './ZoneBand';
import { ZoneTable } from './ZoneTable';
import { OPEN_IN_STACK } from '@/components/navigation';

const WATCH_LTHR_DAYS = 120;

/** The lactate thresholds worth offering: the saved time trial and the newest one the watch sent with a workout. */
function useLthrSources(): { test: LactateValue | null; watch: LactateValue | null } {
  const db = useSQLiteContext();
  const test = useLactateTest();
  const [watch, setWatch] = useState<LactateValue | null>(null);
  useEffect(() => {
    let cancelled = false;
    const nowSec = Math.floor(Date.now() / 1000);
    listWorkoutsSince(db, nowSec - WATCH_LTHR_DAYS * 86_400, nowSec + 60, -1).then(
      (rows) => {
        if (!cancelled) setWatch(watchLactate(rows.map(({ workout, summaryJson }) => ({ workout, summary: parseSummary(summaryJson) }))));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [db]);
  return { test, watch };
}

/** The heart-rate points of the runs of the last 6 weeks, for the estimate "from your hardest run"; null until they are read. */
function useRecentRuns(): HardestRunInput[] | null {
  const db = useSQLiteContext();
  const [runs, setRuns] = useState<HardestRunInput[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const nowSec = Math.floor(Date.now() / 1000);
    (async () => {
      const rows = await listWorkoutsSince(db, nowSec - RUN_LOOKBACK_DAYS * 86_400, nowSec + 60, -1);
      const loaded: HardestRunInput[] = [];
      for (const { workout } of rows) {
        if (!isRunSport(workout.sportType)) continue;
        loaded.push({ workoutId: workout.id, start: workout.start, sportType: workout.sportType, points: await listWorkoutPoints(db, workout.id) });
      }
      if (!cancelled) setRuns(loaded);
    })().catch(() => {
      if (!cancelled) setRuns([]);
    });
    return () => {
      cancelled = true;
    };
  }, [db]);
  return runs;
}

type Suggestion = { status: 'idle' } | { status: 'loading' } | { status: 'done'; value: HrZoneSuggestion } | { status: 'failed' };

/** Which plain row has its editor open: one at a time. */
type OpenRow = 'max' | 'rest' | 'lthr' | 'alert';

/** A finding of "Hitung dari data": a title, one line under it and the button that uses it. */
function FoundRow({ title, caption, children }: { title: string; caption: string; children?: React.ReactNode }) {
  return (
    <View style={styles.found}>
      <View style={styles.foundText}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" muted>
          {caption}
        </AppText>
      </View>
      {children}
    </View>
  );
}

/**
 * Settings > Zona HR, laid out like Huawei Health's own: the method tabs, the maximum and resting heart rate as plain rows, one band that
 * shows where the zones sit, and the zones with their boundaries as editable boxes (bpm and percent). Then the watch's heart-rate limit
 * alert. The draft is applied with "Simpan": every screen that shows zones follows, and the zones go to the watch (docs/hr-zones.md).
 */
export function HrZonesSettings() {
  const { t } = useTranslation('settings');
  const router = useRouter();
  const db = useSQLiteContext();
  const palette = useAnalysisPalette();
  const presence = useWatchPresence();
  const { toast, show } = useToast();
  const recentRuns = useRecentRuns();
  const withWatch = presence === null || showsWatchUi(presence);

  const [stored, setStored] = useState(getHrZoneSettings);
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion>({ status: 'idle' });
  const [open, setOpen] = useState<OpenRow | null>(null);
  const [age] = useState(userAge);
  const hasProfile = useMemo(() => (HuaweiWear.getUserProfile()?.birthYear ?? 0) > 0, []);

  const zones = useMemo(() => resolveHrZones(draft, age), [draft, age]);
  const runsLoaded = recentRuns !== null;
  // The clock is read once on mount: the lookback only needs to be right to within a screen visit.
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000));
  const hardestRun = useMemo(
    () => (recentRuns ? lthrFromHardestRun(recentRuns, zones.maxHr, nowSec) : null),
    [recentRuns, zones.maxHr, nowSec],
  );
  const measured = useLthrSources();
  const dirty = !sameSettings(draft, stored);
  const isDefault = sameSettings(draft, DEFAULT_HR_ZONE_SETTINGS);
  const formulaMax = maxHrFromAge(age);
  const tanakaMax = maxHrTanaka(age);
  const restMax = Math.min(REST_HR_MAX, zones.maxHr - REST_HR_GAP);
  const showRest = draft.method === 'hrr' || (draft.method === 'lthr' && draft.lthr === null);
  const toggle = (row: OpenRow) => setOpen((current) => (current === row ? null : row));

  const edit = (patch: Partial<HrZoneSettings>) => setDraft((current) => ({ ...current, ...patch }));
  // Editing the maximum, the resting rate or the method derives the limits again: hand-edited limits belong to the numbers they were set against.
  const setMethod = (method: HrZoneMethod) => {
    setOpen(null);
    edit({ method, limits: null });
  };
  const setMaxHr = (maxHr: number | null) => edit({ maxHr, limits: null, restingHr: draft.restingHr === null ? null : clampRest(draft.restingHr, maxHr ?? formulaMax) });
  const setRestingHr = (restingHr: number) => edit({ restingHr, limits: draft.method === 'max' ? draft.limits : null });
  const setLthr = (lthr: number | null) => edit({ lthr, limits: null });
  const setLimit = (index: number, value: number) => edit({ limits: moveLimit(zones.limits, index, value, zones.maxHr) });

  const outcomeText = (outcome: WatchZonesOutcome): string => {
    if (outcome === 'sent') return t('hrZones.saved.sent');
    if (outcome === 'unsupported') return t('hrZones.saved.unsupported');
    if (outcome === 'failed') return t('hrZones.saved.failed');
    return hasNative('getHeartRateZonesStatus') && HuaweiWear.getHeartRateZonesStatus().via === 'none' ? t('hrZones.saved.none') : t('hrZones.saved.stored');
  };

  const save = async () => {
    setSaving(true);
    try {
      const next: HrZoneSettings = { ...draft, limits: zones.custom ? [...zones.limits] : null };
      const outcome = await saveHrZoneSettings(next);
      setStored(next);
      setDraft(next);
      show(outcomeText(outcome));
    } finally {
      setSaving(false);
    }
  };

  const calculate = async () => {
    setSuggestion({ status: 'loading' });
    try {
      setSuggestion({ status: 'done', value: await loadZoneSuggestion(db, age) });
    } catch {
      setSuggestion({ status: 'failed' });
    }
  };

  const watchNote = (): string | null => {
    if (!withWatch) return null;
    if (!hasNative('getHeartRateZonesStatus')) return t('hrZones.watch.noNative');
    const { via } = HuaweiWear.getHeartRateZonesStatus();
    if (via === null) return t('hrZones.watch.offline');
    return via === 'none' ? t('hrZones.watch.none') : t('hrZones.watch.ok');
  };
  const note = watchNote();
  const found = suggestion.status === 'done' ? suggestion.value : null;
  const unit = t('hrZones.unit');
  const names = ZONE_NAME_KEYS[zones.method].map((key) => t(`hrZones.zones.names.${key}`));
  const methodBody = t(draft.method === 'max' ? 'hrZones.method.maxBody' : draft.method === 'hrr' ? 'hrZones.method.hrrBody' : 'hrZones.method.lthrBody');

  const stepper = (label: string, value: number, min: number, max: number, onChange: (value: number) => void) => (
    <BpmStepper label={label} lessLabel={t('hrZones.less')} moreLabel={t('hrZones.more')} value={value} min={min} max={max} onChange={onChange} />
  );

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <ButtonRow>
            <Button label={t('hrZones.reset')} variant="secondary" icon="refresh" disabled={isDefault || saving} onPress={() => setDraft(DEFAULT_HR_ZONE_SETTINGS)} />
            <Button label={t('hrZones.save')} variant="primary" icon="checkmark" disabled={!dirty} loading={saving} onPress={() => void save()} />
          </ButtonRow>
        </View>
      }>
      <Section title={t('hrZones.method.title')} icon="pulse" tint="heart">
        <Segmented
          value={draft.method}
          onChange={setMethod}
          options={[
            { value: 'max', label: t('hrZones.method.max') },
            { value: 'hrr', label: t('hrZones.method.hrr') },
            { value: 'lthr', label: t('hrZones.method.lthr') },
          ]}
        />
        <Details title={t('hrZones.method.how')}>
          <AppText variant="caption" muted>
            {methodBody}
          </AppText>
          {draft.method === 'lthr' ? (
            <AppText variant="caption" muted>
              {t('hrZones.lthr.details')}
            </AppText>
          ) : null}
          <AppText variant="caption" muted>
            {t('hrZones.rates.details', { max: fmtInt(MAX_HR_MAX), restMin: fmtInt(REST_HR_MIN), restMax: fmtInt(REST_HR_MAX), gap: fmtInt(REST_HR_GAP) })}
          </AppText>
        </Details>
      </Section>

      <Section title={t('hrZones.zones.title')} icon="stats-chart">
        <ValueRow title={t('hrZones.rates.max')} value={fmtInt(zones.maxHr)} unit={unit} open={open === 'max'} onPress={() => toggle('max')}>
          <AppText variant="caption" muted>
            {draft.maxHr === null ? t('hrZones.rates.maxFromAge', { age: fmtInt(age) }) : t('hrZones.rates.maxSet')}
          </AppText>
          {stepper(t('hrZones.rates.max'), zones.maxHr, MAX_HR_MIN, MAX_HR_MAX, setMaxHr)}
          <View style={styles.chips}>
            <Chip label={t('hrZones.rates.formulaClassic', { bpm: fmtInt(formulaMax) })} selected={draft.maxHr === null} onPress={() => setMaxHr(null)} />
            <Chip label={t('hrZones.rates.formulaTanaka', { bpm: fmtInt(tanakaMax) })} selected={draft.maxHr === tanakaMax} onPress={() => setMaxHr(tanakaMax)} />
          </View>
        </ValueRow>
        {!hasProfile && draft.maxHr === null ? (
          <Notice icon="person-outline" action={{ label: t('hrZones.rates.openProfile'), onPress: () => router.push('/settings/profile', OPEN_IN_STACK) }}>
            {t('hrZones.rates.noProfile', { age: fmtInt(age) })}
          </Notice>
        ) : null}
        {showRest ? (
          <>
            <Divider />
            <ValueRow title={t('hrZones.rates.rest')} value={fmtInt(zones.restingHr)} unit={unit} open={open === 'rest'} onPress={() => toggle('rest')}>
              <AppText variant="caption" muted>
                {draft.restingHr === null ? t('hrZones.rates.restDefault') : t('hrZones.rates.restSet')}
              </AppText>
              {stepper(t('hrZones.rates.rest'), zones.restingHr, REST_HR_MIN, restMax, setRestingHr)}
            </ValueRow>
          </>
        ) : null}
        {draft.method === 'lthr' && zones.lthr !== null ? (
          <>
            <Divider />
            <ValueRow title={t('hrZones.lthr.label')} value={fmtInt(zones.lthr)} unit={unit} open={open === 'lthr'} onPress={() => toggle('lthr')}>
              <AppText variant="caption" muted>
                {draft.lthr === null ? t('hrZones.lthr.estimate') : t('hrZones.lthr.set')}
              </AppText>
              {stepper(t('hrZones.lthr.label'), zones.lthr, LTHR_MIN, zones.maxHr - 1, setLthr)}
              <View style={styles.chips}>
                {measured.test ? <Chip label={t('hrZones.lthr.fromTest', { bpm: fmtInt(measured.test.lthr) })} selected={draft.lthr === measured.test.lthr} onPress={() => setLthr(measured.test!.lthr)} /> : null}
                {measured.watch ? <Chip label={t('hrZones.lthr.fromWatch', { bpm: fmtInt(measured.watch.lthr) })} selected={draft.lthr === measured.watch.lthr} onPress={() => setLthr(measured.watch!.lthr)} /> : null}
                {hardestRun ? <Chip label={t('hrZones.lthr.fromRun', { bpm: fmtInt(hardestRun.lthr) })} selected={draft.lthr === hardestRun.lthr} onPress={() => setLthr(hardestRun.lthr)} /> : null}
                <Chip label={t('hrZones.lthr.estimateChip', { bpm: fmtInt(estimateLthr(zones.maxHr, zones.restingHr)) })} selected={draft.lthr === null} onPress={() => setLthr(null)} />
              </View>
              {hardestRun && draft.lthr === hardestRun.lthr ? (
                <AppText variant="caption" muted>
                  {t('hrZones.lthr.fromRunNote', { date: fmtDate(hardestRun.at, 'short') })}
                </AppText>
              ) : null}
              <Button label={t('hrZones.lthr.runTest')} variant="secondary" icon="speedometer" onPress={() => router.push('/lactate-test')} />
            </ValueRow>
          </>
        ) : null}

        <View style={styles.band}>
          <ZoneBand zones={zones} colorOf={(zone) => hrZoneColor(palette, zone + 1)} />
        </View>
        <ZoneTable zones={zones} names={names} colorOf={(zone) => hrZoneColor(palette, zone + 1)} onLimit={setLimit} />
        {zones.custom ? (
          <Notice icon="create-outline" action={{ label: t('hrZones.zones.resetLimits'), onPress: () => edit({ limits: null }) }}>
            {t('hrZones.zones.custom')}
          </Notice>
        ) : null}
        <AppText variant="caption" muted>
          {t('hrZones.zones.scope')}
        </AppText>
        <Details>{t('hrZones.zones.details')}</Details>
      </Section>

      {withWatch ? (
        <Section title={t('hrZones.alert.title')} icon="alert-circle">
          <SwitchRow label={t('hrZones.alert.switch')} hint={t('hrZones.alert.hint')} value={draft.warningEnabled} onValueChange={(warningEnabled) => edit({ warningEnabled })} />
          {draft.warningEnabled ? (
            <>
              <Divider />
              <ValueRow title={t('hrZones.alert.limit')} value={fmtInt(zones.warningLimit)} unit={unit} open={open === 'alert'} onPress={() => toggle('alert')}>
                {draft.warningLimit === null ? (
                  <AppText variant="caption" muted>
                    {t('hrZones.alert.limitMax')}
                  </AppText>
                ) : null}
                {stepper(t('hrZones.alert.limit'), zones.warningLimit, WARNING_MIN, MAX_HR_MAX, (warningLimit) => edit({ warningLimit }))}
              </ValueRow>
            </>
          ) : null}
        </Section>
      ) : null}

      <Section title={t('hrZones.suggest.title')} icon="analytics">
        <AppText variant="caption" muted>
          {t('hrZones.suggest.body')}
        </AppText>
        <Button
          label={t('hrZones.suggest.action')}
          variant="secondary"
          icon="calculator-outline"
          loading={suggestion.status === 'loading'}
          onPress={() => void calculate()}
        />
        {suggestion.status === 'failed' ? <Notice tone="danger">{t('hrZones.suggest.failed')}</Notice> : null}
        {/* The hardest-run LTHR is offered here too, whatever the method: the chips above only show under LTHR. */}
        {hardestRun ? (
          <FoundRow title={t('hrZones.suggest.lthrRun', { bpm: fmtInt(hardestRun.lthr) })} caption={t('hrZones.suggest.lthrRunBody', { date: fmtDate(hardestRun.at, 'short') })}>
            {draft.method === 'lthr' && draft.lthr === hardestRun.lthr ? null : (
              <Button
                label={t('hrZones.suggest.useLthr')}
                variant="primary"
                onPress={() => {
                  setOpen(null);
                  edit({ method: 'lthr', lthr: hardestRun.lthr, limits: null });
                }}
              />
            )}
          </FoundRow>
        ) : runsLoaded ? (
          <AppText variant="caption" muted>
            {t('hrZones.suggest.lthrRunNone')}
          </AppText>
        ) : null}
        {found ? (
          <>
            {found.peak === null && found.restingHr === null ? <Notice>{t('hrZones.suggest.nothing')}</Notice> : null}
            {found.peak !== null ? (
              <FoundRow
                title={t('hrZones.suggest.peak', { bpm: fmtInt(found.peak) })}
                caption={found.maxHr === null ? t('hrZones.suggest.peakBelow', { bpm: fmtInt(formulaMax) }) : t('hrZones.suggest.peakAbove', { bpm: fmtInt(formulaMax) })}>
                {found.maxHr !== null ? <Button label={t('hrZones.suggest.useMax')} variant="primary" onPress={() => setMaxHr(found.maxHr)} /> : null}
              </FoundRow>
            ) : null}
            {found.restingHr !== null ? (
              <FoundRow title={t('hrZones.suggest.rest', { bpm: fmtInt(found.restingHr) })} caption={t('hrZones.suggest.restBody')}>
                <Button label={t('hrZones.suggest.useRest')} variant="primary" onPress={() => setRestingHr(clampRest(found.restingHr ?? 0, zones.maxHr))} />
              </FoundRow>
            ) : null}
          </>
        ) : null}
      </Section>

      {note ? <Notice icon="watch-outline">{note}</Notice> : null}
      {toast}
    </Screen>
  );
}

const styles = StyleSheet.create({
  found: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56 },
  foundText: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  band: { paddingTop: spacing.xs },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
});
