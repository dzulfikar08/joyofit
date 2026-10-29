import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Screen, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { fmtAgo } from '@/i18n/format';
import type { Granted } from '@/features/sensors/permissions';
import type { GattFailure } from '../gattRead';
import { sensorLabel } from '@/features/sensors/store';
import { batteryLabel } from '@/features/sensors/ui/format';
import { useNow } from '@/hooks/useNow';
import { spacing } from '@/theme';

import { NightSection } from './NightSection';
import { ThermometerPicker } from './ThermometerPicker';
import { useThermometer } from '../useThermometer';
import { useThermometerDiscovery } from './useThermometerDiscovery';
import { ReadingFigures } from './ReadingFigure';

type Problem = 'permission' | 'off' | 'unavailable' | 'notAllowed';

/**
 * Pengaturan > Termometer kamar: the thermometer in use with its last reading and battery, the search and pairing, the overnight scan, what
 * the sensor needs (community firmware) and what leaves the phone (only the nightly averages, and only with Wawasan tidur on).
 */
export function ThermometerScreen() {
  const { t } = useTranslation('thermometer');
  const thermometer = useThermometer();
  const discovery = useThermometerDiscovery();
  const [permission, setPermission] = useState<Granted | null>(null);
  const [nightProblem, setNightProblem] = useState<Problem | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState<GattFailure | null>(null);

  const code = discovery.error;
  const searchProblem: Problem | null =
    permission === 'denied' || permission === 'blocked' || code === 'ERR_BLUETOOTH_PERMISSION'
      ? 'permission'
      : code === 'ERR_BLUETOOTH_OFF'
        ? 'off'
        : code
          ? 'unavailable'
          : null;
  const problem = nightProblem ?? searchProblem;

  const nowMs = useNow(30_000);
  const { sensor, last, link } = thermometer;
  const problemNow = readFailed ?? thermometer.problem;
  const readNow = async () => {
    setReading(true);
    setReadFailed(null);
    try {
      const result = await thermometer.readNow();
      if (result && !result.ok) setReadFailed(result.reason);
    } finally {
      setReading(false);
    }
  };
  const battery = sensor ? batteryLabel(sensor.battery) : null;

  return (
    <Screen>
      {problem ? (
        <Notice
          tone="danger"
          action={problem === 'permission' ? { label: t('problem.openSettings'), onPress: () => void Linking.openSettings() } : undefined}>
          {t(`problem.${problem}`)}
        </Notice>
      ) : null}

      {sensor ? (
        <Section title={sensorLabel(sensor)} icon="thermometer-outline">
          <View style={styles.reading} accessibilityLiveRegion="polite">
            {last ? (
              <>
                <ReadingFigures last={last} />
                <AppText variant="caption" muted numberOfLines={1}>
                  {t(battery ? 'card.lastAtBattery' : 'card.lastAt', {
                    ago: fmtAgo(Math.floor(last.ts / 1000), Math.floor(Math.max(nowMs, last.ts) / 1000)),
                    battery,
                  })}
                </AppText>
              </>
            ) : (
              <>
                <AppText variant="caption" muted>
                  {t(link === 'bindkey' ? 'card.noReadingKey' : link === 'gatt' ? 'card.noReadingGatt' : 'card.noReading')}
                </AppText>
                {battery ? (
                  <AppText variant="caption" muted numberOfLines={1}>
                    {battery}
                  </AppText>
                ) : null}
              </>
            )}
          </View>
          {link !== 'advert' ? (
            <AppText variant="caption" muted>
              {t(`card.link.${link}`)}
            </AppText>
          ) : null}
          {link === 'gatt' && problemNow ? <Notice tone="danger">{t(`stock.gatt.${problemNow}`)}</Notice> : null}
          {link === 'gatt' ? <Button label={t('card.readNow')} icon="refresh" loading={reading} onPress={() => void readNow()} /> : null}
          <Button label={t('card.forget')} icon="trash-outline" variant="ghost" onPress={() => setForgetting(true)} />
        </Section>
      ) : (
        <Section title={t('title')} icon="thermometer-outline">
          <AppText variant="caption" muted>
            {t('card.empty')}
          </AppText>
        </Section>
      )}

      <ThermometerPicker
        discovery={discovery}
        currentId={sensor?.id ?? null}
        onPermission={setPermission}
        onPick={(device) => void thermometer.pair(device)}
        onPairGatt={thermometer.pairGatt}
        onPairBindkey={thermometer.pairBindkey}
      />

      {sensor ? <NightSection ids={[sensor.id]} link={link} onProblem={setNightProblem} /> : null}

      <Section title={t('firmware.title')} icon="information-circle">
        <Details>{t('firmware.body')}</Details>
      </Section>

      <Section title={t('privacy.title')} icon="lock-closed">
        <Details>{t('privacy.body')}</Details>
      </Section>

      <ConfirmDialog
        visible={forgetting}
        title={t('card.forgetTitle')}
        message={t('card.forgetMessage')}
        confirmLabel={t('card.forget')}
        destructive
        onConfirm={() => {
          setForgetting(false);
          void thermometer.forget();
        }}
        onCancel={() => setForgetting(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  reading: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
});
