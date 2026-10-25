import type { AgpsOutcome, AgpsStatus } from '@/wear';

/** The `watch:agps.status.<key>` strings. */
export type AgpsStatusKey =
  | 'never'
  | 'delivered'
  | 'deliveredLab'
  | 'deliveredPgnss'
  | 'expired'
  | 'stored'
  | 'watchSilent'
  | 'noNetwork'
  | 'downloadFailed'
  | 'invalidFile'
  | 'unsupported'
  | 'watchRefused'
  | 'timeout'
  | 'cancelled'
  | 'busy'
  | 'linkLost'
  | 'asking'
  | 'downloading'
  | 'waiting'
  | 'sending';

/** How the status line is drawn. */
export type AgpsTone = 'ok' | 'info' | 'danger';

export interface AgpsView {
  /** When the watch last took data (ms), or null when it never did. */
  lastUpdatedMs: number | null;
  /** The size of that data, else of the newest copy on the phone, in whole KB; null when there is none. */
  sizeKb: number | null;
  /** The data on the watch is older than its validity. */
  expired: boolean;
  /** Something is running: the button waits. */
  busy: boolean;
  statusKey: AgpsStatusKey;
  tone: AgpsTone;
  /** The raw detail of a failure, shown under the status; null when there is none worth showing. */
  detail: string | null;
  /** An automatic retry is waiting until this time (ms); null when not. */
  retryAtMs: number | null;
}

const OUTCOME_STATUS: Record<AgpsOutcome, { key: AgpsStatusKey; tone: AgpsTone }> = {
  none: { key: 'never', tone: 'info' },
  delivered: { key: 'delivered', tone: 'ok' },
  stored: { key: 'stored', tone: 'info' },
  watch_silent: { key: 'watchSilent', tone: 'info' },
  no_network: { key: 'noNetwork', tone: 'danger' },
  download_failed: { key: 'downloadFailed', tone: 'danger' },
  invalid_file: { key: 'invalidFile', tone: 'danger' },
  unsupported: { key: 'unsupported', tone: 'info' },
  watch_refused: { key: 'watchRefused', tone: 'danger' },
  timeout: { key: 'timeout', tone: 'danger' },
  cancelled: { key: 'cancelled', tone: 'info' },
  busy: { key: 'busy', tone: 'info' },
  link_lost: { key: 'linkLost', tone: 'danger' },
};

const PHASE_STATUS: Record<string, AgpsStatusKey> = {
  asking: 'asking',
  downloading: 'downloading',
  waiting: 'waiting',
  sending: 'sending',
};

/** The native source name of the experimental HW_AGNSS file (`AgpsLab.SOURCE`). */
export const AGPS_LAB_SOURCE = 'joyofit_rtcm';

/** The native source name of the experimental HW_PGNSS_PRED files (`AgpsPgnss.SOURCE`). */
export const AGPS_PGNSS_SOURCE = 'joyofit_pgnss';

/** The experimental switch is on and the watch's last ask was exactly the `HW_AGNSS` kind (download version 1 to 3), which JoyoFit then serves. */
export function agpsLabActive(status: AgpsStatus): boolean {
  return status.labAgnss === true && status.lastAskVersion >= 1 && status.lastAskVersion <= 3 && status.lastAskTags === 'HW_AGNSS';
}

/** The PRED switch is on and the watch's last ask was exactly the `HW_PGNSS_PRED` kind (download version 1 to 3), which JoyoFit then serves. */
export function agpsPgnssActive(status: AgpsStatus): boolean {
  return status.labPgnss === true && status.lastAskVersion >= 1 && status.lastAskVersion <= 3 && status.lastAskTags === 'HW_PGNSS_PRED';
}

/** The status key of a delivery: the plain one for Broadcom, the lab ones for the experimental files. */
function deliveredKey(source: string): AgpsStatusKey {
  if (source === AGPS_LAB_SOURCE) return 'deliveredLab';
  if (source === AGPS_PGNSS_SOURCE) return 'deliveredPgnss';
  return 'delivered';
}

/**
 * The switch of the delivered experimental data is on and the watch holds it: the row stays while it is valid, whatever the watch asked next
 * (an HW_AGNSS file stays shown after the PRED ask that follows it, and the other way round).
 */
function labDelivered(status: AgpsStatus, nowMs: number): boolean {
  const switchOn =
    (status.deliveredSource === AGPS_LAB_SOURCE && status.labAgnss === true) ||
    (status.deliveredSource === AGPS_PGNSS_SOURCE && status.labPgnss === true);
  return switchOn && status.deliveredAt > 0 && (status.expiresAt === 0 || nowMs < status.expiresAt);
}

/**
 * The row shows for a watch whose last ask JoyoFit can serve: download version 0 (the Broadcom LTO kind), or `HW_AGNSS` / `HW_PGNSS_PRED` with
 * that kind's experimental switch on (`agpsLabActive`, `agpsPgnssActive`). It also stays while experimental data delivered with its switch on is
 * still valid: the Fit 4 Pro asks `HW_AGNSS` and then `HW_PGNSS_PRED` two seconds later (device run of 2026-10-25), so "the last ask" alone
 * would hide the row right after a delivery. A watch that never asked, or asked only for a kind the watch maker's app prepares, gets no row:
 * JoyoFit would answer "failed" and the row could only offer a button that cannot help.
 */
export function agpsVisible(status: AgpsStatus, nowMs: number): boolean {
  return (
    status.lastAskAt > 0 &&
    (status.lastAskVersion === 0 || agpsLabActive(status) || agpsPgnssActive(status) || labDelivered(status, nowMs))
  );
}

/** Turns the native status into what the row shows. `nowMs` is passed in so the result is a pure function of its inputs. */
export function agpsView(status: AgpsStatus, nowMs: number): AgpsView {
  const busy = status.phase !== 'idle';
  const lastUpdatedMs = status.deliveredAt > 0 ? status.deliveredAt : null;
  const size = status.deliveredSize > 0 ? status.deliveredSize : status.cachedSize;
  const expired = status.expiresAt > 0 && nowMs >= status.expiresAt;

  let statusKey: AgpsStatusKey;
  let tone: AgpsTone;
  if (busy) {
    statusKey = PHASE_STATUS[status.phase] ?? 'asking';
    tone = 'info';
  } else if (expired && (status.outcome === 'delivered' || status.outcome === 'none')) {
    statusKey = 'expired';
    tone = 'danger';
  } else if (status.outcome === 'unsupported' && labDelivered(status, nowMs)) {
    // The decline of the kind asked after the lab data (the other kind, its switch off) is expected; what the watch holds is still the delivered lab data.
    statusKey = deliveredKey(status.deliveredSource);
    tone = 'ok';
  } else {
    const known = OUTCOME_STATUS[status.outcome] ?? OUTCOME_STATUS.none;
    statusKey = known.key === 'delivered' ? deliveredKey(status.deliveredSource) : known.key;
    tone = known.tone;
  }

  const failed = tone === 'danger' && status.error.length > 0;
  return {
    lastUpdatedMs,
    sizeKb: size > 0 ? Math.max(1, Math.round(size / 1024)) : null,
    expired,
    busy,
    statusKey,
    tone,
    detail: failed ? status.error : null,
    retryAtMs: !busy && status.retryAt > nowMs ? status.retryAt : null,
  };
}
