import type { PickedSong } from './musicFiles';

/** One song of a batch. `pending` waits, `uploading` is sent now; the rest are final. */
export type QueueItemStatus = 'pending' | 'uploading' | 'uploaded' | 'cancelled' | 'failed' | 'skipped';

/** Why a native call failed: its error code (`ERR_*`, null without one), its message and the watch's status code when it sent one. */
export interface QueueFailure {
  code: string | null;
  message: string;
  statusCode: number | null;
}

export interface QueueItem {
  file: PickedSong;
  status: QueueItemStatus;
  failure: QueueFailure | null;
}

/** Why the batch ended before its last song: cancelled by the person, or the watch went away. */
export type QueueStop = 'cancelled' | 'disconnected';

export interface QueueState {
  phase: 'idle' | 'uploading' | 'finished';
  items: QueueItem[];
  /** The song being sent while `uploading`; -1 otherwise. */
  index: number;
  /** Cancel was pressed: the running song ends (cancelled or not) and nothing after it starts. */
  cancelRequested: boolean;
  stop: QueueStop | null;
}

export type QueueAction =
  | { type: 'start'; files: readonly PickedSong[] }
  /** The running song's `uploadWatchSong` resolved. */
  | { type: 'done'; status: 'uploaded' | 'cancelled' }
  /** The running song's `uploadWatchSong` rejected. */
  | { type: 'failed'; failure: QueueFailure }
  | { type: 'cancel' };

export const IDLE_QUEUE: QueueState = { phase: 'idle', items: [], index: -1, cancelRequested: false, stop: null };

/** Error codes that end the batch: without a watch every later song fails the same way. Any other error moves on to the next song. */
const STOP_CODES: Readonly<Record<string, true>> = { ERR_NOT_CONNECTED: true, ERR_DISCONNECTED: true };

/**
 * Sets the running song's final status, then starts the next one or ends the batch. `stopNow` ends it at once; a pending cancel ends it
 * after this song. Songs that never started become `skipped`. `stop` says why the batch ended early, null when every song had its turn.
 */
function advance(state: QueueState, status: QueueItemStatus, failure: QueueFailure | null, stopNow: QueueStop | null): QueueState {
  const items = state.items.map((item, i) => (i === state.index ? { ...item, status, failure } : item));
  const next = state.index + 1;
  const remaining = next < items.length;
  const stop = stopNow ?? (state.cancelRequested && remaining ? 'cancelled' : null);
  if (stop === null && remaining) {
    items[next] = { ...items[next], status: 'uploading' };
    return { ...state, items, index: next };
  }
  const rest = items.map((item) => (item.status === 'pending' ? { ...item, status: 'skipped' as const } : item));
  return { ...state, phase: 'finished', items: rest, index: -1, stop };
}

/**
 * The batch of songs as a state machine: idle → uploading(index) → each song uploaded, failed or cancelled → finished. Songs are sent one
 * by one in the order picked. A failed song does not stop the batch, except a lost watch (ERR_NOT_CONNECTED / ERR_DISCONNECTED). Cancel
 * lets the running song end (the native side resolves it `cancelled`) and marks the songs after it `skipped`. Actions that do not fit the
 * phase leave the state as it is.
 */
export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'start': {
      if (state.phase === 'uploading') return state;
      if (action.files.length === 0) return IDLE_QUEUE;
      const items = action.files.map((file, i): QueueItem => ({ file, status: i === 0 ? 'uploading' : 'pending', failure: null }));
      return { phase: 'uploading', items, index: 0, cancelRequested: false, stop: null };
    }
    case 'done':
      if (state.phase !== 'uploading') return state;
      return advance(state, action.status, null, action.status === 'cancelled' ? 'cancelled' : null);
    case 'failed':
      if (state.phase !== 'uploading') return state;
      return advance(state, 'failed', action.failure, action.failure.code !== null && STOP_CODES[action.failure.code] ? 'disconnected' : null);
    case 'cancel':
      if (state.phase !== 'uploading' || state.cancelRequested) return state;
      return { ...state, cancelRequested: true };
  }
}

/** The running song, or null when nothing is sent. */
export function currentItem(state: QueueState): QueueItem | null {
  return state.phase === 'uploading' ? (state.items[state.index] ?? null) : null;
}
