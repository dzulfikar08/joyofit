import { afterEach, describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';

import { failureOf, failureText, rejectText } from './errorText';
import { checkSongs } from './musicFiles';

afterEach(() => applyLocale('id'));

const coded = (code: string, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { code, ...extra });

describe('watch music error text', () => {
  test('failureOf reads the code, the message and the watch status code', () => {
    expect(failureOf(coded('ERR_UPLOAD_REJECTED', 'The watch does not have enough free space (code 140009).'))).toEqual({
      code: 'ERR_UPLOAD_REJECTED',
      message: 'The watch does not have enough free space (code 140009).',
      statusCode: 140009,
    });
    expect(failureOf(coded('ERR_UPLOAD_REJECTED', 'refused', { statusCode: 140004 })).statusCode).toBe(140004);
    expect(failureOf(new Error('boom'))).toEqual({ code: null, message: 'boom', statusCode: null });
  });

  test('known refusals and codes get their own sentence', () => {
    const text = (e: unknown) => failureText(failureOf(e));
    expect(text(coded('ERR_UPLOAD_REJECTED', 'x (code 140004).'))).toContain('140004');
    expect(text(coded('ERR_UPLOAD_REJECTED', 'x (code 140008).'))).toBe('Lagu ini sudah ada di jam (kode 140008).');
    expect(text(coded('ERR_UPLOAD_REJECTED', 'x (code 140009).'))).toContain('140009');
    expect(text(coded('ERR_UPLOAD_REJECTED', 'code 7'))).toBe('Jam menolak file. code 7');
    expect(text(coded('ERR_INVALID_ARGUMENT', 'Not an MP3'))).toBe('File tidak bisa dikirim. Not an MP3');
    expect(text(coded('ERR_BUSY', 'busy'))).toBe('Jam sedang menerima file lain. Coba lagi sebentar lagi.');
    expect(text(coded('ERR_NOT_CONNECTED', 'no'))).toBe('Jam tidak terhubung.');
    expect(text(coded('ERR_TIMEOUT', 'silent'))).toBe('Jam berhenti menjawab. Coba lagi.');
    expect(text(coded('ERR_PROTOCOL', 'File upload: bad frame'))).toBe('File upload: bad frame');
  });

  test('English twin', async () => {
    await applyLocale('en');
    expect(failureText({ code: 'ERR_UPLOAD_REJECTED', message: 'x', statusCode: 140008 })).toBe('This song is already on the watch (code 140008).');
  });

  test('reject text names the file and the format', () => {
    const [flac, bare, m4a, big] = checkSongs(
      [
        { uri: 'u', name: 'lagu.wma', size: 10 },
        { uri: 'u', name: 'lagu', size: 10 },
        { uri: 'u', name: 'lagu.m4a', size: 10 },
        { uri: 'u', name: 'besar.mp3', size: 3 * 1_048_576 },
      ],
      { formats: ['mp3', 'aac'], freeSpaceMb: 2 },
    );
    expect(rejectText(flac, ['mp3', 'aac'])).toBe('lagu.wma: format WMA tidak didukung. Pakai MP3, M4A, AAC, FLAC, WAV, atau Opus; JoyoFit tidak mengonversi lagu.');
    expect(rejectText(bare, ['mp3', 'aac'])).toStartWith('lagu: nama file tanpa ekstensi');
    expect(rejectText(m4a, ['mp3', 'aac'])).toBe('lagu.m4a: jam ini tidak menerima M4A. Format yang diterima jam: MP3, AAC.');
    expect(rejectText(big, ['mp3', 'aac'])).toBe('besar.mp3 (3 MB): ruang kosong di jam tidak cukup.');
  });
});
