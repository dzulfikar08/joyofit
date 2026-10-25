import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { isIos } from '@/components/IosUnavailable';
import { Divider, Section } from '@/components/Screen';
import { EmptyState, Notice } from '@/components/States';
import { BluetoothPermissionPrompt } from '@/features/device/BluetoothPermissionPrompt';
import { withActiveWatch } from '@/features/device/bondedList';
import { BondedRow } from '@/features/device/BondedRow';
import { noWatchFoundHint, noWatchFoundScanHint } from '@/features/device/connectFailure';
import type { BluetoothPermission } from '@/features/device/useBluetoothPermission';
import type { BondedDevices } from '@/features/device/useBondedDevices';
import { useWatchRowActions } from '@/features/device/useWatchRowActions';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

/** Paired watches shown before the list scrolls inside its card. */
const VISIBLE_BONDED = 3;

interface AvailableWatchesSectionProps {
  permission: BluetoothPermission;
  bonded: BondedDevices;
}

/**
 * The Watch tab's list of watches with the Bluetooth permission step, the scan and the connect, forget and disconnect buttons. The tab owns
 * the permission and device hooks (it feeds them to pull-to-refresh); the setup guide's scan cards share the same hooks and helpers.
 */
export function AvailableWatchesSection({ permission, bonded }: AvailableWatchesSectionProps) {
  const { t } = useTranslation('watch');
  const watch = useWatch();
  const actions = useWatchRowActions(bonded);
  const granted = permission.status === 'granted';
  // Measured row heights, so the list shows exactly VISIBLE_BONDED rows before it scrolls.
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});

  const linked = watch.linkState === 'connected' || watch.linkState === 'syncing';
  // iOS only: every listed watch is out of reach (a watch linked to another phone does not advertise). Android leaves `nearby` unset.
  const showNotInReach =
    bonded.loaded && !bonded.loading && !bonded.error && !linked && bonded.devices.length > 0 && bonded.devices.every((d) => d.nearby === false);

  // The watch in use first, then the ones this app can talk to best.
  const devices = useMemo(
    () => withActiveWatch(bonded.devices, watch.activeAddress, watch.device),
    [bonded.devices, watch.activeAddress, watch.device],
  );

  const showEmpty = devices.length === 0 && !bonded.loading && !bonded.error;
  const listMaxHeight = useMemo(() => {
    if (devices.length <= VISIBLE_BONDED) return undefined;
    const heights = devices.slice(0, VISIBLE_BONDED).map((d) => rowHeights[d.address]);
    return heights.every((h) => h !== undefined) ? heights.reduce((sum, h) => sum + h, 0) : undefined;
  }, [devices, rowHeights]);

  return (
    <Section
      title={bonded.scanning ? t('device.list.searching') : t('device.list.title')}
      icon="bluetooth"
      trailing={
        bonded.scanning ? (
          <AppText variant="caption" muted>
            {t('device.list.scanningShort')}
          </AppText>
        ) : devices.length > 0 ? (
          <AppText variant="caption" muted>
            {devices.length}
          </AppText>
        ) : null
      }>
      {!granted ? (
        <BluetoothPermissionPrompt permission={permission} />
      ) : (
        <>
          {bonded.error ? <Notice tone="danger">{t('device.list.readError', { error: bonded.error })}</Notice> : null}
          {showNotInReach ? (
            <Notice action={{ label: t('device.list.refresh'), onPress: () => void bonded.refresh() }}>{noWatchFoundHint()}</Notice>
          ) : null}
          {!isIos && !bonded.scanning && bonded.scanFound === 0 && !linked ? (
            <Notice action={{ label: t('device.list.scanAgain'), onPress: () => void bonded.startScan() }}>{noWatchFoundScanHint()}</Notice>
          ) : null}
          {showEmpty ? (
            <EmptyState
              icon="bluetooth"
              title={isIos ? t('device.list.emptyIos') : bonded.scanning ? t('device.list.scanning') : t('device.list.emptyAndroid')}
              description={
                isIos
                  ? noWatchFoundHint()
                  : bonded.scanning
                    ? t('device.list.scanningHint')
                    : t('device.list.emptyHint')
              }
              action={
                isIos
                  ? { label: t('device.list.refreshList'), icon: 'refresh', onPress: () => void bonded.refresh() }
                  : {
                      label: bonded.scanning ? t('device.list.scanningShort') : t('device.list.scan'),
                      icon: 'refresh',
                      onPress: () => {
                        void bonded.reload();
                        void bonded.startScan();
                      },
                    }
              }
            />
          ) : (
            <>
              <ScrollView
                style={listMaxHeight === undefined ? undefined : { maxHeight: listMaxHeight }}
                scrollEnabled={listMaxHeight !== undefined}
                nestedScrollEnabled
                showsVerticalScrollIndicator>
                {devices.map((d, index) => (
                  <View
                    key={d.address}
                    style={[styles.bonded, index > 0 && styles.bondedNext]}
                    onLayout={(e) => {
                      const height = e.nativeEvent.layout.height;
                      setRowHeights((prev) => (prev[d.address] === height ? prev : { ...prev, [d.address]: height }));
                    }}>
                    {index > 0 ? <Divider /> : null}
                    <BondedRow
                      device={d}
                      linkState={watch.linkState}
                      activeAddress={watch.activeAddress}
                      onConnect={actions.connect}
                      onDisconnect={actions.disconnect}
                      onForget={actions.forget}
                    />
                  </View>
                ))}
              </ScrollView>
              {isIos ? (
                <Button label={t('device.list.refreshList')} icon="refresh" loading={bonded.loading} onPress={() => void bonded.refresh()} />
              ) : (
                <Button
                  label={bonded.scanning ? t('device.list.stopScan') : linked ? t('device.list.scanOther') : t('device.list.scan')}
                  icon={bonded.scanning ? 'close' : 'refresh'}
                  loading={bonded.loading}
                  onPress={() => {
                    if (bonded.scanning) {
                      void bonded.stopScan();
                    } else {
                      void bonded.reload();
                      void bonded.startScan();
                    }
                  }}
                />
              )}
            </>
          )}
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  bonded: { gap: spacing.md },
  bondedNext: { paddingTop: spacing.md },
});
