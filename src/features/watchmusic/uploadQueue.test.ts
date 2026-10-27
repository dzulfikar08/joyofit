import { describe, expect, test } from 'bun:test';

import type { PickedSong } from './musicFiles';
import { currentItem, IDLE_QUEUE, queueReducer, type QueueAction, type QueueState } from './uploadQueue';

const files: PickedSong[] = ['a.mp3', 'b.m4a', 'c.aac', 'd.mp3'].map((name) => ({ uri: `file:///${name}`, name, size: 1000 }));
const run = (actions: QueueAction[], from: QueueState = IDLE_QUEUE) => actions.reduce(queueReducer, from);
const statuses = (state: QueueState) => state.items.map((i) => i.status);
const fail = (code: string | null, statusCode: number | null = null): QueueAction => ({ type: 'failed', failure: { code, message: 'x', statusCode } });
const START: QueueAction = { type: 'start', files };
const UPLOADED: QueueAction = { type: 'done', status: 'uploaded' };

describe('watch music upload queue', () => {
  test('start sends the first song, the rest wait', () => {
    const state = run([START]);
    expect(state.phase).toBe('uploading');
    expect(state.index).toBe(0);
    expect(statuses(state)).toEqual(['uploading', 'pending', 'pending', 'pending']);
    expect(currentItem(state)?.file.name).toBe('a.mp3');
    expect(run([{ type: 'start', files: [] }])).toBe(IDLE_QUEUE);
  });

  test('songs go one by one to finished', () => {
    const state = run([START, UPLOADED, UPLOADED, UPLOADED, UPLOADED]);
    expect(state.phase).toBe('finished');
    expect(state.stop).toBeNull();
    expect(state.index).toBe(-1);
    expect(currentItem(state)).toBeNull();
    expect(statuses(state)).toEqual(['uploaded', 'uploaded', 'uploaded', 'uploaded']);
  });

  test('a failed song does not stop the batch', () => {
    const state = run([START, fail('ERR_UPLOAD_REJECTED', 140008), fail('ERR_TIMEOUT'), UPLOADED, fail(null)]);
    expect(state.phase).toBe('finished');
    expect(state.stop).toBeNull();
    expect(statuses(state)).toEqual(['failed', 'failed', 'uploaded', 'failed']);
    expect(state.items[0].failure).toEqual({ code: 'ERR_UPLOAD_REJECTED', message: 'x', statusCode: 140008 });
  });

  test('cancel mid-batch: the running song ends cancelled, the rest are skipped', () => {
    const cancelling = run([START, UPLOADED, { type: 'cancel' }]);
    expect(cancelling.phase).toBe('uploading');
    expect(cancelling.cancelRequested).toBe(true);
    const state = queueReducer(cancelling, { type: 'done', status: 'cancelled' });
    expect(state.phase).toBe('finished');
    expect(state.stop).toBe('cancelled');
    expect(statuses(state)).toEqual(['uploaded', 'cancelled', 'skipped', 'skipped']);
  });

  test('cancel that comes too late for the running song still stops the next ones', () => {
    const state = run([START, { type: 'cancel' }, UPLOADED]);
    expect(state.stop).toBe('cancelled');
    expect(statuses(state)).toEqual(['uploaded', 'skipped', 'skipped', 'skipped']);
    const failed = run([START, { type: 'cancel' }, fail('ERR_TIMEOUT')]);
    expect(statuses(failed)).toEqual(['failed', 'skipped', 'skipped', 'skipped']);
  });

  test('cancel on the last song finishes without an early stop', () => {
    const state = run([START, UPLOADED, UPLOADED, UPLOADED, { type: 'cancel' }, UPLOADED]);
    expect(state.stop).toBeNull();
    expect(statuses(state)).toEqual(['uploaded', 'uploaded', 'uploaded', 'uploaded']);
  });

  test('a lost watch stops the batch', () => {
    const state = run([START, UPLOADED, fail('ERR_NOT_CONNECTED')]);
    expect(state.phase).toBe('finished');
    expect(state.stop).toBe('disconnected');
    expect(statuses(state)).toEqual(['uploaded', 'failed', 'skipped', 'skipped']);
    expect(run([START, fail('ERR_DISCONNECTED')]).stop).toBe('disconnected');
  });

  test('actions outside their phase change nothing', () => {
    expect(run([{ type: 'cancel' }])).toBe(IDLE_QUEUE);
    expect(run([UPLOADED])).toBe(IDLE_QUEUE);
    expect(run([fail('ERR_BUSY')])).toBe(IDLE_QUEUE);
    const uploading = run([START]);
    expect(queueReducer(uploading, START)).toBe(uploading);
    const finished = run([START, fail('ERR_NOT_CONNECTED')]);
    expect(queueReducer(finished, UPLOADED)).toBe(finished);
    // A new batch starts from a finished one.
    expect(statuses(queueReducer(finished, { type: 'start', files: files.slice(0, 2) }))).toEqual(['uploading', 'pending']);
  });
});
