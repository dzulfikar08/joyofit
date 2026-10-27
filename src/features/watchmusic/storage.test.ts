import { describe, expect, test } from 'bun:test';

import type { WatchMusicInfo, WatchSong } from '@/wear';

import { byteFraction, bytesMb, formatList, freeMb, slotFraction, songCount } from './storage';

const info = (patch: Partial<WatchMusicInfo> = {}): WatchMusicInfo => ({
  freeSpaceMb: 512,
  formats: ['mp3', 'aac'],
  maxSongs: 100,
  songCount: null,
  maxPlaylists: null,
  frameCount: 1,
  limits: [],
  extended: false,
  ...patch,
});
const SONG: WatchSong = { id: 1, title: 'Lagu', artist: 'Artis', fileName: 'lagu.mp3' };

describe('watch music storage', () => {
  test('slot fraction', () => {
    expect(slotFraction(25, 100)).toBe(0.25);
    expect(slotFraction(0, 100)).toBe(0);
    expect(slotFraction(120, 100)).toBe(1);
    expect(slotFraction(5, null)).toBeNull();
    expect(slotFraction(5, 0)).toBeNull();
    expect(slotFraction(null, 100)).toBeNull();
  });

  test('song count prefers the list, then the reported count', () => {
    expect(songCount({ info: info({ songCount: 7 }), songs: [SONG, SONG] })).toBe(2);
    expect(songCount({ info: info({ songCount: 7 }), songs: [] })).toBe(7);
    expect(songCount({ info: info(), songs: [] })).toBe(0);
  });

  test('upload progress', () => {
    expect(byteFraction(512, 1024)).toBe(0.5);
    expect(byteFraction(2048, 1024)).toBe(1);
    expect(byteFraction(0, 0)).toBeNull();
  });

  test('MB text', () => {
    expect(bytesMb(5 * 1_048_576 + 524_288, 'en')).toBe('5.5');
    expect(bytesMb(5 * 1_048_576 + 524_288, 'id')).toBe('5,5');
    expect(freeMb(1234, 'id')).toBe('1.234');
    expect(freeMb(3.25, 'en')).toBe('3.3');
    expect(formatList(['mp3', 'm4a', 'aac'])).toBe('MP3, M4A, AAC');
  });
});
