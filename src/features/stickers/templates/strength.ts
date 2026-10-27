/**
 * The `strength` family. Every card reads `strength.*` (see the data contract) and collapses around what the session does not
 * have: no volume (bodyweight) promotes reps, then duration, to the hero; no top sets drops the list; no PR drops the chip.
 *
 *   strength.bold      VOLT      the volume is the poster, top sets as ruled rows              story square
 *   strength.poster    PAPER     editorial: workout name as the headline, oversized volume      story square
 *   strength.minimal   INK       restrained numbers, three top sets                             story square
 *   strength.muscle    INK       muscle-load bars in the Muscles-screen heat colors             story square
 *   strength.photo     GLASS     own photo, bottom scrim, numbers overlaid                      story square
 *   strength.receipt   PAPER     thermal-paper receipt on a transparent canvas                  sticker
 *   strength.stats     STICKER   compact transparent stack, shadowed                            sticker
 */
import { all, any, has, lacks, statRow, tl } from './blocks';
import type { Cond, Dim, Kit, LayerJson } from './dsl';
import { kit, template } from './dsl';
import { GLASS, INK, PAPER, STICKER, VOLT, type Palette } from './palette';

type Canvas = 'story' | 'square';

const VOL = 'strength.volume';
const UNIT = '{strength.unit}';
const REPS = 'strength.reps';
const SECS = 'strength.seconds';
const SETS = 'strength.sets';
const DUR = 'strength.durationSec';
const PR = 'strength.prCount';
const NAME = '{strength.name}';
const DATE = '{strength.startedAt|date:medium}';
const topEx = (i: number) => `strength.topSets.${i}.exercise`;
const topLoad = (i: number) => `strength.topSets.${i}.load`;

/** The hero number: volume, else reps (bodyweight), else time held (plank), else duration. Exactly one of the four passes its condition. */
const heroVol = has(VOL);
const heroReps = all(lacks(VOL), has(REPS));
const heroSecs = all(lacks(VOL), lacks(REPS), has(SECS));
const heroDur = all(lacks(VOL), lacks(REPS), lacks(SECS), has(DUR));

const spacer = (k: Kit, when?: Cond) => k.shape({ w: 1, h: 'fill' }, 'rect', {}, { when });

interface HeroOpts {
  size: number;
  unitSize: number;
  minSize: number;
  color: string;
  labelColor: string;
  labelSize: number;
  weight?: number;
  gap?: number;
  align?: 'left' | 'center' | 'right';
  w?: Dim;
  shadow?: boolean;
  labelPos?: 'above' | 'below' | 'none';
}

function hero(k: Kit, o: HeroOpts): LayerJson[] {
  const base = {
    size: o.size,
    weight: o.weight ?? 800,
    color: o.color,
    labelColor: o.labelColor,
    labelSize: o.labelSize,
    labelPos: o.labelPos ?? 'above',
    gap: o.gap ?? 16,
    align: o.align,
    minSize: o.minSize,
    shadow: o.shadow,
  } as const;
  const box = { w: o.w ?? 'fill', h: 'auto' } as const;
  return [
    k.stat(box, `{${VOL}|int}`, { ...base, unit: UNIT, unitSize: o.unitSize, label: tl('label.volume'), when: heroVol }),
    k.stat(box, `{${REPS}|int}`, { ...base, label: tl('label.reps'), when: heroReps }),
    k.stat(box, `{${SECS}|dur}`, { ...base, label: tl('label.hold'), when: heroSecs }),
    k.stat(box, `{${DUR}|durhm}`, { ...base, label: tl('label.duration'), when: heroDur }),
  ];
}

const heroGroup = (k: Kit, o: HeroOpts, w: Dim = 'fill') => k.group({ w, h: 'auto' }, hero(k, o), { dir: 'column' });

interface ListOpts {
  limit?: number;
  size: number;
  loadSize?: number;
  color: string;
  loadColor: string;
  gap: number;
  rule?: string;
  ruleWidth?: number;
  index?: { size: number; color: string; width: number };
  shadow?: boolean;
  when?: Cond;
}

/**
 * Top sets as ruled rows: a rule above every row and one closing rule. Rows hide on their own binding, so three sets draw three
 * rows. A long exercise name shrinks to 26 px, then ends in an ellipsis; the load keeps its width.
 */
function topList(k: Kit, o: ListOpts): LayerJson {
  const kids: LayerJson[] = [];
  const rule = (when: Cond) => k.shape({ w: 'fill', h: 2 }, 'line', { stroke: { color: o.rule ?? '$line', width: o.ruleWidth ?? 2 } }, { when });
  for (let i = 0; i < (o.limit ?? 5); i++) {
    kids.push(rule(has(topEx(i))));
    const cells: LayerJson[] = [];
    if (o.index) cells.push(k.text({ w: o.index.width }, String(i + 1).padStart(2, '0'), { size: o.index.size, weight: 600, color: o.index.color }));
    cells.push(k.text({ w: 'fill' }, `{${topEx(i)}}`, { size: o.size, weight: 700, color: o.color, minSize: 26, shadow: o.shadow }));
    cells.push(k.text({ w: 'auto' }, `{${topLoad(i)}}`, { size: o.loadSize ?? o.size, weight: 800, color: o.loadColor, minSize: 26, shadow: o.shadow }));
    kids.push(k.group({ w: 'fill', h: 'auto' }, cells, { dir: 'row', gap: 24, align: 'center', when: has(topEx(i)) }));
  }
  kids.push(rule(has(topEx(0))));
  return k.group({ w: 'fill', h: 'auto' }, kids, { dir: 'column', gap: o.gap, align: 'stretch', when: o.when ? all(o.when, has(topEx(0))) : has(topEx(0)) });
}

const prText = () => tl('tpl.strength.text.newPr', { count: `{${PR}}` });

/** The PR chip: trophy and "2 new PR", outlined (a filled chip cannot pass the flat-card contrast check on VOLT). */
function prChip(k: Kit, o: { color: string; size: number; outline?: boolean; when?: Cond }): LayerJson {
  const chip = k.group(
    { w: 'auto', h: 'auto' },
    [k.icon({ w: o.size + 8, h: o.size + 8 }, 'trophy', o.color), k.text({ w: 'auto' }, prText(), { size: o.size, weight: 800, color: o.color })],
    { dir: 'row', gap: 14, align: 'center', padding: o.outline === false ? 0 : 16, ...(o.outline === false ? {} : { stroke: { color: o.color, width: 3 }, radius: 20 }) },
  );
  return k.group({ w: 'fill', h: 'auto' }, [chip], { dir: 'row', when: o.when ? all(o.when, has(PR)) : has(PR) });
}

/** Sets, reps and time cells; a cell that duplicates the hero or lacks data disappears and the others share the width. */
function statsRow(k: Kit, o: { size: number; labelSize: number; color: string; labelColor: string; unitSize?: number; gap?: number; when?: Cond }): LayerJson {
  const cells = statRow(
    k,
    [
      { value: `{${SETS}|int}`, label: tl('label.sets') },
      { value: `{${REPS}|int}`, label: tl('label.reps'), when: has(VOL) },
      { value: `{${DUR}|durhm}`, label: tl('label.duration'), when: any(has(VOL), has(REPS), has(SECS)) },
    ],
    { size: o.size, labelSize: o.labelSize, color: o.color, labelColor: o.labelColor, unitSize: o.unitSize, weight: 800 },
  );
  return k.group({ w: 'fill', h: 'auto' }, cells, { dir: 'row', gap: o.gap ?? 28, align: 'start', when: o.when });
}

const lifter = (k: Kit, size: number, color: string) => k.icon({ w: size, h: size }, 'strength', color);

/** Brand lockup left, link right, as one row: both are watermark layers, so the row just empties when the watermark is off. */
function cardFooter(k: Kit, story: boolean): LayerJson {
  const h = 56;
  return k.group({ x: 72, y: story ? 1510 : 952, w: 936, h }, [k.brand({ w: 'auto', h }, 'lockup', { size: h }), k.shape({ w: 'fill', h: 1 }, 'rect'), k.brand({ w: 'auto', h: 'auto' }, 'link', { size: 28 })], {
    dir: 'row',
    gap: 24,
    align: 'center',
  });
}

// ------------------------------------------------------------------------------------------------------------------ bold

function bold(canvas: Canvas) {
  const story = canvas === 'story';
  const k = kit(story ? 'bs' : 'bq');
  const S = story ? 96 : 76;
  const header = k.group(
    { w: 'fill', h: S },
    [
      k.group({ w: S, h: S }, [k.shape({ x: 0, y: 0, w: S, h: S }, 'ellipse', { fill: '$surfaceStrong' }), k.icon({ x: S * 0.25, y: S * 0.25, w: S * 0.5, h: S * 0.5 }, 'strength', '$fg')]),
      k.text({ w: 'fill' }, NAME, { size: story ? 44 : 38, weight: 800, upper: true, ls: 3, color: '$fg', minSize: 26 }),
      k.text({ w: 'auto' }, DATE, { size: 32, weight: 600, color: '$fgMuted', align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
  const heroBlock = k.group(
    { w: 'fill', h: 'auto' },
    [
      heroGroup(k, { size: story ? 400 : 260, unitSize: story ? 96 : 72, minSize: 140, color: '$accent', labelColor: '$fgMuted', labelSize: 30, gap: story ? 20 : 12 }),
      prChip(k, { color: '$accent', size: story ? 34 : 30 }),
    ],
    { dir: 'column', gap: story ? 28 : 20, align: 'stretch' },
  );
  const list = topList(k, { size: story ? 42 : 36, color: '$fg', loadColor: '$accent', gap: story ? 14 : 12 });
  const stats = statsRow(k, { size: story ? 72 : 56, labelSize: 26, color: '$fg', labelColor: '$fgMuted', unitSize: 30, when: story ? undefined : lacks(topEx(0)) });
  const root = k.group({ x: 72, y: story ? 250 : 72, w: 936, h: story ? 1190 : 856 }, [header, spacer(k), heroBlock, spacer(k), list, stats], {
    dir: 'column',
    gap: story ? 28 : 20,
    align: 'stretch',
  });
  return template({
    id: `strength.bold.${canvas}`,
    name: `Strength, bold, ${canvas}`,
    titleKey: 'stickers:tpl.strength.bold',
    kind: 'strength',
    style: 'bold',
    aspect: canvas,
    background: { kind: 'color', color: '$bg' },
    dark: VOLT.dark,
    light: VOLT.light,
    layers: [root, cardFooter(k, story)],
    meta: { tags: ['numbers', 'volume'] },
  });
}

// ---------------------------------------------------------------------------------------------------------------- poster

function poster(canvas: Canvas) {
  const story = canvas === 'story';
  const k = kit(story ? 'ps' : 'pq');
  const meta = { size: 30, weight: 700, ls: 3, upper: true, color: '$fgMuted' } as const;
  const kicker = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.text({ w: 'fill' }, '{strength.startedAt|date:long}', meta),
      k.text({ w: 'auto' }, tl('tpl.strength.text.exercises', { count: '{strength.exercises}' }), { ...meta, align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
  const headline = k.text({ w: 'fill' }, NAME, { size: story ? 118 : 84, weight: 800, lh: 1.02, ls: -2, color: '$fg', fit: 'wrap', maxLines: story ? 3 : 2 });
  const top = k.group(
    { w: 'fill', h: 'auto' },
    [kicker, k.shape({ w: 'fill', h: 6 }, 'line', { stroke: { color: '$fg', width: 6 } }), headline],
    { dir: 'column', gap: story ? 28 : 20, align: 'stretch' },
  );
  const heroBlock = k.group(
    { w: 'fill', h: 'auto' },
    [heroGroup(k, { size: story ? 340 : 230, unitSize: story ? 90 : 64, minSize: 120, color: '$accent', labelColor: '$fgMuted', labelSize: 30, gap: 16 })],
    { dir: 'column' },
  );
  const list = topList(k, {
    size: story ? 40 : 34,
    color: '$fg',
    loadColor: '$fg',
    gap: story ? 14 : 10,
    rule: '$line',
    index: { size: story ? 34 : 30, color: '$accent', width: story ? 56 : 48 },
  });
  const root = k.group({ x: 72, y: story ? 250 : 72, w: 936, h: story ? 1190 : 856 }, [top, spacer(k), heroBlock, prChip(k, { color: '$accent', size: 32 }), spacer(k), list], {
    dir: 'column',
    gap: story ? 28 : 18,
    align: 'stretch',
  });
  return template({
    id: `strength.poster.${canvas}`,
    name: `Strength, poster, ${canvas}`,
    titleKey: 'stickers:tpl.strength.poster',
    kind: 'strength',
    style: 'poster',
    aspect: canvas,
    background: { kind: 'color', color: '$bg' },
    dark: PAPER.dark,
    light: PAPER.light,
    layers: [root, cardFooter(k, story)],
    meta: { tags: ['editorial', 'volume'] },
  });
}

// --------------------------------------------------------------------------------------------------------------- minimal

function minimal(canvas: Canvas) {
  const story = canvas === 'story';
  const k = kit(story ? 'ms' : 'mq');
  const header = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.text({ w: 'fill' }, NAME, { size: story ? 42 : 36, weight: 700, color: '$fgSoft', minSize: 26 }),
      k.text({ w: 'auto' }, DATE, { size: 30, weight: 600, color: '$fgMuted', align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
  const block = k.group(
    { w: 'fill', h: 'auto' },
    [
      heroGroup(k, { size: story ? 260 : 190, unitSize: story ? 72 : 56, minSize: 100, color: '$fg', weight: 700, labelColor: '$fgMuted', labelSize: 30, gap: 18 }),
      prChip(k, { color: '$accent', size: 32, outline: false }),
      topList(k, { limit: 3, size: story ? 40 : 34, color: '$fgSoft', loadColor: '$accent', gap: story ? 16 : 12 }),
      statsRow(k, { size: story ? 56 : 46, labelSize: 26, color: '$fg', labelColor: '$fgMuted', unitSize: 26, when: story ? undefined : lacks(topEx(0)) }),
    ],
    { dir: 'column', gap: story ? 44 : 30, align: 'stretch' },
  );
  const root = k.group({ x: 72, y: story ? 250 : 72, w: 936, h: story ? 1190 : 856 }, [header, spacer(k), block], { dir: 'column', gap: 28, align: 'stretch' });
  return template({
    id: `strength.minimal.${canvas}`,
    name: `Strength, minimal, ${canvas}`,
    titleKey: 'stickers:tpl.strength.minimal',
    kind: 'strength',
    style: 'minimal',
    aspect: canvas,
    background: { kind: 'color', color: '$bg' },
    dark: INK.dark,
    light: INK.light,
    layers: [root, cardFooter(k, story)],
    meta: { tags: ['quiet', 'volume'] },
  });
}

// ---------------------------------------------------------------------------------------------------------------- muscle

/**
 * The heat colors of `strength.muscleColors` are made for a dark field (#2B3A3F cold to #D4FF3A hot), so the bars always sit on a
 * deep-teal panel, in both modes. The muscle names are text layers outside the panel (ink on the page), so no label has to be
 * light-on-dark over a light card.
 */
const MUSCLE_PALETTE: Palette = {
  dark: { ...INK.dark, surfaceStrong: INK.dark.bg2 },
  light: { ...INK.light, surfaceStrong: INK.dark.bg2 },
};

function muscle(canvas: Canvas) {
  const story = canvas === 'story';
  const k = kit(story ? 'us' : 'uq');
  const bh = story ? 64 : 44;
  const gap = 16;
  const pad = 24;
  const labelW = story ? 250 : 220;
  const sets = (i: number) => `strength.muscleSets.${i}`;
  const header = k.group(
    { w: 'fill', h: 'auto' },
    [
      lifter(k, story ? 48 : 40, '$accent'),
      k.text({ w: 'fill' }, NAME, { size: story ? 40 : 34, weight: 800, upper: true, ls: 3, color: '$fg', minSize: 26 }),
      k.text({ w: 'auto' }, DATE, { size: 30, weight: 600, color: '$fgMuted', align: 'right' }),
    ],
    { dir: 'row', gap: 20, align: 'center' },
  );
  const rpe = story ? 200 : 150;
  const ring = k.group(
    { w: rpe, h: rpe },
    [
      k.ring({ x: 0, y: 0, w: rpe, h: rpe }, { progress: { bind: 'strength.avgRpe', div: 10 }, thickness: story ? 22 : 18, track: '$line', color: '$accent', cap: 'round', startAngle: 135, sweep: 270 }),
      k.stat({ x: 0, y: story ? 58 : 42, w: rpe }, '{strength.avgRpe|num:1}', {
        size: story ? 64 : 48,
        weight: 800,
        color: '$fg',
        align: 'center',
        label: tl('tpl.strength.text.rpe'),
        labelSize: 26,
        labelColor: '$fgMuted',
        labelPos: 'below',
        gap: 8,
      }),
    ],
    { when: has('strength.avgRpe') },
  );
  const heroRow = k.group(
    { w: 'fill', h: 'auto' },
    [
      heroGroup(k, { size: story ? 210 : 160, unitSize: story ? 64 : 48, minSize: 90, color: '$accent', labelColor: '$fgMuted', labelSize: 30, gap: 14 }),
      ring,
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
  // One chart per number of groups: the bars keep one height, so the panel grows with the data instead of stretching three fat bars.
  const charts = Array.from({ length: 8 }, (_, i) => {
    const n = i + 1;
    return k.chart(
      { w: 'fill', h: n * bh + (n - 1) * gap },
      { kind: 'bars', series: { bind: 'strength.muscleSets' }, colors: { bind: 'strength.muscleColors' }, horizontal: true, showLabels: false, barRadius: 14, color: '$accent' },
      { when: n < 8 ? all(has(sets(n - 1)), lacks(sets(n))) : has(sets(7)) },
    );
  });
  const panel = k.group({ w: 'fill', h: 'auto' }, charts, { dir: 'column', padding: pad, fill: '$surfaceStrong', radius: 36 });
  const labels = k.group(
    { w: labelW, h: 'auto' },
    [
      k.shape({ w: 1, h: pad - gap }, 'rect'),
      ...Array.from({ length: 8 }, (_, i) =>
        k.text({ w: labelW, h: bh }, `{strength.muscleLabels.${i}}`, { size: story ? 32 : 28, weight: 700, color: '$fg', valign: 'middle', minSize: 24 }),
      ),
    ],
    { dir: 'column', gap },
  );
  const board = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.text({ w: 'fill' }, tl('tpl.strength.text.muscleLoad'), { size: 28, weight: 700, ls: 3, upper: true, color: '$fgMuted' }),
      k.group({ w: 'fill', h: 'auto' }, [labels, panel], { dir: 'row', gap: 16, align: 'start' }),
    ],
    { dir: 'column', gap: 24, align: 'stretch', when: has(sets(0)) },
  );
  const noMuscles = lacks(sets(0));
  const fallback = topList(k, { limit: story ? 3 : 2, size: story ? 40 : 34, color: '$fg', loadColor: '$accent', gap: 14, when: noMuscles });
  const stats = story ? statsRow(k, { size: 60, labelSize: 26, color: '$fg', labelColor: '$fgMuted', unitSize: 28 }) : undefined;
  const root = k.group(
    { x: 72, y: story ? 250 : 72, w: 936, h: story ? 1190 : 856 },
    [header, spacer(k), heroRow, spacer(k), board, fallback, ...(stats ? [stats] : [])],
    { dir: 'column', gap: story ? 30 : 24, align: 'stretch' },
  );
  return template({
    id: `strength.muscle.${canvas}`,
    name: `Strength, muscle load, ${canvas}`,
    titleKey: 'stickers:tpl.strength.muscle',
    kind: 'strength',
    style: 'ring',
    aspect: canvas,
    background: { kind: 'color', color: '$bg' },
    dark: MUSCLE_PALETTE.dark,
    light: MUSCLE_PALETTE.light,
    layers: [root, cardFooter(k, story)],
    meta: { tags: ['muscles', 'chart'] },
  });
}

// ------------------------------------------------------------------------------------------------------------------ photo

function photo(canvas: Canvas) {
  const story = canvas === 'story';
  const k = kit(story ? 'hs' : 'hq');
  const kicker = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.text({ w: 'fill' }, NAME, { size: story ? 38 : 34, weight: 800, upper: true, ls: 3, color: '$fg', minSize: 26 }),
      k.text({ w: 'auto' }, DATE, { size: 30, weight: 600, color: '$fgSoft', align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
  const root = k.group(
    { x: 72, y: story ? 250 : 72, w: 936, h: story ? 1230 : 856 },
    [
      spacer(k),
      kicker,
      heroGroup(k, { size: story ? 330 : 230, unitSize: story ? 84 : 60, minSize: 110, color: '$fg', labelColor: '$fgSoft', labelSize: 30, gap: 14 }),
      prChip(k, { color: '$accent', size: story ? 34 : 30 }),
      topList(k, { limit: story ? 5 : 3, size: story ? 40 : 34, color: '$fg', loadColor: '$accent', gap: story ? 14 : 10, rule: '$fg/35' }),
    ],
    { dir: 'column', gap: story ? 30 : 22, align: 'stretch', justify: 'end' },
  );
  return template({
    id: `strength.photo.${canvas}`,
    name: `Strength, photo, ${canvas}`,
    titleKey: 'stickers:tpl.strength.photo',
    kind: 'strength',
    style: 'photo',
    aspect: canvas,
    background: {
      kind: 'photo',
      bind: 'photo',
      fit: 'cover',
      tint: { color: '$bg', opacity: 0.22 },
      scrim: { side: 'bottom', color: '$bg', opacity: 0.96, from: story ? 0.2 : 0.28 },
      fallback: { kind: 'gradient', angle: 160, stops: [{ at: 0, color: '$bg2' }, { at: 1, color: '$bg' }] },
    },
    dark: GLASS.dark,
    light: GLASS.light,
    layers: [root, cardFooter(k, story)],
    meta: { needsPhoto: true, tags: ['photo', 'volume'] },
  });
}

// ----------------------------------------------------------------------------------------------------------------- receipt

/** `exercise ........ load`: the dots are a dashed round-capped line at the baseline, between the two texts. */
function leaderRow(k: Kit, o: { left: string | { t: string }; right: string; size: number; weight?: number; maxLeft?: number; when?: Cond; upper?: boolean }): LayerJson {
  const lineH = Math.round(o.size * 1.15);
  const dotsY = Math.round(o.size * 0.9);
  return k.group(
    { w: 'fill', h: lineH },
    [
      k.text({ w: 'auto' }, o.left, { font: 'mono', size: o.size, weight: o.weight ?? 500, color: '$fg', upper: o.upper }),
      k.shape({ w: 'fill', h: dotsY * 2 }, 'line', { stroke: { color: '$fgMuted', width: 3, dash: [1, 9] } }),
      k.text({ w: 'auto' }, o.right, { font: 'mono', size: o.size, weight: 700, color: '$fg' }),
    ],
    { dir: 'row', gap: 12, align: 'start', when: o.when },
  );
}

/** A deterministic barcode: bars 3, 6 or 9 px wide with 3 or 6 px gaps, 840 x 96. */
function barcodePath(width: number, height: number): string {
  let d = '';
  let x = 0;
  let r = 7;
  while (x < width - 12) {
    r = (r * 73 + 41) % 997;
    const bar = 3 + (r % 3) * 3;
    const gap = 3 + ((r >> 2) % 2) * 3;
    if (x + bar > width) break;
    d += `M${x} 0h${bar}v${height}h-${bar}z`;
    x += bar + gap;
  }
  return d;
}

function zigzag(width: number, tooth: number, rise: number, up: boolean): string {
  let d = up ? `M0 ${rise}` : 'M0 0';
  for (let x = 0; x < width; x += tooth) d += up ? `L${x + tooth / 2} 0L${x + tooth} ${rise}` : `L${x + tooth / 2} ${rise}L${x + tooth} 0`;
  return `${d}Z`;
}

function receipt() {
  const k = kit('rc');
  const W = 936;
  const H = 1260;
  const RISE = 20;
  const dashed = (when?: Cond) => k.shape({ w: 'fill', h: 3 }, 'line', { stroke: { color: '$fgMuted', width: 3, dash: [14, 10] } }, { when });
  const rows: LayerJson[] = Array.from({ length: 5 }, (_, i) =>
    leaderRow(k, { left: `{${topEx(i)}|ellipsis:27}`, right: `{${topLoad(i)}|ellipsis:16}`, size: 30, when: has(topEx(i)) }),
  );
  const totals: LayerJson[] = [
    leaderRow(k, { left: tl('label.volume'), right: `{${VOL}|int} ${UNIT}`, size: 36, weight: 700, upper: true, when: has(VOL) }),
    leaderRow(k, { left: tl('label.sets'), right: `{${SETS}|int}`, size: 30, upper: true, when: has(SETS) }),
    leaderRow(k, { left: tl('label.reps'), right: `{${REPS}|int}`, size: 30, upper: true, when: has(REPS) }),
    leaderRow(k, { left: tl('label.hold'), right: `{${SECS}|dur}`, size: 30, upper: true, when: has(SECS) }),
    leaderRow(k, { left: tl('label.duration'), right: `{${DUR}|durhm}`, size: 30, upper: true, when: has(DUR) }),
    leaderRow(k, { left: tl('tpl.strength.text.pr'), right: `{${PR}|int}`, size: 30, weight: 700, when: has(PR) }),
  ];
  const body = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.text({ w: 'fill' }, NAME, { font: 'mono', size: 38, weight: 700, upper: true, align: 'center', color: '$fg', fit: 'wrap', maxLines: 2, lh: 1.2 }),
      k.text({ w: 'fill' }, DATE, { font: 'mono', size: 28, weight: 500, align: 'center', color: '$fgMuted' }),
      dashed(),
      k.text({ w: 'fill' }, tl('tpl.strength.text.topSets'), { font: 'mono', size: 26, weight: 700, upper: true, ls: 3, align: 'center', color: '$fgMuted', when: has(topEx(0)) }),
      ...rows,
      dashed(has(topEx(0))),
      ...totals,
      dashed(),
      k.shape({ w: 'fill', h: 96 }, 'path', { d: barcodePath(840, 96), viewBox: [840, 96], fill: '$fg' }),
      k.text({ w: 'fill' }, tl('tpl.strength.text.thanks'), { font: 'mono', size: 26, weight: 500, align: 'center', color: '$fgMuted', fit: 'wrap', maxLines: 2 }),
      k.group({ w: 'fill', h: 'auto' }, [k.brand({ w: 'auto', h: 'auto' }, 'lockup', { size: 44 }), k.brand({ w: 'auto', h: 'auto' }, 'link', { size: 28 })], {
        dir: 'column',
        gap: 8,
        align: 'center',
      }),
    ],
    { dir: 'column', gap: 18, align: 'stretch', padding: 48, fill: '$bg' },
  );
  const strip = (up: boolean) => k.shape({ w: 'fill', h: RISE }, 'path', { d: zigzag(W, 24, RISE, up), viewBox: [W, RISE], fill: '$bg' });
  const root = k.group({ x: 72, y: 40, w: W, h: H - 80 }, [strip(true), body, strip(false)], { dir: 'column', gap: 0, align: 'stretch', justify: 'center' });
  return template({
    id: 'strength.receipt.sticker',
    name: 'Strength, receipt, sticker',
    titleKey: 'stickers:tpl.strength.receipt',
    kind: 'strength',
    style: 'receipt',
    aspect: 'free',
    height: H,
    background: { kind: 'transparent' },
    dark: PAPER.dark,
    light: PAPER.light,
    layers: [root],
    meta: { transparent: true, tags: ['receipt', 'mono'] },
  });
}

// ----------------------------------------------------------------------------------------------------------- stats sticker

function statsSticker() {
  const k = kit('ss');
  const H = 820;
  const label = (key: string, when: Cond) =>
    k.text({ w: 'fill' }, tl(key), { size: 30, weight: 700, ls: 4, upper: true, color: '$fg', align: 'center', shadow: true, when });
  const heroBlock = k.group(
    { w: 'fill', h: 'auto' },
    [
      label('label.volume', heroVol),
      label('label.reps', heroReps),
      label('label.hold', heroSecs),
      label('label.duration', heroDur),
      ...hero(k, { size: 220, unitSize: 80, minSize: 110, color: '$fg', labelColor: '$fg', labelSize: 30, align: 'center', shadow: true, labelPos: 'none' }),
    ],
    { dir: 'column', gap: 16, align: 'stretch' },
  );
  const trophy = (color: string, dy: number, opacity?: number) => k.icon({ x: 0, y: dy, w: 56, h: 56 }, 'trophy', color, opacity === undefined ? {} : { opacity });
  const pr = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.group({ w: 56, h: 56 }, [trophy('#000000', 3, 0.35), trophy('$accent', 0)]),
      k.text({ w: 'auto' }, prText(), { size: 40, weight: 800, color: '$accent', shadow: true }),
    ],
    { dir: 'row', gap: 14, align: 'center', justify: 'center', when: has(PR) },
  );
  const list = topList(k, { limit: 3, size: 36, color: '$fgSoft', loadColor: '$fg', gap: 14, shadow: true });
  const root = k.group(
    { x: 90, y: 40, w: 900, h: H - 80 },
    [
      k.text({ w: 'fill' }, NAME, { size: 40, weight: 700, upper: true, ls: 3, color: '$fgSoft', align: 'center', shadow: true, minSize: 26 }),
      heroBlock,
      pr,
      list,
      k.brand({ w: 'auto', h: 'auto' }, 'lockup', { size: 44 }),
    ],
    { dir: 'column', gap: 28, align: 'center', justify: 'center' },
  );
  return template({
    id: 'strength.stats.sticker',
    name: 'Strength, stats, sticker',
    titleKey: 'stickers:tpl.strength.stats',
    kind: 'strength',
    style: 'sticker',
    aspect: 'free',
    height: H,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers: [root],
    meta: { transparent: true, tags: ['sticker', 'volume'] },
  });
}

export const STRENGTH_TEMPLATES = [
  bold('story'),
  bold('square'),
  poster('story'),
  poster('square'),
  minimal('story'),
  minimal('square'),
  muscle('story'),
  muscle('square'),
  photo('story'),
  photo('square'),
  receipt(),
  statsSticker(),
];
