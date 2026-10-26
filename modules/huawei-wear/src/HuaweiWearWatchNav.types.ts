/**
 * Watch navigation (LAB, off by default): P2P data between JoyoFit and its own watch app `com.joyodigitama.navi` (Wear Engine, link service 0x34).
 * The phone works out every instruction in JS (`src/features/watchnav/`); the native side only registers the P2P service while a session runs,
 * sends the JSON messages, answers the watch app's ping (0xca) and data (0xcf), and hands the watch app's messages to JS (`onWatchNav`).
 * Messages: `protocol/watch-nav.schema.json`. Native code: `WatchNavService.kt` / `WatchNavService.swift`, `WatchNav.kt` / `WatchNav.swift`.
 */

/** What Wear Engine checks on both ends. Placeholders until the Huawei developer account exists (JRG-440); see docs/watch-nav.md. */
export interface WatchNavConfig {
  /** The phone app's signing-certificate fingerprint, sent as the source fingerprint (P2P tag 05) of every data message. */
  phoneFingerprint: string;
  /** The watch app's fingerprint from its AppGallery Connect project, sent as the destination fingerprint (tag 06). */
  watchFingerprint: string;
}

/** `present`: the watch app answered (ping 0xca, data 0xcf) or sent something; `absent`: the watch answered with another code. */
export type WatchAppPresence = 'unknown' | 'present' | 'absent';

export interface WatchNavStatus {
  /** The experimental switch ('Navigasi di jam (lab)'). Off: nothing registers and `startWatchNav` rejects with ERR_UNSUPPORTED. */
  enabled: boolean;
  /** A navigation session runs (`startWatchNav` ... `stopWatchNav`); the service is registered on every connect while it does. */
  active: boolean;
  /** The current link has the P2P service (SupportedCommands 34/01). */
  p2p: boolean;
  /** The watch-nav service is registered on this link. */
  registered: boolean;
  /** The phone side's package (the P2P source package): the app's own id. */
  phonePackage: string;
  /** `com.joyodigitama.navi`. */
  watchBundle: string;
  /** Either fingerprint is still a placeholder (starts with `PLACEHOLDER`): the watch will drop the messages. */
  placeholderFingerprints: boolean;
  watchApp: WatchAppPresence;
  /** The watch's last answer code to us (ping or data acknowledgement); null before one on this session. */
  lastCode: number | null;
  /** Epoch ms of the last answer or message from the watch app; null before one on this session. */
  lastHeardAt: number | null;
  /** Data messages sent / acknowledged with 0xcf / received from the watch app on this session. */
  sent: number;
  acked: number;
  received: number;
}

export type WatchNavEvent =
  /** One data message of the watch app, its payload decoded as UTF-8 (JSON per the schema, unchecked). */
  | { kind: 'message'; json: string; ts: number }
  /** `watchApp` changed. */
  | { kind: 'presence'; watchApp: WatchAppPresence; code: number | null; ts: number };
