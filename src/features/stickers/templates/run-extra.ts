/**
 * Run templates, second set: the two transparent stickers (route, watch-face stats), the thermal receipt, the route-focus map
 * story and the two chart cards (km splits, heart-rate zones). `run.ts` holds the other five styles.
 */
import { all, footer, has, is, lacks, not, sportGlyph, statRow, tl } from './blocks';
import { kit, template, type Expr, type Kit, type LayerJson, type TextOpts } from './dsl';
import { INK, PAPER, STICKER, VOLT } from './palette';

// ----------------------------------------------------------------------------------------------------------- shared

/** Condition helpers over array length: `run.splitKmh.4` exists only when there are at least five splits. */
const atLeast = (path: string, n: number) => has(`${path}.${n - 1}`);
const atMost = (path: string, n: number) => lacks(`${path}.${n}`);
const countIn = (path: string, lo: number, hi?: number) => (hi === undefined ? atLeast(path, lo) : all(atLeast(path, lo), atMost(path, hi)));

/** Sport families with their own receipt sign-off; a run, or a workout from before families, keeps "Thanks for running". */
const THANKS_FAMILIES = ['walk', 'ride', 'swim', 'gym', 'cardio', 'flow', 'court', 'other'];

/** The receipt's last line, one text per family; exactly one passes its `when`. */
function thanks(k: Kit, o: TextOpts): LayerJson[] {
  return [
    k.text({ w: 'fill' }, tl('tpl.run.text.thanks'), { ...o, when: not({ bind: 'run.category', in: THANKS_FAMILIES }) }),
    ...THANKS_FAMILIES.map((family) => k.text({ w: 'fill' }, tl(`tpl.run.text.thanksBy.${family}`), { ...o, when: is('run.category', family) })),
  ];
}

/** Sport glyph disc, sport name, date: the top line of the cards. */
function header(k: Kit, size = 96): LayerJson {
  const glyph = Math.round(size / 2);
  return k.group(
    { w: 'fill', h: size },
    [
      k.group({ w: size, h: size }, [k.shape({ x: 0, y: 0, w: size, h: size }, 'ellipse', { fill: '$surfaceStrong' }), ...sportGlyph(k, (size - glyph) / 2, (size - glyph) / 2, glyph, '$fg')]),
      k.text({ w: 'fill' }, '{run.sport}', { size: size < 96 ? 36 : 42, weight: 800, upper: true, ls: 3, color: '$fg', minSize: 28 }),
      k.text({ w: 'auto' }, '{run.startedAt|date:medium}', { size: 32, weight: 600, color: '$fgMuted', align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
}

/** Pace for run and walk, speed for a ride; hidden for the rest. */
const PACE = { value: '{run.paceSecKm|pace}', label: tl('label.pace'), unit: tl('unit.perKm'), when: has('run.paceSecKm') };
const SPEED = { value: '{run.speedKmh|num:1}', label: tl('label.speed'), unit: tl('unit.kmh'), when: has('run.speedKmh') };

// ------------------------------------------------------------------------------------------------- run.route.sticker

/** `run.route.sticker`: the route line alone, big, with a small distance and pace line under it. */
function runRouteSticker() {
  const k = kit('rr');
  const line = k.group(
    { w: 'auto', h: 'auto' },
    [
      k.stat({ w: 'auto' }, '{run.distanceM|km}', { unit: tl('unit.km'), size: 112, unitSize: 44, weight: 800, color: '$fg', labelPos: 'none', shadow: true, when: has('run.distanceM') }),
      k.stat({ w: 'auto' }, '{run.paceSecKm|pace}', { unit: tl('unit.perKm'), size: 64, unitSize: 30, weight: 700, color: '$accent', labelPos: 'none', shadow: true, when: has('run.paceSecKm') }),
      k.stat({ w: 'auto' }, '{run.speedKmh|num:1}', { unit: tl('unit.kmh'), size: 64, unitSize: 30, weight: 700, color: '$accent', labelPos: 'none', shadow: true, when: has('run.speedKmh') }),
      k.stat({ w: 'auto' }, '{run.movingSec|dur}', { size: 64, weight: 700, color: '$accent', labelPos: 'none', shadow: true, when: all(lacks('run.distanceM')) }),
    ],
    { dir: 'row', gap: 48, align: 'end' },
  );
  return template({
    id: 'run.route.sticker',
    name: 'Run, route sticker',
    titleKey: 'stickers:tpl.run.route',
    kind: 'run',
    style: 'sticker',
    aspect: 'free',
    height: 1120,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    requires: ['run.route'],
    layers: [
      k.group(
        { x: 0, y: 0, w: 1080, h: 1120 },
        [k.route({ w: 960, h: 820 }, { color: '$fg', color2: '$accent', strokeWidth: 24, halo: true, markers: true, padding: 40 }), line, k.brand({ w: 'auto', h: 44 }, 'lockup', { size: 44 })],
        { dir: 'column', gap: 36, align: 'center', justify: 'center' },
      ),
    ],
    meta: { transparent: true, needsRoute: true, tags: ['route'] },
  });
}

// ------------------------------------------------------------------------------------------------- run.stats.sticker

/** `run.stats.sticker`: a watch-face stack of the four numbers, with the route as a small glyph when there is one. */
function runStatsSticker() {
  const k = kit('rs');
  const cell = (value: string, label: string, o: { unit?: Expr; size: number; color?: string; when?: Record<string, unknown> }) =>
    k.stat({ w: 'auto' }, value, { unit: o.unit, label: tl(label), size: o.size, unitSize: 40, labelSize: 28, weight: 800, color: o.color ?? '$fg', labelColor: '$fgSoft', labelPos: 'above', gap: 12, shadow: true, when: o.when });
  const stack = k.group(
    { w: 'auto', h: 'auto' },
    [
      cell('{run.distanceM|km}', 'label.distance', { unit: tl('unit.km'), size: 168, color: '$accent', when: has('run.distanceM') }),
      cell('{run.movingSec|dur}', 'label.time', { size: 120 }),
      cell('{run.paceSecKm|pace}', 'label.pace', { unit: tl('unit.perKm'), size: 120, when: has('run.paceSecKm') }),
      cell('{run.speedKmh|num:1}', 'label.speed', { unit: tl('unit.kmh'), size: 120, when: has('run.speedKmh') }),
      cell('{run.hrAvg|int}', 'label.hr', { unit: tl('unit.bpm'), size: 120, when: has('run.hrAvg') }),
    ],
    { dir: 'column', gap: 40, align: 'start' },
  );
  const glyph = k.route({ w: 340, h: 340 }, { color: '$fg', color2: '$accent', strokeWidth: 12, halo: true, markers: true, padding: 24 }, { when: has('run.route') });
  return template({
    id: 'run.stats.sticker',
    name: 'Run, stats sticker',
    titleKey: 'stickers:tpl.run.stats',
    kind: 'run',
    style: 'sticker',
    aspect: 'free',
    height: 1000,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers: [
      k.group(
        { x: 0, y: 0, w: 1080, h: 1000 },
        [
          k.group({ w: 'auto', h: 'auto' }, [stack, glyph], { dir: 'row', gap: 56, align: 'center' }),
          k.brand({ w: 'auto', h: 40 }, 'lockup', { size: 40 }),
        ],
        { dir: 'column', gap: 56, align: 'center', justify: 'center' },
      ),
    ],
    meta: { transparent: true, tags: ['numbers'] },
  });
}

// ------------------------------------------------------------------------------------------------ run.receipt.sticker

/** The receipt's own palette: cream paper with ink by day, charcoal paper with cream and amber by night (all existing values). */
const RECEIPT = {
  light: PAPER.light,
  dark: { ...PAPER.dark, bg: VOLT.dark.bg2, bg2: VOLT.dark.bg, fgMuted: VOLT.dark.fgMuted, fgSoft: '#f4efe4e0', surface: '#f4efe414' },
};

const PAPER_W = 700;
const TOOTH = 20;
const TOOTH_DEPTH = 14;

/** Zigzag torn edge, `top` = teeth up (paper below it). Drawn 2 px past the seam so no hairline shows between pieces. */
function tornEdge(top: boolean): string {
  const teeth = PAPER_W / TOOTH;
  const near = top ? TOOTH_DEPTH : 0; // y of the seam with the paper body
  const far = top ? 0 : TOOTH_DEPTH; // y of the tooth tips
  const seam = top ? TOOTH_DEPTH + 2 : -2;
  let d = `M0 ${seam}L0 ${near}`;
  for (let i = 0; i < teeth; i++) d += `L${i * TOOTH + TOOTH / 2} ${far}L${(i + 1) * TOOTH} ${near}`;
  return `${d}L${PAPER_W} ${seam}Z`;
}

/** A static barcode: fixed bar and gap widths so the receipt never changes between renders. */
function barcode(width: number, height: number): string {
  const pattern = [3, 1, 2, 1, 4, 2, 1, 1, 3, 2, 1, 3, 2, 2, 1, 4, 1, 2, 3, 1, 1, 2, 4, 1, 2, 1, 3, 3, 1, 1, 2, 2, 4, 1, 3, 1, 2, 1, 1, 3, 2, 4, 1, 2, 3, 1, 2, 1];
  const unit = 3;
  let d = '';
  let x = 0;
  for (let i = 0; x < width; i++) {
    const w = pattern[i % pattern.length]! * unit;
    if (i % 2 === 0 && x + w <= width) d += `M${x} 0H${x + w}V${height}H${x}Z`;
    x += w;
  }
  return d;
}

/** `run.receipt.sticker`: a thermal-paper receipt for the workout. The paper is the sticker; its height follows the rows. */
function runReceiptSticker() {
  const k = kit('rc');
  const mono = { font: 'mono' as const };
  const dash = () => k.shape({ w: 'fill', h: 12 }, 'line', { stroke: { color: '$fgMuted', width: 3, dash: [14, 10] } });

  /** `LABEL ........ value unit`: the row hides with its value. */
  const row = (label: string, value: string, unit: Expr | undefined, when: Record<string, unknown>) =>
    k.group(
      { w: 'fill', h: 'auto' },
      [
        k.text({ w: 'auto' }, tl(label), { ...mono, size: 26, weight: 500, color: '$fgSoft', upper: true, ls: 1 }),
        k.shape({ w: 'fill', h: 14 }, 'line', { stroke: { color: '$fgMuted', width: 3, dash: [2, 9] } }),
        k.stat({ w: 'auto' }, value, { ...mono, unit, labelPos: 'none', size: 32, unitSize: 24, weight: 700, color: '$fg', align: 'right' }),
      ],
      { dir: 'row', gap: 10, align: 'end', when },
    );

  const total = (value: string, unit: Expr | undefined, when: Record<string, unknown>) =>
    k.group(
      { w: 'fill', h: 'auto' },
      [
        k.text({ w: 'fill' }, tl('tpl.run.text.total'), { ...mono, size: 36, weight: 700, color: '$fg', upper: true, ls: 2 }),
        k.stat({ w: 'auto' }, value, { ...mono, unit, labelPos: 'none', size: 52, unitSize: 28, weight: 700, color: '$accent', align: 'right', minSize: 30 }),
      ],
      { dir: 'row', gap: 12, align: 'end', when },
    );

  const body = k.group(
    { w: PAPER_W, h: 'auto' },
    [
      k.text({ w: 'fill' }, '{app.name|upper}', { ...mono, size: 40, weight: 700, color: '$fg', align: 'center', ls: 8, role: 'watermark' }),
      k.text({ w: 'fill' }, '{run.sport|upper}', { ...mono, size: 30, weight: 700, color: '$accent', align: 'center', ls: 2, minSize: 22 }),
      k.text({ w: 'fill' }, '{run.startedAt|date:medium}', { ...mono, size: 26, weight: 500, color: '$fgMuted', align: 'center', ls: 1 }),
      dash(),
      row('label.distance', '{run.distanceM|km}', tl('unit.km'), all(has('run.distanceM'), not(is('run.category', 'swim')))),
      row('label.distance', '{run.distanceM|int}', tl('unit.m'), all(has('run.distanceM'), is('run.category', 'swim'))),
      row('label.time', '{run.movingSec|dur}', undefined, has('run.movingSec')),
      row('label.pace', '{run.paceSecKm|pace}', tl('unit.perKm'), has('run.paceSecKm')),
      row('label.pace', '{run.pace100Sec|pace}', tl('unit.per100m'), has('run.pace100Sec')),
      row('label.speed', '{run.speedKmh|num:1}', tl('unit.kmh'), has('run.speedKmh')),
      row('label.laps', '{run.laps|int}', undefined, has('run.laps')),
      row('label.swolf', '{run.swolf|int}', undefined, has('run.swolf')),
      row('label.sets', '{run.sets|int}', undefined, has('run.sets')),
      row('label.reps', '{run.reps|int}', undefined, has('run.reps')),
      row('label.volume', '{run.volumeKg|int}', tl('unit.kg'), has('run.volumeKg')),
      row('label.jumps', '{run.jumps|int}', undefined, has('run.jumps')),
      row('label.avgHr', '{run.hrAvg|int}', tl('unit.bpm'), has('run.hrAvg')),
      row('label.maxHr', '{run.hrMax|int}', tl('unit.bpm'), has('run.hrMax')),
      row('label.elevation', '{run.elevGainM|int}', tl('unit.m'), has('run.elevGainM')),
      row('label.cadence', '{run.cadence|int}', tl('unit.spm'), all(has('run.cadence'), not(is('run.kind', 'ride')))),
      row('label.cadence', '{run.cadence|int}', tl('unit.rpm'), all(has('run.cadence'), is('run.kind', 'ride'))),
      row('label.power', '{run.power|int}', tl('unit.watt'), has('run.power')),
      row('label.steps', '{run.steps|int}', undefined, has('run.steps')),
      row('label.kcal', '{run.kcal|int}', tl('unit.kcal'), has('run.kcal')),
      dash(),
      total('{run.distanceM|km}', tl('unit.km'), all(has('run.distanceM'), not(is('run.category', 'swim')))),
      total('{run.distanceM|int}', tl('unit.m'), all(has('run.distanceM'), is('run.category', 'swim'))),
      total('{run.movingSec|dur}', undefined, lacks('run.distanceM')),
      k.shape({ w: 'fill', h: 96 }, 'path', { d: barcode(PAPER_W - 88, 96), viewBox: [PAPER_W - 88, 96], fill: '$fg' }),
      ...thanks(k, { ...mono, size: 26, weight: 700, color: '$fg', align: 'center', upper: true, ls: 2, fit: 'wrap', maxLines: 2 }),
      k.text({ w: 'fill' }, '{app.link}', { ...mono, size: 26, weight: 500, color: '$fgMuted', align: 'center', role: 'watermark', minSize: 22 }),
    ],
    { dir: 'column', gap: 22, align: 'stretch', padding: 44, fill: '$bg' },
  );

  const paper = k.group(
    { w: PAPER_W, h: 'auto' },
    [k.shape({ w: PAPER_W, h: TOOTH_DEPTH }, 'path', { d: tornEdge(true), viewBox: [PAPER_W, TOOTH_DEPTH], fill: '$bg' }), body, k.shape({ w: PAPER_W, h: TOOTH_DEPTH }, 'path', { d: tornEdge(false), viewBox: [PAPER_W, TOOTH_DEPTH], fill: '$bg' })],
    { dir: 'column', gap: 0, align: 'stretch' },
  );

  return template({
    id: 'run.receipt.sticker',
    name: 'Run, receipt sticker',
    titleKey: 'stickers:tpl.run.receipt',
    kind: 'run',
    style: 'receipt',
    aspect: 'free',
    height: 1160,
    // One row per number any sport family has, most of them hidden for a given workout.
    constraints: { maxLayers: 140 },
    background: { kind: 'transparent' },
    dark: RECEIPT.dark,
    light: RECEIPT.light,
    layers: [k.group({ x: 0, y: 0, w: 1080, h: 1160 }, [paper], { dir: 'column', align: 'center', justify: 'center' })],
    meta: { transparent: true, tags: ['receipt'] },
  });
}

// ----------------------------------------------------------------------------------------------------- run.map.story

/** A closed wobbly loop, as a smooth path in canvas coordinates: the contour lines of the map fallback. */
function contour(cx: number, cy: number, rx: number, ry: number, phase: number): string {
  const n = 9;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const wobble = 1 + 0.14 * Math.sin(a * 2 + phase) + 0.08 * Math.cos(a * 3 + phase * 1.7);
    return [cx + Math.cos(a) * rx * wobble, cy + Math.sin(a) * ry * wobble] as const;
  });
  const at = (i: number) => pts[((i % n) + n) % n]!;
  let d = `M${at(0)[0].toFixed(1)} ${at(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0]!.toFixed(1)} ${c1[1]!.toFixed(1)} ${c2[0]!.toFixed(1)} ${c2[1]!.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

/** `run.map.story`: the route fills the card over a map (a contour-line gradient until a map image is supplied). */
function runMapStory() {
  const k = kit('rm');
  // One stack group around a single path: a full-canvas shape is not an authored box the story safe-area lint should judge.
  const contours = k.group(
    { x: 0, y: 0, w: 1080, h: 1920 },
    [
      k.shape(
        { w: 1080, h: 1920 },
        'path',
        { d: [0, 1, 2, 3, 4, 5].map((i) => contour(620 - i * 18, 830 + i * 10, 200 + i * 140, 160 + i * 150, 0.6 + i * 0.35)).join(''), viewBox: [1080, 1920], stroke: { color: '$line', width: 3 } },
        { opacity: 0.8 },
      ),
    ],
    { dir: 'column', when: lacks('mapImage') },
  );

  const headline = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.stat({ w: 'fill' }, '{run.distanceM|km}', { unit: tl('unit.km'), size: 210, unitSize: 60, weight: 800, color: '$accent', labelPos: 'none', minSize: 120, when: has('run.distanceM') }),
      k.stat({ w: 'fill' }, '{run.movingSec|dur}', { size: 210, weight: 800, color: '$accent', labelPos: 'none', minSize: 120, when: lacks('run.distanceM') }),
      k.group(
        { w: 'auto', h: 'auto' },
        statRow(
          k,
          [{ value: '{run.movingSec|dur}', label: tl('label.time'), when: has('run.distanceM') }, PACE, SPEED],
          { size: 60, labelSize: 26, color: '$fg', labelColor: '$fgMuted', unitSize: 28, weight: 800 },
        ).map((layer) => ({ ...layer, box: { ...layer.box, w: 'auto' as const } })),
        { dir: 'column', gap: 18, align: 'start' },
      ),
    ],
    { dir: 'row', gap: 24, align: 'end' },
  );

  const elevation = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.group(
        { w: 'fill', h: 'auto' },
        [
          k.text({ w: 'fill' }, tl('label.elevation'), { size: 28, weight: 700, color: '$fgMuted', upper: true, ls: 3 }),
          k.stat({ w: 'auto' }, '+{run.elevGainM|int}', { unit: tl('unit.m'), size: 44, unitSize: 28, weight: 800, color: '$fg', labelPos: 'none', when: has('run.elevGainM') }),
        ],
        { dir: 'row', gap: 16, align: 'end' },
      ),
      k.chart({ w: 'fill', h: 170 }, { kind: 'area', series: { bind: 'run.altSeries' }, color: '$accent2', strokeWidth: 6 }),
    ],
    { dir: 'column', gap: 16, align: 'stretch', padding: 32, fill: '$surface', radius: 40, when: has('run.altSeries') },
  );

  const route = k.route({ w: 936, h: 'fill' }, { color: '$fg', color2: '$accent', strokeWidth: 20, halo: true, markers: true, padding: 56 });
  const root = k.group({ x: 72, y: 250, w: 936, h: 1190 }, [header(k), route, headline, elevation], { dir: 'column', gap: 36, align: 'stretch', justify: 'between' });

  return template({
    id: 'run.map.story',
    name: 'Run, map, story',
    titleKey: 'stickers:tpl.run.map',
    kind: 'run',
    style: 'map',
    aspect: 'story',
    background: {
      kind: 'map',
      bind: 'mapImage',
      scrim: { side: 'full', color: '$bg', opacity: 0.45 },
      fallback: {
        kind: 'gradient',
        angle: 165,
        stops: [
          { at: 0, color: '$bg2' },
          { at: 1, color: '$bg' },
        ],
        glows: [{ x: 540, y: 820, r: 760, color: '$accent2', opacity: 0.16 }],
      },
    },
    dark: INK.dark,
    light: INK.light,
    requires: ['run.route'],
    layers: [contours, root, ...footer(k, 72, 1510, 936)],
    meta: { needsRoute: true, tags: ['route', 'map'] },
  });
}

// --------------------------------------------------------------------------------------------------------- splits

type Canvas = 'story' | 'square';

interface SplitTier {
  lo: number;
  hi?: number;
  vertical?: boolean;
  labels?: boolean;
  h: number;
  labelSize?: number;
}

/**
 * The chart layer of one split-count range. Horizontal bars grow taller with fewer splits, so each range has its own height and
 * the bars stay between about 40 and 150 px; beyond that the bars turn into columns, with labels only while they fit.
 */
function splitChart(k: Kit, w: number, tier: SplitTier): LayerJson {
  return k.chart(
    { w, h: tier.h },
    {
      kind: 'bars',
      series: { bind: 'run.splitKmh' },
      labels: { bind: 'run.splitLabels' },
      horizontal: !tier.vertical,
      showLabels: tier.labels !== false,
      labelSize: tier.labelSize ?? 28,
      color: '$accent',
      color2: '$fg/22',
      highlight: 'max',
      barRadius: tier.vertical ? 8 : 14,
    },
    { when: countIn('run.splitKmh', tier.lo, tier.hi) },
  );
}

const STORY_SPLIT_TIERS: SplitTier[] = [
  { lo: 2, hi: 2, h: 300 },
  { lo: 3, hi: 3, h: 420 },
  { lo: 4, hi: 6, h: 540 },
  { lo: 7, hi: 12, h: 640 },
  { lo: 13, hi: 20, h: 520, vertical: true, labelSize: 22 },
  { lo: 21, h: 520, vertical: true, labels: false },
];
const SQUARE_SPLIT_TIERS: SplitTier[] = [
  { lo: 2, hi: 2, h: 320 },
  { lo: 3, hi: 3, h: 420 },
  { lo: 4, hi: 6, h: 520 },
  { lo: 7, hi: 12, h: 620 },
  { lo: 13, hi: 16, h: 520, vertical: true, labelSize: 22 },
  { lo: 17, h: 520, vertical: true, labels: false },
];

function runSplits(canvas: Canvas) {
  const k = kit('rp');
  const story = canvas === 'story';
  const section = k.text({ w: 'fill' }, tl('tpl.run.text.splits'), { size: 28, weight: 700, color: '$fgMuted', upper: true, ls: 3 });

  const distance = (width: number, size: number) =>
    k.group(
      { w: width, h: 'auto' },
      [
        k.stat({ w: width }, '{run.distanceM|km}', { unit: tl('unit.km'), size, unitSize: Math.round(size * 0.22), weight: 800, color: '$accent', labelPos: 'none', minSize: 90, when: has('run.distanceM') }),
        k.stat({ w: width }, '{run.movingSec|dur}', { size, weight: 800, color: '$accent', labelPos: 'none', minSize: 90, when: lacks('run.distanceM') }),
      ],
      { dir: 'column' },
    );

  let root: LayerJson;
  if (story) {
    const stats = k.group(
      { w: 'fill', h: 'auto' },
      statRow(k, [{ value: '{run.movingSec|dur}', label: tl('label.time'), when: has('run.distanceM') }, PACE, SPEED], { size: 76, labelSize: 26, color: '$fg', labelColor: '$fgMuted', unitSize: 30, weight: 800 }),
      { dir: 'row', gap: 28, align: 'start' },
    );
    const chart = k.group({ w: 'fill', h: 'auto' }, [section, ...STORY_SPLIT_TIERS.map((tier) => splitChart(k, 936, tier))], { dir: 'column', gap: 24, align: 'stretch' });
    root = k.group({ x: 72, y: 250, w: 936, h: 1190 }, [header(k), distance(936, 270), stats, chart], { dir: 'column', gap: 36, align: 'stretch', justify: 'between' });
  } else {
    const side = k.group(
      { w: 380, h: 'fill' },
      [
        distance(380, 170),
        k.group({ w: 380, h: 'auto' }, statRow(k, [{ value: '{run.movingSec|dur}', label: tl('label.time'), when: has('run.distanceM') }, PACE, SPEED], { size: 64, labelSize: 26, color: '$fg', labelColor: '$fgMuted', unitSize: 28, weight: 800 }).map((layer) => ({ ...layer, box: { ...layer.box, w: 380 } })), { dir: 'column', gap: 28 }),
      ],
      { dir: 'column', gap: 28, justify: 'between' },
    );
    const chart = k.group({ w: 'fill', h: 'auto' }, [section, ...SQUARE_SPLIT_TIERS.map((tier) => splitChart(k, 520, tier))], { dir: 'column', gap: 24, align: 'stretch' });
    const body = k.group({ w: 'fill', h: 'fill' }, [side, chart], { dir: 'row', gap: 36, align: 'start' });
    root = k.group({ x: 72, y: 72, w: 936, h: 844 }, [header(k, 80), body], { dir: 'column', gap: 36, align: 'stretch' });
  }

  return template({
    id: `run.splits.${canvas}`,
    name: `Run, splits, ${canvas}`,
    titleKey: 'stickers:tpl.run.splits',
    kind: 'run',
    style: 'bold',
    aspect: canvas,
    background: { kind: 'color', color: '$bg' },
    dark: PAPER.dark,
    light: PAPER.light,
    requires: ['run.splitKmh'],
    layers: [root, ...(story ? footer(k, 72, 1510, 936) : footer(k, 72, 952, 936))],
    meta: { tags: ['splits', 'chart'] },
  });
}

// ---------------------------------------------------------------------------------------------------------- zones

/** Five horizontal zone bars (the zone colors come with the data) with the share of time as a number at the right. */
function zoneBars(k: Kit, w: number, h: number, labelSize: number, pctSize: number): LayerJson {
  const gap = Math.min(16, h / 5 / 3);
  const bar = (h - gap * 4) / 5;
  const valueW = 130;
  const values = [0, 1, 2, 3, 4].map((i) =>
    k.text({ x: w - valueW, y: i * (bar + gap), w: valueW, h: bar }, `{run.hrZonePct.${i}|pct}`, { size: pctSize, weight: 800, color: '$fg', align: 'right', valign: 'middle' }),
  );
  return k.group(
    { w, h },
    [
      k.chart(
        { x: 0, y: 0, w: w - valueW - 16, h },
        { kind: 'bars', series: { bind: 'run.hrZonePct' }, labels: { bind: 'run.hrZoneLabels' }, colors: { bind: 'run.hrZoneColors' }, horizontal: true, showLabels: true, labelSize, color: '$accent', barRadius: 18 },
      ),
      ...values,
    ],
    {},
  );
}

function runZones(canvas: Canvas) {
  const k = kit('rz');
  const story = canvas === 'story';
  const section = k.text({ w: 'fill' }, tl('tpl.run.text.zones'), { size: 28, weight: 700, color: '$fgMuted', upper: true, ls: 3 });
  const hero = (size: number, width: number) =>
    k.stat({ w: width }, '{run.hrAvg|int}', { unit: tl('unit.bpm'), label: tl('label.avgHr'), size, unitSize: Math.round(size * 0.24), labelSize: 30, weight: 800, color: '$accent', labelPos: 'above', gap: 20, minSize: 120 });
  const cells = (size: number) =>
    statRow(
      k,
      [
        { value: '{run.hrMax|int}', label: tl('label.maxHr'), unit: tl('unit.bpm'), when: has('run.hrMax') },
        { value: '{run.movingSec|dur}', label: tl('label.time') },
        { value: '{run.distanceM|km}', label: tl('label.distance'), unit: tl('unit.km'), when: has('run.distanceM') },
      ],
      { size, labelSize: 26, color: '$fg', labelColor: '$fgMuted', unitSize: 28, weight: 800 },
    );

  let root: LayerJson;
  if (story) {
    root = k.group(
      { x: 72, y: 250, w: 936, h: 1190 },
      [
        header(k),
        k.group({ w: 'fill', h: 'auto' }, [hero(330, 936)], { dir: 'column' }),
        k.group({ w: 'fill', h: 'auto' }, cells(70), { dir: 'row', gap: 28, align: 'start' }),
        k.group({ w: 'fill', h: 'auto' }, [section, zoneBars(k, 936, 500, 32, 44)], { dir: 'column', gap: 24, align: 'stretch' }),
      ],
      { dir: 'column', gap: 36, align: 'stretch', justify: 'between' },
    );
  } else {
    root = k.group(
      { x: 72, y: 72, w: 936, h: 844 },
      [
        header(k, 80),
        k.group({ w: 'fill', h: 'auto' }, [hero(230, 936)], { dir: 'column' }),
        k.group({ w: 'fill', h: 'auto' }, cells(56), { dir: 'row', gap: 28, align: 'start' }),
        zoneBars(k, 936, 380, 28, 40),
      ],
      { dir: 'column', gap: 30, align: 'stretch', justify: 'between' },
    );
  }

  return template({
    id: `run.zones.${canvas}`,
    name: `Run, heart-rate zones, ${canvas}`,
    titleKey: 'stickers:tpl.run.zones',
    kind: 'run',
    style: 'bold',
    aspect: canvas,
    background: { kind: 'color', color: '$bg' },
    dark: INK.dark,
    light: INK.light,
    requires: ['run.hrZonePct'],
    layers: [root, ...(story ? footer(k, 72, 1510, 936) : footer(k, 72, 952, 936))],
    meta: { tags: ['heart', 'chart'] },
  });
}

export const RUN_EXTRA_TEMPLATES = [runRouteSticker(), runStatsSticker(), runReceiptSticker(), runMapStory(), runSplits('story'), runSplits('square'), runZones('story'), runZones('square')];
