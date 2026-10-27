/**
 * The sport families of a watch workout (`walk`, `ride`, `swim`, `gym`, `cardio`, `flow`, `court`; see `data/sportMetrics.ts`).
 * They read the same `run.*` data as the running cards, but each family puts its own number in the hero and lists only the
 * numbers that sport has: a swim reads metres, pace per 100 m, laps and SWOLF; a gym session reads its duration (or the logged
 * volume), sets, calories and heart rate zones; a yoga class reads calm time and heart rate. Every number hides when the
 * workout does not have it, and the stacks reflow.
 *
 *   <family>.bold      VOLT      family hero, art (route, climb, heart rate zones or the family glyph), number rows   story square
 *   <family>.poster    PAPER     editorial: the hero across the card, art, small-caps numbers                         story
 *   <family>.minimal   INK       restrained: the hero, ruled rows of the brief numbers, small art                    story square
 *   <family>.stats     STICKER   transparent: the hero and a row of the brief numbers, shadowed                       sticker
 */
import { all, any, footer, has, lacks, not, sportGlyph, tl } from './blocks';
import { kit, template, type Cond, type Dim, type Expr, type Kit, type LayerJson } from './dsl';
import { INK, PAPER, STICKER, VOLT, type Palette } from './palette';

export type SportFamily = 'walk' | 'ride' | 'swim' | 'gym' | 'cardio' | 'flow' | 'court';
type Canvas = 'story' | 'square';
type Style = 'bold' | 'poster' | 'minimal' | 'stats';

interface Metric {
  /** The `run.*` path whose presence shows the metric. */
  bind: string;
  value: string;
  label: Expr;
  unit?: Expr;
}

const metric = (field: string, filter: string, label: string, unit?: string): Metric => ({
  bind: `run.${field}`,
  value: `{run.${field}|${filter}}`,
  label: tl(`label.${label}`),
  unit: unit ? tl(`unit.${unit}`) : undefined,
});

const M = {
  km: metric('distanceM', 'km', 'distance', 'km'),
  meters: metric('distanceM', 'int', 'distance', 'm'),
  clock: metric('movingSec', 'dur', 'time'),
  duration: metric('movingSec', 'dur', 'duration'),
  pace: metric('paceSecKm', 'pace', 'pace', 'perKm'),
  pace100: metric('pace100Sec', 'pace', 'pace', 'per100m'),
  speed: metric('speedKmh', 'num:1', 'speed', 'kmh'),
  climb: metric('elevGainM', 'int', 'elevation', 'm'),
  steps: metric('steps', 'int', 'steps'),
  jumps: metric('jumps', 'int', 'jumps'),
  rpm: metric('cadence', 'int', 'cadence', 'rpm'),
  /** A machine's cadence (strides or strokes a minute): no unit, the label says what it is. */
  cadence: metric('cadence', 'int', 'cadence'),
  power: metric('power', 'int', 'power', 'watt'),
  hr: metric('hrAvg', 'int', 'avgHr', 'bpm'),
  /** "Heart rate" instead of "Avg heart rate", for rows of four. */
  hrShort: metric('hrAvg', 'int', 'hr', 'bpm'),
  hrMax: metric('hrMax', 'int', 'maxHr', 'bpm'),
  kcal: metric('kcal', 'int', 'kcal', 'kcal'),
  laps: metric('laps', 'int', 'laps'),
  strokes: metric('strokes', 'int', 'strokes'),
  swolf: metric('swolf', 'int', 'swolf'),
  pool: metric('poolM', 'int', 'pool', 'm'),
  volume: { ...metric('volume', 'int', 'volume'), unit: '{run.unit}' },
  sets: metric('sets', 'int', 'sets'),
  reps: metric('reps', 'int', 'reps'),
} satisfies Record<string, Metric>;

/** The picture of a card, first one the workout has wins: its route, its climb, its heart rate, its heart rate zones. */
type Art = 'route' | 'alt' | 'hr' | 'zones';

const ART_BIND: Record<Art, string> = { route: 'run.route', alt: 'run.altSeries', hr: 'run.hrSeries', zones: 'run.hrZonePct' };

interface FamilySpec {
  family: SportFamily;
  /** English developer name. */
  name: string;
  /** Hero candidates in order: the first the workout has is the hero. */
  hero: Metric[];
  /** The number rows of the bold and poster cards; a metric that is the hero, or missing, drops out of its row. */
  rows: Metric[][];
  /** At most four numbers for the minimal card and the sticker. */
  brief: Metric[];
  art: Art[];
  /** Show the strain band ("Effort: Hard") under the hero. */
  effort: boolean;
  /** The style the sheet opens on comes first (`DEFAULT_GROUP`). */
  styles: Style[];
}

const ALL_STYLES: Style[] = ['bold', 'poster', 'minimal', 'stats'];

export const FAMILY_SPECS: readonly FamilySpec[] = [
  {
    family: 'walk',
    name: 'Walk',
    hero: [M.km, M.steps, M.clock],
    rows: [
      [M.clock, M.pace, M.climb],
      [M.steps, M.hr, M.kcal],
    ],
    brief: [M.clock, M.pace, M.climb, M.steps],
    art: ['route', 'alt', 'hr'],
    effort: false,
    styles: ALL_STYLES,
  },
  {
    family: 'ride',
    name: 'Ride',
    hero: [M.km, M.clock],
    rows: [
      [M.clock, M.speed, M.climb],
      [M.power, M.rpm, M.hrShort, M.kcal],
    ],
    brief: [M.clock, M.speed, M.climb, M.power],
    art: ['route', 'alt', 'hr'],
    effort: false,
    styles: ALL_STYLES,
  },
  {
    family: 'swim',
    name: 'Swim',
    hero: [M.meters, M.clock],
    rows: [
      [M.clock, M.pace100, M.laps],
      [M.swolf, M.strokes, M.pool],
      [M.hr, M.kcal],
    ],
    brief: [M.clock, M.pace100, M.laps, M.swolf],
    art: ['route'],
    effort: false,
    styles: ALL_STYLES,
  },
  {
    family: 'gym',
    name: 'Strength',
    hero: [M.volume, M.duration],
    rows: [
      [M.duration, M.sets, M.reps],
      [M.kcal, M.hr, M.hrMax],
    ],
    brief: [M.duration, M.sets, M.kcal, M.hrShort],
    art: ['zones', 'hr'],
    effort: true,
    styles: ALL_STYLES,
  },
  {
    family: 'cardio',
    name: 'Cardio',
    hero: [M.jumps, M.duration],
    rows: [
      [M.duration, M.kcal, M.hrShort, M.hrMax],
      [M.km, M.power, M.cadence],
    ],
    brief: [M.duration, M.kcal, M.hrShort, M.hrMax],
    art: ['zones', 'hr'],
    effort: true,
    styles: ALL_STYLES,
  },
  {
    family: 'flow',
    name: 'Yoga and mobility',
    hero: [M.duration],
    rows: [[M.kcal, M.hr]],
    brief: [M.kcal, M.hr],
    art: ['hr'],
    effort: true,
    styles: ['minimal', 'bold', 'poster', 'stats'],
  },
  {
    family: 'court',
    name: 'Team and racket',
    hero: [M.duration],
    rows: [
      [M.kcal, M.hr, M.hrMax],
      [M.steps, M.km],
    ],
    brief: [M.kcal, M.hrShort, M.hrMax, M.steps],
    art: ['zones', 'hr'],
    effort: true,
    styles: ALL_STYLES,
  },
];

// ------------------------------------------------------------------------------------------------------------ conditions

/** The hero is candidate `i` when the workout has it and none of the candidates before it. */
const heroWhen = (spec: FamilySpec, i: number): Cond => all(has(spec.hero[i]!.bind), ...spec.hero.slice(0, i).map((h) => lacks(h.bind)));

/** A number shows when the workout has it and it is not already the hero. */
function cellWhen(spec: FamilySpec, cell: Metric): Cond {
  const asHero = spec.hero.indexOf(cell);
  return asHero < 0 ? has(cell.bind) : all(has(cell.bind), not(heroWhen(spec, asHero)));
}

const rowWhen = (spec: FamilySpec, row: Metric[]): Cond => any(...row.map((cell) => cellWhen(spec, cell)));

const artWhen = (spec: FamilySpec, i: number): Cond => all(has(ART_BIND[spec.art[i]!]), ...spec.art.slice(0, i).map((a) => lacks(ART_BIND[a])));
const noArt = (spec: FamilySpec): Cond => all(...spec.art.map((a) => lacks(ART_BIND[a])));

// ---------------------------------------------------------------------------------------------------------------- blocks

const spacer = (k: Kit, when?: Cond) => k.shape({ w: 1, h: 'fill' }, 'rect', {}, { when });

const rule = (k: Kit, w: Dim) => k.shape({ w, h: 2 }, 'line', { stroke: { color: '$line', width: 2 } });

/** The family glyph in a box of its own, so it sits in a stack. */
const glyphBox = (k: Kit, size: number, color: string, when?: Cond) => k.group({ w: size, h: size }, sportGlyph(k, 0, 0, size, color), { when });

/** Glyph disc, sport name, date. */
function header(k: Kit, o: { disc: number; size: number; dateSize: number; weight?: number; upper?: boolean; ls?: number; muted?: string; plain?: boolean }): LayerJson {
  const glyph = Math.round(o.disc / 2);
  const off = (o.disc - glyph) / 2;
  const mark = o.plain
    ? glyphBox(k, o.disc, o.muted ?? '$fgMuted')
    : k.group({ w: o.disc, h: o.disc }, [k.shape({ x: 0, y: 0, w: o.disc, h: o.disc }, 'ellipse', { fill: '$surfaceStrong' }), ...sportGlyph(k, off, off, glyph, '$fg')]);
  return k.group(
    { w: 'fill', h: 'auto' },
    [
      mark,
      k.text({ w: 'fill' }, '{run.sport}', { size: o.size, weight: o.weight ?? 800, upper: o.upper ?? true, ls: o.ls ?? 3, color: '$fg', minSize: 26 }),
      k.text({ w: 'auto' }, '{run.startedAt|date:medium}', { size: o.dateSize, weight: 600, color: '$fgMuted', align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
}

interface HeroLook {
  size: number;
  unitSize: number;
  color: string;
  labelColor: string;
  labelSize: number;
  weight?: number;
  labelPos?: 'above' | 'none';
  unit?: boolean;
  shadow?: boolean;
  align?: 'left' | 'center' | 'right';
  w?: Dim;
}

/** One stat per hero candidate; exactly one passes its `when`. */
function hero(k: Kit, spec: FamilySpec, o: HeroLook): LayerJson {
  return k.group(
    { w: o.w ?? 'fill', h: 'auto' },
    spec.hero.map((cell, i) =>
      k.stat({ w: 'fill', h: 'auto' }, cell.value, {
        unit: o.unit === false ? undefined : cell.unit,
        label: cell.label,
        size: o.size,
        unitSize: o.unitSize,
        labelSize: o.labelSize,
        weight: o.weight ?? 800,
        color: o.color,
        labelColor: o.labelColor,
        labelPos: o.labelPos ?? 'above',
        gap: 16,
        minSize: 110,
        align: o.align,
        shadow: o.shadow,
        when: heroWhen(spec, i),
      }),
    ),
    { dir: 'column' },
  );
}

/** "Effort: Hard", outlined like the strength PR chip (a filled chip cannot pass the flat-card contrast check on VOLT). */
function effortChip(k: Kit, spec: FamilySpec, o: { size: number; color: string; outline?: boolean }): LayerJson[] {
  if (!spec.effort) return [];
  const chip = k.group(
    { w: 'auto', h: 'auto' },
    [k.icon({ w: o.size + 6, h: o.size + 6 }, 'flame', o.color), k.text({ w: 'auto' }, tl('tpl.sport.text.effort', { effort: '{run.effortLabel}' }), { size: o.size, weight: 800, color: o.color })],
    { dir: 'row', gap: 12, align: 'center', padding: o.outline === false ? 0 : 14, ...(o.outline === false ? {} : { stroke: { color: o.color, width: 3 }, radius: 20 }) },
  );
  return [k.group({ w: 'fill', h: 'auto' }, [chip], { dir: 'row', when: has('run.effortLabel') })];
}

interface CellLook {
  size: number;
  labelSize: number;
  unitSize: number;
  color: string;
  labelColor: string;
  weight?: number;
  shadow?: boolean;
  gap?: number;
}

function cell(k: Kit, spec: FamilySpec, m: Metric, o: CellLook): LayerJson {
  return k.stat({ w: 'fill', h: 'auto' }, m.value, {
    unit: m.unit,
    label: m.label,
    size: o.size,
    labelSize: o.labelSize,
    unitSize: o.unitSize,
    weight: o.weight ?? 800,
    color: o.color,
    labelColor: o.labelColor,
    labelPos: 'above',
    gap: 10,
    minSize: 36,
    shadow: o.shadow,
    when: cellWhen(spec, m),
  });
}

/** The number rows: a row whose numbers are all missing (or the hero) is removed with its gap. */
function rows(k: Kit, spec: FamilySpec, list: Metric[][], o: CellLook & { rowGap: number }): LayerJson {
  return k.group(
    { w: 'fill', h: 'auto' },
    list.map((row) => k.group({ w: 'fill', h: 'auto' }, row.map((m) => cell(k, spec, m, o)), { dir: 'row', gap: o.gap ?? 28, align: 'start', when: rowWhen(spec, row) })),
    { dir: 'column', gap: o.rowGap, align: 'stretch', when: any(...list.map((row) => rowWhen(spec, row))) },
  );
}

const ZONE_COLORS = ['#5FD3EE', '#6EE7A0', '#F5D547', '#FF9F43', '#FF4D6A'];

/** Heart rate zones: a caption, one proportional bar in the zone colors, and the share of time under each zone label. */
function zones(k: Kit, o: { barH: number; labelSize: number; pctSize: number; captionSize: number; labels: boolean }): LayerJson {
  const bar = k.chart({ w: 'fill', h: o.barH }, { kind: 'stack', barRadius: Math.round(o.barH / 3), segments: ZONE_COLORS.map((color, i) => ({ value: { bind: `run.hrZonePct.${i}` }, color })) });
  const legend = k.group(
    { w: 'fill', h: 'auto' },
    ZONE_COLORS.map((_, i) =>
      k.group(
        { w: 'fill', h: 'auto' },
        [
          k.text({ w: 'fill' }, `{run.hrZoneLabels.${i}}`, { size: o.labelSize, weight: 700, color: '$fgMuted' }),
          k.text({ w: 'fill' }, `{run.hrZonePct.${i}|pct}`, { size: o.pctSize, weight: 800, color: '$fg' }),
        ],
        { dir: 'column', gap: 6 },
      ),
    ),
    { dir: 'row', gap: 16, align: 'start' },
  );
  return k.group(
    { w: 'fill', h: 'auto' },
    [k.text({ w: 'fill' }, tl('tpl.run.text.zones'), { size: o.captionSize, weight: 700, color: '$fgMuted', upper: true, ls: 3 }), bar, ...(o.labels ? [legend] : [])],
    { dir: 'column', gap: 18, align: 'stretch' },
  );
}

/** A chart with its caption. */
function captioned(k: Kit, label: string, chart: LayerJson, captionSize: number): LayerJson {
  return k.group({ w: 'fill', h: 'auto' }, [k.text({ w: 'fill' }, tl(label), { size: captionSize, weight: 700, color: '$fgMuted', upper: true, ls: 3 }), chart], { dir: 'column', gap: 18, align: 'stretch' });
}

interface ArtLook {
  chartH: number;
  stroke: number;
  captionSize: number;
  zoneLabels: boolean;
  routeColor: string;
  routeColor2: string;
  /** The family glyph when the workout has none of the art; 0 leaves the space empty. */
  glyph: number;
  glyphColor: string;
}

/** The art block: the first art the workout has, or the family glyph; it takes the free height of the card. */
function art(k: Kit, spec: FamilySpec, o: ArtLook): LayerJson[] {
  const pieces = spec.art.map((a, i) => {
    const when = artWhen(spec, i);
    switch (a) {
      case 'route':
        return k.route({ w: 'fill', h: 'fill' }, { color: o.routeColor, color2: o.routeColor2, strokeWidth: o.stroke * 2, halo: true, markers: true, padding: 40 }, { when });
      case 'alt':
        return k.group({ w: 'fill', h: 'auto' }, [captioned(k, 'label.elevation', k.chart({ w: 'fill', h: o.chartH }, { kind: 'area', series: { bind: 'run.altSeries' }, color: '$accent', strokeWidth: o.stroke }), o.captionSize)], { dir: 'column', when });
      case 'hr':
        return k.group({ w: 'fill', h: 'auto' }, [captioned(k, 'label.hr', k.chart({ w: 'fill', h: o.chartH }, { kind: 'line', series: { bind: 'run.hrSeries' }, color: '$accent', strokeWidth: o.stroke }), o.captionSize)], { dir: 'column', when });
      case 'zones':
        return k.group({ w: 'fill', h: 'auto' }, [zones(k, { barH: Math.round(o.chartH / 4), labelSize: o.captionSize, pctSize: o.captionSize + 8, captionSize: o.captionSize, labels: o.zoneLabels })], { dir: 'column', when });
    }
  });
  const layers = [k.group({ w: 'fill', h: 'fill' }, pieces, { dir: 'column', justify: 'center', align: 'stretch', when: any(...spec.art.map((a) => has(ART_BIND[a]))) })];
  if (o.glyph > 0) layers.push(k.group({ w: 'fill', h: 'fill' }, [glyphBox(k, o.glyph, o.glyphColor)], { dir: 'column', align: 'center', justify: 'center', when: noArt(spec) }));
  else layers.push(spacer(k, noArt(spec)));
  return layers;
}

const footerRow = (k: Kit, w: Dim, h = 48) =>
  k.group({ w, h: 'auto' }, [k.brand({ w: 'auto', h }, 'lockup', { size: h }), k.brand({ w: 'auto', h: 'auto' }, 'link', { size: 28 })], { dir: 'row', justify: 'between', align: 'center' });

function build(spec: FamilySpec, style: Style, canvas: Canvas | 'sticker', palette: Palette, layers: LayerJson[], o: { tags: string[]; height?: number; transparent?: boolean }) {
  const free = canvas === 'sticker';
  return template({
    id: `${spec.family}.${style}.${canvas}`,
    name: `${spec.name}, ${style}, ${canvas}`,
    titleKey: `stickers:tpl.${spec.family}.${style}`,
    kind: spec.family,
    style: free ? 'sticker' : style,
    aspect: free ? 'free' : canvas,
    height: o.height,
    background: free ? { kind: 'transparent' } : { kind: 'color', color: '$bg' },
    dark: palette.dark,
    light: palette.light,
    layers,
    constraints: { maxLayers: 160 },
    meta: { tags: o.tags, ...(o.transparent ? { transparent: true } : {}) },
  });
}

// ------------------------------------------------------------------------------------------------------------------ bold

/** `<family>.bold.*`: volt on black (a volt card by day). The family's number is the poster, the art fills the middle. */
function bold(spec: FamilySpec, canvas: Canvas) {
  const k = kit(`${spec.family[0]}b${canvas[1]}`);
  const story = canvas === 'story';
  const look = { color: '$fg', labelColor: '$fgMuted', labelSize: 26, unitSize: story ? 30 : 26, size: story ? 66 : 54 };
  const top = k.group(
    { w: 'fill', h: 'auto' },
    [hero(k, spec, { size: story ? 340 : 220, unitSize: story ? 88 : 64, color: '$accent', labelColor: '$fgMuted', labelSize: 30 }), ...effortChip(k, spec, { size: story ? 32 : 28, color: '$accent' })],
    { dir: 'column', gap: story ? 28 : 18, align: 'stretch' },
  );
  const middle = art(k, spec, {
    chartH: story ? 300 : 150,
    stroke: story ? 8 : 6,
    captionSize: 26,
    zoneLabels: story,
    routeColor: '$fg',
    routeColor2: '$accent',
    glyph: story ? 300 : 0,
    glyphColor: '$surfaceStrong',
  });
  const numbers = rows(k, spec, story ? spec.rows : spec.rows.slice(0, 2), { ...look, rowGap: story ? 32 : 20 });
  const root = k.group(
    { x: 72, y: story ? 250 : 72, w: 936, h: story ? 1190 : 844 },
    [header(k, { disc: story ? 96 : 80, size: story ? 44 : 38, dateSize: story ? 32 : 30, upper: true }), top, ...middle, numbers],
    { dir: 'column', gap: story ? 36 : 24, align: 'stretch' },
  );
  return build(spec, 'bold', canvas, VOLT, [root, ...footer(k, 72, story ? 1510 : 952, 936)], { tags: ['numbers', spec.family] });
}

// ---------------------------------------------------------------------------------------------------------------- poster

/** `<family>.poster.story`: editorial. A kicker line, hairlines, the hero across the card, the art, small-caps numbers. */
function poster(spec: FamilySpec) {
  const k = kit(`${spec.family[0]}p`);
  const W = 936;
  const kicker = k.group(
    { w: W, h: 'auto' },
    [
      glyphBox(k, 44, '$accent'),
      k.text({ w: 'fill' }, '{run.sport}', { size: 30, weight: 700, upper: true, ls: 6, color: '$fg', minSize: 24 }),
      k.text({ w: 'auto' }, '{run.startedAt|date:medium}', { size: 28, weight: 600, color: '$fgMuted', align: 'right', upper: true, ls: 4 }),
    ],
    { dir: 'row', gap: 20, align: 'center' },
  );
  const captions = spec.hero.map((h, i) =>
    k.group(
      { w: W, h: 'auto' },
      [
        k.text({ w: 'fill' }, h.label, { size: 26, weight: 700, upper: true, ls: 6, color: '$fgMuted' }),
        ...(h.unit ? [k.text({ w: 'auto' }, h.unit, { size: 34, weight: 800, upper: true, ls: 6, color: '$accent', align: 'right' })] : []),
      ],
      { dir: 'row', align: 'center', when: heroWhen(spec, i) },
    ),
  );
  const big = hero(k, spec, { size: 470, unitSize: 1, unit: false, color: '$fg', labelColor: '$fgMuted', labelSize: 26, labelPos: 'none', w: W });
  const middle = art(k, spec, { chartH: 280, stroke: 8, captionSize: 26, zoneLabels: true, routeColor: '$accent', routeColor2: '$accent2', glyph: 300, glyphColor: '$accent' });
  const metaCell = (m: Metric) =>
    k.group(
      { w: 'fill', h: 'auto' },
      [
        k.text({ w: 'fill' }, m.label, { size: 24, weight: 700, upper: true, ls: 3, color: '$fgMuted' }),
        k.stat({ w: 'fill', h: 'auto' }, m.value, { unit: m.unit, size: 52, unitSize: 26, weight: 700, color: '$fg', labelPos: 'none', minSize: 34 }),
      ],
      { dir: 'column', gap: 12, when: cellWhen(spec, m) },
    );
  const meta = k.group(
    { w: W, h: 'auto' },
    spec.rows.slice(0, 2).map((row) => k.group({ w: W, h: 'auto' }, row.map(metaCell), { dir: 'row', gap: 24, align: 'start', when: rowWhen(spec, row) })),
    { dir: 'column', gap: 24 },
  );
  const root = k.group(
    { x: 72, y: 250, w: W, h: 1330 },
    [kicker, rule(k, W), ...captions, big, ...effortChip(k, spec, { size: 28, color: '$accent' }), ...middle, rule(k, W), meta, footerRow(k, W)],
    { dir: 'column', gap: 28, align: 'center' },
  );
  return build(spec, 'poster', 'story', PAPER, [root], { tags: ['editorial', spec.family] });
}

// --------------------------------------------------------------------------------------------------------------- minimal

/** `<family>.minimal.*`: ink, medium weights, hairlines, the brief numbers as ruled rows (story) or one row (square). */
function minimal(spec: FamilySpec, canvas: Canvas) {
  const k = kit(`${spec.family[0]}m${canvas[1]}`);
  const story = canvas === 'story';
  const W = 936;
  const head = header(k, { disc: 40, size: 32, dateSize: 30, weight: 600, upper: false, ls: 0, plain: true, muted: '$fgMuted' });
  const heroLayer = hero(k, spec, { size: story ? 260 : 190, unitSize: story ? 60 : 48, weight: 500, color: '$fg', labelColor: '$fgMuted', labelSize: 30 });
  const effort = effortChip(k, spec, { size: 28, color: '$accent', outline: false });

  if (story) {
    const line = (m: Metric) =>
      k.group(
        { w: W, h: 'auto' },
        [
          rule(k, W),
          k.group(
            { w: W, h: 'auto' },
            [
              k.text({ w: 'auto' }, m.label, { size: 32, weight: 500, color: '$fgMuted' }),
              k.stat({ w: 'auto', h: 'auto' }, m.value, { unit: m.unit, size: 56, unitSize: 28, weight: 600, color: '$fg', labelPos: 'none', align: 'right', minSize: 36 }),
            ],
            { dir: 'row', justify: 'between', align: 'end' },
          ),
        ],
        { dir: 'column', gap: 24, when: cellWhen(spec, m) },
      );
    const table = k.group({ w: W, h: 'auto' }, spec.brief.map(line), { dir: 'column', gap: 24 });
    const middle = art(k, spec, { chartH: 220, stroke: 6, captionSize: 26, zoneLabels: true, routeColor: '$accent', routeColor2: '$accent', glyph: 240, glyphColor: '$fgMuted' });
    const root = k.group(
      { x: 72, y: 250, w: W, h: 1330 },
      [head, rule(k, W), heroLayer, ...effort, table, ...middle, footerRow(k, W)],
      { dir: 'column', gap: 36, align: 'stretch' },
    );
    return build(spec, 'minimal', canvas, INK, [root], { tags: ['minimal', spec.family] });
  }

  const table = k.group(
    { w: W, h: 'auto' },
    [rule(k, W), k.group({ w: W, h: 'auto' }, spec.brief.map((m) => cell(k, spec, m, { size: 50, labelSize: 26, unitSize: 24, weight: 600, color: '$fg', labelColor: '$fgMuted' })), { dir: 'row', gap: 24, align: 'start' })],
    { dir: 'column', gap: 26, when: rowWhen(spec, spec.brief) },
  );
  const root = k.group({ x: 72, y: 72, w: W, h: 936 }, [head, spacer(k), heroLayer, ...effort, table, spacer(k), footerRow(k, W, 44)], { dir: 'column', gap: 32, align: 'stretch' });
  return build(spec, 'minimal', canvas, INK, [root], { tags: ['minimal', spec.family] });
}

// ----------------------------------------------------------------------------------------------------------------- stats

/** `<family>.stats.sticker`: transparent. The glyph and sport name, the hero, a row of the brief numbers, the lockup. */
function stats(spec: FamilySpec) {
  const k = kit(`${spec.family[0]}s`);
  const W = 936;
  const title = k.group(
    { w: 'auto', h: 'auto' },
    [glyphBox(k, 56, '$fg'), k.text({ w: 'auto' }, '{run.sport}', { size: 40, weight: 800, upper: true, ls: 3, color: '$fg', shadow: true, minSize: 26 })],
    { dir: 'row', gap: 20, align: 'center' },
  );
  const heroLayer = hero(k, spec, { size: 200, unitSize: 56, color: '$accent', labelColor: '$fgSoft', labelSize: 30, shadow: true, align: 'center', w: W });
  const brief = k.group(
    { w: W, h: 'auto' },
    spec.brief.map((m) => cell(k, spec, m, { size: 76, labelSize: 28, unitSize: 30, color: '$fg', labelColor: '$fgSoft', shadow: true })),
    { dir: 'row', gap: 28, align: 'start', when: rowWhen(spec, spec.brief) },
  );
  const root = k.group({ x: 0, y: 0, w: 1080, h: 1000 }, [title, heroLayer, brief, k.brand({ w: 'auto', h: 44 }, 'lockup', { size: 44 })], {
    dir: 'column',
    gap: 48,
    align: 'center',
    justify: 'center',
  });
  return build(spec, 'stats', 'sticker', STICKER, [root], { tags: ['numbers', spec.family], height: 1000, transparent: true });
}

function familyTemplates(spec: FamilySpec) {
  return spec.styles.flatMap((style) => {
    switch (style) {
      case 'bold':
        return [bold(spec, 'story'), bold(spec, 'square')];
      case 'poster':
        return [poster(spec)];
      case 'minimal':
        return [minimal(spec, 'story'), minimal(spec, 'square')];
      case 'stats':
        return [stats(spec)];
    }
  });
}

export const SPORT_TEMPLATES = FAMILY_SPECS.flatMap(familyTemplates);
