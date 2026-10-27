/**
 * Songs on the watch (lab, docs/watch-music.md): the watch's music store over Huawei service 0x25 (capabilities `04` / `0D`, song list `05`,
 * delete `08`, the watch's title-and-artist question `09`) and the song file itself over FileUpload 0x28 as file type 2, the way Gadgetbridge
 * does it. EXPERIMENTAL: behind a switch that is off by default; unverified on any watch until docs/watch-music.md says otherwise.
 * Native code: `WatchMusic.kt` / `WatchMusic.swift` (+ `WatchMusicController.swift`).
 */

/** The audio formats JoyoFit sends; nothing is converted, the file must already be one of these and listed by the watch. `ogg` is Ogg Vorbis. */
export type WatchSongFormat = 'mp3' | 'm4a' | 'aac' | 'flac' | 'wav' | 'opus' | 'ogg';

export interface WatchMusicStatus {
  /** The experimental switch. Off: every music call rejects with ERR_UNSUPPORTED. */
  enabled: boolean;
  /** A watch is connected now. */
  connected: boolean;
  /** The watch lists 25/04 (MusicInfoParams) in SupportedCommands, Gadgetbridge's `supportsMusicUploading` gate. False while not connected. */
  uploadSupported: boolean;
  /** The watch lists 25/0D (ExtendedMusicInfoParams): per-format limits and the playlist limit. */
  extendedInfo: boolean;
  /** ExpandCapability 122 (Gadgetbridge `supportsMoreMusic`): the list is paged up to 250 frames. */
  moreMusic: boolean;
  /** A song upload is running. */
  uploading: boolean;
}

/** One format's limits from 25/0D. */
export interface WatchMusicFormatLimit {
  /** Index into Gadgetbridge's format table. */
  formatIndex: number;
  /** `mp3`, `aac`, `m4a` ...; null for an index outside the table. */
  format: string | null;
  /** Sample rates in Hz as the watch wrote them ("44100"). */
  sampleRates: string[];
  /** Bitrate limit (kbit/s per Gadgetbridge, unverified); null when the watch sent none. */
  bitrate: number | null;
  channels: number;
}

export interface WatchMusicInfo {
  /** Free space for songs in MB (Gadgetbridge shows it as "Watch storage: N MB"; unverified). Null when the watch sent none. */
  freeSpaceMb: number | null;
  /** Formats the watch takes, from 25/0D when it answered, else 25/04 (Gadgetbridge's bit table, partly guesswork). */
  formats: string[];
  /** The most songs the watch keeps; null when it sent none. */
  maxSongs: number | null;
  /** Songs on the watch per 25/04 tag 05 (Gadgetbridge: "not sure"); null when it sent none. */
  songCount: number | null;
  /** From 25/0D; null without it. */
  maxPlaylists: number | null;
  /** Pages of the song list (25/04 tag 01). */
  frameCount: number;
  /** Per-format limits from 25/0D; empty without it. */
  limits: WatchMusicFormatLimit[];
  /** 25/0D answered. */
  extended: boolean;
}

export interface WatchSong {
  /** The watch's song id, what `deleteWatchSongs` takes (16 bit). */
  id: number;
  title: string;
  artist: string;
  fileName: string;
}

export interface WatchMusicList {
  info: WatchMusicInfo;
  songs: WatchSong[];
  /** List pages read. */
  pages: number;
}

export interface WatchSongUploadResult {
  /** `cancelled` when `cancelWatchMusicUpload` stopped it; the watch is left to drop the partial file. */
  status: 'uploaded' | 'cancelled';
  /** The name sent to the watch (the picked file's name). */
  fileName: string;
  /** From the file's tags; the file name without extension when it has none. */
  title: string;
  /** From the file's tags; "Unknown" (as Gadgetbridge sends) when it has none. */
  artist: string;
  format: WatchSongFormat;
  bytes: number;
  uploadMs: number;
  /** Tag 02 of the watch's 28/07 result (1 = accepted per Huawei Health's naming); null when it sent none or the upload was cancelled. */
  uploadStatus: number | null;
  /** The watch asked for title and artist (25/09) during the upload and got them. */
  infoAnswered: boolean;
}

export interface WatchSongDeleteResult {
  ids: number[];
  /** The watch answered 7F = 100000. */
  ok: boolean;
  /** The watch's 7F code; null when it sent none. */
  code: number | null;
}
