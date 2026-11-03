/**
 * `run.tape`, `run.column`, `run.track`, `run.lanes`, `run.swoosh`: transparent overlays for the person's own photo, each in a
 * Story (1080 x 1920) and a Square (1080 x 1080) canvas. The overlay is exported as a PNG with nothing behind the type, so the
 * person lays it over any picture (Instagram's sticker layer, or their gallery editor); the sheet draws it on a checker.
 *
 * Numbers follow the sport family like every `run` card: the distance reads in km (metres for a swim), the effort is a pace per
 * km, a pace per 100 m or a speed, and a workout without a distance (gym, yoga, a class) puts its duration in the hero and
 * its heart rate and calories in the secondary slots. A number the workout lacks is left out and the layout closes up.
 *
 * Colors: one bright `$accent` per template (the sticker accent, the same amber as the app's Classic hero); the rest is `$fg`.
 * Every template reads its colors from the theme tokens only. The engine has no user-chosen accent option (`StickerOptions` is
 * shared with JoyoRogo and has none), so the accent is not picked per share yet.
 */
import { all, any, has, is, lacks, not, tl } from './blocks';
import { kit, template } from './dsl';
import type { Cond, Dim, Kit, LayerJson } from './dsl';
import { STICKER } from './palette';

type Canvas = 'story' | 'square';

const HEIGHT: Record<Canvas, number> = { story: 1920, square: 1080 };

// ----------------------------------------------------------------------------------------------------------- numbers

interface Cell {
  bind: string;
  value: string;
  label: string;
  unit?: string;
  when?: Cond;
}

const SWIM = is('run.category', 'swim');
const NO_DISTANCE = lacks('run.distanceM');
const NO_EFFORT = all(lacks('run.paceSecKm'), lacks('run.pace100Sec'), lacks('run.speedKmh'));

const CELL = {
  distKm: { bind: 'run.distanceM', value: '{run.distanceM|km}', label: 'label.distance', unit: 'unit.km', when: all(has('run.distanceM'), not(SWIM)) },
  distM: { bind: 'run.distanceM', value: '{run.distanceM|int}', label: 'label.distance', unit: 'unit.m', when: all(has('run.distanceM'), SWIM) },
  duration: { bind: 'run.movingSec', value: '{run.movingSec|dur}', label: 'label.duration' },
  pace: { bind: 'run.paceSecKm', value: '{run.paceSecKm|pace}', label: 'label.avgPace', unit: 'unit.perKm' },
  pace100: { bind: 'run.pace100Sec', value: '{run.pace100Sec|pace}', label: 'label.avgPace', unit: 'unit.per100m' },
  speed: { bind: 'run.speedKmh', value: '{run.speedKmh|num:1}', label: 'label.avgSpeed', unit: 'unit.kmh' },
  hr: { bind: 'run.hrAvg', value: '{run.hrAvg|int}', label: 'label.avgHrShort', unit: 'unit.bpm' },
  cadenceSpm: { bind: 'run.cadence', value: '{run.cadence|int}', label: 'label.cadence', unit: 'unit.spm', when: all(has('run.cadence'), not(is('run.category', 'ride'))) },
  cadenceRpm: { bind: 'run.cadence', value: '{run.cadence|int}', label: 'label.cadence', unit: 'unit.rpm', when: all(has('run.cadence'), is('run.category', 'ride')) },
  kcal: { bind: 'run.kcal', value: '{run.kcal|int}', label: 'label.kcal', unit: 'unit.kcal' },
} satisfies Record<string, Cell>;

const cellWhen = (cell: Cell): Cond =>
  cell.when ? all(lacks('run._custom'), cell.when) : all(lacks('run._custom'), has(cell.bind));

/** The big number: the distance, else the duration. */
const HERO: Cell[] = [CELL.distKm, CELL.distM, { ...CELL.duration, when: NO_DISTANCE }];

/** The sport's pace per km, its pace per 100 m or its speed: only one of them exists. */
const EFFORT: Cell[] = [CELL.pace, CELL.pace100, CELL.speed];

/**
 * The two secondary slots. With a distance the hero is the distance and the slots read duration and pace/speed; without one
 * the hero is the duration, and the slots fall back to calories and the average heart rate (a gym session, a yoga class).
 */
const LEFT: Cell[] = [{ ...CELL.duration, when: has('run.distanceM') }, { ...CELL.kcal, when: all(NO_DISTANCE, has('run.kcal')) }];
const RIGHT: Cell[] = [...EFFORT, { ...CELL.hr, when: all(NO_EFFORT, has('run.hrAvg')) }];

interface StatLook {
  w?: Dim;
  size: number;
  unitSize: number;
  labelSize: number;
  align?: 'left' | 'center' | 'right';
  color?: string;
  labelColor?: string;
  gap?: number;
  minSize?: number;
}

/** A label over a big number with its unit, in white with a soft shadow so it holds on a photo. */
function cellStat(k: Kit, cell: Cell, o: StatLook): LayerJson {
  return k.stat({ w: o.w ?? 'auto', h: 'auto' }, cell.value, {
    unit: cell.unit ? tl(cell.unit) : undefined,
    label: tl(cell.label),
    size: o.size,
    unitSize: o.unitSize,
    labelSize: o.labelSize,
    weight: 800,
    align: o.align,
    color: o.color ?? '$fg',
    labelColor: o.labelColor ?? '$fgSoft',
    labelPos: 'above',
    gap: o.gap ?? 10,
    shadow: true,
    minSize: o.minSize ?? 40,
    when: cellWhen(cell),
  });
}

function customSlotCell(k: Kit, i: 1 | 2 | 3 | 4, o: StatLook): LayerJson {
  return k.stat({ w: o.w ?? 'auto', h: 'auto' }, `{run.slot${i}Val}`, {
    unit: `{run.slot${i}Unit?}`,
    label: `{run.slot${i}Label?}`,
    size: o.size,
    unitSize: o.unitSize,
    labelSize: o.labelSize,
    weight: 800,
    align: o.align,
    color: o.color ?? '$fg',
    labelColor: o.labelColor ?? '$fgSoft',
    labelPos: 'above',
    gap: o.gap ?? 10,
    shadow: true,
    minSize: o.minSize ?? 40,
    when: has(`run.slot${i}Val`),
  });
}

function customHeroStat(k: Kit, o: StatLook, box: { x?: number; y?: number; w?: Dim } = {}): LayerJson {
  return k.stat({ x: box.x, y: box.y, w: box.w ?? o.w ?? 'fill', h: 'auto' }, '{run.heroVal}', {
    unit: '{run.heroUnit?}',
    label: '{run.heroLabel?}',
    size: o.size,
    unitSize: o.unitSize,
    labelSize: o.labelSize,
    weight: 800,
    align: o.align,
    color: o.color ?? '$fg',
    labelColor: o.labelColor ?? '$fgSoft',
    labelPos: 'above',
    gap: o.gap ?? 14,
    shadow: true,
    minSize: o.minSize ?? 90,
    when: has('run._custom'),
  });
}

/** Every variant of a slot in one group; exactly one passes its `when`, so the group is as big as that stat (or absent). */
function slot(k: Kit, cells: Cell[], o: StatLook, box: { x?: number; y?: number; w?: Dim } = {}, customSlotIdx?: 1 | 2): LayerJson {
  const w = box.w === undefined ? 'auto' : 'fill';
  const custom = customSlotIdx ? [customSlotCell(k, customSlotIdx, { ...o, w })] : [];
  return k.group(
    { x: box.x, y: box.y, w: box.w ?? 'auto', h: 'auto' },
    [...custom, ...cells.map((cell) => cellStat(k, cell, { ...o, w }))],
    { dir: 'column', align: o.align === 'right' ? 'end' : 'start' },
  );
}

/** The route as a thin outline with a dark underlay, so it reads on a bright photo as well as a dark one. */
function routeLine(k: Kit, box: { x?: number; y?: number; w: number; h: number }, width: number, markers = true): LayerJson[] {
  const when = has('run.route');
  return [
    k.route(box, { color: '$bg/45', strokeWidth: width + 6, padding: 28 }, { when }),
    k.route(box, { color: '$fg', strokeWidth: width, padding: 28, markers }, { when }),
  ];
}

const lockup = (k: Kit, x: number, y: number, size = 44) => k.brand({ x, y, w: 'auto', h: size }, 'lockup', { size });

interface Frame {
  canvas: Canvas;
  H: number;
  story: boolean;
  /** Side margin. */
  pad: number;
  /** First y a story keeps clear of Instagram's header (the square has no header). */
  top: number;
  /** Last y a story keeps clear of Instagram's reply bar. */
  bottom: number;
  /** Width between the margins. */
  W: number;
}

function frame(canvas: Canvas): Frame {
  const story = canvas === 'story';
  const pad = story ? 64 : 56;
  return { canvas, H: HEIGHT[canvas], story, pad, top: story ? 250 : pad, bottom: story ? 1580 : 1080 - pad, W: 1080 - pad * 2 };
}

/** The overlay shell: a transparent template with the sticker palette. */
function overlay(f: Frame, id: string, titleKey: string, name: string, layers: LayerJson[], tags: string[]) {
  return template({
    id: `run.${id}.${f.canvas}`,
    name: `Run, ${name} overlay, ${f.canvas}`,
    titleKey: `stickers:tpl.run.${titleKey}`,
    kind: 'run',
    style: 'sticker',
    aspect: f.canvas,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers,
    constraints: { maxLayers: 80 },
    meta: { transparent: true, tags: ['overlay', ...tags] },
  });
}

// ---------------------------------------------------------------------------------------------------------- run.tape

/** One line of a band: LABEL, value, unit, all caps, in the ink that reads on the accent. */
function bandRow(k: Kit, cell: Cell, o: { size: number; unit: number; gap: number }): LayerJson {
  const ink = '$bg';
  return k.group(
    { w: 'auto', h: 'auto' },
    [
      k.text({ w: 'auto' }, tl(cell.label), { size: o.size, weight: 800, upper: true, ls: 2, color: ink, trim: true }),
      k.group(
        { w: 'auto', h: 'auto' },
        [
          k.text({ w: 'auto' }, cell.value, { size: o.size, weight: 800, color: ink, trim: true }),
          ...(cell.unit ? [k.text({ w: 'auto' }, tl(cell.unit), { size: o.unit, weight: 800, upper: true, ls: 1, color: ink, trim: true })] : []),
        ],
        { dir: 'row', gap: 12, align: 'end' },
      ),
    ],
    { dir: 'row', gap: o.gap, align: 'end', when: cellWhen(cell) },
  );
}

function slotBandRow(k: Kit, i: 1 | 2, o: { size: number; unit: number; gap: number }): LayerJson {
  const ink = '$bg';
  return k.group(
    { w: 'auto', h: 'auto' },
    [
      k.text({ w: 'auto' }, `{run.slot${i}Label}`, { size: o.size, weight: 800, upper: true, ls: 2, color: ink, trim: true }),
      k.group(
        { w: 'auto', h: 'auto' },
        [
          k.text({ w: 'auto' }, `{run.slot${i}Val}`, { size: o.size, weight: 800, color: ink, trim: true }),
          k.text({ w: 'auto' }, `{run.slot${i}Unit}`, { size: o.unit, weight: 800, upper: true, ls: 1, color: ink, trim: true, when: has(`run.slot${i}Unit`) }),
        ],
        { dir: 'row', gap: 12, align: 'end' },
      ),
    ],
    { dir: 'row', gap: o.gap, align: 'end', when: has(`run.slot${i}Val`) },
  );
}

/** A tape: a full-bleed accent band tilted about the middle of the canvas, one line of text on it. */
function band(
  k: Kit,
  f: Frame,
  o: { cy: number; h: number; rotation: number; size: number; unit: number; cells: Cell[]; when: Cond },
  slotIdx?: 1 | 2,
): LayerJson {
  const bleed = 240;
  const width = 1080 + bleed * 2;
  const custom = slotIdx ? [slotBandRow(k, slotIdx, { size: o.size, unit: o.unit, gap: 36 })] : [];
  return k.group(
    { x: -bleed, y: o.cy - o.h / 2, w: width, h: o.h },
    [
      k.shape({ x: 0, y: 10, w: width, h: o.h }, 'rect', { fill: '#00000040' }),
      k.shape({ x: 0, y: 0, w: width, h: o.h }, 'rect', { fill: '$accent' }),
      k.group(
        { x: bleed + f.pad, y: 0, w: f.W, h: o.h },
        [...custom, ...o.cells.map((cell) => bandRow(k, cell, { size: o.size, unit: o.unit, gap: 36 }))],
        { dir: 'row', align: 'center' },
      ),
    ],
    // A band with nothing to say is not drawn: the group carries a fill child, so its own `when` has to say so.
    { rotation: o.rotation, when: o.when },
  );
}

/**
 * `run.tape`: the duration as a giant number across the top, the route as a thin line on the right, and two accent tapes
 * crossing the lower half, one carrying the average pace (or speed), the other the distance. A workout without those falls back
 * to its heart rate and calories, so the tapes never hold a blank.
 */
function runTape(canvas: Canvas) {
  const f = frame(canvas);
  const k = kit('tp');
  const m = f.story
    ? { hero: 270, label: 38, gap: 22, top: 280, route: { x: 520, y: 700, w: 496, h: 400 }, h: 128, size: 50, unit: 32, one: { cy: 1150, rotation: 3.5 }, two: { cy: 1420, rotation: -6 }, logo: 1520 }
    : { hero: 210, label: 32, gap: 18, top: 70, route: { x: 600, y: 310, w: 424, h: 300 }, h: 104, size: 40, unit: 26, one: { cy: 640, rotation: 3 }, two: { cy: 850, rotation: -5 }, logo: 990 };
  const heroCustom = customHeroStat(k, { size: m.hero, unitSize: Math.round(m.hero * 0.35), labelSize: m.label, align: 'center', gap: m.gap, minSize: 120 }, { x: f.pad, y: m.top, w: f.W });
  const heroDefault = k.stat({ x: f.pad, y: m.top, w: f.W, h: 'auto' }, CELL.duration.value, {
    label: tl(CELL.duration.label),
    size: m.hero,
    labelSize: m.label,
    weight: 800,
    align: 'center',
    color: '$fg',
    labelColor: '$fgSoft',
    labelPos: 'above',
    gap: m.gap,
    shadow: true,
    minSize: 120,
    when: lacks('run._custom'),
  });
  const effortCells = [...EFFORT, { ...CELL.hr, when: all(NO_EFFORT, has('run.hrAvg')) }];
  const effort = {
    ...m.one,
    h: m.h,
    size: m.size,
    unit: m.unit,
    cells: effortCells,
    when: any(has('run.slot1Val'), all(lacks('run._custom'), any(has('run.paceSecKm'), has('run.pace100Sec'), has('run.speedKmh'), has('run.hrAvg')))),
  };
  const distCells = [CELL.distKm, CELL.distM, { ...CELL.kcal, when: all(NO_DISTANCE, has('run.kcal')) }];
  const distance = {
    ...m.two,
    h: m.h,
    size: m.size,
    unit: m.unit,
    cells: distCells,
    when: any(has('run.slot2Val'), all(lacks('run._custom'), any(has('run.distanceM'), has('run.kcal')))),
  };
  return overlay(
    f,
    'tape',
    'tape',
    'tape',
    [heroCustom, heroDefault, ...routeLine(k, m.route, 8), band(k, f, effort, 1), band(k, f, distance, 2), k.group({ x: f.pad, y: m.logo, w: f.W, h: 44 }, [lockup(k, 0, 0)], { dir: 'row', justify: 'center' })],
    ['tape'],
  );
}

/**
 * `run.column`: small label over a big value, stacked down the right edge (distance, duration, pace or speed, heart rate,
 * cadence), the route small at the bottom left and the wordmark standing up the left edge. Each number has a short accent rail
 * on its right edge.
 */
function runColumn(canvas: Canvas) {
  const f = frame(canvas);
  const k = kit('cl');
  const m = f.story
    ? { w: 560, value: 80, unit: 32, label: 30, gap: 40, route: 300, word: 56 }
    : { w: 520, value: 68, unit: 28, label: 28, gap: 26, route: 250, word: 48 };
  const look: StatLook = { w: 'fill', size: m.value, unitSize: m.unit, labelSize: m.label, align: 'right', gap: 8, minSize: 48 };
  // Each number is a row of the stat and an accent rail the stat's height: the rail is stretched to the row by `align`.
  const item = (cell: Cell) =>
    k.group({ w: 'fill', h: 'auto' }, [cellStat(k, cell, look), k.shape({ w: 8, h: 'auto' }, 'rect', { fill: '$accent', radius: 4 })], { dir: 'row', gap: 22, align: 'stretch', when: cellWhen(cell) });
  const customHeroItem = k.group(
    { w: 'fill', h: 'auto' },
    [customHeroStat(k, look), k.shape({ w: 8, h: 'auto' }, 'rect', { fill: '$accent', radius: 4 })],
    { dir: 'row', gap: 22, align: 'stretch', when: has('run._custom') },
  );
  const customSlotItem = (i: 1 | 2 | 3 | 4) =>
    k.group(
      { w: 'fill', h: 'auto' },
      [customSlotCell(k, i, look), k.shape({ w: 8, h: 'auto' }, 'rect', { fill: '$accent', radius: 4 })],
      { dir: 'row', gap: 22, align: 'stretch', when: has(`run.slot${i}Val`) },
    );
  const items: LayerJson[] = [
    customHeroItem,
    ...([1, 2, 3, 4] as const).map(customSlotItem),
    ...[CELL.distKm, CELL.distM, CELL.duration].map(item),
    ...EFFORT.map(item),
    item(CELL.hr),
    ...[CELL.cadenceSpm, CELL.cadenceRpm].map(item),
    item({ ...CELL.kcal, when: all(NO_DISTANCE, has('run.kcal')) }),
  ];
  const column = k.group({ x: 1080 - f.pad - m.w + 28, y: f.top, w: m.w, h: f.bottom - f.top }, items, { dir: 'column', gap: m.gap, align: 'end', justify: 'end' });
  // The wordmark stands on its left edge, reading upward: a fixed box centered on the point it should turn about.
  const wordW = 300;
  const standing = k.group({ x: f.pad + m.word * 0.36 - wordW / 2, y: f.top + wordW / 2, w: wordW, h: m.word }, [k.brand({ w: 'auto', h: 'auto' }, 'wordmark', { size: m.word })], {
    dir: 'row',
    justify: 'center',
    align: 'center',
    rotation: -90,
  });
  return overlay(f, 'column', 'column', 'stat column', [column, ...routeLine(k, { x: f.pad - 14, y: f.bottom - m.route, w: m.route, h: m.route }, 6), standing], ['column']);
}

/**
 * `run.track`: an athletics track, five thin lanes in a stadium oval around the big number, the duration and the pace (or
 * speed) at the two corners underneath. The accent is the innermost lane and the finish line across the lanes.
 */
function runTrack(canvas: Canvas) {
  const f = frame(canvas);
  const k = kit('tk');
  const m = f.story
    ? { x: 72, y: 640, w: 936, h: 580, lane: 27, hero: 200, unit: 70, label: 32, corner: 84, cornerUnit: 32, cornerLabel: 30, logo: 1500 }
    : { x: 64, y: 130, w: 952, h: 500, lane: 24, hero: 168, unit: 58, label: 28, corner: 66, cornerUnit: 28, cornerLabel: 26, logo: 960 };
  const lanes = [0, 1, 2, 3, 4].map((i) => ({ x: m.x + i * m.lane, y: m.y + i * m.lane, w: m.w - 2 * i * m.lane, h: m.h - 2 * i * m.lane }));
  const stadium = (stroke: { color: string; width: number }) => lanes.map((lane) => k.shape(lane, 'rect', { stroke, radius: lane.h / 2 }));
  const innerX = m.x + 4 * m.lane;
  const innerY = m.y + 4 * m.lane;
  const inner = { x: innerX, y: innerY, w: m.w - 8 * m.lane, h: m.h - 8 * m.lane };
  const heroLook: StatLook = { w: 'fill', size: m.hero, unitSize: m.unit, labelSize: m.label, align: 'center', gap: 14, minSize: 90 };
  const hero = k.group(
    inner,
    [
      customHeroStat(k, heroLook),
      ...HERO.map((cell) => cellStat(k, cell, heroLook)),
    ],
    { dir: 'column', align: 'center', justify: 'center' },
  );
  // The finish line: one accent bar across the five lanes of the top straight.
  const finish = k.shape({ x: m.x + m.w * 0.64, y: m.y - 5, w: 12, h: 4 * m.lane + 10 }, 'rect', { fill: '$accent' });
  const cornerY = m.y + m.h + (f.story ? 60 : 44);
  const corner = { size: m.corner, unitSize: m.cornerUnit, labelSize: m.cornerLabel };
  const left = slot(k, LEFT, { ...corner, align: 'left' }, { x: m.x, y: cornerY, w: 420 }, 1);
  const right = slot(k, RIGHT, { ...corner, align: 'right' }, { x: m.x + m.w - 420, y: cornerY, w: 420 }, 2);
  const innermost = lanes[4]!;
  const accentLane = k.shape(innermost, 'rect', { stroke: { color: '$accent', width: 8 }, radius: innermost.h / 2 });
  const layers = [...stadium({ color: '$bg/30', width: 11 }), ...stadium({ color: '$fg/95', width: 5 }), accentLane, finish, hero, left, right, lockup(k, f.pad, m.logo)];
  return overlay(f, 'track', 'track', 'track', layers, ['track']);
}

/** A lane: comes in from the right edge, turns a half circle about (cx, cy) and goes back out to the right edge. */
function lanePath(cx: number, cy: number, r: number): string {
  const edge = 1160;
  return `M${edge} ${cy - r}H${cx}A${r} ${r} 0 0 0 ${cx} ${cy + r}H${edge}`;
}

/**
 * `run.lanes`: lane lines sweeping in from the right and turning a bend, the big number top left with the duration and pace
 * underneath. The innermost lane is the accent.
 */
function runLanes(canvas: Canvas) {
  const f = frame(canvas);
  const k = kit('ln');
  const m = f.story
    ? { top: 290, hero: 230, unit: 78, label: 34, sub: 76, subUnit: 30, subLabel: 28, subGap: 64, gap: 64, cx: 430, cy: 1130, r0: 230, step: 36, stroke: 12, logo: 1530 }
    : { top: 70, hero: 190, unit: 64, label: 30, sub: 62, subUnit: 26, subLabel: 26, subGap: 52, gap: 44, cx: 370, cy: 740, r0: 150, step: 30, stroke: 11, logo: 1000 };
  const heroLook: StatLook = { w: 'fill', size: m.hero, unitSize: m.unit, labelSize: m.label, gap: 14, minSize: 100 };
  const text = k.group(
    { x: f.pad, y: m.top, w: f.W, h: 'auto' },
    [
      k.group({ w: f.W, h: 'auto' }, [customHeroStat(k, heroLook), ...HERO.map((cell) => cellStat(k, cell, heroLook))], { dir: 'column' }),
      k.group(
        { w: f.W, h: 'auto' },
        [slot(k, LEFT, { size: m.sub, unitSize: m.subUnit, labelSize: m.subLabel }, {}, 1), slot(k, RIGHT, { size: m.sub, unitSize: m.subUnit, labelSize: m.subLabel }, {}, 2)],
        { dir: 'row', gap: m.subGap, align: 'start' },
      ),
    ],
    { dir: 'column', gap: m.gap },
  );
  const lanes = [0, 1, 2, 3, 4].map((i) => {
    const d = lanePath(m.cx, m.cy, m.r0 + i * m.step);
    const box = { x: 0, y: 0, w: 1080, h: f.H };
    return k.shape(box, 'path', { d, viewBox: [1080, f.H], stroke: { color: i === 0 ? '$accent' : '$fg', width: m.stroke } }, { opacity: i === 0 ? 1 : 0.96 - i * 0.12 });
  });
  return overlay(f, 'lanes', 'lanes', 'lanes', [...lanes, text, lockup(k, f.pad, m.logo)], ['lanes']);
}

/** A ribbon of constant height `t`: flat at `y0` out to `xs`, then sweeping down to `y1` at the right edge. */
function ribbonPath(y0: number, y1: number, t: number, xs: number): string {
  const [a, b, c, d] = [y0 - t / 2, y0 + t / 2, y1 - t / 2, y1 + t / 2];
  const [c1, c2] = [xs + 420, 1100];
  return `M-80 ${a}H${xs}C${c1} ${a} ${c2} ${c} 1160 ${c}L1160 ${d}C${c2} ${d} ${c1} ${b} ${xs} ${b}H-80Z`;
}

/**
 * `run.swoosh`: a thick accent ribbon that runs flat behind the big number and then sweeps down the right side, the duration
 * and pace below it and the route outline at the bottom left. The number is the ink color on
 * the ribbon, so it keeps its contrast whatever photo sits behind.
 */
function runSwoosh(canvas: Canvas) {
  const f = frame(canvas);
  const k = kit('sw');
  const m = f.story
    ? { y0: 580, y1: 1160, t: 330, xs: 560, hero: 230, unit: 76, label: 34, subTop: 870, sub: 76, subUnit: 30, subLabel: 28, subGap: 64, route: 420, logo: 1550 }
    : { y0: 300, y1: 800, t: 290, xs: 520, hero: 190, unit: 62, label: 30, subTop: 530, sub: 62, subUnit: 26, subLabel: 26, subGap: 52, route: 340, logo: 1000 };
  const ribbon = k.shape({ x: 0, y: 0, w: 1080, h: f.H }, 'path', { d: ribbonPath(m.y0, m.y1, m.t, m.xs), viewBox: [1080, f.H], fill: '$accent' });
  // The number on the ribbon: ink (`$bg`) text, one variant per cell, the unit set on the number's baseline.
  const heroText = (cell: Cell) =>
    k.group(
      { w: f.W, h: 'auto' },
      [
        k.text({ w: 'auto' }, tl(cell.label), { size: m.label, weight: 700, upper: true, ls: 3, color: '$bg' }),
        k.group(
          { w: 'auto', h: 'auto' },
          [
            k.text({ w: 'auto' }, cell.value, { size: m.hero, weight: 800, color: '$bg', trim: true, minSize: 100 }),
            ...(cell.unit ? [k.text({ w: 'auto' }, tl(cell.unit), { size: m.unit, weight: 800, color: '$bg', trim: true })] : []),
          ],
          { dir: 'row', gap: 14, align: 'end' },
        ),
      ],
      { dir: 'column', gap: 18, when: cellWhen(cell) },
    );
  const customHeroSwoosh = k.group(
    { w: f.W, h: 'auto' },
    [
      k.text({ w: 'auto' }, '{run.heroLabel}', { size: m.label, weight: 700, upper: true, ls: 3, color: '$bg' }),
      k.group(
        { w: 'auto', h: 'auto' },
        [
          k.text({ w: 'auto' }, '{run.heroVal}', { size: m.hero, weight: 800, color: '$bg', trim: true, minSize: 100 }),
          k.text({ w: 'auto' }, '{run.heroUnit}', { size: m.unit, weight: 800, color: '$bg', trim: true, when: has('run.heroUnit') }),
        ],
        { dir: 'row', gap: 14, align: 'end' },
      ),
    ],
    { dir: 'column', gap: 18, when: has('run._custom') },
  );
  const hero = k.group({ x: f.pad, y: m.y0 - m.t / 2, w: f.W, h: m.t }, [customHeroSwoosh, ...HERO.map(heroText)], { dir: 'column', justify: 'center' });
  const sub = { size: m.sub, unitSize: m.subUnit, labelSize: m.subLabel };
  const subRow = k.group({ x: f.pad, y: m.subTop, w: 520, h: 'auto' }, [slot(k, LEFT, sub, {}, 1), slot(k, RIGHT, sub, {}, 2)], { dir: 'row', gap: m.subGap, align: 'start' });
  const routeBox = { x: f.pad - 14, y: f.bottom - m.route - (f.story ? 60 : 0), w: m.route, h: m.route };
  return overlay(f, 'swoosh', 'swoosh', 'swoosh', [ribbon, hero, subRow, ...routeLine(k, routeBox, 7), lockup(k, f.pad, m.logo)], ['swoosh']);
}
export const RUN_OVERLAY_TEMPLATES = [
  runTape('story'),
  runTape('square'),
  runColumn('story'),
  runColumn('square'),
  runTrack('story'),
  runTrack('square'),
  runLanes('story'),
  runLanes('square'),
  runSwoosh('story'),
  runSwoosh('square'),
];
