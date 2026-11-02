import { useMemo } from 'react';

import { useTheme, type Colors } from '@/theme';
import type { AnalysisMapTheme, AnalysisPalette } from './ui';
import { defaultPalette } from './ui';

/**
 * The analysis components' palette from JoyoFit's theme: workouts tint as the accent, the heart colour for heart rate,
 * link green for speed, steps blue for cadence, warning amber for power. Zones keep the analysis defaults (a fixed
 * easy-to-hard ramp that reads in both schemes).
 */
export function analysisPalette(colors: Colors, isDark: boolean, fonts: { regular: string; bold: string }): AnalysisPalette {
  const base = defaultPalette(isDark);
  return {
    ...base,
    background: colors.background,
    surface: colors.card,
    surfaceAlt: colors.muted,
    text: colors.foreground,
    textMuted: colors.mutedForeground,
    border: colors.hairline,
    accent: colors.workouts,
    hr: colors.heart,
    pace: colors.link,
    elevation: colors.sleep,
    cadence: colors.steps,
    power: colors.warning,
    hrv: colors.heart,
    stress: colors.sleep,
    negative: colors.destructive,
    mapRoute: colors.workouts,
    mapRouteCasing: colors.card,
    fonts,
  };
}

/** The palette for the current JoyoFit theme and colour scheme; stable until either changes. */
export function useAnalysisPalette(): AnalysisPalette {
  const { colors, scheme, fonts } = useTheme();
  return useMemo(
    () => analysisPalette(colors, scheme === 'dark', { regular: fonts.regular, bold: fonts.bold }),
    [colors, scheme, fonts.regular, fonts.bold],
  );
}

/** Light or dark map tiles to match the screen. */
export function useMapTheme(): AnalysisMapTheme {
  return useTheme().scheme;
}
