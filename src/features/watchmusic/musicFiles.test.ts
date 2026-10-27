import { describe, expect, test } from 'bun:test';

import { checkSongs, extensionOf, formatOf, MAX_SONG_BYTES, type PickedSong } from './musicFiles';

const MB = 1_048_576;
const song = (name: string, size: number | null = 5 * MB): PickedSong => ({ uri: `file:///cache/${name}`, name, size });
const ALL = { formats: ['mp3', 'm4a', 'aac'], freeSpaceMb: 1000 };

describe('watch music files', () => {
  test('extensions and formats', () => {
    expect(extensionOf('lagu.MP3')).toBe('mp3');
    expect(extensionOf('a.b.m4a')).toBe('m4a');
    expect(extensionOf('lagu')).toBe('');
    expect(extensionOf('.mp3')).toBe('');
    expect(extensionOf('lagu.')).toBe('');
    expect(formatOf('lagu.mp3')).toBe('mp3');
    expect(formatOf('lagu.M4A')).toBe('m4a');
    expect(formatOf('lagu.Aac')).toBe('aac');
    expect(formatOf('lagu.flac')).toBeNull();
  });

  test('MP3, M4A and AAC are accepted, in any case', () => {
    const checks = checkSongs([song('a.mp3'), song('b.m4a'), song('c.aac'), song('D.MP3')], ALL);
    expect(checks.map((c) => (c.accepted ? c.format : null))).toEqual(['mp3', 'm4a', 'aac', 'mp3']);
  });

  test('other formats and names without an extension are rejected', () => {
    const checks = checkSongs([song('a.flac'), song('b.wav'), song('c.ogg'), song('d.opus'), song('lagu')], ALL);
    expect(checks.map((c) => (c.accepted ? null : [c.reason, c.extension]))).toEqual([
      ['format', 'flac'],
      ['format', 'wav'],
      ['format', 'ogg'],
      ['format', 'opus'],
      ['noExtension', ''],
    ]);
  });

  test('a format the watch does not list is rejected', () => {
    const checks = checkSongs([song('a.m4a'), song('b.mp3')], { formats: ['MP3', 'aac'], freeSpaceMb: 1000 });
    expect(checks[0]).toMatchObject({ accepted: false, reason: 'notOnWatch', extension: 'm4a' });
    expect(checks[1]).toMatchObject({ accepted: true, format: 'mp3' });
    expect(checkSongs([song('a.mp3')], { formats: [], freeSpaceMb: 1000 })[0]).toMatchObject({ accepted: false, reason: 'notOnWatch' });
  });

  test('size: empty, over 64 MiB, and free space counted down over the batch', () => {
    const checks = checkSongs([song('a.mp3', 0), song('b.mp3', MAX_SONG_BYTES + 1), song('c.mp3', 6 * MB), song('d.mp3', 5 * MB), song('e.mp3', 4 * MB)], {
      ...ALL,
      freeSpaceMb: 10,
    });
    expect(checks.map((c) => (c.accepted ? 'ok' : c.reason))).toEqual(['empty', 'tooBig', 'ok', 'noSpace', 'ok']);
  });

  test('unknown size or free space leaves the check to the watch', () => {
    expect(checkSongs([song('a.mp3', null)], { ...ALL, freeSpaceMb: 1 })[0].accepted).toBe(true);
    expect(checkSongs([song('a.mp3', 60 * MB), song('b.mp3', 60 * MB)], { ...ALL, freeSpaceMb: null }).every((c) => c.accepted)).toBe(true);
    expect(checkSongs([song('a.mp3', MAX_SONG_BYTES)], { ...ALL, freeSpaceMb: null })[0].accepted).toBe(true);
  });
});
