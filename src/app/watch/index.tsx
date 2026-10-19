import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { NavRow } from '@/components/NavRow';
import { Divider, Screen, Section } from '@/components/Screen';
import { isIos } from '@/components/IosUnavailable';
import { AvailableWatchesSection } from '@/features/device/AvailableWatchesSection';
import { AgpsSection } from '@/features/device/AgpsSection';
import { BatteryHelp } from '@/features/device/BatteryHelp';
import { BindConfirmDialog } from '@/features/device/BindConfirmDialog';
import { FindWatchSection } from '@/features/device/FindWatchSection';
import { GuideLink } from '@/features/device/GuideLink';
import { supportLabel } from '@/features/device/modelSupport';
import { SilentWatchHelp } from '@/features/device/SilentWatchHelp';
import { SupportReportSection } from '@/features/device/SupportReportSection';
import { SupportedWatches } from '@/features/device/SupportedWatches';
import { WatchIntro } from '@/features/device/WatchIntro';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { WatchStatusCard } from '@/features/device/WatchStatusCard';
import { WatchesSection } from '@/features/device/WatchesSection';
import { useBluetoothPermission } from '@/features/device/useBluetoothPermission';
import { useBondedDevices } from '@/features/device/useBondedDevices';
import { SensorsSection } from '@/features/sensors/ui/SensorsSection';
import { useWatch } from '@/state/WatchProvider';
import { fmtPercent } from '@/i18n';
import { spacing, useTheme } from '@/theme';

/** The three things that have to be true before the first connect, in the order they happen. */
function ConnectSteps() {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation('watch');
  const steps = isIos
    ? [t('connectSteps.ios.s1'), t('connectSteps.ios.s2'), t('connectSteps.ios.s3')]
    : [t('connectSteps.android.s1'), t('connectSteps.android.s2'), t('connectSteps.android.s3')];
  return (
    <Section title={t('connectSteps.title')} icon="list">
      <Details title={t('connectSteps.details')}>
        {steps.map((step, index) => (
          <View key={step} style={styles.step}>
            <View style={[styles.stepNumber, { backgroundColor: colors.muted }]}>
              <AppText variant="label" style={[styles.stepDigit, { fontFamily: fonts.bold }]}>
                {index + 1}
              </AppText>
            </View>
            <AppText variant="caption" style={styles.stepText}>
              {step}
            </AppText>
          </View>
        ))}
      </Details>
      <GuideLink />
    </Section>
  );
}

function WatchHub() {
  const router = useRouter();
  const { t } = useTranslation(['watch', 'routes']);
  const watch = useWatch();
  const permission = useBluetoothPermission();
  const granted = permission.status === 'granted';
  const bonded = useBondedDevices(granted);
  const { device } = watch;
  const linked = watch.linkState === 'connected' || watch.linkState === 'syncing';
  const pairedWatches = <AvailableWatchesSection permission={permission} bonded={bonded} />;
  // Another watch: look for it where the list below shows watches; it is paired there with Connect, and the first one keeps its keys.
  const addWatch = () => {
    if (!granted) {
      void permission.request();
    } else if (isIos) {
      void bonded.refresh();
    } else {
      void bonded.reload();
      void bonded.startScan();
    }
  };

  const watchDetails = device ? (
    <Section title={t('watch:details.title')} icon="watch">
      <View style={styles.grid}>
        <Pair label={t('watch:details.name')} value={device.name} />
        <Pair label={t('watch:details.model')} value={device.model ?? device.productModel} />
        <Pair label={t('watch:details.support')} value={supportLabel(device.support)} />
        {device.model ? <Pair label={t('watch:details.productCode')} value={device.productModel} /> : null}
        <Pair label={t('watch:details.software')} value={device.softwareVersion} />
        <Pair label={t('watch:details.hardware')} value={device.hardwareVersion} />
        <Pair label={t('watch:details.serial')} value={device.serialNumber} />
        <Pair label={t('watch:details.authMode')} value={device.authMode} />
        <Pair label={t('watch:details.battery')} value={watch.battery === null ? null : fmtPercent(watch.battery)} />
      </View>
      {watch.linkState !== 'connected' ? (
        <AppText variant="caption" muted>
          {watch.linkState === 'syncing' ? t('watch:details.afterSync') : t('watch:device.connectFirst')}
        </AppText>
      ) : null}
      <Button
        label={t('watch:details.refreshBattery')}
        icon="refresh"
        disabled={watch.linkState !== 'connected'}
        onPress={() => void watch.refreshBattery()}
      />
    </Section>
  ) : null;

  const onTheWatch = (
    <Section title={t('watch:hub.title')} icon="watch">
      <NavRow
        icon="color-palette"
        title={t('watch:hub.faces')}
        subtitle={t('watch:hub.facesSub')}
        style={styles.navRow}
        onPress={() => router.push('/watch/faces')}
      />
      <Divider />
      <NavRow
        icon="images"
        title={t('watch:hub.photo')}
        subtitle={t('watch:hub.photoSub')}
        style={styles.navRow}
        onPress={() => router.push('/watch/photos')}
      />
      <Divider />
      <NavRow
        icon="alarm"
        title={t('watch:hub.alarms')}
        subtitle={t('watch:hub.alarmsSub')}
        style={styles.navRow}
        onPress={() => router.push('/watch/alarms')}
      />
      <Divider />
      <NavRow
        icon="trail-sign"
        title={t('routes:hub.title')}
        subtitle={t('routes:hub.subtitle')}
        style={styles.navRow}
        onPress={() => router.push('/routes')}
      />
    </Section>
  );

  return (
    <Screen
      title={t('watch:title')}
      refresh={{ refreshing: bonded.loading, onRefresh: () => void bonded.refresh(), enabled: granted }}>
      <WatchStatusCard />
      <SilentWatchHelp />
      <BatteryHelp />
      <WatchesSection onAdd={addWatch} />
      <SensorsSection />
      {/* Connected, the list is only needed to disconnect or switch, so the watch's own pages come first. */}
      {linked ? (
        <>
          {onTheWatch}
          <FindWatchSection />
          <AgpsSection />
          {watchDetails}
          {pairedWatches}
          <SupportReportSection />
        </>
      ) : (
        <>
          {device ? null : <ConnectSteps />}
          {pairedWatches}
          {watchDetails}
          {device ? <FindWatchSection /> : null}
          {device ? <AgpsSection /> : null}
          {onTheWatch}
          <SupportReportSection />
        </>
      )}
      {device ? <ConnectSteps /> : null}
      {device ? null : <SupportedWatches />}
      <BindConfirmDialog />
    </Screen>
  );
}

/**
 * The Watch tab. A phone that never had a watch first sees a short intro (what a watch adds, which ones work, how to ask for yours)
 * and only "Lanjut" opens the pairing screen, which is what asks for Bluetooth permission. Everyone else goes straight to it.
 */
export default function WatchScreen() {
  const { t } = useTranslation('watch');
  const presence = useWatchPresence();
  const [open, setOpen] = useState(false);
  if (presence === null) return <Screen title={t('title')}>{null}</Screen>;
  if (presence === 'none' && !open) return <WatchIntro onContinue={() => setOpen(true)} />;
  return <WatchHub />;
}

function Pair({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.pair}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="label" selectable numberOfLines={1}>
        {value ?? '\u2014'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, columnGap: spacing.md },
  pair: { width: '47%' },
  navRow: { paddingHorizontal: 0 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepNumber: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepDigit: { fontVariant: ['tabular-nums'] },
  stepText: { flex: 1, paddingTop: 6 },
});
