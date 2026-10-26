import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { PressableScale } from '@/components/PressableScale';
import { Section } from '@/components/Screen';
import { SwitchRow } from '@/components/SwitchRow';
import { Notice } from '@/components/States';
import { BikeSetupPanel } from '@/features/bikecomputer/record/BikeSetupPanel';
import { useOverlayRoute } from '@/features/live/overlayRoute';
import { RouteOverlayButton } from '@/features/live/ui/RouteOverlayButton';
import { SPORT_ROWS, type ManualSport } from '@/features/workouts/manual';
import { sportLabel } from '@/features/workouts/sportLabel';
import { errorMessage } from '@/format';
import { useRecorder } from '@/state/RecorderProvider';
import { useSensors } from '@/state/SensorsProvider';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';

import { hasWatch, setBandStartEnabled, useBandStartEnabled } from '../bandLink';
import { bandSportCode } from '../bandLinkCore';
import { canPrepare, gpsChip, permissionPlan } from './format';
import { GpsLine } from './GpsLine';
import { PermissionCards, StepsPanel, useRecordPermissions } from './PermissionGate';
import { IndoorBackdrop, MapBackdrop } from './RecordBackdrop';
import { RecordStage } from './RecordStage';
import { SportPicker } from './SportPicker';
import { StartButton } from './StartButton';
import { StatPreview } from './StatPreview';
import { useBandSegment, useGpsSegment, useSensorsSegment, useStepsSegment } from './statusSegments';
import { useGpsWarmUp } from './useGpsWarmUp';
import { OPEN_IN_STACK } from '@/components/navigation';

const LOCATION_DENIED = 'ERR_LOCATION_PERMISSION';

/** The share of the screen height the questions and notices above the sport row may take before they scroll; the start button never leaves the screen. */
const EXTRAS_MAX_SHARE = 0.34;

interface SetupViewProps {
  sport: ManualSport;
  onSport: (sport: ManualSport) => void;
  /** Something the last recording left to say (nothing was recorded). */
  notice: string | null;
  onBack: () => void;
}

/**
 * Phase `idle`: the map with the person on it (or, with no GPS in the sport, the figures large), a pill of what will record (GPS,
 * sensors, the phone's step counter), and a sheet to pick the sport and press "Mulai", which gets the recording ready. What the sport
 * still needs from the person (location, Bluetooth) is asked in the sheet before "Mulai" works; the step counter is asked from its
 * segment of the pill.
 */
export function SetupView({ sport, onSport, notice, onBack }: SetupViewProps) {
  const { t } = useTranslation('workouts');
  const { t: tRide } = useTranslation('ride');
  const router = useRouter();
  const { height } = useWindowDimensions();
  const { prepare, snapshot } = useRecorder();
  const { saved, hub } = useSensors();
  const { linkState, device } = useWatch();
  const overlay = useOverlayRoute();
  const bandStart = useBandStartEnabled();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);

  const autoSensors = saved.filter((s) => s.autoConnect);
  const plan = permissionPlan(sport, autoSensors.length);
  const permissions = useRecordPermissions(plan, hub.bluetooth);
  const allowed = canPrepare(plan, permissions.location, permissions.bluetooth);
  // The GPS starts looking while the sport and the sensors are still being picked, not after "Mulai".
  const warming = plan.location && permissions.location === 'granted';
  useGpsWarmUp(sport, warming);

  const fix = warming ? snapshot.fix : null;
  const chip = gpsChip(plan, permissions.location, fix);
  const gpsSegment = useGpsSegment(chip, fix);
  const sensorsSegment = useSensorsSegment(autoSensors.length, () => router.push('/watch/sensors', OPEN_IN_STACK));
  const stepsSegment = useStepsSegment(permissions.steps === 'granted', () => setStepsOpen((open) => !open));
  const bandSegment = useBandSegment(linkState, () => router.push('/watch'));
  // The band's link, only when the band takes part in this recording (a watch exists, the setting is on, the sport has a band workout).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the remembered watch is read again when the link changes
  const watchKnown = useMemo(() => device !== null || hasWatch(), [device, linkState]);
  const showBand = watchKnown && bandStart && bandSportCode(sport) !== null;
  const segments = [gpsSegment, sensorsSegment, ...(plan.steps ? [stepsSegment] : []), ...(showBand ? [bandSegment] : [])];

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await prepare(sport, sportLabel(SPORT_ROWS[sport].name));
    } catch (e) {
      // The permission was taken back since the screen read it: its notice and question come back.
      if ((e as { code?: unknown } | null)?.code === LOCATION_DENIED) permissions.locationRefused();
      else setError(t('record.setup.prepareError', { error: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <RecordStage
      onBack={onBack}
      segments={segments}
      backdrop={
        plan.location ? (
          <MapBackdrop position={snapshot.position} location={permissions.location} route={overlay.selected?.line ?? null} />
        ) : (
          <IndoorBackdrop sport={sport} />
        )
      }>
      <ScrollView
        style={[styles.extras, { maxHeight: height * EXTRAS_MAX_SHARE }]}
        contentContainerStyle={styles.extrasContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {notice ? <Notice icon="information-circle">{notice}</Notice> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {plan.location && (linkState === 'connected' || linkState === 'syncing') ? (
          <>
            <Notice icon="information-circle">{t('record.setup.gnssHint')}</Notice>
            <Details title={t('record.setup.gnssWhy')}>{t('record.setup.gnssWhyBody')}</Details>
          </>
        ) : null}
        {chip === 'fair' || chip === 'weak' ? <GpsLine fix={snapshot.fix} /> : null}
        {plan.location ? (
          <View style={styles.route}>
            <RouteOverlayButton overlay={overlay} />
          </View>
        ) : null}
        {device !== null && plan.location ? (
          <SwitchRow
            icon="watch-outline"
            label={t('record.bandLink.setting')}
            hint={t('record.bandLink.settingHint')}
            value={bandStart}
            onValueChange={setBandStartEnabled}
          />
        ) : null}
        {autoSensors.length > 0 && hub.bluetooth === 'off' ? <Notice icon="bluetooth">{t('record.setup.bluetoothOff')}</Notice> : null}
        <PermissionCards permissions={permissions} plan={plan} />
        {plan.steps && stepsOpen ? <StepsPanel permissions={permissions} /> : null}
        {sport === 'ride' ? <BikeSetupPanel /> : null}
        {sport === 'indoorRide' ? (
          <Section title={tRide('entry.title')} icon="laptop-outline" tint="link">
            <AppText variant="caption" muted>
              {tRide('entry.hint')}
            </AppText>
            <Button label={tRide('entry.action')} icon="laptop-outline" onPress={() => router.push('/ride')} />
          </Section>
        ) : null}
        <Details title={t('record.setup.aboutTitle')}>
          <View style={styles.about}>
            <AppText variant="caption" muted>
              {plan.location ? t('record.setup.gpsNote') : t('record.setup.noGpsNote')}
            </AppText>
            <AppText variant="caption" muted>
              {autoSensors.length > 0 ? t('record.setup.sensorsNote') : t('record.setup.noSensors')}
            </AppText>
            {plan.steps ? (
              <AppText variant="caption" muted>
                {t('record.permission.steps.body')}
              </AppText>
            ) : null}
          </View>
        </Details>
      </ScrollView>

      <SportPicker sport={sport} onSport={onSport} />
      {plan.location ? <StatPreview sport={sport} layout="row" /> : null}
      <StartButton label={t('record.setup.start')} disabled={!allowed} loading={busy} onPress={() => void start()} />

      <View style={styles.actions}>
        <TextAction icon="trail-sign-outline" label={t('record.setup.actions.routes')} onPress={() => router.push('/routes')} />
        <TextAction icon="repeat" label={t('record.setup.actions.loop')} onPress={() => router.push('/routes/loop', OPEN_IN_STACK)} />
        <TextAction icon="bluetooth" label={t('record.setup.sensors')} onPress={() => router.push('/watch/sensors', OPEN_IN_STACK)} />
      </View>
    </RecordStage>
  );
}

interface TextActionProps {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}

/** A quiet action under the start button: a glyph and a word, no fill. */
function TextAction({ icon, label, onPress }: TextActionProps) {
  const colors = useColors();
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} scaleTo={0.96} style={styles.action}>
      <Ionicons name={icon} size={18} color={colors.mutedForeground} />
      <AppText variant="label" numberOfLines={1}>
        {label}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  extras: { flexGrow: 0 },
  extrasContent: { gap: spacing.md },
  route: { alignItems: 'flex-start' },
  about: { gap: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
  action: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
});
