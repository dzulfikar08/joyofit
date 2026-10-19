/**
 * The "painted" index: the streets the person has already walked or run, kept as a grid of small cells built from their own
 * GPS tracks. A loop's novelty is the share of its length that is not near a painted cell. Everything stays on the phone; this
 * file is pure (no database, no React) so it runs under `bun test`.
 */
import type { LatLon } from '@/features/routes/map/geometry';
import { haversineM } from '@/features/routes/routeModel';

import { M_PER_DEG, resampleLine } from './geo';

/** Side of one cell. A point counts as painted when its cell or one of the 8 around it holds a track, so about 15 to 30 m. */
export const CELL_M = 15;

/** Two consecutive GPS fixes further apart than this are a gap in the signal, not a walk in a straight line. */
export const GPS_GAP_M = 200;

/** A loop is looked at every this many metres along its length. */
export const SAMPLE_STEP_M = 10;

/** Two points on the same loop count as "the same street again" when they are within this distance. */
const REPEAT_RADIUS_CELLS = 1;
/** ...and at least this far apart along the loop (a street walked on, not the next point of the same stretch). */
const REPEAT_MIN_GAP_SAMPLES = 10;
/** The loop leaves and comes back through the same door, so points this close to the start are not counted as repeated. */
const START_EXEMPT_M = 100;

const KEY_STRIDE = 4_000_000;

export interface PaintedIndex {
  /** Cells that hold at least one fix. */
  readonly size: number;
  /** Adds one track; fixes are joined into a continuous line unless a gap is bigger than `GPS_GAP_M`. */
  addTrack(points: readonly LatLon[]): void;
  /** The point's cell or a cell next to it holds a track. */
  isPainted(point: LatLon): boolean;
}

/** Cell grid in metres around one reference latitude: longitude is shrunk by its cosine so a cell is square on the ground. */
function cellOf(point: LatLon, cosRef: number): { ix: number; iy: number } {
  return {
    ix: Math.floor(((point.lon + 180) * M_PER_DEG * cosRef) / CELL_M),
    iy: Math.floor(((point.lat + 90) * M_PER_DEG) / CELL_M),
  };
}

const keyOf = (ix: number, iy: number) => iy * KEY_STRIDE + ix;

/** `refLat` is the latitude of the area (any point in it): the grid is only used for points within a few tens of kilometres. */
export function createPaintedIndex(refLat: number): PaintedIndex {
  const cosRef = Math.max(0.05, Math.cos((refLat * Math.PI) / 180));
  const cells = new Set<number>();
  const mark = (p: LatLon) => {
    const { ix, iy } = cellOf(p, cosRef);
    cells.add(keyOf(ix, iy));
  };

  return {
    get size() {
      return cells.size;
    },
    addTrack(points) {
      let previous: LatLon | null = null;
      for (const point of points) {
        if (previous === null || haversineM(previous, point) > GPS_GAP_M) {
          mark(point);
        } else {
          // Fill the cells between two fixes so a fast run with sparse fixes still paints the street.
          for (const p of resampleLine([previous, point], CELL_M / 2)) mark(p);
        }
        previous = point;
      }
    },
    isPainted(point) {
      const { ix, iy } = cellOf(point, cosRef);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (cells.has(keyOf(ix + dx, iy + dy))) return true;
        }
      }
      return false;
    },
  };
}

export interface LoopScore {
  /** Length of the line in metres. */
  lengthM: number;
  /** Share of the length, 0 to 1, that is on streets the person has not painted; null when there is no history to compare with. */
  newShare: number | null;
  /** Share of the length, 0 to 1, that retraces a street the same loop already used (an out-and-back). */
  repeatShare: number;
}

/** Novelty and repetition of a closed loop. `painted` is null when the person has no tracks near here. */
export function scoreLoop(line: readonly LatLon[], painted: PaintedIndex | null): LoopScore {
  const samples = resampleLine(line, SAMPLE_STEP_M);
  let lengthM = 0;
  for (let i = 1; i < line.length; i++) lengthM += haversineM(line[i - 1], line[i]);
  if (samples.length < 2) return { lengthM, newShare: painted ? 1 : null, repeatShare: 0 };

  let fresh = 0;
  if (painted) {
    for (const p of samples) if (!painted.isPainted(p)) fresh++;
  }

  const cosRef = Math.max(0.05, Math.cos((samples[0].lat * Math.PI) / 180));
  const seen = new Map<number, number[]>();
  let repeated = 0;
  for (let i = 0; i < samples.length; i++) {
    const { ix, iy } = cellOf(samples[i], cosRef);
    if (haversineM(samples[0], samples[i]) > START_EXEMPT_M) {
      let again = false;
      for (let dy = -REPEAT_RADIUS_CELLS; dy <= REPEAT_RADIUS_CELLS && !again; dy++) {
        for (let dx = -REPEAT_RADIUS_CELLS; dx <= REPEAT_RADIUS_CELLS && !again; dx++) {
          const earlier = seen.get(keyOf(ix + dx, iy + dy));
          if (earlier?.some((j) => i - j >= REPEAT_MIN_GAP_SAMPLES)) again = true;
        }
      }
      if (again) repeated++;
    }
    const key = keyOf(ix, iy);
    const bucket = seen.get(key);
    if (bucket) bucket.push(i);
    else seen.set(key, [i]);
  }

  return { lengthM, newShare: painted ? fresh / samples.length : null, repeatShare: repeated / samples.length };
}

/**
 * The tracks as lines for the map: each track cut where it leaves `box` (`[south, west, north, east]`) or where the signal
 * dropped, thinned to one point per `minStepM`, at most `maxPoints` points in all (the oldest tracks go first when over).
 * `tracks` are newest first.
 */
export function displayLines(
  tracks: readonly (readonly LatLon[])[],
  box: readonly [number, number, number, number],
  minStepM = 12,
  maxPoints = 12_000,
): LatLon[][] {
  const [south, west, north, east] = box;
  const lines: LatLon[][] = [];
  let budget = maxPoints;
  for (const track of tracks) {
    let current: LatLon[] = [];
    const flush = () => {
      if (current.length >= 2) lines.push(current);
      current = [];
    };
    for (const p of track) {
      if (budget <= 0) break;
      if (p.lat < south || p.lat > north || p.lon < west || p.lon > east) {
        flush();
        continue;
      }
      const last = current[current.length - 1];
      if (last) {
        const d = haversineM(last, p);
        if (d > GPS_GAP_M) flush();
        else if (d < minStepM) continue;
      }
      current.push(p);
      budget--;
    }
    flush();
    if (budget <= 0) break;
  }
  return lines;
}
