# Music on the watch: feasibility and plan

Status: **remote control (`25/01`, `25/02`, `25/03`) implemented on Android (`WatchMediaControl.kt`, `MediaBridge.kt`, `MusicControl.java`); song storage upload (`25/04..0D`) plan only. Android only; iOS cannot control another app's playback. UNVERIFIED on a watch (acks `7F = 0x000186A0` on success or `0` on failure, whereas GB always acks `0x000186A0`).** Asked by a user (Salim, Watch Fit 2): "can I put songs on the watch?". Sources: Gadgetbridge
(`HuaweiMusicManager`, `HuaweiMusicUtils`, `packets/MusicControl`, `HuaweiSupportProvider.onInstallApp`, `HuaweiState`), JoyoFit's
`protocol/README.md` and the Fit 4 / Fit 4 Pro observations in it. Nothing here was run against a watch.

## Short answer

Yes in principle, on the watches that list the Music service (`25`) with command `04`: Gadgetbridge uploads MP3 files to Huawei watches over
the same file-upload service JoyoFit already uses for watch faces (`28`, file type `2`), and lists and deletes songs over service `25`.
JoyoFit implements `25/01`, `25/02` and `25/03` for phone media control; the song-upload packets (`25/04..0D`) are not implemented yet. Whether a given watch can store songs is only known at connect time (SupportedCommands), not
from the model name.

## Which of our watches

There is no per-model music flag in Gadgetbridge or in `WatchModels.kt`; support is read from the watch at every connect:

| Gate (GB `HuaweiState`) | Meaning |
| --- | --- |
| SupportedServices lists `25` | the watch has the Music service at all |
| SupportedCommands `25/04` (`supportsMusicUploading`) | it takes uploaded songs: this is the one that matters |
| SupportedCommands `25/02` (`supportsMusic`) | it shows what the phone plays (remote control), unrelated to stored songs |
| ExpandCapability 122 (`supportsMoreMusic`) | paged song list of up to 250 songs |

What is known:

- Watch Fit 4 (SYA-B29, 2026-10-14) and Watch Fit 4 Pro (2026-10-16, same list over Classic and LE) list service `25`
  (`protocol/README.md`, Observations). Whether `25/04` is among their commands was not logged.
- Watch Fit 2 (the user's): unknown. Band-class watches (Band 8 to 11, Honor Band) have no music storage as far as Huawei's product
  pages go [INFERENCE, not checked against a Band]; they would simply not list `25/04`.
- **Free first step, shipped with the language change:** init now logs `Language and music: 0C=[...] 25=[...] moreMusic(ExpandCapability 122)=...`
  (`HuaweiInitializer`), so the next support report of any watch answers the question. Ask Salim for a report after he updates.

## What Gadgetbridge does (the protocol to port)

1. **Capabilities.** `25/04` MusicInfoParams (request tags `01`..`03`, response: `01` frame count, `02` free space, `03` format bit set, `04` max
   songs, `05` current songs, optional `86{87{08 start, 09 end, 0a count, 0b hash}}` pages) and, if listed, `25/0D` ExtendedMusicInfoParams
   (`01` free space, `02` formats, `03` max songs, `04` max playlists, `86{87{08 format index, 09 sample rates "44100,48000", 0a encode, 0b bitrate,
   0c channels}}` per-format limits). Format bits (GB: "most unknown"): `mp3 wav aac sbc msbc hwa cvsd | pcm ape m4a flac opus ogg butt | amr imy`.
2. **Upload.** `28/02` FileInfoSend with file type `2` (music) and the file name, then the usual `28/03` hash, `28/04` ack, `28/05` chunk,
   `28/06` data, `28/07` result. JoyoFit's `FileUploader` does exactly this for watch faces (type `1`) and photos (type `3`) and takes any type.
   During the upload the watch sends `25/09` UploadMusicFileInfo request (`01` song index, `02` file name; GB answers it from
   `HuaweiMusicManager.uploadMusicInfo`, exact timing not read); the phone answers with `01` index,
   `03` title, `04` artist (read from the file's tags). Errors: `140004` too many songs, `140008` already on the watch, `140009` not enough space.
3. **List.** `25/05` MusicList (`01` start frame, `04` end index; answer `82{83{04 id, 05 title, 06 artist, 07 file name}}`), paged by frame
   (GB stops at 250 frames with ExpandCapability 122); `25/06` playlists and `25/07` playlist songs.
4. **Delete / playlists.** `25/08` MusicOperation: `01` operation, `02` playlist index (operations 1 to 4), `03` playlist name (operations 0 and 2),
   `04` song ids as 16-bit values (operations 3 and 4); answer `7f = 100000` is ok. Which number means "delete a song" is not in the packet
   class (my reading of the tags: 0 new playlist, 1 delete playlist, 2 rename, 3 add songs, 4 remove songs [INFERENCE]); read GB's
   `GBDeviceMusicUpdate` callers and check on a watch before relying on it.

GB does not convert audio: the file must already be in a format and sample rate the watch lists. JoyoFit's MVP should say so, and refuse
files outside the limits from `25/0D` instead of uploading and failing.

## MVP: a "Musik" screen

Scope: pick MP3 files from the phone, upload with progress, list what is on the watch, delete a song. No playlists, no conversion, no
album art, no playback control.

| Piece | Work |
| --- | --- |
| `MusicControl` packets for `25/04`, `25/0D`, `25/05`, `25/08`, `25/09` (Java, from GB; Swift mirror for iOS) | 0.5 day Android |
| `WatchMusic.kt`: read capabilities, page the list, delete, upload through `FileUploader` with file type `2`, answer `25/09` from the file's ID3 tags (`MediaMetadataRetriever`), pre-check format, sample rate, bitrate, free space, song count | 2 days |
| Module API (`getMusic`, `uploadSong`, `deleteSong`, events reuse `onUploadProgress` / `onUploadResult`) and `HuaweiWearMusic.types.ts` | 0.5 day |
| Screen in the Watch tab: `expo-document-picker` (already a dependency, used for watch faces), list with title and artist, per-song delete, a progress bar, "not supported on this watch" state from the capability read, i18n `id` + `en` | 1.5 days |
| Tests: Kotlin codec tests with golden frames from GB's classes, JS tests for the screen state; i18n parity | 1 day |
| Real-watch run (Fit 4 Pro first; Salim's Fit 2 through a test build), fixes | 1 to 2 days |

**Android total: about 6 to 7 working days.** iOS adds about 2 to 3 days (Swift packets and tests on the Linux package, document picker,
file access). Needs a **new native build** (new Kotlin and Swift code, new module functions); the screen alone could go over the air only
after every user has the native part.

## Risks and open questions

- A song is held in memory by `UploadFile` (one `ByteArray`): fine for 3 to 10 MB, a concern for long mixes. Streaming from the file would
  need a change to `FileUploader`.
- Upload speed over the link is not measured. A 5 MB song over the Fit 4 Pro's RFCOMM link may take minutes [INFERENCE]; the background service
  must hold the link and a wake lock for the whole upload, and a lost link has to leave no half song (the watch answers `28/08` errors).
- Which formats and sample rates each watch accepts is only known from `25/0D` and GB's own table is partly guesswork ("not sure" fields):
  the first build must log the raw answer so the table can be corrected from reports.
- Whether the watch's music app needs a Huawei Music account or a region is unknown; GB has no account step for uploads, but a Fit 2 was never tried.
- Songs are the user's own files; JoyoFit copies nothing from any service. Marketing: do not promise streaming or playlists.
