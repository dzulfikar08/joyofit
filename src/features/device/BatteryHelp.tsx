import Storage from 'expo-sqlite/kv-store';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Notice } from '@/components/States';
import { parseDismissed, VENDOR_NAMES, visibleBatteryHelp, type BatteryHelpKind } from '@/features/device/batteryLimits';
import { useBackgroundRestrictions, useBatteryScreens } from '@/features/device/useBackgroundRestrictions';
import { spacing } from '@/theme';
import type { BackgroundRestrictions } from '@/wear';

const DISMISSED_KEY = 'joyofit.batteryHelp.dismissed';

interface BatteryNoticesProps {
  /** The battery situation to explain, or null when only the maker's auto-start list is offered (Settings, with the battery already allowed). */
  kind: BatteryHelpKind | null;
  restrictions: BackgroundRestrictions;
  /** The Watch tab lets the person close the notice; Settings keeps it. */
  onDismiss?: () => void;
}

/**
 * What to open so Android stops cutting the watch link: the battery screen, and for Infinix, Tecno, itel, Xiaomi, OPPO, realme and vivo
 * phones also the maker's auto-start list (Android cannot say whether JoyoFit is in it, so it is always offered where the maker is known).
 */
export function BatteryNotices({ kind, restrictions, onDismiss }: BatteryNoticesProps) {
  const { t } = useTranslation('watch');
  const { failed, openBattery, openAutoStart } = useBatteryScreens();
  const vendor = restrictions.autoStartVendor;
  return (
    <View style={styles.stack}>
      {kind !== null ? (
        <Notice icon="battery-charging" action={{ label: t('device.limits.openBattery'), onPress: openBattery }}>
          {kind === 'restricted' ? t('device.limits.restricted') : t('device.limits.optimized')}
        </Notice>
      ) : null}
      {vendor !== null ? (
        <Notice icon="power" action={{ label: t('device.limits.openAutoStart'), onPress: openAutoStart }}>
          {t('device.limits.vendor', { maker: VENDOR_NAMES[vendor] })}
        </Notice>
      ) : null}
      {failed ? <Notice tone="danger">{t('device.limits.error')}</Notice> : null}
      {onDismiss ? <Button label={t('device.limits.dismiss')} variant="ghost" onPress={onDismiss} /> : null}
    </View>
  );
}

/**
 * The Watch tab's notice for a drop that Android causes: shown on Android while the phone may stop JoyoFit with the screen off. Closing it
 * is remembered per situation, so it does not come back until the situation changes; Settings, Sync, keeps the same help.
 */
export function BatteryHelp() {
  const restrictions = useBackgroundRestrictions();
  const [dismissed, setDismissed] = useState(() => parseDismissed(Storage.getItemSync(DISMISSED_KEY)));
  const kind = visibleBatteryHelp(restrictions, dismissed);
  if (restrictions === null || kind === null) return null;
  const dismiss = () => {
    Storage.setItemSync(DISMISSED_KEY, kind);
    setDismissed(kind);
  };
  return <BatteryNotices kind={kind} restrictions={restrictions} onDismiss={dismiss} />;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
});
