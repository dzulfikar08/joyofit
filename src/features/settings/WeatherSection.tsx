import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Input } from '@/components/Input';
import { Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { forecastLine } from '@/features/settings/forecastStatus';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatClock } from '@/format';
import type { TFunction } from '@/i18n';
import { spacing } from '@/theme';
import {
  HuaweiWear,
  type TemperatureUnit,
  type WeatherLocationMode,
  type WeatherStatus,
} from '@/wear';

const UNITS: readonly { value: TemperatureUnit; label: string }[] = [
  { value: 'celsius', label: '\u00B0C' },
  { value: 'fahrenheit', label: '\u00B0F' },
];

const MODES: readonly WeatherLocationMode[] = ['current', 'city'];

const INTERVAL_MINUTES = [30, 60, 120, 240] as const;

/**
 * Asks for the coarse location; true when granted. The native side also accepts the fine one.
 * Android only: on iOS the native module shows the system prompt itself, once, when the weather
 * switch or "This phone" is set (`setWeatherEnabled`, `setWeatherLocationMode`).
 */
async function ensureCoarseLocation(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
  if (await PermissionsAndroid.check(permission)) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

/** The condition from the Huawei icon name (`SUNNY`, `LIGHT_RAIN`); an icon with no translation reads as its name. */
function conditionLabel(t: TFunction<'settings'>, icon: string): string {
  const text = icon.toLowerCase().replace(/_/g, ' ');
  return t(`weather.conditions.${icon}` as 'weather.conditions.UNKNOWN', {
    defaultValue: text.charAt(0).toUpperCase() + text.slice(1),
  });
}

export function WeatherSection() {
  const { t } = useTranslation(['settings', 'common']);
  const [status, setStatus] = useState<WeatherStatus>(() => HuaweiWear.getWeatherStatus());
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; danger: boolean } | null>(null);
  /** iOS asks only once: after a refusal the only way to allow location is the Settings app. */
  const [needsSettings, setNeedsSettings] = useState(false);

  const refresh = useCallback(() => setStatus(HuaweiWear.getWeatherStatus()), []);
  useNativeRefresh(refresh);

  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (done) setMessage({ text: done, danger: false });
    } catch (e) {
      setMessage({ text: errorMessage(e), danger: true });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  /** Selecting or enabling `current` needs the permission; without it the watch is told so. */
  const askLocation = async () => {
    if (Platform.OS === 'ios') return;
    if (!(await ensureCoarseLocation())) {
      setMessage({ text: t('weather.deniedAndroid'), danger: true });
    }
  };

  /** iOS: the native call above has shown the prompt (if it was due); say so when location is still off. */
  const reportIosDenial = () => {
    if (Platform.OS !== 'ios' || HuaweiWear.getWeatherStatus().locationPermission) return;
    setNeedsSettings(true);
    setMessage({ text: t('weather.deniedIos'), danger: true });
  };

  const toggle = (enabled: boolean) =>
    run(async () => {
      if (enabled && status.locationMode === 'current') await askLocation();
      await HuaweiWear.setWeatherEnabled(enabled);
      if (enabled && status.locationMode === 'current') reportIosDenial();
    });

  const chooseMode = (mode: WeatherLocationMode) =>
    run(async () => {
      if (mode === 'current') await askLocation();
      await HuaweiWear.setWeatherLocationMode(mode);
      if (mode === 'current') reportIosDenial();
    });

  const allowLocation = () =>
    run(async () => {
      if (Platform.OS === 'ios') {
        if (needsSettings) {
          await Linking.openSettings();
          return;
        }
        await HuaweiWear.setWeatherLocationMode('current');
        reportIosDenial();
        return;
      }
      await askLocation();
    });

  const search = () =>
    run(async () => {
      const place = await HuaweiWear.setWeatherCity(city);
      setCity('');
      setMessage({
        text: place.detail
          ? t('weather.citySetDetail', { name: place.name, detail: place.detail })
          : t('weather.citySet', { name: place.name }),
        danger: false,
      });
    });

  const connected = status.watchSupported !== null;
  const forecast = forecastLine(status.lastForecast);

  return (
    <Section title={t('weather.title')} icon="partly-sunny">
      <SwitchRow
        icon="partly-sunny"
        label={t('weather.send')}
        value={status.enabled}
        onValueChange={toggle}
        disabled={busy}
      />

      <View style={styles.row}>
        <View style={styles.unit}>
          <AppText variant="label" muted>
            {t('weather.unit')}
          </AppText>
          <Segmented
            options={UNITS}
            value={status.unit}
            onChange={(unit) => run(() => HuaweiWear.setWeatherUnit(unit))}
            disabled={busy}
          />
        </View>
        <View style={styles.mode}>
          <AppText variant="label" muted>
            {t('weather.weatherFor')}
          </AppText>
          <Segmented
            options={MODES.map((value) => ({ value, label: t(`weather.modes.${value}`) }))}
            value={status.locationMode} onChange={chooseMode} disabled={busy} />
        </View>
      </View>

      {status.locationMode === 'current' ? (
        <>
          <PairGrid>
            <Pair label={t('weather.permission')} value={status.locationPermission ? t('weather.granted') : t('weather.notGranted')} />
          </PairGrid>
          {!status.locationPermission ? (
            <>
              <AppText variant="caption" muted>
                {t('weather.locationWhy')}
              </AppText>
              <Button
                label={Platform.OS === 'ios' && needsSettings ? t('weather.openSettings') : t('common:actions.next')}
                variant="secondary"
                icon="location-outline"
                onPress={allowLocation}
                disabled={busy}
              />
            </>
          ) : null}
        </>
      ) : (
        <>
          <PairGrid>
            <Pair
              label={t('weather.city')}
              value={
                status.city
                  ? `${status.city.name}${status.city.detail ? `, ${status.city.detail}` : ''}`
                  : null
              }
              wide
            />
          </PairGrid>
          <Input
            icon="search"
            accessibilityLabel={t('weather.cityName')}
            placeholder={t('weather.cityPlaceholder')}
            value={city}
            onChangeText={setCity}
            onSubmitEditing={search}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
          />
          <Button label={t('weather.searchCity')} variant="secondary" onPress={search} disabled={busy || !city.trim()} />
        </>
      )}

      <AppText variant="label" muted>
        {t('weather.interval')}
      </AppText>
      <Segmented
        options={INTERVAL_MINUTES.map((value) => ({
          value,
          label: value >= 60 ? t('weather.intervals.h', { count: value / 60 }) : t('weather.intervals.m', { count: value }),
        }))}
        value={status.intervalMinutes}
        onChange={(minutes) => run(() => HuaweiWear.setWeatherIntervalMinutes(minutes))}
        disabled={busy}
      />

      {message ? <Notice tone={message.danger ? 'danger' : 'info'}>{message.text}</Notice> : null}
      {!connected ? (
        <Notice>{t('weather.connect')}</Notice>
      ) : status.watchSupported === false ? (
        <Notice tone="danger">{t('weather.noService')}</Notice>
      ) : null}
      <Button
        label={t('weather.updateNow')}
        variant="primary"
        icon="refresh"
        loading={busy}
        disabled={!status.enabled || !connected}
        onPress={() => run(async () => void (await HuaweiWear.refreshWeather()), t('weather.sentToWatch'))}
      />
      <PairGrid>
        <Pair label={t('weather.lastSent')} value={status.lastPushAt ? formatClock(status.lastPushAt) : null} />
        <Pair
          label={t('weather.lastWeather')}
          value={
            status.lastTemperatureC !== null && status.lastCondition
              ? `${status.lastTemperatureC}\u00B0C, ${conditionLabel(t, status.lastCondition)}${
                  status.lastLocationName ? `, ${status.lastLocationName}` : ''
                }`
              : null
          }
        />
      </PairGrid>
      {forecast ? (
        <AppText variant="caption" muted>
          {forecast}
        </AppText>
      ) : null}
      {status.lastError ? <Notice tone="danger">{status.lastError}</Notice> : null}
      <Details>{`${t('weather.details')}\n\n${Platform.OS === 'ios' ? t('weather.detailsIos') : t('weather.detailsAndroid')}`}</Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  unit: { flex: 1, gap: spacing.xs },
  mode: { flex: 2, gap: spacing.xs },
});
