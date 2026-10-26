import { isUsableCoordinate } from '@/features/routes/routeModel';

/** The two files a workout can be shared as. */
export type ExportFormat = 'fit' | 'gpx';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  fit: 'application/vnd.ant.fit',
  gpx: 'application/gpx+xml',
};

/** What the exporter needs of a workout row. */
export interface ExportWorkout {
  /** Unix seconds. */
  start: number;
  sportName: string;
  complete: boolean;
}

/** What the exporter needs of a stored sample. */
export interface ExportPoint {
  ts: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** `JoyoFit-<sport>-<yyyy-mm-dd-HHmm>.<ext>`, the start in the phone's local time. The sport keeps letters and digits only. */
export function exportFileName(workout: ExportWorkout, format: ExportFormat): string {
  const d = new Date(workout.start * 1000);
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const sport = workout.sportName.replace(/[^A-Za-z0-9]+/g, '') || 'Workout';
  return `JoyoFit-${sport}-${when}.${format}`;
}

/** A FIT file is built for any finished workout (a summary-only one too); one still downloading from the watch has no final numbers. */
export function canExportFit(workout: ExportWorkout): boolean {
  return workout.complete;
}

function gpsPoints(points: readonly ExportPoint[]): ExportPoint[] {
  return points.filter((p) => p.lat !== null && p.lon !== null && isUsableCoordinate(p.lat, p.lon));
}

/** A GPX track needs a line: two fixes at least. */
export function canExportGpx(workout: ExportWorkout, points: readonly ExportPoint[]): boolean {
  return workout.complete && gpsPoints(points).length >= 2;
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GPS rows and heart-rate rows are stored apart: a fix takes the heart rate sampled closest to it, within this many seconds. */
const HR_REACH_S = 15;

function heartRateAt(hrs: readonly ExportPoint[], ts: number, from: { i: number }): number | null {
  while (from.i + 1 < hrs.length && Math.abs((hrs[from.i + 1] as ExportPoint).ts - ts) <= Math.abs((hrs[from.i] as ExportPoint).ts - ts)) from.i += 1;
  const near = hrs[from.i];
  return near && Math.abs(near.ts - ts) <= HR_REACH_S ? near.hr : null;
}

/**
 * GPX 1.1 track of the workout's GPS fixes: position, elevation, UTC time and, where the workout has one, the heart rate in
 * Garmin's TrackPointExtension v1 (what Garmin Connect, Strava and most apps read).
 */
export function buildGpx(workout: ExportWorkout, points: readonly ExportPoint[], creator = 'JoyoFit'): string {
  const hrs = points.filter((p) => p.hr !== null && p.hr > 0);
  const cursor = { i: 0 };
  const name = escapeXml(workout.sportName || 'Workout');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${escapeXml(creator)}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">`,
    `  <metadata><time>${new Date(workout.start * 1000).toISOString()}</time></metadata>`,
    '  <trk>',
    `    <name>${name}</name>`,
    '    <trkseg>',
  ];
  for (const p of gpsPoints(points)) {
    const hr = hrs.length > 0 ? heartRateAt(hrs, p.ts, cursor) : null;
    const parts = [`      <trkpt lat="${(p.lat as number).toFixed(6)}" lon="${(p.lon as number).toFixed(6)}">`];
    if (p.alt !== null && Number.isFinite(p.alt)) parts.push(`<ele>${p.alt.toFixed(1)}</ele>`);
    parts.push(`<time>${new Date(p.ts * 1000).toISOString()}</time>`);
    if (hr !== null) parts.push(`<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(hr)}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`);
    parts.push('</trkpt>');
    lines.push(parts.join(''));
  }
  lines.push('    </trkseg>', '  </trk>', '</gpx>', '');
  return lines.join('\n');
}

/** What a button does with the file: write it to a folder the person can find again, or hand it to the system share sheet. */
export type ExportAction = 'save' | 'share';

/**
 * How "Save" works on a platform. Android has no system sheet with a "Save to Downloads" entry, so the app asks for a folder
 * (Storage Access Framework) and writes there. iOS has one: the share sheet's "Save to Files", so Save and Share are the same sheet.
 */
export type SaveFlow = 'folder' | 'files';

export function saveFlow(os: string): SaveFlow {
  return os === 'android' ? 'folder' : 'files';
}

/** One button or menu entry: a format and what happens to it. */
export interface ExportEntry {
  format: ExportFormat;
  action: ExportAction;
}

const FORMATS: readonly ExportFormat[] = ['fit', 'gpx'];

/**
 * The entries to offer, Save before Share. iOS has no Share entries: its Save is the share sheet, so a second one would open the
 * same sheet.
 */
export function exportEntries(os: string, available: Readonly<Record<ExportFormat, boolean>>): ExportEntry[] {
  const formats = FORMATS.filter((format) => available[format]);
  const actions: ExportAction[] = saveFlow(os) === 'files' ? ['save'] : ['save', 'share'];
  return actions.flatMap((action) => formats.map((format) => ({ format, action })));
}

/** Translation key (`workouts` namespace) of an entry's label: Save (Android), Save to Files (iOS) or Share. */
export function exportLabelKey(os: string, { format, action }: ExportEntry): `export.${'save' | 'saveFiles' | 'share'}.${ExportFormat}` {
  if (action === 'share') return `export.share.${format}`;
  return saveFlow(os) === 'files' ? `export.saveFiles.${format}` : `export.save.${format}`;
}

/** The phone side of an export, injected so the logic is testable. */
export interface ExportIo {
  /** Writes the file into the cache directory and returns its `file://` URI. */
  writeCacheFile(name: string, content: Uint8Array | string): string;
  /** Opens the share sheet; resolves when it closes (also when the person cancels). */
  share(uri: string, mime: string, name: string): Promise<void>;
  /**
   * Writes the file into a folder the person picked (the one used last time unless `pickFolder`). Resolves with the folder's
   * name, or null when the picker was closed without a choice.
   */
  saveToFolder(name: string, mime: string, content: Uint8Array | string, pickFolder: boolean): Promise<string | null>;
}

/** `saved`: the file is in `folder`. `sheet`: the share sheet closed (what the person chose in it is not known). `cancelled`: nothing was written. */
export type ExportOutcome = { kind: 'saved'; name: string; folder: string } | { kind: 'sheet'; name: string } | { kind: 'cancelled' };

/** Saves or shares the file; `os` picks the Save flow (`saveFlow`). */
export async function exportFile(
  io: ExportIo,
  os: string,
  workout: ExportWorkout,
  format: ExportFormat,
  action: ExportAction,
  content: Uint8Array | string,
  pickFolder = false,
): Promise<ExportOutcome> {
  const name = exportFileName(workout, format);
  const mime = EXPORT_MIME[format];
  if (action === 'save' && saveFlow(os) === 'folder') {
    const folder = await io.saveToFolder(name, mime, content, pickFolder);
    return folder === null ? { kind: 'cancelled' } : { kind: 'saved', name, folder };
  }
  await io.share(io.writeCacheFile(name, content), mime, name);
  return { kind: 'sheet', name };
}
