/**
 * `run.classic.*`: the share card JoyoFit had before the sticker engine, back as a template. The person's photo full-bleed, the
 * sport glyph with the sport and the date top left, the distance as a huge number, a grid of the other numbers, and the
 * JoyoFit wordmark with the link at the foot. White type with a soft shadow, no panel. Numbers follow the sport family
 * like every `run` card: pace per km, per 100 m or speed, whatever the workout does not have is left out and the grid closes up.
 */
import { all, has, is, lacks, not, sportGlyph, tl } from './blocks';
import { kit, template } from './dsl';
import type { Cond, Dim, Kit, LayerJson } from './dsl';
import { GLASS } from './palette';
import { PHOTO_FALLBACK, bleed } from './run';

type Canvas = 'story' | 'square';

interface Cell {
  bind: string;
  value: string;
  label: { t: string };
  unit?: { t: string };
  when?: Cond;
}

const CELL = {
  time: { bind: 'run.movingSec', value: '{run.movingSec|dur}', label: tl('label.time'), when: has('run.distanceM') },
  pace: { bind: 'run.paceSecKm', value: '{run.paceSecKm|pace}', label: tl('label.avgPace'), unit: tl('unit.perKm') },
  pace100: { bind: 'run.pace100Sec', value: '{run.pace100Sec|pace}', label: tl('label.avgPace'), unit: tl('unit.per100m') },
  speed: { bind: 'run.speedKmh', value: '{run.speedKmh|num:1}', label: tl('label.avgSpeed'), unit: tl('unit.kmh') },
  hr: { bind: 'run.hrAvg', value: '{run.hrAvg|int}', label: tl('label.avgHrShort'), unit: tl('unit.bpm') },
  kcal: { bind: 'run.kcal', value: '{run.kcal|int}', label: tl('label.kcal'), unit: tl('unit.kcal') },
  elev: { bind: 'run.elevGainM', value: '{run.elevGainM|int}', label: tl('label.elevation'), unit: tl('unit.m'), when: { bind: 'run.elevGainM', gte: 1 } },
} satisfies Record<string, Cell>;

const cellWhen = (cell: Cell): Cond =>
  cell.when ? all(lacks('run._custom'), has(cell.bind), cell.when) : all(lacks('run._custom'), has(cell.bind));

interface Metrics {
  pad: number; gap: number; rowGap: number; columnGap: number; heroLabelGap: number; labelGap: number;
  titleGap: number; disc: number; glyph: number; headGap: number; title: number; date: number;
  primary: number; primaryUnit: number; value: number; unit: number; label: number; wordmark: number;
  link: number; columns: number; inset: number;
}

const METRICS: Record<Canvas, Metrics> = {
  story: { pad: 72, gap: 73, rowGap: 66, columnGap: 40, heroLabelGap: 46, labelGap: 20, titleGap: 7, disc: 104, glyph: 54, headGap: 40, title: 65, date: 29, primary: 148, primaryUnit: 44, value: 72, unit: 27, label: 27, wordmark: 38, link: 25, columns: 2, inset: 400 },
  square: { pad: 56, gap: 44, rowGap: 40, columnGap: 24, heroLabelGap: 28, labelGap: 12, titleGap: 5, disc: 88, glyph: 46, headGap: 24, title: 51, date: 24, primary: 102, primaryUnit: 36, value: 51, unit: 22, label: 22, wordmark: 32, link: 22, columns: 3, inset: 280 },
};

const HEIGHT: Record<Canvas, number> = { story: 1920, square: 1080 };

function header(k: Kit, m: Metrics, w: number): LayerJson {
  const off = (m.disc - m.glyph) / 2;
  const disc = k.group({ w: m.disc, h: m.disc }, [k.shape({ x: 0, y: 0, w: m.disc, h: m.disc }, 'ellipse', { fill: '$bg/38' }), ...sportGlyph(k, off, off, m.glyph, '$fg')]);
  const text = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.text({ w: 'fill' }, '{run.sport}', { size: m.title, weight: 800, color: '$fg', shadow: true, minSize: 36 }),
      k.text({ w: 'fill' }, '{run.startedAt|date:medium} · {run.startedAt|time}', { size: m.date, weight: 500, color: '$fgSoft', shadow: true, minSize: 24, onMissing: 'hide' }),
    ],
    { dir: 'column', gap: m.titleGap },
  );
  return k.group({ w, h: 'auto' }, [disc, text], { dir: 'row', gap: m.headGap, align: 'center' });
}

/** The distance (metres for a swim, like every `run` card; km otherwise); with none, the moving time. */
function hero(k: Kit, m: Metrics, w: Dim): LayerJson {
  const big = (value: string, unit: string | null, label: string, when: Cond) =>
    k.stat({ w: 'fill' }, value, {
      unit: unit ? tl(unit) : undefined,
      label: tl(label),
      size: m.primary,
      unitSize: m.primaryUnit,
      labelSize: m.label,
      weight: 800,
      color: '$fg',
      labelColor: '$fgSoft',
      labelPos: 'above',
      gap: m.heroLabelGap,
      shadow: true,
      minSize: 90,
      when,
    });
  return k.group(
    { w, h: 'auto' },
    [
      k.stat({ w: 'fill' }, '{run.heroVal}', {
        unit: '{run.heroUnit?}',
        label: '{run.heroLabel?}',
        size: m.primary,
        unitSize: m.primaryUnit,
        labelSize: m.label,
        weight: 800,
        color: '$fg',
        labelColor: '$fgSoft',
        labelPos: 'above',
        gap: m.heroLabelGap,
        shadow: true,
        minSize: 90,
        when: has('run._custom'),
      }),
      big('{run.distanceM|km}', 'unit.km', 'label.distance', all(lacks('run._custom'), has('run.distanceM'), not(is('run.category', 'swim')))),
      big('{run.distanceM|int}', 'unit.m', 'label.distance', all(lacks('run._custom'), has('run.distanceM'), is('run.category', 'swim'))),
      big('{run.movingSec|dur}', null, 'label.time', all(lacks('run._custom'), lacks('run.distanceM'))),
    ],
    { dir: 'column' },
  );
}

function cellStat(k: Kit, m: Metrics, cell: Cell, w: number): LayerJson {
  return k.stat({ w, h: 'auto' }, cell.value, {
    unit: cell.unit,
    label: cell.label,
    size: m.value,
    unitSize: m.unit,
    labelSize: m.label,
    weight: 800,
    color: '$fg',
    labelColor: '$fgSoft',
    labelPos: 'above',
    gap: m.labelGap,
    shadow: true,
    minSize: 40,
    when: cellWhen(cell),
  });
}
function slotCell(k: Kit, m: Metrics, i: 1 | 2 | 3 | 4, w: number): LayerJson {
  return k.stat({ w, h: 'auto' }, `{run.slot${i}Val}`, {
    unit: `{run.slot${i}Unit?}`,
    label: `{run.slot${i}Label?}`,
    size: m.value,
    unitSize: m.unit,
    labelSize: m.label,
    weight: 800,
    color: '$fg',
    labelColor: '$fgSoft',
    labelPos: 'above',
    gap: m.labelGap,
    shadow: true,
    minSize: 40,
    when: has(`run.slot${i}Val`),
  });
}

/**
 * The grid: rows of `columns` slots, each slot one fixed-width column. A slot holds the cells that may fill it (the sport's pace,
 * its pace per 100 m or its speed: only one exists), so a cell keeps its column whether or not its neighbour exists, and a row
 * or slot with nothing to show takes no height.
 */
function grid(k: Kit, m: Metrics, w: number): LayerJson {
  const effort = [CELL.pace, CELL.pace100, CELL.speed];
  const slots: Cell[][] = [[CELL.time], effort, [CELL.hr], [CELL.kcal], [CELL.elev]];
  const cellW = Math.floor((w - m.columnGap * (m.columns - 1)) / m.columns);
  const chunk = <T>(arr: T[], sz: number): T[][] => Array.from({ length: Math.ceil(arr.length / sz) }, (_, i) => arr.slice(i * sz, (i + 1) * sz));

  const customRows = chunk<1 | 2 | 3 | 4>([1, 2, 3, 4], m.columns).map((row) =>
    k.group(
      { w, h: 'auto' },
      row.map((i) => k.group({ w: cellW, h: 'auto' }, [slotCell(k, m, i, cellW)], { dir: 'column' })),
      { dir: 'row', gap: m.columnGap, align: 'start', when: has('run._custom') },
    ),
  );
  const defaultRows = chunk(slots, m.columns).map((row) =>
    k.group(
      { w, h: 'auto' },
      row.map((cells) => k.group({ w: cellW, h: 'auto' }, cells.map((cell) => cellStat(k, m, cell, cellW)), { dir: 'column' })),
      { dir: 'row', gap: m.columnGap, align: 'start', when: lacks('run._custom') },
    ),
  );
  return k.group({ w, h: 'auto' }, [...customRows, ...defaultRows], { dir: 'column', gap: m.rowGap });
}

function footer(k: Kit, m: Metrics, w: number): LayerJson {
  return k.group(
    { w, h: 'auto' },
    [k.brand({ w: 'auto', h: 'auto' }, 'wordmark', { size: Math.round(m.wordmark / 0.62) }), k.brand({ w: 'auto', h: 'auto' }, 'link', { size: m.link })],
    { dir: 'row', justify: 'between', align: 'end' },
  );
}

function runClassic(canvas: Canvas) {
  const k = kit('rc');
  const m = METRICS[canvas];
  const H = HEIGHT[canvas];
  const W = 1080 - m.pad * 2;
  const story = canvas === 'story';

  // The old card's scrim: dark over the top 30 %, clear in the middle, 80 % dark under the numbers.
  const scrim = bleed(
    k,
    0,
    0,
    1080,
    H,
    k.shape({ w: 1080, h: H }, 'rect', {
      fill: {
        gradient: {
          angle: 180,
          stops: [{ at: 0, color: '$bg/55' }, { at: 0.3, color: '$bg/0' }, { at: 0.5, color: '$bg/0' }, { at: 1, color: '$bg/80' }],
        },
      },
    }),
  );

  const route = (size: number) =>
    k.route({ w: size, h: size }, { color: '$accent', color2: '$fg', strokeWidth: 10, halo: true, markers: true, padding: 24 }, { when: has('run.route') });
  const spacer = k.shape({ w: 1, h: 'fill' }, 'rect');

  // Story: the route sits above the numbers. Square: beside the hero, so the card keeps its height.
  const lower = story
    ? [route(m.inset), hero(k, m, W)]
    : [k.group({ w: W, h: 'auto' }, [hero(k, m, 'fill'), route(m.inset)], { dir: 'row', gap: m.gap, align: 'end' })];

  const root = k.group(
    { x: m.pad, y: m.pad, w: W, h: H - m.pad * 2 },
    [header(k, m, W), spacer, ...lower, grid(k, m, W), footer(k, m, W)],
    { dir: 'column', gap: m.gap, align: 'start' },
  );

  return template({
    id: `run.classic.${canvas}`,
    name: `Run, classic, ${canvas}`,
    titleKey: 'stickers:tpl.run.classic',
    kind: 'run',
    style: 'photo',
    aspect: canvas,
    // The old card ran edge to edge with a 72 px margin (56 on the square); it ignores Instagram's Story chrome as it always did.
    safe: { top: m.pad, right: m.pad, bottom: m.pad, left: m.pad },
    background: { kind: 'photo', bind: 'photo', fit: 'cover', fallback: PHOTO_FALLBACK },
    dark: GLASS.dark,
    light: GLASS.light,
    layers: [scrim, root],
    constraints: { maxLayers: 80 },
    meta: { tags: ['photo', 'classic'], needsPhoto: true },
  });
}

export const RUN_CLASSIC_TEMPLATES = [runClassic('story'), runClassic('square')];
