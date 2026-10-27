/**
 * The Threads carousel: one template per slide, all 1080 x 1350 (4:5 portrait, Threads' own post format; docs/share-threads.md).
 * Every slide has the same chrome: a header (sport glyph, slide title, date, "n/total"), a body, and a footer with the JoyoFit
 * lockup and link. The footer is an `attribution` layer, so it stays when the Pro watermark switch is off: the Threads set is
 * always branded.
 *
 * A slide is offered only when the subject has what it `requires` (`threads/slides.ts`); the builder (`data/threads.ts`) writes
 * the `th.*` flags and rows these templates bind. Rows of a table are authored once per index and hide when the row is missing.
 *
 *   threads.summary      run      route, distance, time, pace or speed, elevation, heart rate, calories, device
 *   threads.lift         strength volume, sets, reps, time, PRs
 *   threads.splits(2,3)  run      per km (ride: per 5 km) table with time, pace or speed, heart rate, cadence, power, climb
 *   threads.charts       run      pace or speed, heart rate and elevation over the workout
 *   threads.sensors      run      cadence and power over the workout
 *   threads.zones        run      heart-rate zones, training effect and load
 *   threads.power        ride     power: NP, IF, TSS, VI, work, W/kg, power curve
 *   threads.powerZones   ride     time in the seven power zones, FTP
 *   threads.climbs       ride     the climbs
 *   threads.lifts(2,3)   strength exercises with sets x reps x weight and volume
 *   threads.muscle       strength muscle load and records
 *   threads.context(Lift) the last four weeks
 */
import { all, any, has, is, lacks, not, sportGlyph, tl } from './blocks';
import { kit, template, type Cond, type Expr, type Kit, type LayerJson } from './dsl';
import { INK } from './palette';

const X = 72;
const W = 936;
const BODY_Y = 196;
const BODY_H = 1000;
const GAP = 20;

type Palette = typeof INK;
const THREADS_PALETTE: Palette = INK;

/** The first `{path}` of a binding string: what a tile needs to exist. */
function pathOf(value: string): string | null {
  const match = /\{([^}|?]+)/.exec(value);
  return match ? match[1]!.trim() : null;
}

// ------------------------------------------------------------------------------------------------------------- chrome

interface SlideSpec {
  /** Slide id: `threads.<id>.portrait`, label `stickers:threads.slide.<id>`. */
  id: string;
  k: Kit;
  /** Which namespace the header subtitle reads. */
  subject: 'run' | 'lift';
  requires: string[];
  body: LayerJson[];
  justify?: 'start' | 'between';
  gap?: number;
  maxLayers?: number;
  tags?: string[];
}

/** The same header, body frame and footer on every slide. */
function slide(o: SlideSpec) {
  const { k } = o;
  const glyphSize = 88;
  const inner = 44;
  const off = (glyphSize - inner) / 2;
  const glyph = k.group({ w: glyphSize, h: glyphSize }, [
    k.shape({ x: 0, y: 0, w: glyphSize, h: glyphSize }, 'ellipse', { fill: '$surfaceStrong' }),
    ...(o.subject === 'run' ? sportGlyph(k, off, off, inner, '$fg') : [k.icon({ x: off, y: off, w: inner, h: inner }, 'strength', '$fg')]),
  ]);
  const sub = o.subject === 'run' ? '{run.sport} \u00b7 {run.startedAt|date:medium}' : '{strength.name} \u00b7 {strength.startedAt|date:medium}';
  const titles = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.text({ w: 'fill' }, tl(`threads.slide.${o.id}`), { size: 38, weight: 800, upper: true, ls: 3, color: '$accent', minSize: 28 }),
      k.group(
        { w: 'fill', h: 'auto' },
        [
          k.text({ w: 'auto' }, '{user.name} \u00b7', { size: 30, weight: 700, color: '$fg', when: has('user.name') }),
          k.text({ w: 'fill' }, sub, { size: 30, weight: 600, color: '$fgMuted', minSize: 24 }),
        ],
        { dir: 'row', gap: 12, align: 'center' },
      ),
    ],
    { dir: 'column', gap: 8 },
  );
  const pill = k.group({ w: 'auto', h: 'auto' }, [k.text({ w: 'auto' }, '{th.n}/{th.total}', { size: 34, weight: 800, color: '$fg' })], {
    dir: 'row',
    padding: 20,
    fill: '$surfaceStrong',
    radius: 40,
    align: 'center',
  });
  const header = k.group({ x: X, y: 56, w: W, h: glyphSize }, [glyph, titles, pill], { dir: 'row', gap: 24, align: 'center' });
  const body = k.group({ x: X, y: BODY_Y, w: W, h: BODY_H }, o.body, { dir: 'column', gap: o.gap ?? GAP, align: 'stretch', justify: o.justify ?? 'start' });
  const rule = k.shape({ x: X, y: 1222, w: W, h: 2 }, 'rect', { fill: '$line' });
  const footer = k.group(
    { x: X, y: 1244, w: W, h: 56 },
    [
      k.brand({ w: 'auto', h: 56 }, 'lockup', { size: 52 }, { role: 'attribution', opacity: 0.92 }),
      k.shape({ w: 'fill', h: 1 }, 'rect'),
      k.brand({ w: 'auto', h: 'auto' }, 'link', { size: 30 }, { role: 'attribution' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
  return template({
    id: `threads.${o.id}.portrait`,
    name: `Threads carousel, ${o.id}`,
    titleKey: `stickers:threads.slide.${o.id}`,
    kind: 'threads',
    style: 'minimal',
    aspect: 'portrait',
    background: { kind: 'gradient', angle: 165, stops: [{ at: 0, color: '$bg' }, { at: 1, color: '$bg2' }] },
    dark: THREADS_PALETTE.dark,
    light: THREADS_PALETTE.light,
    requires: o.requires,
    constraints: { maxLayers: o.maxLayers ?? 120 },
    layers: [header, body, rule, footer],
    meta: { tags: ['threads', ...(o.tags ?? [])] },
  });
}

// ------------------------------------------------------------------------------------------------------------ blocks

interface TileSpec {
  value: string;
  label: Expr;
  unit?: Expr;
  size?: number;
  when?: Cond;
}

/** A stat on a panel; hidden with the value. */
function tile(k: Kit, o: TileSpec): LayerJson {
  const path = pathOf(o.value);
  return k.group(
    { w: 'fill', h: 'auto' },
    [
      k.stat({ w: 'fill' }, o.value, {
        unit: o.unit,
        label: o.label,
        size: o.size ?? 58,
        unitSize: 26,
        labelSize: 24,
        labelPos: 'above',
        gap: 10,
        weight: 800,
        color: '$fg',
        labelColor: '$fgMuted',
        minSize: 32,
      }),
    ],
    { dir: 'column', padding: 24, fill: '$surface', radius: 28, when: o.when ?? (path ? has(path) : undefined) },
  );
}

/** Tiles side by side; the row disappears when none of them has data. */
function tileRow(k: Kit, tiles: TileSpec[]): LayerJson {
  const paths = tiles.map((t) => (t.when ? null : pathOf(t.value))).filter((p): p is string => p !== null);
  const whens = tiles.flatMap((t) => (t.when ? [t.when] : []));
  const conds = [...paths.map(has), ...whens];
  return k.group({ w: 'fill', h: 'auto' }, tiles.map((t) => tile(k, t)), { dir: 'row', gap: GAP, align: 'stretch', when: conds.length > 1 ? any(...conds) : conds[0] });
}

/** A small section label above a block. */
function section(k: Kit, key: string, when?: Cond, args?: Record<string, string>): LayerJson {
  return k.text({ w: 'fill' }, tl(key, args), { size: 26, weight: 700, upper: true, ls: 3, color: '$fgMuted', when });
}

const deviceLine = (k: Kit) => k.text({ w: 'fill' }, tl('threads.text.device', { device: '{th.device}' }), { size: 30, weight: 600, color: '$fgMuted', minSize: 24, when: has('th.device') });

// ------------------------------------------------------------------------------------------------------------ summary

function summary() {
  const k = kit('ts');
  const route = k.group({ w: 'fill', h: 310 }, [k.route({ x: 24, y: 20, w: 888, h: 270 }, { color: '$fg', color2: '$accent', strokeWidth: 14, halo: true, markers: true, padding: 12 })], {
    fill: '$surface',
    radius: 36,
    when: has('run.route'),
  });
  const hero = (size: number, when: Cond) =>
    k.group(
      { w: 'fill', h: 'auto' },
      [
        k.stat({ w: 'fill' }, '{run.distanceM|km}', { unit: tl('unit.km'), label: tl('label.distance'), size, unitSize: Math.round(size * 0.24), labelSize: 28, labelPos: 'above', gap: 12, weight: 800, color: '$accent', minSize: 100, when: all(has('run.distanceM'), not(is('run.category', 'swim'))) }),
        k.stat({ w: 'fill' }, '{run.distanceM|int}', { unit: tl('unit.m'), label: tl('label.distance'), size, unitSize: Math.round(size * 0.24), labelSize: 28, labelPos: 'above', gap: 12, weight: 800, color: '$accent', minSize: 100, when: all(has('run.distanceM'), is('run.category', 'swim')) }),
        k.stat({ w: 'fill' }, '{run.movingSec|dur}', { label: tl('label.time'), size, labelSize: 28, labelPos: 'above', gap: 12, weight: 800, color: '$accent', minSize: 100, when: lacks('run.distanceM') }),
      ],
      { dir: 'column', when },
    );
  const rows = [
    tileRow(k, [
      { value: '{run.movingSec|dur}', label: tl('label.time'), when: has('run.distanceM') },
      { value: '{run.paceSecKm|pace}', label: tl('label.pace'), unit: tl('unit.perKm') },
      { value: '{run.speedKmh|num:1}', label: tl('label.speed'), unit: tl('unit.kmh') },
      { value: '{run.elevGainM|int}', label: tl('label.elevation'), unit: tl('unit.m') },
    ]),
    tileRow(k, [
      { value: '{run.hrAvg|int}', label: tl('label.avgHr'), unit: tl('unit.bpm') },
      { value: '{run.hrMax|int}', label: tl('label.maxHr'), unit: tl('unit.bpm') },
      { value: '{run.kcal|int}', label: tl('label.kcal'), unit: tl('unit.kcal') },
    ]),
    tileRow(k, [
      { value: '{run.cadence|int}', label: tl('label.cadence'), unit: tl('unit.spm') },
      { value: '{run.power|int}', label: tl('threads.label.power'), unit: tl('threads.unit.w') },
      { value: '{run.steps|int}', label: tl('label.steps') },
    ]),
  ];
  return slide({
    id: 'summary',
    k,
    subject: 'run',
    requires: ['run.kind'],
    body: [route, hero(170, has('run.route')), hero(260, lacks('run.route')), ...rows, deviceLine(k)],
    gap: 24,
    tags: ['summary'],
  });
}

// --------------------------------------------------------------------------------------------------------------- lift

function lift() {
  const k = kit('tl');
  const hero = k.stat({ w: 'fill' }, '{strength.volume|int}', { unit: '{strength.unit}', label: tl('label.volume'), size: 230, unitSize: 64, labelSize: 28, labelPos: 'above', gap: 12, weight: 800, color: '$accent', minSize: 100, when: has('strength.volume') });
  const heroReps = k.stat({ w: 'fill' }, '{strength.reps|int}', { label: tl('label.reps'), size: 230, labelSize: 28, labelPos: 'above', gap: 12, weight: 800, color: '$accent', minSize: 100, when: all(lacks('strength.volume'), has('strength.reps')) });
  const heroSecs = k.stat({ w: 'fill' }, '{strength.seconds|dur}', { label: tl('label.hold'), size: 230, labelSize: 28, labelPos: 'above', gap: 12, weight: 800, color: '$accent', minSize: 100, when: all(lacks('strength.volume'), lacks('strength.reps'), has('strength.seconds')) });
  const pr = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.group({ w: 'auto', h: 'auto' }, [k.text({ w: 'auto' }, tl('tpl.strength.text.newPr', { count: '{strength.prCount}' }), { size: 34, weight: 800, color: '$bg', minSize: 26 })], {
        dir: 'row',
        padding: 20,
        fill: '$accent',
        radius: 40,
      }),
    ],
    { dir: 'row', when: has('strength.prCount') },
  );
  const rows = [
    tileRow(k, [
      { value: '{strength.durationSec|dur}', label: tl('label.duration') },
      { value: '{strength.sets|int}', label: tl('label.sets') },
      { value: '{strength.reps|int}', label: tl('label.reps'), when: has('strength.volume') },
    ]),
    tileRow(k, [
      { value: '{strength.exercises|int}', label: tl('threads.label.exercises') },
      { value: '{strength.avgRpe|num:1}', label: tl('tpl.strength.text.rpe') },
      { value: '{strength.kcal|int}', label: tl('label.kcal'), unit: tl('unit.kcal') },
    ]),
  ];
  return slide({ id: 'lift', k, subject: 'lift', requires: ['strength.name'], body: [hero, heroReps, heroSecs, pr, ...rows, deviceLine(k)], gap: 28, tags: ['summary'] });
}

// ------------------------------------------------------------------------------------------------------------- splits

const ROWS = 12;
const ROW_H = 56;
const ROW_PAD = 14;

/** One table column: a header label, the cell text per row, its width. */
interface Col {
  key: string;
  header: Expr;
  /** Bind of the column flag (`th.splitCols.hr`); none = always shown. */
  flag?: string;
  width: number | 'fill';
  value: (row: string) => string;
  align?: 'left' | 'right';
  /** The cell shows a dash when a row lacks it. */
  keep?: boolean;
  /** Only in this split mode. */
  mode?: 'pace' | 'speed';
}

const SPLIT_COLS: Col[] = [
  { key: 'n', header: tl('threads.col.km'), width: 128, value: (r) => `{${r}.n}`, align: 'left' },
  { key: 'tot', header: tl('threads.col.time'), width: 'fill', value: (r) => `{${r}.tot|dur}`, align: 'right' },
  { key: 'pace', header: tl('threads.col.pace'), width: 'fill', value: (r) => `{${r}.main|pace}`, align: 'right', mode: 'pace' },
  { key: 'speed', header: tl('threads.col.speed'), width: 'fill', value: (r) => `{${r}.main|num:1}`, align: 'right', mode: 'speed' },
  { key: 'hr', header: tl('threads.col.hr'), flag: 'th.splitCols.hr', width: 'fill', value: (r) => `{${r}.hr|int}`, align: 'right', keep: true },
  { key: 'cad', header: tl('threads.col.cad'), flag: 'th.splitCols.cad', width: 'fill', value: (r) => `{${r}.cad|int}`, align: 'right', keep: true },
  { key: 'pwr', header: tl('threads.col.power'), flag: 'th.splitCols.pwr', width: 'fill', value: (r) => `{${r}.pwr|int}`, align: 'right', keep: true },
  { key: 'gain', header: tl('threads.col.gain'), flag: 'th.splitCols.gain', width: 'fill', value: (r) => `{${r}.gain|int}`, align: 'right', keep: true },
];

function colCond(col: Col, extra?: Cond): Cond | undefined {
  const conds: Cond[] = [];
  if (col.flag) conds.push(has(col.flag));
  if (col.mode) conds.push(is('th.splitMode', col.mode));
  if (extra) conds.push(extra);
  return conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : all(...conds);
}

function splitsPage(id: 'splits' | 'splits2' | 'splits3', path: string) {
  const k = kit(`ts${id.slice(6) || '1'}`);
  const inner = ROW_H - 8;
  const header = k.group(
    { w: 'fill', h: 'auto' },
    SPLIT_COLS.map((col) => k.text({ w: col.width, h: 40 }, col.header, { size: 24, weight: 700, upper: true, ls: 2, color: '$fgMuted', align: col.align, valign: 'middle', when: colCond(col), minSize: 22 })),
    { dir: 'row', gap: 8, align: 'center', padding: ROW_PAD },
  );
  const rows = Array.from({ length: ROWS }, (_, i) => {
    const row = `${path}.${i}`;
    const cells = SPLIT_COLS.flatMap((col) => {
      const base = { size: 32, color: '$fg', align: col.align, valign: 'middle' as const, minSize: 22, onMissing: col.keep ? ('keep' as const) : undefined, fallback: col.keep ? '-' : undefined };
      if (col.key === 'pace' || col.key === 'speed') {
        // The best row of the table is amber and bold.
        return [
          k.text({ w: col.width, h: inner }, col.value(row), { ...base, weight: 800, color: '$accent', when: colCond(col, has(`${row}.best`)) }),
          k.text({ w: col.width, h: inner }, col.value(row), { ...base, weight: 600, when: colCond(col, lacks(`${row}.best`)) }),
        ];
      }
      return [k.text({ w: col.width, h: inner }, col.value(row), { ...base, weight: col.key === 'n' ? 800 : 600, color: col.key === 'n' ? '$fgSoft' : '$fg', when: colCond(col) })];
    });
    return k.group({ w: 'fill', h: ROW_H }, cells, { dir: 'row', gap: 8, align: 'center', padding: ROW_PAD - 4, fill: i % 2 === 0 ? '$surface' : undefined, radius: 18, when: has(`${row}.n`) });
  });
  const table = k.group({ w: 'fill', h: 'auto' }, [header, ...rows], { dir: 'column', gap: 4, align: 'stretch' });
  const step = k.text({ w: 'fill' }, tl('threads.text.splitStep', { km: '{th.splitStep}' }), { size: 28, weight: 600, color: '$fgMuted', when: { bind: 'th.splitStep', gt: 1 } });
  const recap = tileRow(k, [
    { value: '{run.distanceM|km}', label: tl('label.distance'), unit: tl('unit.km'), when: all(has('run.distanceM'), not(is('run.category', 'swim'))) },
    { value: '{run.distanceM|int}', label: tl('label.distance'), unit: tl('unit.m'), when: all(has('run.distanceM'), is('run.category', 'swim')) },
    { value: '{run.movingSec|dur}', label: tl('label.time') },
    { value: '{run.paceSecKm|pace}', label: tl('label.pace'), unit: tl('unit.perKm') },
    { value: '{run.speedKmh|num:1}', label: tl('label.speed'), unit: tl('unit.kmh') },
    { value: '{run.hrAvg|int}', label: tl('label.hr'), unit: tl('unit.bpm') },
  ]);
  const top = k.group({ w: 'fill', h: 'auto' }, [step, table], { dir: 'column', gap: 12, align: 'stretch' });
  return slide({ id, k, subject: 'run', requires: [`${path}.0.n`], body: [top, recap], justify: 'between', maxLayers: 400, tags: ['splits', 'table'] });
}

// ------------------------------------------------------------------------------------------------------------- charts

interface PanelSpec {
  /** The layer that draws the series. */
  chart: (k: Kit) => LayerJson;
  title: Expr;
  stats: Expr;
  when: Cond;
}

/** A chart on a panel: title, its stats on the right of the title, the chart, and the x axis. */
function chartPanel(k: Kit, p: PanelSpec): LayerJson {
  return k.group(
    { w: 'fill', h: 'fill' },
    [
      k.group(
        { w: 'fill', h: 'auto' },
        [
          k.text({ w: 'auto' }, p.title, { size: 26, weight: 700, upper: true, ls: 3, color: '$fgMuted' }),
          k.text({ w: 'fill' }, p.stats, { size: 28, weight: 700, color: '$fg', align: 'right', minSize: 22 }),
        ],
        { dir: 'row', gap: 16, align: 'center' },
      ),
      p.chart(k),
      k.group(
        { w: 'fill', h: 'auto' },
        [
          k.text({ w: 'auto' }, tl('threads.text.axisStart'), { size: 24, weight: 600, color: '$fgMuted' }),
          k.shape({ w: 'fill', h: 1 }, 'rect'),
          k.text({ w: 'auto' }, '{run.distanceM|km:1} km', { size: 24, weight: 600, color: '$fgMuted', when: all(has('run.distanceM'), not(is('run.category', 'swim'))) }),
          k.text({ w: 'auto' }, '{run.distanceM|int} m', { size: 24, weight: 600, color: '$fgMuted', when: all(has('run.distanceM'), is('run.category', 'swim')) }),
          k.text({ w: 'auto' }, '{run.movingSec|dur}', { size: 24, weight: 600, color: '$fgMuted', when: lacks('run.distanceM') }),
        ],
        { dir: 'row', gap: 8, align: 'center' },
      ),
    ],
    { dir: 'column', gap: 12, padding: 26, fill: '$surface', radius: 32, align: 'stretch', when: p.when },
  );
}

/** An area chart; `range` pins the axis where autoscaling would blow a few units of wobble up to the full height. */
const area =
  (bind: string, color: string, range: { min?: number; max?: number } = {}) =>
  (k: Kit) =>
    k.chart({ w: 'fill', h: 'fill' }, { kind: 'area', series: { bind }, color, strokeWidth: 6, barRadius: 18, ...range });

function charts() {
  const k = kit('tc');
  const panels: PanelSpec[] = [
    {
      title: tl('label.pace'),
      stats: tl('threads.text.paceStats', { avg: '{run.paceSecKm|pace}', best: '{th.charts.paceBest|pace}' }),
      chart: area('th.charts.speed', '$accent'),
      when: all(has('th.charts.speed'), has('run.paceSecKm')),
    },
    {
      title: tl('label.speed'),
      stats: tl('threads.text.speedStats', { avg: '{run.speedKmh|num:1}', max: '{th.charts.speedTop|num:1}' }),
      chart: area('th.charts.speed', '$accent'),
      when: all(has('th.charts.speed'), lacks('run.paceSecKm')),
    },
    {
      title: tl('label.hr'),
      stats: tl('threads.text.hrStats', { min: '{th.charts.hrMin|int}', avg: '{th.charts.hrAvg|int}', max: '{th.charts.hrMax|int}' }),
      chart: area('th.charts.hr', '$bad'),
      when: has('th.charts.hr'),
    },
    {
      title: tl('label.elevation'),
      stats: tl('threads.text.elevStats', { gain: '{th.elev.gainM|int}', loss: '{th.elev.lossM|int}', min: '{th.charts.altMin|int}', max: '{th.charts.altMax|int}' }),
      chart: area('th.charts.alt', '$accent2'),
      when: has('th.charts.alt'),
    },
  ];
  return slide({ id: 'charts', k, subject: 'run', requires: ['th.has.charts'], body: panels.map((p) => chartPanel(k, p)), tags: ['chart'] });
}

function sensors() {
  const k = kit('tn');
  const panels: PanelSpec[] = [
    {
      title: tl('label.cadence'),
      stats: tl('threads.text.cadStats', { avg: '{th.sensors.cadAvg|int}', max: '{th.sensors.cadMax|int}' }),
      chart: area('th.sensors.cad', '$good', { min: 60, max: 220 }),
      when: all(has('th.sensors.cad'), not(is('run.kind', 'ride'))),
    },
    {
      title: tl('label.cadence'),
      stats: tl('threads.text.cadStatsRide', { avg: '{th.sensors.cadAvg|int}', max: '{th.sensors.cadMax|int}' }),
      chart: area('th.sensors.cad', '$good', { min: 0, max: 140 }),
      when: all(has('th.sensors.cad'), is('run.kind', 'ride')),
    },
    {
      title: tl('threads.label.power'),
      stats: tl('threads.text.powerStats', { avg: '{th.sensors.powerAvg|int}', max: '{th.sensors.powerMax|int}' }),
      chart: area('th.sensors.power', '$warn', { min: 0 }),
      when: has('th.sensors.power'),
    },
  ];
  return slide({ id: 'sensors', k, subject: 'run', requires: ['th.has.sensors'], body: panels.map((p) => chartPanel(k, p)), tags: ['chart'] });
}

// -------------------------------------------------------------------------------------------------------------- zones

interface ZoneBars {
  count: number;
  series: string;
  labels: string;
  colors: string;
  secs: string;
  h: number;
  labelSize: number;
}

/** Horizontal zone bars with the share of time and the time itself on the right. */
function zoneBars(k: Kit, z: ZoneBars): LayerJson {
  const gap = Math.min(14, z.h / z.count / 3);
  const bar = (z.h - gap * (z.count - 1)) / z.count;
  const pctW = 120;
  const timeW = 130;
  const chartW = W - 2 * 24 - pctW - timeW - 24;
  const texts = Array.from({ length: z.count }, (_, i) => [
    k.text({ x: chartW + 24, y: 24 + i * (bar + gap), w: pctW, h: bar }, `{${z.series}.${i}|pct}`, { size: 34, weight: 800, color: '$fg', align: 'right', valign: 'middle' }),
    k.text({ x: chartW + 24 + pctW + 8, y: 24 + i * (bar + gap), w: timeW, h: bar }, `{${z.secs}.${i}|dur}`, { size: 28, weight: 600, color: '$fgMuted', align: 'right', valign: 'middle', minSize: 22 }),
  ]).flat();
  return k.group(
    { w: 'fill', h: z.h + 48 },
    [k.chart({ x: 24, y: 24, w: chartW, h: z.h }, { kind: 'bars', series: { bind: z.series }, labels: { bind: z.labels }, colors: { bind: z.colors }, horizontal: true, showLabels: true, labelSize: z.labelSize, color: '$accent', barRadius: 16 }), ...texts],
    { fill: '$surface', radius: 32 },
  );
}

function zones() {
  const k = kit('tz');
  const hrTiles = tileRow(k, [
    { value: '{run.hrAvg|int}', label: tl('label.avgHr'), unit: tl('unit.bpm') },
    { value: '{run.hrMax|int}', label: tl('label.maxHr'), unit: tl('unit.bpm') },
    { value: '{th.load.strain|num:1}', label: tl('label.strain'), unit: tl('threads.unit.of21') },
  ]);
  const bars = zoneBars(k, { count: 5, series: 'run.hrZonePct', labels: 'run.hrZoneLabels', colors: 'run.hrZoneColors', secs: 'run.hrZoneSec', h: 360, labelSize: 30 });
  const loadRows = [
    tileRow(k, [
      { value: '{th.load.aerobic|num:1}', label: tl('threads.label.aerobic') },
      { value: '{th.load.anaerobic|num:1}', label: tl('threads.label.anaerobic') },
      { value: '{th.load.recoveryH|int}', label: tl('threads.label.recovery'), unit: tl('threads.unit.hours') },
    ]),
    tileRow(k, [
      { value: '{th.load.ratio|num:2}', label: tl('threads.label.ratio') },
      { value: '{th.load.trimp|int}', label: tl('threads.label.trimp') },
      { value: '{th.load.vo2max|int}', label: tl('threads.label.vo2max') },
    ]),
  ];
  const status = k.text({ w: 'fill' }, tl('threads.text.loadStatus', { status: '{th.load.status|lower}', acute: '{th.load.acute|int}', chronic: '{th.load.chronic|int}' }), { size: 28, weight: 600, color: '$fgMuted', minSize: 22, when: has('th.load.status') });
  return slide({
    id: 'zones',
    k,
    subject: 'run',
    requires: ['th.has.zones'],
    body: [hrTiles, section(k, 'threads.text.zones', has('run.hrZonePct')), k.group({ w: 'fill', h: 'auto' }, [bars], { dir: 'column', when: has('run.hrZonePct') }), section(k, 'threads.text.load', has('th.load')), ...loadRows, status],
    justify: 'between',
    tags: ['zones'],
  });
}

// -------------------------------------------------------------------------------------------------------------- power

function power() {
  const k = kit('tw');
  const hero = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.stat({ w: 'fill' }, '{th.power.avg|int}', { unit: tl('threads.unit.w'), label: tl('threads.label.avgPower'), size: 170, unitSize: 52, labelSize: 28, labelPos: 'above', gap: 10, weight: 800, color: '$accent', minSize: 90 }),
      k.stat({ w: 'fill' }, '{th.power.np|int}', { unit: tl('threads.unit.w'), label: tl('threads.label.np'), size: 170, unitSize: 52, labelSize: 28, labelPos: 'above', gap: 10, weight: 800, color: '$fg', minSize: 90, when: has('th.power.np') }),
    ],
    { dir: 'row', gap: 24, align: 'start' },
  );
  const rows = [
    tileRow(k, [
      { value: '{th.power.if|num:2}', label: tl('threads.label.if') },
      { value: '{th.power.tss|int}', label: tl('threads.label.tss') },
      { value: '{th.power.vi|num:2}', label: tl('threads.label.vi') },
    ]),
    tileRow(k, [
      { value: '{th.power.workKj|int}', label: tl('threads.label.work'), unit: tl('threads.unit.kj') },
      { value: '{th.power.wkg|num:2}', label: tl('threads.label.wkg') },
      { value: '{th.power.max|int}', label: tl('threads.label.maxPower'), unit: tl('threads.unit.w') },
    ]),
  ];
  // The curve: one chart per number of efforts so the bars keep their thickness.
  const curve = Array.from({ length: 4 }, (_, i) => {
    const n = i + 2;
    const h = n * 64 + (n - 1) * 12;
    return k.chart({ w: 'fill', h }, { kind: 'bars', series: { bind: 'th.power.curveW' }, labels: { bind: 'th.power.curveLabels' }, horizontal: true, showLabels: true, labelSize: 28, color: '$accent', barRadius: 16 }, { when: n < 5 ? all(has(`th.power.curveW.${n - 1}`), lacks(`th.power.curveW.${n}`)) : has('th.power.curveW.4') });
  });
  const curvePanel = k.group({ w: 'fill', h: 'auto' }, curve, { dir: 'column', padding: 24, fill: '$surface', radius: 32, when: has('th.power.curveW.1') });
  return slide({ id: 'power', k, subject: 'run', requires: ['th.has.power'], body: [hero, ...rows, section(k, 'threads.text.curve', has('th.power.curveW.1')), curvePanel], justify: 'between', tags: ['power'] });
}

function powerZones() {
  const k = kit('tp');
  const tiles = tileRow(k, [
    { value: '{th.power.ftp|int}', label: tl('threads.label.ftp'), unit: tl('threads.unit.w') },
    { value: '{th.power.nwkg|num:2}', label: tl('threads.label.nwkg') },
    { value: '{th.power.balanceLeft|int}', label: tl('threads.label.balance'), unit: tl('threads.unit.pct') },
  ]);
  const bars = zoneBars(k, { count: 7, series: 'th.power.zonePct', labels: 'th.power.zoneLabels', colors: 'th.power.zoneColors', secs: 'th.power.zoneSec', h: 640, labelSize: 30 });
  const note = k.text({ w: 'fill' }, tl('threads.text.ftpNote', { ftp: '{th.power.ftp|int}' }), { size: 28, weight: 600, color: '$fgMuted', fit: 'wrap', maxLines: 2, when: has('th.power.ftp') });
  return slide({ id: 'powerzones', k, subject: 'run', requires: ['th.power.zonePct'], body: [tiles, section(k, 'threads.text.powerZones'), bars, note], justify: 'between', tags: ['power', 'zones'] });
}

// ------------------------------------------------------------------------------------------------------------- climbs

function climbs() {
  const k = kit('tb');
  const cards = Array.from({ length: 5 }, (_, i) => {
    const c = `th.climbs.${i}`;
    const stat = (value: string, label: Expr, unit?: Expr, when?: Cond) => k.stat({ w: 'fill' }, value, { unit, label, size: 44, unitSize: 24, labelSize: 22, labelPos: 'below', gap: 6, weight: 800, color: '$fg', labelColor: '$fgMuted', minSize: 26, when });
    const category = k.group({ w: 'auto', h: 'auto' }, [k.text({ w: 'auto' }, tl('threads.text.category', { value: `{${c}.category|upper}` }), { size: 26, weight: 800, color: '$bg', minSize: 22 })], {
      dir: 'row',
      padding: 12,
      fill: '$accent',
      radius: 20,
      when: all(has(`${c}.category`), not(is(`${c}.category`, 'none'))),
    });
    return k.group(
      { w: 'fill', h: 'auto' },
      [
        k.group(
          { w: 'fill', h: 'auto' },
          [k.text({ w: 'fill' }, tl('threads.text.climbN', { n: `{${c}.n}` }), { size: 34, weight: 800, color: '$accent' }), category],
          { dir: 'row', gap: 16, align: 'center' },
        ),
        k.group(
          { w: 'fill', h: 'auto' },
          [
            stat(`{${c}.lengthM|km}`, tl('threads.label.length'), tl('unit.km')),
            stat(`{${c}.gainM|int}`, tl('threads.label.gain'), tl('unit.m')),
            stat(`{${c}.avgGrade|num:1}`, tl('threads.label.avgGrade'), tl('threads.unit.pct')),
            stat(`{${c}.sec|dur}`, tl('label.time')),
            stat(`{${c}.vam|int}`, tl('threads.label.vam'), undefined, has(`${c}.vam`)),
          ],
          { dir: 'row', gap: 12, align: 'start' },
        ),
        k.group(
          { w: 'fill', h: 'auto' },
          [
            k.text({ w: 'auto' }, tl('threads.text.climbMax', { value: `{${c}.maxGrade|num:1}` }), { size: 28, weight: 600, color: '$fgMuted', when: has(`${c}.maxGrade`) }),
            k.text({ w: 'auto' }, tl('threads.text.climbPower', { value: `{${c}.power|int}` }), { size: 28, weight: 600, color: '$fgMuted', when: has(`${c}.power`) }),
            k.text({ w: 'auto' }, tl('threads.text.climbHr', { value: `{${c}.hr|int}` }), { size: 28, weight: 600, color: '$fgMuted', when: has(`${c}.hr`) }),
          ],
          { dir: 'row', gap: 28 },
        ),
      ],
      { dir: 'column', gap: 14, padding: 26, fill: '$surface', radius: 32, align: 'stretch', when: has(`${c}.n`) },
    );
  });
  // What is left of the page shows the whole climb profile.
  const profile = k.group(
    { w: 'fill', h: 'fill' },
    [section(k, 'label.elevation'), k.chart({ w: 'fill', h: 'fill' }, { kind: 'area', series: { bind: 'th.charts.alt' }, color: '$accent2', strokeWidth: 6, barRadius: 18 })],
    { dir: 'column', gap: 12, padding: 26, fill: '$surface', radius: 32, align: 'stretch', when: has('th.charts.alt') },
  );
  return slide({ id: 'climbs', k, subject: 'run', requires: ['th.has.climbs'], body: [...cards, profile], gap: 16, tags: ['climbs'] });
}

// -------------------------------------------------------------------------------------------------------------- lifts

const LIFT_ROWS = 6;

function liftsPage(id: 'lifts' | 'lifts2' | 'lifts3', path: string, more: boolean) {
  const k = kit(`tf${id.slice(5) || '1'}`);
  const rows = Array.from({ length: LIFT_ROWS }, (_, i) => {
    const r = `${path}.${i}`;
    const pill = k.group({ w: 'auto', h: 'auto' }, [k.text({ w: 'auto' }, tl('tpl.strength.text.pr'), { size: 24, weight: 800, color: '$bg', minSize: 22 })], { dir: 'row', padding: 10, fill: '$accent', radius: 18, when: has(`${r}.pr`) });
    return k.group(
      { w: 'fill', h: 'auto' },
      [
        k.group(
          { w: 'fill', h: 'auto' },
          [
            k.text({ w: 'fill' }, `{${r}.name}`, { size: 38, weight: 800, color: '$fg', minSize: 26 }),
            pill,
            k.stat({ w: 'auto' }, `{${r}.volume|int}`, { unit: `{${r}.unit}`, size: 34, unitSize: 24, weight: 800, color: '$accent', labelPos: 'none', trim: false, when: has(`${r}.volume`) }),
          ],
          { dir: 'row', gap: 14, align: 'center' },
        ),
        k.text({ w: 'fill' }, `{${r}.sets}`, { size: 30, weight: 600, color: '$fgSoft', fit: 'wrap', maxLines: 2, lh: 1.25 }),
      ],
      { dir: 'column', gap: 8, padding: 24, fill: '$surface', radius: 28, align: 'stretch', when: has(`${r}.name`) },
    );
  });
  const moreLine = more ? [k.text({ w: 'fill' }, tl('threads.text.liftMore', { count: '{th.liftMore}' }), { size: 28, weight: 600, color: '$fgMuted', when: has('th.liftMore') })] : [];
  return slide({ id, k, subject: 'lift', requires: [`${path}.0.name`], body: [...rows, ...moreLine], gap: 14, maxLayers: 200, tags: ['lifts', 'table'] });
}

// ------------------------------------------------------------------------------------------------------------- muscle

function muscle() {
  const k = kit('tm');
  const bh = 62;
  const gap = 14;
  const pad = 24;
  const labelW = 250;
  const sets = (i: number) => `strength.muscleSets.${i}`;
  const charts = Array.from({ length: 8 }, (_, i) => {
    const n = i + 1;
    return k.chart(
      { w: 'fill', h: n * bh + (n - 1) * gap },
      { kind: 'bars', series: { bind: 'strength.muscleSets' }, colors: { bind: 'strength.muscleColors' }, horizontal: true, showLabels: false, barRadius: 14, color: '$accent' },
      { when: n < 8 ? all(has(sets(n - 1)), lacks(sets(n))) : has(sets(7)) },
    );
  });
  // The heat colors are made for a dark field, so the bars sit on a deep panel in both modes; names are page-colored text beside it.
  const panel = k.group({ w: 'fill', h: 'auto' }, charts, { dir: 'column', padding: pad, fill: '#12303a', radius: 32 });
  const labels = k.group(
    { w: labelW, h: 'auto' },
    [
      k.shape({ w: 1, h: pad - gap }, 'rect'),
      ...Array.from({ length: 8 }, (_, i) =>
        k.group(
          { w: labelW, h: bh },
          [k.text({ w: 'fill', h: bh }, `{strength.muscleLabels.${i}}`, { size: 32, weight: 700, color: '$fg', valign: 'middle', minSize: 24 }), k.text({ w: 'auto', h: bh }, `{${sets(i)}|num:1}`, { size: 28, weight: 700, color: '$accent', valign: 'middle' })],
          { dir: 'row', gap: 12, align: 'center' },
        ),
      ),
    ],
    { dir: 'column', gap },
  );
  const board = k.group({ w: 'fill', h: 'auto' }, [section(k, 'tpl.strength.text.muscleLoad'), k.group({ w: 'fill', h: 'auto' }, [labels, panel], { dir: 'row', gap: 16, align: 'start' })], { dir: 'column', gap: 20, align: 'stretch', when: has(sets(0)) });
  const prRows = Array.from({ length: 3 }, (_, i) => {
    const r = `strength.prs.${i}`;
    return k.group(
      { w: 'fill', h: 'auto' },
      [
        k.group({ w: 'auto', h: 'auto' }, [k.text({ w: 'auto' }, tl('tpl.strength.text.pr'), { size: 24, weight: 800, color: '$bg', minSize: 22 })], { dir: 'row', padding: 10, fill: '$accent', radius: 18 }),
        k.text({ w: 'fill' }, `{${r}.exercise}`, { size: 34, weight: 800, color: '$fg', minSize: 24 }),
        k.text({ w: 'auto' }, `{${r}.load}`, { size: 32, weight: 700, color: '$accent', minSize: 24 }),
      ],
      { dir: 'row', gap: 16, align: 'center', padding: 22, fill: '$surface', radius: 28, when: has(`${r}.exercise`) },
    );
  });
  const prs = k.group({ w: 'fill', h: 'auto' }, [section(k, 'threads.text.records'), ...prRows], { dir: 'column', gap: 14, align: 'stretch', when: has('strength.prs.0.exercise') });
  return slide({ id: 'muscle', k, subject: 'lift', requires: ['th.has.muscle'], body: [board, prs], gap: 40, tags: ['muscles'] });
}

// ------------------------------------------------------------------------------------------------------------- context

/** Four equal columns of the bar chart: the bars and the value of each week under its date (the chart draws four bars side by side). */
function weekBars(k: Kit, o: { series: string; unit?: Expr; fmt: string; color: string; h: number; title: string; titleArgs?: Record<string, string>; when?: Cond }): LayerJson {
  const inner = W - 2 * 26;
  const gap = Math.max(4, Math.min(24, (inner / 4) * 0.28));
  const col = (inner - gap * 3) / 4;
  const values = [0, 1, 2, 3].map((i) =>
    k.text({ w: col, h: 'auto' }, `{${o.series}.${i}|${o.fmt}}`, { size: 32, weight: 800, color: i === 3 ? '$fg' : '$fgSoft', align: 'center', minSize: 22 }),
  );
  return k.group(
    { w: 'fill', h: 'auto' },
    [
      section(k, o.title, undefined, o.titleArgs),
      k.chart({ w: 'fill', h: o.h }, { kind: 'bars', series: { bind: o.series }, labels: { bind: 'th.ctx.weekLabels' }, showLabels: true, labelSize: 26, color: o.color, color2: `${o.color}/45`, highlight: 'last', barRadius: 16 }),
      k.group({ w: 'fill', h: 'auto' }, values, { dir: 'row', gap }),
    ],
    { dir: 'column', gap: 12, padding: 26, fill: '$surface', radius: 32, align: 'stretch', when: o.when },
  );
}

function contextSlide(lifting: boolean) {
  const k = kit(lifting ? 'tq' : 'tx');
  const subject = lifting ? 'lift' : 'run';
  const main = lifting
    ? [weekBars(k, { series: 'th.ctx.weekVolume', fmt: 'int', color: '$accent', h: 200, title: 'threads.text.weeklyVolume', titleArgs: { unit: '{th.ctx.unit}' } })]
    : [
        weekBars(k, { series: 'th.ctx.weekKm', fmt: 'num:1', color: '$accent', h: 200, title: 'threads.text.weeklyKm', when: has('th.ctx.weekKm') }),
        weekBars(k, { series: 'th.ctx.weekMin', fmt: 'int', color: '$accent', h: 200, title: 'threads.text.weeklyMin', when: lacks('th.ctx.weekKm') }),
      ];
  const totals = lifting
    ? [
        tileRow(k, [
          { value: '{th.ctx.volume|int}', label: tl('threads.label.volume4'), unit: '{th.ctx.unit}' },
          { value: '{th.ctx.sessions|int}', label: tl('threads.label.sessions') },
          { value: '{th.ctx.sets|int}', label: tl('label.sets') },
        ]),
        tileRow(k, [
          { value: '{th.ctx.avgVolumeWeek|int}', label: tl('threads.label.avgVolumeWeek'), unit: '{th.ctx.unit}' },
          { value: '{th.ctx.avgSessionsWeek|num:1}', label: tl('threads.label.avgSessionsWeek') },
          { value: '{th.ctx.movingSec|durhm}', label: tl('label.duration') },
        ]),
      ]
    : [
        tileRow(k, [
          { value: '{th.ctx.distanceM|km:1}', label: tl('threads.label.distance4'), unit: tl('unit.km') },
          { value: '{th.ctx.sessions|int}', label: tl('threads.label.sessions') },
          { value: '{th.ctx.movingSec|durhm}', label: tl('label.duration') },
        ]),
        tileRow(k, [
          { value: '{th.ctx.avgDistanceWeekM|km:1}', label: tl('threads.label.avgDistanceWeek'), unit: tl('unit.km') },
          { value: '{th.ctx.avgSessionsWeek|num:1}', label: tl('threads.label.avgSessionsWeek') },
        ]),
      ];
  const sessions = weekBars(k, { series: 'th.ctx.weekSessions', fmt: 'int', color: '$accent2', h: 110, title: 'threads.text.weeklySessions' });
  return slide({
    id: lifting ? 'contextlift' : 'context',
    k,
    subject,
    requires: ['th.has.context', lifting ? 'strength.name' : 'run.kind'],
    body: [k.text({ w: 'fill' }, tl('threads.text.fourWeeks'), { size: 28, weight: 600, color: '$fgMuted', fit: 'ellipsis' }), ...main, sessions, ...totals],
    justify: 'between',
    tags: ['context'],
  });
}

export const THREADS_TEMPLATES = [
  summary(),
  lift(),
  splitsPage('splits', 'th.splitRows'),
  splitsPage('splits2', 'th.splitRows2'),
  splitsPage('splits3', 'th.splitRows3'),
  charts(),
  sensors(),
  zones(),
  power(),
  powerZones(),
  climbs(),
  liftsPage('lifts', 'th.liftRows', false),
  liftsPage('lifts2', 'th.liftRows2', false),
  liftsPage('lifts3', 'th.liftRows3', true),
  muscle(),
  contextSlide(false),
  contextSlide(true),
];
