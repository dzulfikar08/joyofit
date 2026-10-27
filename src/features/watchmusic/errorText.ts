import { errorCode } from '@/features/device/connectFailure';
import { errorMessage } from '@/format';
import { t } from '@/i18n';

import { MAX_SONG_BYTES, type SongCheck } from './musicFiles';
import { bytesMb, formatList } from './storage';
import type { QueueFailure } from './uploadQueue';

/** The watch's upload refusals the native side names (FileUploader): too many songs, already there, no space. */
const REJECT_KEYS: Readonly<Record<number, 'tooMany' | 'alreadyThere' | 'noSpace'>> = {
  140004: 'tooMany',
  140008: 'alreadyThere',
  140009: 'noSpace',
};

/** Codes whose own sentence replaces the native message. */
const CODE_KEYS: Readonly<Record<string, 'busy' | 'notConnected' | 'disconnected' | 'timeout' | 'unsupported'>> = {
  ERR_BUSY: 'busy',
  ERR_NOT_CONNECTED: 'notConnected',
  ERR_DISCONNECTED: 'disconnected',
  ERR_TIMEOUT: 'timeout',
  ERR_UNSUPPORTED: 'unsupported',
};

/**
 * A rejected native call as data: the `ERR_*` code, the message, and the watch's status code. The status code travels as `statusCode`
 * when the bridge carries it; otherwise it is read from the message, which names it ("... (code 140009)").
 */
export function failureOf(e: unknown): QueueFailure {
  const message = errorMessage(e);
  const own = typeof e === 'object' && e !== null && 'statusCode' in e && typeof e.statusCode === 'number' ? e.statusCode : null;
  const named = /\b(1400\d{2})\b/.exec(message);
  return { code: errorCode(e), message, statusCode: own ?? (named ? Number(named[1]) : null) };
}

/** The sentence for a failed music call: the watch's known refusals and the common codes in plain words, anything else its own message. */
export function failureText(failure: QueueFailure): string {
  const { code, message, statusCode } = failure;
  if (code === 'ERR_UPLOAD_REJECTED') {
    const known = statusCode === null ? undefined : REJECT_KEYS[statusCode];
    return known ? t(`settings:watchMusic.errors.${known}`) : t('settings:watchMusic.errors.rejected', { message });
  }
  if (code === 'ERR_INVALID_ARGUMENT') return t('settings:watchMusic.errors.invalid', { message });
  const key = code === null ? undefined : CODE_KEYS[code];
  return key ? t(`settings:watchMusic.errors.${key}`) : message;
}

/** Why a picked file is not sent, naming the file. */
export function rejectText(check: SongCheck, watchFormats: readonly string[]): string {
  if (check.accepted) return '';
  const name = check.file.name;
  const ext = check.extension.toUpperCase();
  switch (check.reason) {
    case 'noExtension':
    case 'format':
    case 'empty':
      return t(`settings:watchMusic.reject.${check.reason}`, { name, ext });
    case 'notOnWatch':
      return t('settings:watchMusic.reject.notOnWatch', { name, ext, formats: formatList(watchFormats) });
    case 'tooBig':
      return t('settings:watchMusic.reject.tooBig', { name, max: MAX_SONG_BYTES / 1_048_576 });
    case 'noSpace':
      return t('settings:watchMusic.reject.noSpace', { name, mb: bytesMb(check.file.size ?? 0) });
  }
}
