import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { PressableScale } from '@/components/PressableScale';
import { fmtNumber } from '@/i18n';
import { HIT, spacing, tintColors, useTheme, type Tint } from '@/theme';

import { BAR_STEP, MAX_BAR, PLATES, platesFor } from '../plates';
import { getWeightUnit, kgToUnit } from '../units';
import { BottomSheet } from './Sheet';

interface PlateSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Distinct loads (kg) of the exercise's sets, to pick from. The first is the one shown. */
  weightsKg: readonly number[];
  /** The bar in the current unit. */
  bar: number;
  /** Called with the new bar, in the current unit; the screen saves it. */
  onBarChange: (bar: number) => void;
}

/** One colour per plate size, from the theme's tints (heaviest first); they cycle. */
const PLATE_TINTS: readonly Tint[] = ['heart', 'link', 'workouts', 'steps', 'sleep'];

const BAR_LENGTH = 40;
const PLATE_THICKNESS = 14;
const PLATE_MIN_HEIGHT = 36;
const PLATE_MAX_HEIGHT = 104;

/** Hevy's plate calculator: the plates of one side of the bar for a set's weight, as a picture and a list. */
export function PlateSheet({ visible, onClose, weightsKg, bar, onBarChange }: PlateSheetProps) {
  const { t } = useTranslation('strength');
  const { colors, radius } = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  // A pick that is no longer one of the exercise's loads (another exercise, an edited set) falls back to the first.
  const targetKg = picked !== null && weightsKg.includes(picked) ? picked : (weightsKg[0] ?? null);
  const close = () => {
    setPicked(null);
    onClose();
  };
  const unit = getWeightUnit();
  const target = targetKg === null ? null : kgToUnit(targetKg, unit);
  const load = useMemo(() => platesFor(target, bar, unit), [target, bar, unit]);
  const plateSizes = PLATES[unit];
  const heaviest = plateSizes[0]!;
  const unitLabel = t(`plates.unit.${unit}`);
  const num = (n: number) => fmtNumber(n, 2);
  const step = BAR_STEP[unit];
  const empty = target === null || target <= 0;

  const tintOf = (weight: number) => tintColors(colors, PLATE_TINTS[plateSizes.indexOf(weight) % PLATE_TINTS.length]!).base;

  return (
    <BottomSheet visible={visible} onClose={close} title={t('plates.title')}>
      {weightsKg.length > 1 ? (
        <View style={styles.wrap}>
          {weightsKg.map((kg) => (
            <Chip key={kg} label={t('plates.value', { value: num(kgToUnit(kg, unit)), unit: unitLabel })} selected={kg === targetKg} onPress={() => setPicked(kg)} />
          ))}
        </View>
      ) : null}

      {empty ? (
        <AppText variant="body" muted>
          {t('plates.empty')}
        </AppText>
      ) : (
        <>
          <View style={styles.summary}>
            <AppText variant="label" muted>
              {t('plates.target')}
            </AppText>
            <AppText variant="figure">{t('plates.value', { value: num(target), unit: unitLabel })}</AppText>
          </View>

          <View accessible accessibilityLabel={t('plates.pictureLabel')} style={[styles.picture, { backgroundColor: colors.muted, borderRadius: radius.card }]}>
            <View style={[styles.stop, { backgroundColor: colors.mutedForeground }]} />
            <View style={styles.rack}>
              <View style={[styles.barLine, { backgroundColor: colors.mutedForeground }]} />
              <View style={styles.plates}>
                {load.perSide.flatMap((plate) =>
                  Array.from({ length: plate.count }, (_, n) => (
                    <View
                      key={`${plate.weight}-${n}`}
                      style={[
                        styles.plate,
                        {
                          backgroundColor: tintOf(plate.weight),
                          height: PLATE_MIN_HEIGHT + (PLATE_MAX_HEIGHT - PLATE_MIN_HEIGHT) * (plate.weight / heaviest),
                        },
                      ]}
                    />
                  )),
                )}
                <View style={[styles.sleeve, { backgroundColor: colors.mutedForeground }]} />
              </View>
            </View>
          </View>

          {load.belowBar ? (
            <AppText variant="body" danger>
              {t('plates.belowBar', { bar: t('plates.value', { value: num(bar), unit: unitLabel }) })}
            </AppText>
          ) : load.perSide.length === 0 ? (
            <AppText variant="body">{t('plates.barOnly')}</AppText>
          ) : (
            <View style={styles.list}>
              <AppText variant="label" muted>
                {t('plates.perSide')}
              </AppText>
              {load.perSide.map((plate) => (
                <View key={plate.weight} style={styles.row}>
                  <View style={[styles.swatch, { backgroundColor: tintOf(plate.weight) }]} />
                  <AppText variant="bodyStrong" style={styles.rowWeight}>
                    {t('plates.value', { value: num(plate.weight), unit: unitLabel })}
                  </AppText>
                  <AppText variant="body" muted>
                    {t('plates.count', { n: plate.count })}
                  </AppText>
                </View>
              ))}
            </View>
          )}

          {load.remainder > 0 ? (
            <AppText variant="body" danger>
              {t('plates.inexact', { reached: t('plates.value', { value: num(load.reached), unit: unitLabel }), left: t('plates.value', { value: num(load.remainder), unit: unitLabel }) })}
            </AppText>
          ) : null}
        </>
      )}

      <View style={styles.barRow}>
        <View style={styles.barText}>
          <AppText variant="bodyStrong">{t('plates.bar')}</AppText>
          <AppText variant="caption" muted>
            {t('plates.barHint')}
          </AppText>
        </View>
        <View style={styles.stepper}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('plates.barLess')}
            disabled={bar <= 0}
            onPress={() => onBarChange(Math.max(0, bar - step))}
            style={[styles.stepButton, { backgroundColor: colors.muted, opacity: bar <= 0 ? 0.4 : 1 }]}>
            <Ionicons name="remove" size={22} color={colors.foreground} />
          </PressableScale>
          <AppText variant="bodyStrong" style={styles.barValue}>
            {t('plates.value', { value: num(bar), unit: unitLabel })}
          </AppText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('plates.barMore')}
            disabled={bar >= MAX_BAR}
            onPress={() => onBarChange(Math.min(MAX_BAR, bar + step))}
            style={[styles.stepButton, { backgroundColor: colors.muted, opacity: bar >= MAX_BAR ? 0.4 : 1 }]}>
            <Ionicons name="add" size={22} color={colors.foreground} />
          </PressableScale>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summary: { gap: spacing.xs },
  picture: { height: PLATE_MAX_HEIGHT + spacing.lg, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  stop: { width: 8, height: PLATE_MAX_HEIGHT * 0.9, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  rack: { flex: 1, justifyContent: 'center' },
  barLine: { position: 'absolute', left: 0, right: 0, height: 8 },
  plates: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: spacing.xs },
  plate: { width: PLATE_THICKNESS, borderRadius: 3 },
  sleeve: { width: BAR_LENGTH, height: 8 },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 16, height: 16, borderRadius: 4 },
  rowWeight: { minWidth: 88 },
  barRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  barText: { flex: 1, gap: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepButton: { width: HIT, height: HIT, borderRadius: HIT / 2, alignItems: 'center', justifyContent: 'center' },
  barValue: { minWidth: 72, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
