import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Screen, Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { buildPlan, defaultWeekdays, planWeeks, startPlan, type PlanChoice } from '@/features/coach/actions';
import type { PlanGoal, PlanLevel, StrengthSetting } from '@/features/coach/doc';
import { ChoiceCard } from '@/features/coach/ui/ChoiceCard';
import { CoachGate } from '@/features/coach/ui/CoachGate';
import { errorMessage } from '@/format';
import { fmtDay, fmtInt, useLocale } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { spacing } from '@/theme';

const GOALS: readonly PlanGoal[] = ['runWalk', 'run5k', 'run10k', 'runHalf', 'runRoutine', 'strengthFull'];
const LEVELS: readonly PlanLevel[] = ['beginner', 'intermediate', 'advanced'];
const SETTINGS: readonly StrengthSetting[] = ['home', 'gym'];

function dayChoices(goal: PlanGoal): number[] {
  if (goal === 'strengthFull') return [2, 3];
  return goal === 'runRoutine' || goal === 'runWalk' ? [3] : [3, 4, 5];
}

function SetupForm() {
  const { t } = useTranslation('coach');
  useLocale();
  const router = useRouter();
  const db = useSQLiteContext();
  const cloud = useCloud();
  const [goal, setGoal] = useState<PlanGoal>('run5k');
  const [level, setLevel] = useState<PlanLevel>('beginner');
  const [setting, setSetting] = useState<StrengthSetting>('home');
  const [days, setDays] = useState(3);
  const [weekdays, setWeekdays] = useState<number[]>(defaultWeekdays(3));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = goal === 'strengthFull';
  const runWalk = goal === 'runWalk';

  const chooseGoal = (next: PlanGoal) => {
    setGoal(next);
    const options = dayChoices(next);
    if (!options.includes(days)) {
      const first = options[0] ?? 3;
      setDays(first);
      setWeekdays(defaultWeekdays(first));
    }
  };
  const chooseDays = (next: number) => {
    setDays(next);
    setWeekdays(defaultWeekdays(next));
  };
  const toggleDay = (day: number) =>
    setWeekdays((current) => (current.includes(day) ? current.filter((d) => d !== day) : current.length >= days ? current : [...current, day].sort((a, b) => a - b)));

  // Lari-jalan is one plan for everyone who starts from walking: it has no level to pick.
  const choice: PlanChoice = { kind: strength ? 'strength' : 'run', goal, level: runWalk ? 'beginner' : level, daysPerWeek: days, setting: strength ? setting : null, weekdays };
  const ready = weekdays.length === days;

  const start = async (now: number) => {
    setSaving(true);
    setError(null);
    try {
      await startPlan(db, buildPlan(choice, now));
      if (cloud.signedIn) void cloud.syncNow().catch(() => {});
      router.replace('/coach');
    } catch (e) {
      setError(t('setup.error', { message: errorMessage(e) }));
      setSaving(false);
    }
  };

  return (
    <>
      <Section title={t('setup.goal.title')} icon="flag" tint="workouts">
        <View style={styles.stack} accessibilityRole="radiogroup">
          {GOALS.map((g) => (
            <ChoiceCard key={g} title={t(`setup.goal.${g}.title`)} hint={t(`setup.goal.${g}.hint`)} selected={goal === g} onPress={() => chooseGoal(g)} />
          ))}
        </View>
      </Section>

      {runWalk ? (
        <Notice icon="heart">{t('setup.runWalk.note')}</Notice>
      ) : (
        <Section title={t('setup.level.title')} icon="speedometer" tint="workouts">
          <View style={styles.stack} accessibilityRole="radiogroup">
            {LEVELS.map((l) => (
              <ChoiceCard key={l} title={t(`level.${l}`)} hint={t(strength ? `setup.levelStrength.${l}` : `setup.level.${l}`)} selected={level === l} onPress={() => setLevel(l)} />
            ))}
          </View>
        </Section>
      )}

      {strength ? (
        <Section title={t('setup.setting.title')} icon="home" tint="workouts">
          <View style={styles.stack} accessibilityRole="radiogroup">
            {SETTINGS.map((s) => (
              <ChoiceCard key={s} title={t(`setup.setting.${s}`)} hint={t(`setup.setting.${s}Hint`)} selected={setting === s} onPress={() => setSetting(s)} />
            ))}
          </View>
        </Section>
      ) : null}

      <Section title={t('setup.days.title')} icon="calendar" tint="workouts">
        <Segmented options={dayChoices(goal).map((d) => ({ value: d, label: fmtInt(d) }))} value={days} onChange={chooseDays} />
        <AppText variant="caption" muted>
          {t('setup.days.hint', { n: fmtInt(days) })}
        </AppText>
        <AppText variant="bodyStrong">{t('setup.weekdays.title')}</AppText>
        <View style={styles.chips}>
          {[0, 1, 2, 3, 4, 5, 6].map((day) => (
            <Chip key={day} label={fmtDay(`2026-10-${String(12 + day)}`, 'dayShort')} selected={weekdays.includes(day)} onPress={() => toggleDay(day)} role="checkbox" />
          ))}
        </View>
        <AppText variant="caption" muted>
          {ready ? t(runWalk ? 'setup.weekdays.hintRunWalk' : 'setup.weekdays.hint', { n: fmtInt(days) }) : t('setup.weekdays.needMore', { n: fmtInt(days - weekdays.length) })}
        </AppText>
      </Section>

      <AppText variant="caption" muted>
        {t('setup.summary', { weeks: fmtInt(planWeeks(choice)), days: fmtInt(days) })}
      </AppText>
      <Details>{t('disclaimer')}</Details>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={saving ? t('setup.starting') : t('setup.start')} variant="primary" icon="play" onPress={() => void start(Date.now())} disabled={!ready} loading={saving} />
    </>
  );
}

export default function CoachSetupScreen() {
  return (
    <Screen>
      <CoachGate>
        <SetupForm />
      </CoachGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
