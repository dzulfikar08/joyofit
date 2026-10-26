import { describe, expect, it } from 'bun:test';

import { buildFit, buildUploadForm, type StravaPoint, type StravaWorkout } from './activityFile';
import {
  answerFileRequest,
  initialManualUpload,
  manualUploadFile,
  manualUploadReducer,
  STRAVA_UPLOAD_URL,
  takesWorkoutFile,
  type ManualFile,
  type ManualUploadState,
} from './manualUpload';
import { decodeFit } from './testDecode';

const START = 1_792_058_016;
const run: StravaWorkout = {
  start: START,
  end: START + 1_800,
  sportType: 5,
  sportName: 'Outdoor run',
  duration: 1_780,
  distance: 5_000,
  calories: 320,
  avgHr: 150,
  maxHr: 171,
  steps: 5_200,
};
const points: StravaPoint[] = [
  { ts: START, lat: -6.2, lon: 106.8, alt: 10, hr: 140 },
  { ts: START + 900, lat: -6.21, lon: 106.8, alt: 12, hr: 155 },
  { ts: START + 1_800, lat: -6.22, lon: 106.8, alt: 11, hr: 160 },
];

const UPLOAD = 'https://www.strava.com/upload/select';
const READY: ManualFile = { status: 'ready', uri: 'file:///cache/strava-upload/joyofit-1.fit', name: 'joyofit-1.fit' };

describe('the file', () => {
  it('is the FIT the API upload sends, byte for byte, under the API upload name', () => {
    const fit = buildFit(run, points);
    const manual = manualUploadFile(START, fit.bytes);
    expect(manual.name).toBe(`joyofit-${START}.fit`);
    expect(manual.bytes).toBe(fit.bytes);

    const form = buildUploadForm(run, fit.bytes, { addLink: false });
    const text = new TextDecoder('latin1').decode(form.body);
    expect(text).toContain(`name="file"; filename="${manual.name}"\r\n`);
  });

  it('decodes as the same activity', () => {
    const { integrity, messages } = decodeFit(manualUploadFile(START, buildFit(run, points).bytes).bytes);
    expect(integrity).toBe(true);
    expect(messages.sessionMesgs?.[0]?.totalDistance).toBeCloseTo(5_000, 0);
    expect(messages.recordMesgs?.length).toBeGreaterThan(0);
  });

  it('opens Strava’s own upload page', () => {
    expect(STRAVA_UPLOAD_URL).toBe(UPLOAD);
  });
});

describe('takesWorkoutFile', () => {
  it('answers a file input on strava.com’s upload pages', () => {
    for (const pageUrl of [UPLOAD, 'https://strava.com/upload/select', 'https://www.strava.com/upload', 'https://www.strava.com/upload?x=1', 'HTTPS://WWW.STRAVA.COM/upload/select']) {
      expect([pageUrl, takesWorkoutFile({ pageUrl, acceptTypes: [] })]).toEqual([pageUrl, true]);
    }
  });

  it('answers nothing on another page, another site or without https', () => {
    for (const pageUrl of [
      'https://www.strava.com/settings/profile',
      'https://www.strava.com/uploads',
      'https://www.strava.com.evil.example/upload/select',
      'https://evil.example/?https://www.strava.com/upload',
      'http://www.strava.com/upload/select',
      '',
    ]) {
      expect([pageUrl, takesWorkoutFile({ pageUrl, acceptTypes: [] })]).toEqual([pageUrl, false]);
    }
  });

  it('answers an input that can take a .fit, not a photo or video picker', () => {
    expect(takesWorkoutFile({ pageUrl: UPLOAD, acceptTypes: ['.fit,.fit.gz,.tcx,.gpx'] })).toBe(true);
    expect(takesWorkoutFile({ pageUrl: UPLOAD, acceptTypes: ['*/*'] })).toBe(true);
    expect(takesWorkoutFile({ pageUrl: UPLOAD, acceptTypes: ['image/*', '.fit'] })).toBe(true);
    expect(takesWorkoutFile({ pageUrl: UPLOAD, acceptTypes: [' '] })).toBe(true);
    expect(takesWorkoutFile({ pageUrl: UPLOAD, acceptTypes: ['image/*'] })).toBe(false);
    expect(takesWorkoutFile({ pageUrl: UPLOAD, acceptTypes: ['image/jpeg, video/mp4'] })).toBe(false);
  });
});

describe('answerFileRequest', () => {
  const request = { pageUrl: UPLOAD, acceptTypes: [] };

  it('hands over the written file', () => {
    expect(answerFileRequest(READY, request)).toEqual({ kind: 'file', uri: READY.status === 'ready' ? READY.uri : '' });
  });

  it('holds the request while the file is still being written', () => {
    expect(answerFileRequest({ status: 'building' }, request)).toEqual({ kind: 'wait' });
  });

  it('cancels when there is no file or the request is not Strava’s upload', () => {
    expect(answerFileRequest({ status: 'failed', error: 'gone' }, request)).toEqual({ kind: 'cancel' });
    expect(answerFileRequest(READY, { pageUrl: 'https://www.strava.com/athlete/edit', acceptTypes: [] })).toEqual({ kind: 'cancel' });
    expect(answerFileRequest({ status: 'building' }, { pageUrl: UPLOAD, acceptTypes: ['image/*'] })).toEqual({ kind: 'cancel' });
  });
});

describe('manualUploadReducer', () => {
  const step = (state: ManualUploadState, ...events: Parameters<typeof manualUploadReducer>[1][]) => events.reduce(manualUploadReducer, state);

  it('starts building, with nothing handed over and no mark', () => {
    expect(initialManualUpload).toEqual({ file: { status: 'building' }, handedOver: 0, markedAt: null });
  });

  it('counts hand-overs only once the file is written', () => {
    const early = step(initialManualUpload, { type: 'handedOver' });
    expect(early.handedOver).toBe(0);
    const ready = step(initialManualUpload, { type: 'fileReady', uri: 'file:///a.fit', name: 'a.fit' }, { type: 'handedOver' }, { type: 'handedOver' });
    expect(ready.file).toEqual({ status: 'ready', uri: 'file:///a.fit', name: 'a.fit' });
    expect(ready.handedOver).toBe(2);
  });

  it('keeps a failure and hands nothing over after it', () => {
    const failed = step(initialManualUpload, { type: 'fileFailed', error: 'gone' }, { type: 'handedOver' });
    expect(failed).toEqual({ file: { status: 'failed', error: 'gone' }, handedOver: 0, markedAt: null });
  });

  it('loads, sets and clears the mark without touching the file', () => {
    const ready = step(initialManualUpload, { type: 'fileReady', uri: 'file:///a.fit', name: 'a.fit' });
    expect(step(ready, { type: 'markLoaded', markedAt: 100 }).markedAt).toBe(100);
    const marked = step(ready, { type: 'markLoaded', markedAt: null }, { type: 'marked', at: 200 });
    expect(marked.markedAt).toBe(200);
    expect(marked.file).toBe(ready.file);
    expect(step(marked, { type: 'unmarked' }).markedAt).toBeNull();
  });
});
