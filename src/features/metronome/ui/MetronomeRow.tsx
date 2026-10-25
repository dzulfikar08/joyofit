import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { Segmented } from '@/components/Segmented';
import { fmtInt } from '@/i18n';
import { spacing, useTheme } from '@/theme';

import { metronome, useMetronome } from '../metronome';
import { MAX_BPM, METRONOME_MODES, type MetronomeMode, MIN_BPM, stepBpm } from '../metronomeModel';

/**
 * The cadence metronome during a workout: its switch, its tempo in beats per minute (120 to 200, steps of 5), and what a beat
 * does (vibration, sound, or both).
 */
export function MetronomeRow() {
  const { t } = useTranslation('sharing');
  const { colors, fonts, radius } = useTheme();
  const { enabled, bpm, mode } = useMetronome();
  const modeOptions = METRONOME_MODES.map((value) => ({ value, label: t(`live.metronome.mode.${value}`) }));

  const step = (direction: -1 | 1) => {
    const can = direction < 0 ? bpm > MIN_BPM : bpm < MAX_BPM;
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t(direction < 0 ? 'live.metronome.slower' : 'live.metronome.faster')}
        accessibilityState={{ disabled: !can }}
        disabled={!can}
        scaleTo={0.96}
        onPress={() => metronome.setBpm(stepBpm(bpm, direction))}
        style={[styles.step, { backgroundColor: colors.muted, borderRadius: radius.control, opacity: can ? 1 : 0.4 }]}>
        <Ionicons name={direction < 0 ? 'remove' : 'add'} size={24} color={colors.foreground} />
      </PressableScale>
    );
  };

  return (
    <View style={styles.wrap}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={t('live.metronome.title')}
        accessibilityValue={{ text: t('live.metronome.value', { bpm: fmtInt(bpm) }) }}
        style={styles.row}>
        <Ionicons name="musical-notes" size={22} color={enabled ? colors.primary : colors.mutedForeground} />
        <View style={styles.text}>
          <AppText variant="bodyStrong">{t('live.metronome.title')}</AppText>
          <AppText variant="caption" muted>
            {t(`live.metronome.hint.${mode}`)}
          </AppText>
        </View>
        {step(-1)}
        <AppText style={[styles.value, { fontFamily: fonts.numeral }]} numberOfLines={1}>
          {fmtInt(bpm)}
        </AppText>
        {step(1)}
        <Switch
          accessibilityLabel={t('live.metronome.title')}
          value={enabled}
          onValueChange={(value) => metronome.setEnabled(value)}
          trackColor={{ false: colors.switchOff, true: colors.primary }}
          thumbColor={enabled ? colors.primaryForeground : colors.card}
        />
      </View>
      <Segmented<MetronomeMode> options={modeOptions} value={mode} onChange={(value) => metronome.setMode(value)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56 },
  text: { flex: 1, gap: 1 },
  step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 40, textAlign: 'center', fontSize: 18, fontVariant: ['tabular-nums'] },
});
