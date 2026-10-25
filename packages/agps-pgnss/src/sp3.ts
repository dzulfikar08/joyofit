// SP3-c/d precise orbit files (CODE's ultra-rapid and 5-day prediction products) and interpolation of their tabulated positions and clocks.
//
// Times are GPS seconds since 1980-01-06 (the products' time system is GPS: `%c ... GPS`); positions are ECEF metres (IGS20), clocks seconds.

export const GPS_EPOCH_MS = Date.UTC(1980, 0, 6);

/** Calendar date read as UTC to GPS seconds without a leap second offset: right for timestamps already in GPS time (SP3, RINEX GPS/Galileo). */
export const calendarToGps = (ms: number): number => (ms - GPS_EPOCH_MS) / 1000;

export type Sp3 = {
  /** Epoch times, GPS seconds, ascending, evenly spaced by [step]. */
  t0: number;
  step: number;
  count: number;
  /** Per satellite id (`G01`, `R05`, `E12`, `C23`, `J02`): x, y, z [m] and clock [s] for every epoch, NaN where the file has no value. */
  sats: Map<string, { pos: Float64Array; clk: Float64Array }>;
  /** Header comment lines (`/*`), kept for logging the product's own description. */
  comments: string[];
};

/** Clock value SP3 uses for "no clock" (microseconds). */
const BAD_CLOCK_US = 999999;

/**
 * Parses an SP3-c/d file. Epochs outside [fromGps, toGps] are skipped before their numbers are read. Positions of 0.000000 (SP3's "no
 * value") and clocks of 999999.999999 become NaN. Throws on a file that is not SP3 or not evenly spaced in GPS time.
 */
export function parseSp3(text: string, fromGps = -Infinity, toGps = Infinity): Sp3 {
  if (!text.startsWith('#c') && !text.startsWith('#d')) throw new Error('not an SP3-c/d file');
  const lines = text.split('\n');
  const head2 = lines[1] ?? '';
  const step = Number(head2.slice(24, 38));
  if (!(step > 0)) throw new Error('SP3 epoch interval missing');
  const timeSystem = (lines.find((l) => l.startsWith('%c')) ?? '').slice(9, 12);
  if (timeSystem !== 'GPS') throw new Error(`SP3 time system ${timeSystem || 'missing'} (want GPS)`);
  const comments = lines.filter((l) => l.startsWith('/*')).map((l) => l.slice(3).trimEnd());

  const epochs: number[] = [];
  const rows = new Map<string, { idx: number[]; xyzc: number[] }>();
  let current = -1;
  for (const line of lines) {
    const c0 = line.charCodeAt(0);
    if (c0 === 42 /* * */) {
      const m = /^\*\s+(\d{4})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)/.exec(line);
      if (!m) throw new Error(`bad SP3 epoch line: ${line}`);
      const sec = Number(m[6]);
      const t = calendarToGps(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Math.floor(sec))) + (sec % 1);
      if (t < fromGps || t > toGps) {
        current = -1;
        continue;
      }
      epochs.push(t);
      current = epochs.length - 1;
    } else if (c0 === 80 /* P */ && current >= 0) {
      const id = line.slice(1, 4).replace(' ', '0');
      let row = rows.get(id);
      if (!row) {
        row = { idx: [], xyzc: [] };
        rows.set(id, row);
      }
      const x = Number(line.slice(4, 18));
      const y = Number(line.slice(18, 32));
      const z = Number(line.slice(32, 46));
      const clkUs = Number(line.slice(46, 60));
      const noPos = x === 0 && y === 0 && z === 0;
      row.idx.push(current);
      row.xyzc.push(noPos ? NaN : x * 1000, noPos ? NaN : y * 1000, noPos ? NaN : z * 1000, !Number.isFinite(clkUs) || clkUs >= BAD_CLOCK_US ? NaN : clkUs * 1e-6);
    }
  }
  if (epochs.length === 0) throw new Error('SP3 file has no epochs in the wanted window');
  const t0 = epochs[0] as number;
  for (let i = 1; i < epochs.length; i++) {
    if (Math.abs((epochs[i] as number) - t0 - i * step) > 1e-3) throw new Error('SP3 epochs are not evenly spaced');
  }
  const sats = new Map<string, { pos: Float64Array; clk: Float64Array }>();
  for (const [id, row] of rows) {
    const pos = new Float64Array(epochs.length * 3).fill(NaN);
    const clk = new Float64Array(epochs.length).fill(NaN);
    for (let k = 0; k < row.idx.length; k++) {
      const i = row.idx[k] as number;
      pos[3 * i] = row.xyzc[4 * k] as number;
      pos[3 * i + 1] = row.xyzc[4 * k + 1] as number;
      pos[3 * i + 2] = row.xyzc[4 * k + 2] as number;
      clk[i] = row.xyzc[4 * k + 3] as number;
    }
    sats.set(id, { pos, clk });
  }
  return { t0, step, count: epochs.length, sats, comments };
}

/** Last epoch of the file, GPS seconds. */
export const sp3End = (s: Sp3): number => s.t0 + (s.count - 1) * s.step;

/** Lagrange window: this many tabulated epochs around the wanted time (sub-centimetre for GNSS orbits at 300 to 900 s spacing). */
const LAGRANGE_POINTS = 10;

/**
 * Position [m] and velocity [m/s] (ECEF, so the velocity is the rotating-frame one) of `id` at `t` by Lagrange interpolation, or null when
 * `t` is outside the file or any epoch of the window has no position. The window slides inward at the file's ends instead of extrapolating.
 */
export function interpolate(s: Sp3, id: string, t: number, out: Float64Array): boolean {
  const sat = s.sats.get(id);
  if (!sat) return false;
  const u = (t - s.t0) / s.step;
  if (u < 0 || u > s.count - 1) return false;
  let first = Math.floor(u) - LAGRANGE_POINTS / 2 + 1;
  first = Math.max(0, Math.min(s.count - LAGRANGE_POINTS, first));
  const n = Math.min(LAGRANGE_POINTS, s.count);
  let px = 0;
  let py = 0;
  let pz = 0;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (let j = 0; j < n; j++) {
    const xj = first + j;
    const X = sat.pos[3 * xj] as number;
    if (Number.isNaN(X)) return false;
    // L_j(u) and its derivative.
    let l = 1;
    let dl = 0;
    for (let m = 0; m < n; m++) {
      if (m === j) continue;
      const den = xj - (first + m);
      const f = (u - (first + m)) / den;
      dl = dl * f + l / den;
      l *= f;
    }
    px += l * X;
    py += l * (sat.pos[3 * xj + 1] as number);
    pz += l * (sat.pos[3 * xj + 2] as number);
    vx += dl * X;
    vy += dl * (sat.pos[3 * xj + 1] as number);
    vz += dl * (sat.pos[3 * xj + 2] as number);
  }
  out[0] = px;
  out[1] = py;
  out[2] = pz;
  out[3] = vx / s.step;
  out[4] = vy / s.step;
  out[5] = vz / s.step;
  return true;
}

/** Clock [s] of `id` at `t`, linear between the two neighbouring epochs; NaN when either has no clock or `t` is outside the file. */
export function clockAt(s: Sp3, id: string, t: number): number {
  const sat = s.sats.get(id);
  if (!sat) return NaN;
  const u = (t - s.t0) / s.step;
  if (u < 0 || u > s.count - 1) return NaN;
  const i = Math.min(Math.floor(u), s.count - 2);
  const f = u - i;
  const a = sat.clk[i] as number;
  const b = sat.clk[i + 1] as number;
  return f === 0 ? a : a + (b - a) * f;
}
