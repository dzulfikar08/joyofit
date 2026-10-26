import { describe, expect, it } from 'bun:test';

import { buildFit, type StravaPoint, type StravaWorkout } from '@/features/strava/activityFile';
import { decodeFit } from '@/features/strava/testDecode';

import { buildGpx, canExportFit, canExportGpx, exportEntries, exportFile, exportFileName, exportLabelKey, saveFlow, type ExportIo } from './workoutExport';

const START = 1_792_058_016;
const workout: StravaWorkout = {
  start: START,
  end: START + 600,
  sportType: 2,
  sportName: 'Walking',
  duration: 540,
  distance: 500,
  calories: 38,
  avgHr: 101,
  maxHr: 120,
  steps: 900,
};
const points: StravaPoint[] = [
  { ts: START, lat: -6.2, lon: 106.8, alt: 10, hr: null },
  { ts: START + 5, lat: null, lon: null, alt: null, hr: 98 },
  { ts: START + 300, lat: -6.201, lon: 106.8, alt: 12, hr: null },
  { ts: START + 600, lat: -6.202, lon: 106.8, alt: 11, hr: 110 },
];
const row = { start: START, sportName: 'Walking', complete: true };

describe('exportFileName', () => {
  it('names the file by sport and local start time', () => {
    const d = new Date(START * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    expect(exportFileName(row, 'fit')).toBe(`JoyoFit-Walking-${when}.fit`);
    expect(exportFileName({ ...row, sportName: 'Indoor cycling' }, 'gpx')).toBe(`JoyoFit-Indoorcycling-${when}.gpx`);
    expect(exportFileName({ ...row, sportName: '' }, 'fit')).toStartWith('JoyoFit-Workout-');
  });
});

interface Calls {
  cache: { name: string; content: Uint8Array | string }[];
  shared: { uri: string; mime: string; name: string }[];
  folder: { name: string; mime: string; content: Uint8Array | string; pickFolder: boolean }[];
}

/** An `ExportIo` that records what it was asked; `folderName` is what the picker "returns" (null: closed without a choice). */
function recordingIo(folderName: string | null = 'Download/JoyoFit'): { io: ExportIo; calls: Calls } {
  const calls: Calls = { cache: [], shared: [], folder: [] };
  const io: ExportIo = {
    writeCacheFile: (name, content) => {
      calls.cache.push({ name, content });
      return `file:///cache/${name}`;
    },
    share: async (uri, mime, name) => {
      calls.shared.push({ uri, mime, name });
    },
    saveToFolder: async (name, mime, content, pickFolder) => {
      calls.folder.push({ name, mime, content, pickFolder });
      return folderName;
    },
  };
  return { io, calls };
}

describe('saveFlow', () => {
  it('asks Android for a folder and lets iOS use the share sheet\'s Save to Files', () => {
    expect(saveFlow('android')).toBe('folder');
    expect(saveFlow('ios')).toBe('files');
    expect(saveFlow('web')).toBe('files');
  });
});

describe('exportFile', () => {
  const built = buildFit(workout, points, { utcOffsetSeconds: 7 * 3600 });

  it('Android Save writes the exact Strava FIT bytes into the picked folder, without the share sheet or the cache', async () => {
    const { io, calls } = recordingIo();
    const outcome = await exportFile(io, 'android', row, 'fit', 'save', built.bytes);
    expect(outcome.kind).toBe('saved');
    if (outcome.kind !== 'saved') return;
    expect(outcome.folder).toBe('Download/JoyoFit');
    expect(calls.folder).toHaveLength(1);
    expect(calls.folder[0]?.name).toBe(outcome.name);
    expect(calls.folder[0]?.mime).toBe('application/vnd.ant.fit');
    expect(calls.folder[0]?.pickFolder).toBe(false);
    expect(Buffer.from(calls.folder[0]?.content as Uint8Array).equals(Buffer.from(buildFit(workout, points, { utcOffsetSeconds: 7 * 3600 }).bytes))).toBe(true);
    expect(calls.shared).toEqual([]);
    expect(calls.cache).toEqual([]);
    expect(decodeFit(built.bytes).integrity).toBe(true);
  });

  it('Android Save passes "pick the folder again" on and reports a closed picker as cancelled', async () => {
    const asked = recordingIo();
    await exportFile(asked.io, 'android', row, 'gpx', 'save', '<gpx/>', true);
    expect(asked.calls.folder[0]?.pickFolder).toBe(true);
    expect(asked.calls.folder[0]?.mime).toBe('application/gpx+xml');
    const closed = recordingIo(null);
    expect(await exportFile(closed.io, 'android', row, 'fit', 'save', built.bytes)).toEqual({ kind: 'cancelled' });
    expect(closed.calls.shared).toEqual([]);
  });

  it('iOS Save is the share sheet (Save to Files) on a cache file', async () => {
    const { io, calls } = recordingIo();
    const outcome = await exportFile(io, 'ios', row, 'fit', 'save', built.bytes);
    expect(outcome.kind).toBe('sheet');
    if (outcome.kind !== 'sheet') return;
    expect(calls.folder).toEqual([]);
    expect(calls.cache).toHaveLength(1);
    expect(calls.cache[0]?.name).toBe(outcome.name);
    expect(calls.cache[0]?.content).toBe(built.bytes);
    expect(calls.shared).toEqual([{ uri: `file:///cache/${outcome.name}`, mime: 'application/vnd.ant.fit', name: outcome.name }]);
  });

  it('Share opens the share sheet on both platforms and never touches a folder', async () => {
    for (const os of ['android', 'ios']) {
      const { io, calls } = recordingIo();
      const outcome = await exportFile(io, os, row, 'gpx', 'share', '<gpx/>');
      expect(outcome.kind).toBe('sheet');
      expect(calls.folder).toEqual([]);
      expect(calls.shared).toHaveLength(1);
      expect(calls.shared[0]?.mime).toBe('application/gpx+xml');
    }
  });
});

describe('exportEntries', () => {
  const both = { fit: true, gpx: true };
  it('Android: Save, then Share, per available format', () => {
    expect(exportEntries('android', both)).toEqual([
      { format: 'fit', action: 'save' },
      { format: 'gpx', action: 'save' },
      { format: 'fit', action: 'share' },
      { format: 'gpx', action: 'share' },
    ]);
    expect(exportEntries('android', { fit: true, gpx: false })).toEqual([
      { format: 'fit', action: 'save' },
      { format: 'fit', action: 'share' },
    ]);
  });
  it('iOS: Save only, because Save and Share are the same sheet', () => {
    expect(exportEntries('ios', both)).toEqual([
      { format: 'fit', action: 'save' },
      { format: 'gpx', action: 'save' },
    ]);
  });
  it('offers nothing when no file can be built', () => {
    expect(exportEntries('android', { fit: false, gpx: false })).toEqual([]);
    expect(exportEntries('ios', { fit: false, gpx: false })).toEqual([]);
  });
  it('labels Save "Save .fit file" on Android and "Save .fit to Files" on iOS', () => {
    expect(exportLabelKey('android', { format: 'fit', action: 'save' })).toBe('export.save.fit');
    expect(exportLabelKey('ios', { format: 'gpx', action: 'save' })).toBe('export.saveFiles.gpx');
    expect(exportLabelKey('android', { format: 'gpx', action: 'share' })).toBe('export.share.gpx');
  });
});

describe('availability', () => {
  it('needs a finished workout, and for GPX a line', () => {
    expect(canExportFit(row)).toBe(true);
    expect(canExportFit({ ...row, complete: false })).toBe(false);
    expect(canExportGpx(row, points)).toBe(true);
    expect(canExportGpx(row, points.slice(1, 2))).toBe(false);
    expect(canExportGpx({ ...row, complete: false }, points)).toBe(false);
  });
});

describe('buildGpx', () => {
  it('writes the fixes with time and the closest heart rate in the Garmin extension', () => {
    const gpx = buildGpx(row, points);
    expect(gpx).toContain('xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"');
    expect(gpx.match(/<trkpt /g)).toHaveLength(3);
    expect(gpx).toContain('<trkpt lat="-6.200000" lon="106.800000"><ele>10.0</ele><time>');
    expect(gpx).toContain('<gpxtpx:hr>98</gpxtpx:hr>');
    expect(gpx).toContain('<gpxtpx:hr>110</gpxtpx:hr>');
    // The fix at +300 s has no heart rate within reach.
    expect(gpx.match(/<gpxtpx:hr>/g)).toHaveLength(2);
    expect(gpx).toContain(new Date(START * 1000).toISOString());
  });
  it('escapes the name', () => {
    expect(buildGpx({ ...row, sportName: 'A & <B>' }, points)).toContain('<name>A &amp; &lt;B&gt;</name>');
  });
});
