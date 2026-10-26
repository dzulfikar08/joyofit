import type { OfflineMapSendResult } from '@/wear';

/** The `settings:offlineMapLab.mapType.<key>` strings. */
export function mapTypeKey(type: number): 'region' | 'contour' | 'global' | 'ski' | 'other' {
  return (['region', 'contour', 'global', 'ski'] as const)[type] ?? 'other';
}

/**
 * The verdict of a send (`settings:offlineMapLab.verdict.<key>`): the watch's parse result (`08`) decides when it sent one; otherwise the map in
 * the watch's list counts as accepted (the Fit 4 Pro sends no `08`); neither is its own case.
 */
export type SendVerdict = 'parsedOk' | 'parsedFailed' | 'listed' | 'noParse';

export function sendVerdict(result: OfflineMapSendResult): SendVerdict {
  if (result.parsed !== null) return result.parsed.code === 0 ? 'parsedOk' : 'parsedFailed';
  return result.listed ? 'listed' : 'noParse';
}

/** kB/s with one decimal below 10, whole above; null when unknown. */
export function rateKbps(bytesPerSecond: number | null): string | null {
  if (bytesPerSecond === null || bytesPerSecond <= 0) return null;
  const kb = bytesPerSecond / 1000;
  return kb < 10 ? kb.toFixed(1) : String(Math.round(kb));
}

/** Seconds, rounded, from milliseconds; null stays null. */
export function seconds(ms: number | null): number | null {
  return ms === null ? null : Math.round(ms / 1000);
}
