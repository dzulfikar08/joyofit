# Music on the watch

Status:

- **Remote control** (`25/01`, `25/02`, `25/03`): implemented on Android (`WatchMediaControl.kt`, `MediaBridge.kt`, `MusicControl.java`).
  iOS cannot control another app's playback. UNVERIFIED on a watch (acks `7F = 0x000186A0` on success or `0` on failure, whereas GB always
  acks `0x000186A0`).
- **Songs on the watch** (`25/04`, `25/05`, `25/08`, `25/09`, `25/0D` and FileUpload `28` with file type `2`): implemented on Android and iOS
  behind the Experimental switch **Musik di jam (uji lab)** (JRG-417), off by default. **Verified on a Watch Fit 4 Pro** (Android, lab build
  v1.1-lab.12, 2026-10-27): the watch's `25/04` answer was `availableSpace=1469 MB formats=[mp3, wav, aac, m4a, flac, opus]
  maxMusicCount=500`, and a 32 MB MP3 uploaded and plays on the watch. FLAC, WAV and Opus uploads, cancel, delete, the iOS build and other
  watches are not yet tried. Needs a new store build (native code).

Asked by a user (Salim, Watch Fit 2): "can I put songs on the watch?", and wanted for phone-free runs on the Fit 4 Pro.

## Sources

- Gadgetbridge, commit `c8e59392b7437b04c9735dcaf5f33555799ba9a9` (2026-10-26), AGPL-3.0-or-later:
  [`packets/MusicControl.java`](https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/c8e59392b7437b04c9735dcaf5f33555799ba9a9/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huawei/packets/MusicControl.java),
  [`HuaweiMusicUtils.java`](https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/c8e59392b7437b04c9735dcaf5f33555799ba9a9/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huawei/HuaweiMusicUtils.java),
  [`HuaweiMusicManager.java`](https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/c8e59392b7437b04c9735dcaf5f33555799ba9a9/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/huawei/HuaweiMusicManager.java),
  `HuaweiSupportProvider.onInstallApp` (music branch: file type 2, the error codes), `HuaweiFwHelper.parseAsMusic` and
  `util/audio/MusicUtils.audioInfoFromUri` (file name, title, artist "Unknown" fallback), `AsynchronousResponse` (`25/09`),
  `requests/{GetMusicInfoParams,GetExtendedMusicInfoParams,GetMusicList,SendMusicOperation,SendUploadMusicFileInfoResponse}`,
  `HuaweiState.{supportsMusicUploading,supportsMoreMusic}`, `activities/musicmanager/MusicManagerActivity` (operation 4 on playlist 0 =
  delete from the watch), `res/values/strings.xml` (`music_huawei_device_info`: "Watch storage: %2$d MB").
- Huawei support, ["What format of music file does the watch support?"](https://consumer.huawei.com/uk/support/content/en-gb00756685/):
  "MP3 or AAC music file with resolution below 320Kbps". Huawei's Fit 4 / Fit 4 Pro spec pages do not state the music storage size
  ([specs](https://consumer.huawei.com/en/wearables/watch-fit4-pro/specs/); GSMArena: "Unspecified storage").
- The Fit 4 / Fit 4 Pro user guide says music syncing to the watch is not offered when the watch is paired with an iPhone (Huawei's app
  choice). JoyoFit talks to the watch directly, so the iOS build sends songs too; whether the watch accepts them from an iPhone is part of
  the device test.
- JoyoFit's own `protocol/README.md` ("Songs on the watch") and the Fit 4 / Fit 4 Pro observations in it.

No Huawei app code was read for this feature.

## What the watch must report

There is no per-model music flag; the watch says it at every connect:

| Gate | Meaning | JoyoFit |
| --- | --- | --- |
| SupportedCommands `25/04` (GB `supportsMusicUploading`) | the watch stores uploaded songs | without it every music call rejects `ERR_UNSUPPORTED` and the screen says the watch does not take songs |
| SupportedCommands `25/0D` | per-format limits and the playlist limit | read when listed; a missing answer is logged and skipped |
| ExpandCapability 122 (GB `supportsMoreMusic`) | the song list is paged up to 250 frames | changes the paging (below) |
| `25/04` answer | `01` list frames, `02` free space (MB per GB), `03` format bits, `04` max songs, `05` songs on the watch | shown on the screen; the format bits and free space are checked before an upload |

The init log already prints `Language and music: 0C=[...] 25=[...] moreMusic(ExpandCapability 122)=...` (`HuaweiInitializer`), and the
music screen logs the raw `25/04` / `25/0D` answers (`Music: 25/04: ...`, `Music: 25/0D: ...`), so one support report answers what a
watch takes. Fit 4 and Fit 4 Pro list service `25`; whether `25/04` is among their commands was not logged before this change.

Format bits (`03` of `25/04`, `02` of `25/0D`), seven per byte, bit 7 = another byte follows; GB marks the table "most unknown":
byte 0 `mp3 wav aac sbc msbc hwa cvsd`, byte 1 `pcm ape m4a flac opus ogg butt`, byte 2 `amr imy`.

## Protocol (as ported)

1. **Capabilities.** `25/04` request `01 02 03` (empty tags); answer as above plus optional `86{87{08 start, 09 end, 0a count, 0b hash}}`
   pages (logged, unused, as in GB). `25/0D` request `01..05`; answer `01` free space, `02` formats, `03` max songs, `04` max playlists, `05`
   unknown byte, `86{87{08 format index, 09 sample rates "44100,48000", 0a encode, 0b bitrate, 0c channels, 0d second bitrate}}`.
2. **List.** `25/05` request `01` start frame (16 bit), `04` end index (16 bit, first 65535); answer `01`, `04`, `82{83{04 id, 05 title,
   06 artist, 07 file name}}`. Paging exactly as GB's `HuaweiMusicManager`: frames 0 up to the frame count (at most 250 with
   ExpandCapability 122). Without 122 the list ends at a page whose end index equals the one asked for (GB compares the signed 16-bit answer
   with the int it sent, so 65535 never matches) or that holds one song; a two-song page moves the next end index to the second song's id.
   Songs are kept once per id.
3. **Upload.** `28/02` FileInfoSend `01` file name (the picked file's name), `02` size, `03` type `2`; then the usual `28/03` hash, `28/04`
   parameters / ack, `28/05` chunk requests, `28/06` chunks, `28/07` result (`FileUploader`, shared with watch faces). While it runs the watch
   sends `25/09` (`01` song index, `02` file name); the phone answers `25/09 {01 index, 03 title, 04 artist}` when the name is the file being
   sent (GB does not answer any other). If no `25/09` came during the transfer, JoyoFit waits 5 s more for it (GB's timing was not read).
   Errors from the watch (`28/02` or `28/08` code): `140004` too many songs, `140008` already on the watch, `140009` not enough space.
4. **Delete.** `25/08` `01` operation `4`, `02` playlist `0` ("all songs"), `04` song ids as big-endian 16-bit values; answer `7f = 100000`
   is ok. Operations 0 to 3 (new, delete, rename playlist, add songs to a playlist) and `25/06` / `25/07` (playlists) are not used.

Cancel: there is no "abort upload" packet in GB. Cancelling stops answering the watch's chunk requests; the watch is expected to drop the
partial file when its own wait runs out [INFERENCE, unverified]. A song cut short is never complete, so its SHA-256 cannot match.

## Files JoyoFit sends

- **The formats the watch lists**, by name *and* content, nothing else. JoyoFit recognises:
  - MP3: an MPEG Layer III frame after an optional ID3v2 tag (`.mp3`);
  - AAC: an ADTS header after an optional ID3v2 tag (`.aac`); M4A: an MP4 `ftyp` box (`.m4a`);
  - FLAC: `fLaC` after an optional ID3v2 tag, sample rate from STREAMINFO (`.flac`);
  - WAV: `RIFF`....`WAVE`, sample rate from the `fmt ` chunk (`.wav`);
  - Opus: an Ogg page whose first packet starts with `OpusHead`, sample rate from that header (`.opus`, and `.ogg` holding Opus, sent as
    `opus`). An Ogg file holding Vorbis is `ogg`: sent only when the watch lists `ogg` (the Fit 4 Pro does not).

  The wire names are Gadgetbridge's format table names (`mp3 wav aac m4a flac opus ogg`). A file whose content is another format than its
  name says is refused with "rename it". **Nothing is converted**: no pure-JS or OS encoder exists without a new native dependency.
- The format must be in the watch's format bits when it sent any (strict: a `.m4a` is refused when the watch lists `aac` but not `m4a`;
  a FLAC is refused on a watch that does not list `flac`).
- At most 64 MiB (the upload holds the file in memory) and at most the free space the watch reported.
- Sample rate and bitrate against the `25/0D` limits are logged only (`Music: 25/0D limits for mp3: ...`), never refused: GB's meaning of
  those fields is a guess. Huawei's own advice is MP3 or AAC below 320 kbit/s.
- Title and artist come from the file's tags (Android `MediaMetadataRetriever`, iOS AVFoundation common metadata); without them the file
  name without extension and "Unknown", as GB sends.

Privacy: the files go from the phone to the watch over Bluetooth only. Nothing is uploaded to any server; the app keeps no copy beyond the
picker's cache.

## App

Settings → Tentang & lanjutan (About & advanced) → Eksperimental → **Musik di jam (uji lab)** switch, then the **Musik di jam (lab)** row: free space, song slots used (bar),
formats the watch takes, the song list with per-song delete, **Tambah lagu** (pick several files; each is checked first, then sent one
after another with progress and a Cancel button), and a result per file. Native: `WatchMusic.kt`, `WatchMusicController.kt`,
`WatchMusicModuleApi.kt`; iOS `HuaweiProtocol/WatchMusic.swift`, `Packets/MusicPackets.swift`, `WatchMusicController.swift`. JS:
`src/features/watchmusic/`. Tests: `WatchMusicTest.kt`, `PacketsMusicTests.swift`, `WatchMusicTests.swift` (golden frames from
`GoldenGen/src/GoldenMusic.java`), `src/features/watchmusic/*.test.ts`.

## Device test (Fit 4 Pro, firmware 6.1.0.117)

Needs the test build of this branch (not OTA). Android first, then iOS.

1. Connect the watch. Settings → Tentang & lanjutan → Log, filter `Language and music`: note `25=[...]` (is `04` listed? `0d`?) and
   `moreMusic(ExpandCapability 122)=`.
2. Eksperimental → switch **Musik di jam (uji lab)** on → open **Musik di jam (lab)**. Expected: free space, formats, an empty or current song list.
   Log: `Music: 25/04: frameCount=... availableSpace=... MB formats=[...] maxMusicCount=... currentMusicCount=...`, `Music: 25/0D: ...`,
   `Music: 25/05 frame 0 ...`, `Music: list: N songs in P pages`.
3. **Tambah lagu**: pick one MP3 (128 to 320 kbit/s, 3 to 5 MB, with ID3 title and artist). Expected: progress, then the song in the list.
   Log: `Music: upload <name>: <bytes> bytes, mp3 (...)`, `Upload: start <name>: type=2 ...`, `Upload: FileUploadConsultAck: ... unitSize=...`,
   `Music: 25/09 song index N '<name>': answered title '...', artist '...'` (or `no 25/09 during the upload`), `Upload: complete <name> ...`,
   `Music: upload <name> done in S s (B/s): 28/07 status ...`. On the watch: Music app → the song plays with its title and artist.
4. Pick a FLAC, a WAV and an Opus file (the Fit 4 Pro lists all three): each goes and plays. On a watch that does not list a format, that
   file is refused before sending; an Ogg Vorbis file is refused unless the watch lists `ogg`.
5. Pick several MP3s at once, press **Batal** during the second: the first stays, the second is `cancelled`, the rest skipped. Reopen the
   screen after 1 minute: the cancelled song must not be listed (log `Music: cancel requested`, `upload of <name> cancelled after ...`).
6. Upload the same file again: expect the `140008` message ("already on the watch").
7. Delete a song: log `Music: 25/08 delete [id]: watch answered code=100000 ...`; the song disappears from the list and from the watch.
8. Send the support report (Settings → Tentang & lanjutan → Log → share) and attach it to JRG-417 with the timings (bytes per second).

What would change the code: a different free-space unit (compare `availableSpace` before and after a 5 MB song), `25/09` arriving after
`28/07` or never, paging that misses songs past the first page, `28/08` codes not listed above, the watch keeping a cancelled partial file.
