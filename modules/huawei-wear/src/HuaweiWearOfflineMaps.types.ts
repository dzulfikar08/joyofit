/**
 * The offline-map lab (P2P module `hw.unitedevice.mapkit` <-> `in.huawei.mapkit`, Huawei's offline-map transfer): sends an `offvmp` map file the
 * user picked (built from OpenStreetMap with `tools/offline-maps/`), lists and deletes maps on the watch. EXPERIMENTAL: behind a switch that is
 * off by default; unproven on any watch until docs/offline-maps.md says otherwise. Frames: `protocol/README.md`, "Offline maps (mapkit P2P)".
 * Native code: `OfflineMapLab.kt` / `OfflineMapLab.swift`, `MapkitWire.kt` / `MapkitWire.swift`.
 */

/** Map types of the mapkit module: 0 region map (`<id>.bin`), 1 contour lines (`<id>_contour.bin`), 2 world overview (`global.bin`), 3 ski. */
export type OfflineMapType = 0 | 1 | 2 | 3;

/** The watch's `08` frame: it parsed a received file. */
export interface OfflineMapParsed {
  /** Decimal map id (u64, so a string); null when the frame had none. */
  mapId: string | null;
  mapType: number | null;
  /** 0 = the watch read the map; anything else = it could not. */
  code: number | null;
}

export interface OfflineMapLabStatus {
  /** The experimental switch. Off: nothing registers and every call rejects with ERR_UNSUPPORTED. */
  enabled: boolean;
  /** The P2P service is available on the current link. */
  p2p: boolean;
  /** ExpandCapability 201 (offline map), the bit Huawei Health checks; without it calls reject with ERR_UNSUPPORTED. */
  gateMap: boolean;
  /** ExpandCapability 202 (contour map). */
  gateContour: boolean;
  /** ExpandCapability 284 (the watch asks for the map around its position). */
  gateAutoDownload: boolean;
  /** The mapkit module is registered on this link. */
  registered: boolean;
  /** The watch map app's answer to the ping (0xca = there); null before one. */
  pingCode: number | null;
  /** The political view JoyoFit sends (`ID`). */
  politicalView: string;
  /** The watch's answer to it: "0" ok, "1" failed; null before one. */
  politicalViewResult: string | null;
  /** The last parse result on this link, with its time (ms). */
  lastParsed: (OfflineMapParsed & { at: number | null }) | null;
}

/** A picked map file, read and checked on the phone. */
export interface OfflineMapFile {
  /** The name the watch gets: `<id>.bin`, `<id>_contour.bin` or `global.bin`. */
  fileName: string;
  /** Decimal map id from the file name. */
  mapId: string;
  mapType: OfflineMapType;
  bytes: number;
  /** What the handshake announces: whole MB, rounded up. */
  sizeMb: number;
  /** The `offvmp` header's version (the converter writes YYMMDDHH). */
  formatVersion: number;
  /** The region name in the header. */
  region: string;
  /** Zoom levels in the file's index (10, 12, 14, 16 for a region map). */
  zooms: number[];
  /** SHA-256 of the file (the watch checks it after the upload), upper-case hex. */
  sha256: string;
}

/** A map the watch lists (`03`). */
export interface OfflineMapOnWatch {
  mapId: string;
  mapType: number;
  version: number | null;
  /** 0 the user sent it, 1 the watch asked for it; null when not said. */
  downloadType: number | null;
}

export interface OfflineMapList {
  maps: OfflineMapOnWatch[];
  /** The count the watch announced; null when it did not answer. */
  total: number | null;
  /** Every frame of the list arrived within 10 s. */
  complete: boolean;
}

export interface OfflineMapSendResult {
  file: OfflineMapFile;
  /** The id was already on the watch, so the handshake said "update". */
  update: boolean;
  /** The watch's `01` free-space value before the send (unit unverified: KiB per huac); null when it did not answer. */
  freeSpace: number | null;
  /** The watch's handshake answer (`0C`): always 0 here; any other code rejects with ERR_UPLOAD_REJECTED carrying it. */
  handshakeCode: number;
  /** Tag 02 of the watch's 28/07 upload result (1 = file accepted); null when it sent none. */
  uploadStatus: number | null;
  /** From the handshake to the end of the upload. */
  uploadMs: number;
  bytesPerSecond: number | null;
  /** The watch's parse result (`08`); null when none arrived (the Fit 4 Pro sent none on 2026-10-26). */
  parsed: OfflineMapParsed | null;
  /** From the end of the upload to the `08`; null without one. */
  parseMs: number | null;
  /** After the upload the watch's list (`03`) showed this map: taken as accepted when no `08` comes. */
  listed: boolean;
  /** The version the watch lists for it (the file header's version when it read the header); null when not listed or not said. */
  listedVersion: number | null;
  /** From the end of the upload to the listing; null when not listed. */
  listedMs: number | null;
  /** How long the app waits after the upload: Huawei Health's parse budget, 5 s per MB + 30 s. */
  parseBudgetMs: number;
}

export interface OfflineMapDeleteResult {
  mapId: string;
  mapType: number;
  /** The watch answered the delete within 10 s. */
  answered: boolean;
  /** The watch's result for that map (`12`; 0 = deleted); null when not said. */
  code: number | null;
}
