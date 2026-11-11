import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Segmented } from '@/components/Segmented';
import { Divider, Section } from '@/components/Screen';
import { SwitchRow } from '@/components/SwitchRow';
import { Notice } from '@/components/States';
import { fmtInt } from '@/i18n';
import { spacing } from '@/theme';

import { ShareSection } from '../live/ShareSection';
import { OfflineMapsSection } from '../map/OfflineMapsSection';
import { bikeSettingsStore } from '../settings';
import {
  AUTO_LAP_MAX_M,
  AUTO_LAP_MIN_M,
  DIM_AFTER_MAX_SEC,
  DIM_AFTER_MIN_SEC,
  OFF_COURSE_MAX_M,
  OFF_COURSE_MIN_M,
} from '../settingsModel';
import type { AlertConfig, AutoLapConfig, ReminderAlert, RideThemeSetting, ZoneAlert } from '../types';
import { HrSensorSection } from './HrSensorSection';
import { LayoutEditor } from './LayoutEditor';
import { Stepper } from './Stepper';
import { useBikeLayout, useBikeSettings } from './useBikeSettings';

type ReminderKey = 'eat' | 'drink';
type ZoneKey = 'hr' | 'power';

const HR_ZONES = 5;
const POWER_ZONES = 7;

/** Settings > Bersepeda > Komputer sepeda: the mode, the ride screen's look, the data pages, ride features and alerts. */
export function BikeSettingsScreen() {
  const { t } = useTranslation('bikecomp');
  const settings = useBikeSettings();
  const layout = useBikeLayout();
  const [editing, setEditing] = useState(false);
  const { alerts, autoLap } = settings;

  const setAlerts = (patch: Partial<AlertConfig>) => bikeSettingsStore.set({ alerts: { ...alerts, ...patch } });
  const setZone = (key: ZoneKey, patch: Partial<ZoneAlert>) =>
    setAlerts(key === 'hr' ? { hr: { ...alerts.hr, ...patch } } : { power: { ...alerts.power, ...patch } });
  const setReminder = (key: ReminderKey, patch: Partial<ReminderAlert>) =>
    setAlerts(key === 'eat' ? { eat: { ...alerts.eat, ...patch } } : { drink: { ...alerts.drink, ...patch } });

  const themeOptions: { value: RideThemeSetting; label: string }[] = [
    { value: 'auto', label: t('settings.display.themeAuto') },
    { value: 'day', label: t('settings.display.themeDay') },
    { value: 'night', label: t('settings.display.themeNight') },
  ];
  const autoLapOptions: { value: AutoLapConfig['mode']; label: string }[] = [
    { value: 'off', label: t('settings.ride.autoLapOff') },
    { value: 'distance', label: t('settings.ride.autoLapDistance') },
    { value: 'start', label: t('settings.ride.autoLapStart') },
  ];
  const onAutoLapMode = (mode: AutoLapConfig['mode']) => {
    if (mode === 'off') bikeSettingsStore.set({ autoLap: { mode: 'off' } });
    else if (mode === 'start') bikeSettingsStore.set({ autoLap: { mode: 'start' } });
    else bikeSettingsStore.set({ autoLap: { mode: 'distance', everyM: autoLap.mode === 'distance' ? autoLap.everyM : 5000 } });
  };

  const zoneBlock = (key: ZoneKey, title: string, hint: string, zones: number) => {
    const zone = alerts[key];
    return (
      <>
        <SwitchRow label={title} hint={hint} value={zone.enabled} onValueChange={(enabled) => setZone(key, { enabled })} />
        {zone.enabled ? (
          <>
            <Stepper
              label={t('settings.alerts.minZone')}
              value={zone.minZone}
              min={1}
              max={zone.maxZone}
              step={1}
              format={(v) => t('settings.alerts.zoneValue', { value: v })}
              onChange={(minZone) => setZone(key, { minZone })}
            />
            <Stepper
              label={t('settings.alerts.maxZone')}
              value={zone.maxZone}
              min={zone.minZone}
              max={zones}
              step={1}
              format={(v) => t('settings.alerts.zoneValue', { value: v })}
              onChange={(maxZone) => setZone(key, { maxZone })}
            />
          </>
        ) : null}
      </>
    );
  };

  const reminderBlock = (key: ReminderKey, title: string) => {
    const reminder = alerts[key];
    const byDistance = reminder.everyM !== null && reminder.everySec === null;
    return (
      <>
        <SwitchRow label={title} value={reminder.enabled} onValueChange={(enabled) => setReminder(key, { enabled })} />
        {reminder.enabled ? (
          <>
            <Segmented<'time' | 'distance'>
              options={[
                { value: 'time', label: t('settings.alerts.byTime') },
                { value: 'distance', label: t('settings.alerts.byDistance') },
              ]}
              value={byDistance ? 'distance' : 'time'}
              onChange={(mode) =>
                setReminder(key, mode === 'distance' ? { everySec: null, everyM: reminder.everyM ?? 5000 } : { everySec: reminder.everySec ?? 1800, everyM: null })
              }
            />
            {byDistance ? (
              <Stepper
                label={t('settings.alerts.everyKm')}
                value={Math.round((reminder.everyM ?? 5000) / 1000)}
                min={1}
                max={50}
                step={1}
                format={(v) => t('unit.kilometres', { value: fmtInt(v) })}
                onChange={(km) => setReminder(key, { everyM: km * 1000 })}
              />
            ) : (
              <Stepper
                label={t('settings.alerts.everyMinutes')}
                value={Math.round((reminder.everySec ?? 1800) / 60)}
                min={5}
                max={180}
                step={5}
                format={(v) => t('unit.minutes', { value: fmtInt(v) })}
                onChange={(min) => setReminder(key, { everySec: min * 60 })}
              />
            )}
          </>
        ) : null}
      </>
    );
  };

  return (
    <>
      <Section title={t('settings.mode.title')} icon="bicycle">
        <SwitchRow
          label={t('settings.mode.enabled')}
          hint={t('settings.mode.hint')}
          value={settings.enabled}
          onValueChange={(enabled) => bikeSettingsStore.set({ enabled })}
        />
        <Details>{t('settings.mode.body')}</Details>
      </Section>

      <Section title={t('settings.display.title')} icon="contrast">
        <View style={styles.block}>
          <AppText variant="bodyStrong">{t('settings.display.theme')}</AppText>
          <Segmented<RideThemeSetting> options={themeOptions} value={settings.theme} onChange={(theme) => bikeSettingsStore.set({ theme })} />
          <AppText variant="caption" muted>
            {t('settings.display.themeHint')}
          </AppText>
        </View>
        <Divider />
        <SwitchRow
          label={t('settings.display.dim')}
          hint={t('settings.display.dimHint')}
          value={settings.dim}
          onValueChange={(dim) => bikeSettingsStore.set({ dim })}
        />
        {settings.dim ? (
          <>
            <Stepper
              label={t('settings.display.dimAfter')}
              value={settings.dimAfterSec}
              min={DIM_AFTER_MIN_SEC}
              max={DIM_AFTER_MAX_SEC}
              step={5}
              format={(v) => t('unit.seconds', { value: fmtInt(v) })}
              onChange={(dimAfterSec) => bikeSettingsStore.set({ dimAfterSec })}
            />
            <Stepper
              label={t('settings.display.dimLevel')}
              value={Math.round(settings.dimLevel * 100)}
              min={5}
              max={60}
              step={5}
              format={(v) => t('unit.percent', { value: fmtInt(v) })}
              onChange={(pct) => bikeSettingsStore.set({ dimLevel: pct / 100 })}
            />
          </>
        ) : null}
        <Notice icon="information-circle-outline">{t('settings.display.dimNote')}</Notice>
      </Section>

      <Section title={t('settings.pages.title')} icon="albums">
        <AppText variant="caption" muted>
          {t('settings.pages.body')}
        </AppText>
        <AppText variant="bodyStrong">{t('settings.pages.count', { count: layout.pages.length })}</AppText>
        <Button label={t('settings.pages.open')} variant="primary" icon="create-outline" onPress={() => setEditing(true)} />
      </Section>

      <Section title={t('settings.ride.title')} icon="speedometer">
        <SwitchRow
          label={t('settings.ride.autoPause')}
          hint={t('settings.ride.autoPauseHint')}
          value={settings.autoPause}
          onValueChange={(autoPause) => bikeSettingsStore.set({ autoPause })}
        />
        <Divider />
        <View style={styles.block}>
          <AppText variant="bodyStrong">{t('settings.ride.autoLap')}</AppText>
          <Segmented<AutoLapConfig['mode']> options={autoLapOptions} value={autoLap.mode} onChange={onAutoLapMode} />
          {autoLap.mode === 'start' ? (
            <AppText variant="caption" muted>
              {t('settings.ride.autoLapHintStart')}
            </AppText>
          ) : null}
        </View>
        {autoLap.mode === 'distance' ? (
          <Stepper
            label={t('settings.ride.autoLapEvery')}
            value={Math.round(autoLap.everyM / 1000)}
            min={AUTO_LAP_MIN_M / 1000}
            max={AUTO_LAP_MAX_M / 1000}
            step={1}
            format={(v) => t('unit.kilometres', { value: fmtInt(v) })}
            onChange={(km) => bikeSettingsStore.set({ autoLap: { mode: 'distance', everyM: km * 1000 } })}
          />
        ) : null}
        <Divider />
        <Stepper
          label={t('settings.ride.offCourse')}
          hint={t('settings.ride.offCourseHint')}
          value={settings.offCourseM}
          min={OFF_COURSE_MIN_M}
          max={OFF_COURSE_MAX_M}
          step={10}
          format={(v) => t('unit.metres', { value: fmtInt(v) })}
          onChange={(offCourseM) => bikeSettingsStore.set({ offCourseM })}
        />
      </Section>

      <Section title={t('settings.alerts.title')} icon="notifications">
        {zoneBlock('hr', t('settings.alerts.hr'), t('settings.alerts.hrHint'), HR_ZONES)}
        <Divider />
        {zoneBlock('power', t('settings.alerts.power'), t('settings.alerts.powerHint'), POWER_ZONES)}
        <Divider />
        <SwitchRow
          label={t('settings.alerts.cadence')}
          hint={t('settings.alerts.cadenceHint')}
          value={alerts.cadence.enabled}
          onValueChange={(enabled) => setAlerts({ cadence: { ...alerts.cadence, enabled } })}
        />
        {alerts.cadence.enabled ? (
          <>
            <Stepper
              label={t('settings.alerts.minRpm')}
              value={alerts.cadence.minRpm}
              min={20}
              max={alerts.cadence.maxRpm}
              step={5}
              format={(v) => t('unit.rpmValue', { value: fmtInt(v) })}
              onChange={(minRpm) => setAlerts({ cadence: { ...alerts.cadence, minRpm } })}
            />
            <Stepper
              label={t('settings.alerts.maxRpm')}
              value={alerts.cadence.maxRpm}
              min={alerts.cadence.minRpm}
              max={200}
              step={5}
              format={(v) => t('unit.rpmValue', { value: fmtInt(v) })}
              onChange={(maxRpm) => setAlerts({ cadence: { ...alerts.cadence, maxRpm } })}
            />
          </>
        ) : null}
        <Divider />
        {reminderBlock('eat', t('settings.alerts.eat'))}
        <Divider />
        {reminderBlock('drink', t('settings.alerts.drink'))}
        <Divider />
        <SwitchRow label={t('settings.alerts.offCourse')} value={alerts.offCourse} onValueChange={(offCourse) => setAlerts({ offCourse })} />
        <SwitchRow label={t('settings.alerts.lowBattery')} value={alerts.lowBattery} onValueChange={(lowBattery) => setAlerts({ lowBattery })} />
        <SwitchRow label={t('settings.alerts.sensorLost')} value={alerts.sensorLost} onValueChange={(sensorLost) => setAlerts({ sensorLost })} />
        <SwitchRow label={t('settings.alerts.gpsLost')} value={alerts.gpsLost} onValueChange={(gpsLost) => setAlerts({ gpsLost })} />
        <Divider />
        <SwitchRow label={t('settings.alerts.vibrate')} hint={t('settings.alerts.vibrateHint')} value={alerts.vibrate} onValueChange={(vibrate) => setAlerts({ vibrate })} />
        <SwitchRow label={t('settings.alerts.sound')} hint={t('settings.alerts.soundHint')} value={alerts.sound} onValueChange={(sound) => setAlerts({ sound })} />
      </Section>

      <HrSensorSection />

      <Section title={t('settings.share.title')} icon="location">
        <ShareSection enabled={settings.liveShare} onEnabledChange={(liveShare) => bikeSettingsStore.set({ liveShare })} />
      </Section>

      <OfflineMapsSection />

      <LayoutEditor visible={editing} onClose={() => setEditing(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
});
