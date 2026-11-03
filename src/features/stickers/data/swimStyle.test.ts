import { describe, expect, it } from 'bun:test';

import { formatSwimStyle } from './swimStyle';

describe('formatSwimStyle', () => {
  it('localizes common watch stroke codes in Indonesian', () => {
    expect(formatSwimStyle('freestyle', 'id')).toBe('Gaya bebas');
    expect(formatSwimStyle('breaststroke', 'id')).toBe('Gaya dada');
    expect(formatSwimStyle('backstroke', 'id')).toBe('Gaya punggung');
    expect(formatSwimStyle('butterfly', 'id')).toBe('Gaya kupu-kupu');
    expect(formatSwimStyle('medley', 'id')).toBe('Campuran');
  });

  it('localizes common watch stroke codes in English', () => {
    expect(formatSwimStyle('freestyle', 'en')).toBe('Freestyle');
    expect(formatSwimStyle('breaststroke', 'en')).toBe('Breaststroke');
    expect(formatSwimStyle('backstroke', 'en')).toBe('Backstroke');
    expect(formatSwimStyle('butterfly', 'en')).toBe('Butterfly');
    expect(formatSwimStyle('medley', 'en')).toBe('Medley');
  });

  it('handles variations like uppercase or hyphenated names', () => {
    expect(formatSwimStyle('BREAST_STROKE', 'id')).toBe('Gaya dada');
    expect(formatSwimStyle('Back-stroke', 'en')).toBe('Backstroke');
    expect(formatSwimStyle('Individual Medley', 'id')).toBe('Campuran');
  });

  it('preserves custom already-localized strings', () => {
    expect(formatSwimStyle('Gaya dada', 'id')).toBe('Gaya dada');
    expect(formatSwimStyle('Latihan Kaki', 'id')).toBe('Latihan Kaki');
  });

  it('returns null for empty or nullish inputs', () => {
    expect(formatSwimStyle(null)).toBeNull();
    expect(formatSwimStyle(undefined)).toBeNull();
    expect(formatSwimStyle('')).toBeNull();
    expect(formatSwimStyle('   ')).toBeNull();
  });
});
