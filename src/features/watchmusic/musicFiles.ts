import type { WatchMusicInfo, WatchSongFormat } from '@/wear';

/** The native side refuses a song over 64 MiB (`uploadWatchSong`); the same limit is checked before sending. */
export const MAX_SONG_BYTES = 64 * 1_048_576;

const FORMATS: Readonly<Record<string, WatchSongFormat>> = { mp3: 'mp3', m4a: 'm4a', aac: 'aac' };

/** One file from the document picker. `size` is unknown on some providers: then the native side checks it. */
export interface PickedSong {
  uri: string;
  name: string;
  size: number | null;
}

/** Why a picked file is not sent: no extension, a format JoyoFit does not send, one the watch does not list, empty, over 64 MiB, no room. */
export type RejectReason = 'noExtension' | 'format' | 'notOnWatch' | 'empty' | 'tooBig' | 'noSpace';

export type SongCheck =
  | { file: PickedSong; accepted: true; format: WatchSongFormat }
  | { file: PickedSong; accepted: false; reason: RejectReason; extension: string };

/** The extension in lower case without the dot; '' when the name has none (a leading dot alone is no extension). */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The format JoyoFit sends a file as, from its extension; null for anything else. Nothing is converted. */
export function formatOf(name: string): WatchSongFormat | null {
  return FORMATS[extensionOf(name)] ?? null;
}

/** The watch's formats in lower case: `info.formats` comes from the watch as it wrote them. */
export function watchFormats(info: Pick<WatchMusicInfo, 'formats'>): string[] {
  return info.formats.map((f) => f.toLowerCase());
}

/**
 * Checks the picked files in order before anything is sent: the extension must be MP3, M4A or AAC and listed by the watch, and the
 * file must fit. Free space counts down over the accepted files, so a batch that does not fit as a whole stops being accepted where
 * the room runs out. Without a free-space answer (null) the native side decides. Sizes are bytes; free space is MB (MiB, unverified).
 */
export function checkSongs(files: readonly PickedSong[], info: Pick<WatchMusicInfo, 'formats' | 'freeSpaceMb'>): SongCheck[] {
  const takes = watchFormats(info);
  let freeBytes = info.freeSpaceMb === null ? null : info.freeSpaceMb * 1_048_576;
  return files.map((file): SongCheck => {
    const extension = extensionOf(file.name);
    const reject = (reason: RejectReason): SongCheck => ({ file, accepted: false, reason, extension });
    if (extension === '') return reject('noExtension');
    const format = FORMATS[extension];
    if (format === undefined) return reject('format');
    if (!takes.includes(format)) return reject('notOnWatch');
    if (file.size !== null) {
      if (file.size <= 0) return reject('empty');
      if (file.size > MAX_SONG_BYTES) return reject('tooBig');
      if (freeBytes !== null) {
        if (file.size > freeBytes) return reject('noSpace');
        freeBytes -= file.size;
      }
    }
    return { file, accepted: true, format };
  });
}
