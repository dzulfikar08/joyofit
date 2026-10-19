import type { AutoStartVendor, BackgroundRestrictions } from '@/wear';

/**
 * What Android does to JoyoFit that drops the watch link with the screen off: `restricted` is the "Restricted" background use (the app may
 * not run at all, and only its own settings screen lifts it), `optimized` is the ordinary battery optimization (Doze and App Standby cut the
 * background service; the exemption lifts it).
 */
export type BatteryHelpKind = 'restricted' | 'optimized';

/** The situation to explain, or null when Android leaves the connection alone (or on iOS, where `restrictions` is null). */
export function batteryHelpKind(restrictions: BackgroundRestrictions | null): BatteryHelpKind | null {
  if (restrictions === null) return null;
  if (restrictions.backgroundRestricted) return 'restricted';
  return restrictions.ignoringBatteryOptimizations ? null : 'optimized';
}

/**
 * The notice to show on the Watch tab: the situation unless the person already closed that very one. Closing `optimized` does not hide a later
 * `restricted`, which needs a different fix.
 */
export function visibleBatteryHelp(restrictions: BackgroundRestrictions | null, dismissed: BatteryHelpKind | null): BatteryHelpKind | null {
  const kind = batteryHelpKind(restrictions);
  return kind !== null && kind !== dismissed ? kind : null;
}

/** What the store kept of the dismissal; anything else (an older build, a damaged value) counts as never dismissed. */
export function parseDismissed(stored: string | null): BatteryHelpKind | null {
  return stored === 'restricted' || stored === 'optimized' ? stored : null;
}

/** Brand names, which read the same in every language: the makers whose auto-start list `openAutoStartSettings` knows. */
export const VENDOR_NAMES: Record<AutoStartVendor, string> = {
  transsion: 'Infinix, Tecno, itel',
  xiaomi: 'Xiaomi, Redmi, POCO',
  oppo: 'OPPO, realme',
  vivo: 'vivo, iQOO',
};
