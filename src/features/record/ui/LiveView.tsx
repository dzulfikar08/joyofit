import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { StatusDot } from '@/components/StatusDot';
import { Card, Divider, Section } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { Notice } from '@/components/States';
import { averagePace, strideLength, type FieldSportKind, type RunMetricId, type RunMetricValues } from '@/features/live/runFields';
import { useTrail } from '@/features/live/trail';
import { LiveRunMap } from '@/features/live/ui/LiveRunMap';
import { MetricGrid, useFieldEditor } from '@/features/live/ui/MetricGrid';
import { useStopMetronomeOnUnmount } from '@/features/metronome/metronome';
import { MetronomeRow } from '@/features/metronome/ui/MetronomeRow';
import { kindChannels } from '@/features/sensors/store';
import { SensorLinkRow } from '@/features/sensors/ui/SensorLinkRow';
import { SPORT_ROWS, type ManualSport } from '@/features/workouts/manual';
import { sportLabel } from '@/features/workouts/sportLabel';
import { formatElapsed } from '@/features/workouts/summary';
import { fmtDistance, fmtInt } from '@/i18n';
import { useRecorder } from '@/state/RecorderProvider';
import { useSensors } from '@/state/SensorsProvider';
import { spacing, useColors } from '@/theme';

import { bandLinkLine, useBandLink } from '../bandLink';
import { lapRows, liveTiles, paceSecPerKm, sensorErrorKind, type SensorChannel } from './format';

const DASH = '--';

/** Without GPS (treadmill, indoor ride) a recording has no altitude, so these two fields are not offered. */
const NO_ALTITUDE: readonly RunMetricId[] = ['elevationGain', 'altitude'];
/** The fields the phone's step counter fills when no running pod is paired. */
const PHONE_STEP_FIELDS: readonly RunMetricId[] = ['cadence', 'steps', 'stride'];

/** The sport kind a recording's data fields are saved under (a treadmill run is a run, an indoor ride a ride). */
function fieldKind(sport: ManualSport): FieldSportKind {
  switch (sport) {
    case 'run':
    case 'treadmill':
      return 'run';
    case 'ride':
    case 'indoorRide':
      return 'ride';
    case 'walk':
    case 'hike':
      return sport;
    default:
      return 'other';
  }
}

interface LiveViewProps {
  /** The recording is being written to the database. */
  saving: boolean;
  /** Why the last save failed; the recording is still held and can be saved again. */
  saveError: string | null;
  onFinish: () => void;
  onSaveAgain: () => void;
  onDiscard: () => void;
}

/** Phases `active` and `saving`: the map when the GPS is on, the configurable data fields, the controls, the metronome and the laps. */
export function LiveView({ saving, saveError, onFinish, onSaveAgain, onDiscard }: LiveViewProps) {
  const { t } = useTranslation(['workouts', 'common']);
  const { t: tLive } = useTranslation('sharing');
  const colors = useColors();
  const { snapshot, pause, resume, lap } = useRecorder();
  const { saved } = useSensors();
  const editor = useFieldEditor();
  const trail = useTrail(snapshot.position);
  const band = useBandLink();
  const { live, sport } = snapshot;
  // The metronome belongs to the recording: this view exists only while it runs.
  useStopMetronomeOnUnmount();

  if (!live || !sport) return null;

  const paused = live.status === 'paused';
  const failed = live.status === 'finished' && !saving;
  const busy = saving || failed;
  const channels = new Set<SensorChannel>(
    snapshot.sensorIds.flatMap((id) => kindChannels(saved.find((s) => s.id === id)?.kinds ?? [])),
  );
  const tiles = liveTiles(live, channels);
  const sportName = sportLabel(SPORT_ROWS[sport].name);
  const statusColor = paused ? colors.warning : colors.link;
  const laps = lapRows(snapshot.laps);
  const sensorRows = snapshot.sensorIds.flatMap((id) => saved.find((s) => s.id === id) ?? []);
  const pace = paceSecPerKm(live.speedMps);
  const values: RunMetricValues = {
    duration: live.movingSec,
    distance: live.distanceM,
    pace,
    avgPace: averagePace(live.movingSec, live.distanceM),
    speed: live.speedMps === null ? null : live.speedMps * 3.6,
    hr: live.hr,
    avgHr: live.avgHr,
    maxHr: live.maxHr,
    calories: live.calories,
    cadence: live.cadence,
    steps: live.steps > 0 ? live.steps : null,
    stride: strideLength(live.distanceM, live.steps),
    elevationGain: live.elevationGainM,
    altitude: live.altitudeM,
  };
  // A running pod's cadence and steps win (`Recorder`); without one they are the phone's step counter's.
  const phoneMeasured = snapshot.phoneSteps && !channels.has('pod') ? PHONE_STEP_FIELDS : undefined;
  // Only what the person should know: the band is not part of this recording (or not yet); a start under way or confirmed says nothing.
  const bandKey = band.phase === 'off' || band.phase === 'starting' || band.phase === 'linked' ? null : bandLinkLine(band.phase);

  return (
    <>
      {paused && !busy ? <Notice icon="pause-circle">{t('record.live.pausedBanner')}</Notice> : null}

      <Card>
        <View style={styles.heroHead}>
          <AppText variant="label" muted numberOfLines={1} style={styles.sport}>
            {sportName}
          </AppText>
          <StatusDot color={statusColor} live={!paused} />
          <AppText variant="label" color={statusColor}>
            {paused ? t('record.live.status.paused') : t('record.live.status.recording')}
          </AppText>
          <Button label={tLive('live.fields.edit')} icon="options" variant="ghost" iconOnly onPress={() => editor.open()} />
        </View>
        {bandKey !== null ? (
          <AppText variant="caption" muted accessibilityLiveRegion="polite">
            {t(bandKey)}
          </AppText>
        ) : null}
      </Card>

      {snapshot.gps ? (
        <LiveRunMap position={snapshot.position} trail={trail} fix={{ accuracyM: live.fixAccuracyM, ageSec: live.fixAgeSec }} />
      ) : null}

      <MetricGrid
        kind={fieldKind(sport)}
        values={values}
        editor={editor}
        exclude={snapshot.gps ? undefined : NO_ALTITUDE}
        phoneMeasured={phoneMeasured}
      />

      {failed ? (
        <>
          <Notice tone="danger">{t('record.live.saveFailed', { error: saveError ?? DASH })}</Notice>
          <Button label={t('record.live.saveAgain')} variant="primary" icon="refresh" style={styles.big} onPress={onSaveAgain} />
          <Button label={t('record.finish.discard')} variant="destructive" icon="trash-outline" onPress={onDiscard} />
        </>
      ) : (
        <View style={styles.controls}>
          <Button
            label={paused ? t('record.live.resume') : t('record.live.pause')}
            variant="primary"
            icon={paused ? 'play' : 'pause'}
            disabled={saving}
            style={styles.big}
            onPress={paused ? resume : pause}
          />
          <View style={styles.controlRow}>
            <Button label={t('record.live.lap')} icon="flag" disabled={busy || paused} style={styles.half} onPress={lap} />
            <Button label={t('record.live.finish')} icon="stop-circle" loading={saving} disabled={saving} style={styles.half} onPress={onFinish} />
          </View>
        </View>
      )}

      {tiles.power ? (
        <View style={styles.tiles}>
          <StatTile icon="flash" tint="workouts" label={t('record.live.power')} value={live.watts === null ? DASH : fmtInt(live.watts)} unit={t('analysis.unit.w')} />
        </View>
      ) : null}

      <Card>
        <MetronomeRow />
      </Card>

      <Card>
        <View style={styles.lapHead}>
          <AppText variant="bodyStrong">{t('record.live.lapName', { number: live.lapNumber })}</AppText>
          <AppText variant="caption" muted>
            {t('record.live.lapNow')}
          </AppText>
        </View>
        <AppText variant="figure" style={styles.lapStats}>
          {t('record.live.lapStats', { distance: fmtDistance(live.lapDistanceM), time: formatElapsed(live.lapMovingSec) })}
        </AppText>
      </Card>

      {laps.length > 0 ? (
        <Section title={t('record.live.laps')} icon="flag">
          {laps.map((row) => (
            <KeyValue
              key={row.number}
              label={t('record.live.lapName', { number: row.number })}
              value={
                row.avgHr === null
                  ? t('record.live.lapStats', { distance: fmtDistance(row.distanceM), time: formatElapsed(row.movingSec) })
                  : t('record.live.lapStatsHr', { distance: fmtDistance(row.distanceM), time: formatElapsed(row.movingSec), hr: fmtInt(row.avgHr) })
              }
            />
          ))}
        </Section>
      ) : null}

      {sensorRows.length > 0 ? (
        <Section title={t('record.live.sensors')} icon="bluetooth" tint="link">
          {sensorRows.map((sensor, index) => (
            <Fragment key={sensor.id}>
              {index > 0 ? <Divider /> : null}
              <SensorLinkRow sensor={sensor} managed />
            </Fragment>
          ))}
        </Section>
      ) : null}
      {snapshot.sensorError !== null ? (
        <Notice
          icon="bluetooth"
          action={
            sensorErrorKind(snapshot.sensorError) === 'permission'
              ? { label: t('record.permission.openSettings'), onPress: () => void Linking.openSettings() }
              : undefined
          }>
          {t(`record.sensorError.${sensorErrorKind(snapshot.sensorError)}`)}
        </Notice>
      ) : null}
      {snapshot.noService ? <Notice icon="battery-half">{t('record.ready.noService')}</Notice> : null}
    </>
  );
}

const styles = StyleSheet.create({
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sport: { flex: 1 },
  controls: { gap: spacing.sm },
  controlRow: { flexDirection: 'row', gap: spacing.sm },
  big: { minHeight: 64 },
  half: { flex: 1, minHeight: 52 },
  tiles: { flexDirection: 'row', gap: spacing.md },
  lapHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  lapStats: { fontVariant: ['tabular-nums'] },
});
