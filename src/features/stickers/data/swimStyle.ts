import type { Locale } from '@/i18n';

const STYLES_ID: Readonly<Record<string, string>> = {
  freestyle: 'Gaya bebas',
  breaststroke: 'Gaya dada',
  backstroke: 'Gaya punggung',
  butterfly: 'Gaya kupu-kupu',
  medley: 'Campuran',
  mixed: 'Campuran',
};

const STYLES_EN: Readonly<Record<string, string>> = {
  freestyle: 'Freestyle',
  breaststroke: 'Breaststroke',
  backstroke: 'Backstroke',
  butterfly: 'Butterfly',
  medley: 'Medley',
  mixed: 'Medley',
};

/** Formats raw swimming style strings (from watch, FIT file or log) into localized presentation text. */
export function formatSwimStyle(raw: string | undefined | null, locale: 'id' | 'en' | Locale = 'id'): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const clean = trimmed.toLowerCase().replace(/[\s_-]+/g, '');
  const isId = locale === 'id' || (typeof locale === 'string' && locale.startsWith('id'));
  const dict = isId ? STYLES_ID : STYLES_EN;

  for (const [key, label] of Object.entries(dict)) {
    if (clean.includes(key)) return label;
  }

  // If already in title case or custom string, preserve as is
  return trimmed;
}
