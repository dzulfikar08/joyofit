import { fmtNumber, getLocale, type Locale } from '@/i18n';
import type { WatchMusicList } from '@/wear';

/** How many songs the watch holds: the list read when there is one, else the count the watch reported (null when it sent none). */
export function songCount(list: Pick<WatchMusicList, 'info' | 'songs'>): number | null {
  return list.songs.length > 0 || list.info.songCount === null ? list.songs.length : list.info.songCount;
}

/** The share of the watch's song slots in use, 0..1; null without a maximum (the screen then shows the count as text only). */
export function slotFraction(count: number | null, maxSongs: number | null): number | null {
  if (count === null || maxSongs === null || maxSongs <= 0) return null;
  return Math.min(1, Math.max(0, count / maxSongs));
}

/** The share of a running upload that has reached the watch, 0..1; null before the first progress event or without a total. */
export function byteFraction(bytes: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(1, Math.max(0, bytes / total));
}

/** Bytes as MB (MiB) with one decimal, in the language's separators. */
export function bytesMb(bytes: number, locale: Locale = getLocale()): string {
  return fmtNumber(bytes / 1_048_576, 1, locale);
}

/** The watch's free space in MB as it reported it: whole above 10, one decimal below. */
export function freeMb(mb: number, locale: Locale = getLocale()): string {
  return fmtNumber(mb, mb < 10 ? 1 : 0, locale);
}

/** The watch's formats for the screen: `MP3, M4A, AAC`. */
export function formatList(formats: readonly string[]): string {
  return formats.map((f) => f.toUpperCase()).join(', ');
}
