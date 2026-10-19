/** Reads the person's own walking, running and hiking tracks around a point from the workouts table. Nothing leaves the phone. */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { LatLon } from '@/features/routes/map/geometry';

import { SPORT_TYPES } from './body';
import { boxAround } from './geo';
import { createPaintedIndex, displayLines, type PaintedIndex } from './painted';

/** How far from the start the history is read: a loop of the longest length stays well inside. */
export const HISTORY_RADIUS_M = 8000;

/** Most GPS rows read in one go; the newest workouts come first, so the cap drops the oldest. */
const MAX_ROWS = 400_000;

export interface PaintedArea {
  /** Null when the person has no foot tracks around the start: novelty cannot be told then. */
  index: PaintedIndex | null;
  /** The tracks as lines to draw on the map. */
  lines: LatLon[][];
  /** How many workouts have a track in the area. */
  workouts: number;
}

interface Row {
  id: number;
  lat: number;
  lon: number;
}

/** Foot tracks (walk, hike, run, trail run) inside `HISTORY_RADIUS_M` of `center`. */
export async function loadPaintedArea(db: SQLiteDatabase, center: LatLon): Promise<PaintedArea> {
  const [south, west, north, east] = boxAround(center, HISTORY_RADIUS_M);
  const types = [...SPORT_TYPES.walk, ...SPORT_TYPES.run];
  const rows = await db.getAllAsync<Row>(
    `SELECT workout_id AS id, lat, lon FROM workout_points
     WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
       AND workout_id IN (SELECT id FROM workouts WHERE sport_type IN (${types.map(() => '?').join(',')}))
     ORDER BY workout_id DESC, ts LIMIT ?`,
    south,
    north,
    west,
    east,
    ...types,
    MAX_ROWS,
  );
  if (rows.length === 0) return { index: null, lines: [], workouts: 0 };

  const tracks: LatLon[][] = [];
  let currentId: number | null = null;
  for (const row of rows) {
    if (row.id !== currentId) {
      tracks.push([]);
      currentId = row.id;
    }
    tracks[tracks.length - 1].push({ lat: row.lat, lon: row.lon });
  }

  const index = createPaintedIndex(center.lat);
  for (const track of tracks) index.addTrack(track);
  return { index, lines: displayLines(tracks, [south, west, north, east]), workouts: tracks.length };
}
