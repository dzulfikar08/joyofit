import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { BatteryNotices } from '@/features/device/BatteryHelp';
import { batteryHelpKind } from '@/features/device/batteryLimits';
import { useBackgroundRestrictions } from '@/features/device/useBackgroundRestrictions';

/**
 * Settings, Sync: whether Android may stop JoyoFit while the screen is off (a common reason the watch disconnects by itself), the way to lift
 * it, and the maker's auto-start list. Not dismissible: it is where the Watch tab's notice, once closed, can still be found. Android only.
 */
export function BatterySection() {
  const { t } = useTranslation('settings');
  const restrictions = useBackgroundRestrictions();
  if (restrictions === null) return null;
  const kind = batteryHelpKind(restrictions);
  return (
    <Section title={t('background.limits.title')} icon="battery-charging">
      <KeyValue
        icon="battery-charging"
        label={t('background.limits.battery')}
        value={restrictions.ignoringBatteryOptimizations ? t('background.limits.exempt') : t('background.limits.limited')}
      />
      <KeyValue
        icon="lock-closed"
        label={t('background.limits.restriction')}
        value={restrictions.backgroundRestricted ? t('background.limits.restricted') : t('background.limits.notRestricted')}
      />
      {kind === null ? (
        <AppText variant="caption" muted>
          {t('background.limits.ok')}
        </AppText>
      ) : null}
      <BatteryNotices kind={kind} restrictions={restrictions} />
    </Section>
  );
}
