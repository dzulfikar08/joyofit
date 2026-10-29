/**
 * A month grid (weeks start on Monday) with a dot for every strength workout and for every other workout of each day.
 * Tap a day to select it; the parent shows that day's items.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { localDay } from '@/features/strength/calc';
import { dayCounts, monthGrid, type DayItem, type MonthRef } from '@/features/strength/historyModel';
import { useNow } from '@/hooks/useNow';
import { fmtDay, fmtInt, useLocale } from '@/i18n';
import { spacing, useTheme } from '@/theme';

const MAX_DOTS = 4;

interface CalendarProps {
  month: MonthRef;
  days: ReadonlyMap<string, readonly DayItem[]>;
  /** `YYYY-MM-DD` or null. */
  selected: string | null;
  onSelect: (day: string) => void;
}

/** 2024-01-01 is a Monday: its week names the columns in the language of the UI. */
const MONDAY_BASE = '2024-01-0';

export function Calendar({ month, days, selected, onSelect }: CalendarProps) {
  const { t } = useTranslation('lifts');
  const { colors } = useTheme();
  const locale = useLocale();
  const grid = useMemo(() => monthGrid(month), [month]);
  const weekdays = useMemo(
    () => [1, 2, 3, 4, 5, 6, 7].map((n) => fmtDay(`${MONDAY_BASE}${n}`, 'dayShort')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  // A minute is fine enough for the day to roll over while the screen is open.
  const today = localDay(useNow(60_000));

  return (
    <View style={styles.grid}>
      <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {weekdays.map((name, i) => (
          <View key={i} style={styles.cell}>
            <AppText variant="caption" muted numberOfLines={1}>
              {name}
            </AppText>
          </View>
        ))}
      </View>
      {grid.map((week) => (
        <View key={week[0]!.day} style={styles.row}>
          {week.map((cell) => {
            const counts = dayCounts(days.get(cell.day));
            const isSelected = selected === cell.day;
            const isToday = cell.day === today;
            const date = fmtDay(cell.day, 'long');
            const label =
              counts.strength > 0 && counts.other > 0
                ? t('calendar.day.both', { date, strength: counts.strength, other: counts.other })
                : counts.strength > 0
                  ? t('calendar.day.strength', { date, strength: counts.strength })
                  : counts.other > 0
                    ? t('calendar.day.other', { date, other: counts.other })
                    : t('calendar.day.none', { date });
            const dots: string[] = [
              ...Array<string>(Math.min(counts.strength, MAX_DOTS)).fill(colors.primary),
              ...Array<string>(Math.min(counts.other, MAX_DOTS)).fill(colors.workouts),
            ].slice(0, MAX_DOTS);
            return (
              <PressableScale
                key={cell.day}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: isSelected }}
                scaleTo={0.94}
                onPress={() => onSelect(cell.day)}
                style={[styles.cell, styles.day, !cell.inMonth && styles.outside]}>
                <View
                  style={[
                    styles.number,
                    isSelected ? { backgroundColor: colors.primary } : isToday ? { borderColor: colors.primary, borderWidth: 1.5 } : null,
                  ]}>
                  <AppText variant="label" color={isSelected ? colors.primaryForeground : colors.foreground} style={styles.numberText}>
                    {fmtInt(cell.date)}
                  </AppText>
                </View>
                <View style={styles.dots}>
                  {dots.map((color, i) => (
                    <View key={i} style={[styles.dot, { backgroundColor: color }]} />
                  ))}
                </View>
              </PressableScale>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 2 },
  row: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 24 },
  day: { minHeight: 52, gap: 3 },
  outside: { opacity: 0.4 },
  number: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  numberText: { fontVariant: ['tabular-nums'] },
  dots: { flexDirection: 'row', gap: 3, height: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
