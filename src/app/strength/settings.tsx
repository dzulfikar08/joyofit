import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { Divider, Screen, Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Skeleton } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useLocale } from '@/i18n';
import { HIT, spacing, useColors } from '@/theme';

import { buildCatalog, type Catalog } from '@/features/strength/catalog';
import { restLabel, secondsText, stepRest, timerText } from '@/features/strength/logFormat';
import {
  customExerciseIndex,
  listRestPrefs,
  loadSettings,
  saveSettings,
  setRestPref,
  type StrengthSettings,
} from '@/features/strength/store';
import { setWeightUnit, WEIGHT_UNITS } from '@/features/strength/units';
import { useWatchStartRefused, useWatchWorkoutAvailability } from '@/features/strength/useStrengthWatch';

/** Logger settings: the default rest, the switches, and the rest timers saved per exercise. */
export default function StrengthSettingsScreen() {
  const { t } = useTranslation('strength');
  const locale = useLocale();
  const db = useSQLiteContext();
  const colors = useColors();
  const [settings, setSettings] = useState<StrengthSettings | null>(null);
  const watchStart = useWatchWorkoutAvailability();
  const watchRefused = useWatchStartRefused();
  const [prefs, setPrefs] = useState<Map<string, number>>(new Map());
  const [catalog, setCatalog] = useState<Catalog>(() => buildCatalog([]));

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void Promise.all([loadSettings(db), listRestPrefs(db), customExerciseIndex(db)]).then(([loaded, saved, custom]) => {
        if (cancelled) return;
        setSettings(loaded);
        setPrefs(saved);
        setCatalog(buildCatalog([...custom.values()]));
      });
      return () => {
        cancelled = true;
      };
    }, [db]),
  );

  const change = (patch: Partial<StrengthSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    // The formatters read the module unit; every screen that draws a weight redraws from it (`useWeightUnit`).
    if (patch.weightUnit) setWeightUnit(patch.weightUnit);
    void saveSettings(db, next);
  };

  const clearPref = async (exerciseId: string) => {
    await setRestPref(db, exerciseId, null);
    setPrefs(await listRestPrefs(db));
  };

  const saved = [...prefs].map(([exerciseId, sec]) => ({ exerciseId, sec, name: catalog.name(exerciseId, locale) ?? t('removedExercise') }));
  saved.sort((a, b) => a.name.localeCompare(b.name, locale));

  return (
    <Screen>
      <Stack.Screen options={{ title: t('settings.title') }} />
      {settings === null ? (
        <>
          <Skeleton width="100%" height={160} radius="card" />
          <Skeleton width="100%" height={160} radius="card" />
        </>
      ) : (
        <>
          <Section title={t('units.title')} icon="barbell-outline" tint="workouts">
            <Segmented
              options={WEIGHT_UNITS.map((unit) => ({ value: unit, label: unit }))}
              value={settings.weightUnit}
              onChange={(weightUnit) => change({ weightUnit })}
            />
            <AppText variant="caption" muted>
              {t('units.hint')}
            </AppText>
          </Section>

          <Section title={t('settings.restTitle')} icon="timer-outline" tint="workouts">
            <View style={styles.stepper}>
              <View style={styles.grow}>
                <AppText variant="bodyStrong">{t('settings.defaultRest')}</AppText>
                <AppText variant="caption" muted>
                  {t('settings.defaultRestHint')}
                </AppText>
              </View>
              <StepButton icon="remove" label={t('settings.restLess')} disabled={settings.defaultRestSec <= 30} onPress={() => change({ defaultRestSec: stepRest(settings.defaultRestSec, -1) })} />
              <AppText variant="heading" style={styles.stepValue} accessibilityLiveRegion="polite">
                {settings.defaultRestSec < 60 ? secondsText(settings.defaultRestSec) : timerText(settings.defaultRestSec)}
              </AppText>
              <StepButton icon="add" label={t('settings.restMore')} disabled={settings.defaultRestSec >= 300} onPress={() => change({ defaultRestSec: stepRest(settings.defaultRestSec, 1) })} />
            </View>
            <Divider />
            <SwitchRow label={t('settings.autoRest')} hint={t('settings.autoRestHint')} value={settings.autoRest} onValueChange={(autoRest) => change({ autoRest })} />
          </Section>

          <Section title={t('settings.timedTitle')} icon="stopwatch-outline" tint="workouts">
            <SwitchRow label={t('settings.countdown')} hint={t('settings.countdownHint')} value={settings.countdownTimed} onValueChange={(countdownTimed) => change({ countdownTimed })} />
          </Section>

          {watchStart !== 'unavailable' ? (
            <Section title={t('settings.watchTitle')} icon="watch-outline" tint="link">
              {watchStart === 'unsupported' || watchRefused ? (
                <AppText variant="caption" muted>
                  {t(watchStart === 'unsupported' ? 'settings.startOnWatchUnsupported' : 'settings.startOnWatchRefused')}
                </AppText>
              ) : (
                <SwitchRow
                  label={t('settings.startOnWatch')}
                  hint={watchStart === 'offline' ? `${t('settings.startOnWatchHint')} ${t('settings.startOnWatchOffline')}` : t('settings.startOnWatchHint')}
                  value={settings.startOnWatch}
                  onValueChange={(startOnWatch) => change({ startOnWatch })}
                />
              )}
            </Section>
          ) : null}

          <Section title={t('settings.screenTitle')} icon="phone-portrait-outline" tint="link">
            <SwitchRow label={t('settings.keepAwake')} hint={t('settings.keepAwakeHint')} value={settings.keepAwake} onValueChange={(keepAwake) => change({ keepAwake })} />
            <Divider />
            <SwitchRow label={t('settings.showRpe')} hint={t('settings.showRpeHint')} value={settings.showRpe} onValueChange={(showRpe) => change({ showRpe })} />
          </Section>

          <Section title={t('settings.shareTitle')} icon="share-social-outline" tint="steps">
            <SwitchRow label={t('settings.autoStrava')} hint={t('settings.autoStravaHint')} value={settings.autoStrava} onValueChange={(autoStrava) => change({ autoStrava })} />
          </Section>

          <Section title={t('settings.savedRest')} icon="bookmark-outline">
            {saved.length === 0 ? (
              <AppText variant="caption" muted>
                {t('settings.savedRestEmpty')}
              </AppText>
            ) : (
              saved.map((entry, index) => (
                <View key={entry.exerciseId}>
                  {index > 0 ? <Divider /> : null}
                  <View style={styles.savedRow}>
                    <View style={styles.grow}>
                      <AppText variant="bodyStrong" numberOfLines={1}>
                        {entry.name}
                      </AppText>
                      <AppText variant="caption" muted>
                        {restLabel(entry.sec)}
                      </AppText>
                    </View>
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={t('settings.clearRest', { name: entry.name })}
                      onPress={() => void clearPref(entry.exerciseId)}
                      style={styles.hit}>
                      <Ionicons name="close-circle-outline" size={22} color={colors.mutedForeground} />
                    </PressableScale>
                  </View>
                </View>
              ))
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}

function StepButton({ icon, label, disabled, onPress }: { icon: 'add' | 'remove'; label: string; disabled: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.step, { backgroundColor: colors.muted }]}>
      <Ionicons name={icon} size={20} color={colors.foreground} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, gap: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: HIT },
  step: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 56, textAlign: 'center' },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: HIT },
  hit: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
});
