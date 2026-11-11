import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { SwitchRow } from '@/components/SwitchRow';
import { Notice } from '@/components/States';
import { ensureBluetoothAdvertise } from '@/features/device/useBluetoothPermission';
import { fmtInt } from '@/i18n';
import { spacing } from '@/theme';
import { HuaweiWear, hasNative, type HrSensorStatus } from '@/wear';

const POLL_MS = 2000;

function readStatus(): HrSensorStatus | null {
  try {
    return HuaweiWear.getHrSensor();
  } catch {
    return null;
  }
}

/**
 * Settings > Komputer sepeda: the phone as a Bluetooth heart-rate sensor, so a bike computer (iGPSPORT, Magene, XOSS) shows the
 * watch's heart rate. Hidden on iOS and on binaries without `setHrSensor`.
 */
export function HrSensorSection() {
  const available = Platform.OS === 'android' && hasNative('setHrSensor');
  if (!available) return null;
  return <HrSensorSectionBody />;
}

function HrSensorSectionBody() {
  const { t } = useTranslation('bikecomp');
  const [status, setStatus] = useState<HrSensorStatus | null>(readStatus);
  const [problem, setProblem] = useState<'permission' | 'blocked' | 'failed' | null>(null);

  const enabled = status?.enabled ?? false;
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setStatus(readStatus()), POLL_MS);
    return () => clearInterval(id);
  }, [enabled]);

  const onToggle = useCallback(async (on: boolean) => {
    setProblem(null);
    if (on) {
      const permission = await ensureBluetoothAdvertise();
      if (permission !== 'granted') {
        setProblem(permission === 'blocked' ? 'blocked' : 'permission');
        return;
      }
    }
    try {
      setStatus(HuaweiWear.setHrSensor(on));
    } catch {
      setProblem('failed');
      setStatus(readStatus());
    }
  }, []);

  if (status && !status.supported) {
    return (
      <Section title={t('settings.hrSensor.title')} icon="heart">
        <Notice icon="bluetooth">{t('settings.hrSensor.unsupported')}</Notice>
      </Section>
    );
  }

  const line = (() => {
    if (!status?.enabled) return null;
    if (status.subscribed > 0) {
      const bpm = status.heartRate != null ? t('settings.hrSensor.bpm', { value: fmtInt(status.heartRate) }) : t('settings.hrSensor.noReading');
      return t('settings.hrSensor.sending', { name: status.connected.join(', '), bpm });
    }
    if (status.advertising) return t('settings.hrSensor.advertising');
    return t('settings.hrSensor.starting');
  })();

  return (
    <Section title={t('settings.hrSensor.title')} icon="heart">
      <SwitchRow
        label={t('settings.hrSensor.enabled')}
        hint={t('settings.hrSensor.hint')}
        value={enabled}
        onValueChange={(on) => void onToggle(on)}
      />
      {line ? (
        <View style={styles.block}>
          <AppText variant="bodyStrong">{line}</AppText>
          {status?.subscribed ? (
            <AppText variant="caption" muted>
              {t('settings.hrSensor.battery', { value: fmtInt(status.phoneBattery) })}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {status?.enabled && status.error ? <Notice tone="danger">{status.error}</Notice> : null}
      {problem === 'permission' ? <Notice tone="danger">{t('settings.hrSensor.permission')}</Notice> : null}
      {problem === 'blocked' ? (
        <Notice tone="danger" action={{ label: t('settings.hrSensor.openSettings'), onPress: () => void Linking.openSettings() }}>
          {t('settings.hrSensor.permission')}
        </Notice>
      ) : null}
      {problem === 'failed' ? <Notice tone="danger">{t('settings.hrSensor.failed')}</Notice> : null}
      <Details>{t('settings.hrSensor.body')}</Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.xs },
});
