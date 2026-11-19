/**
 * Frame state -> Scene. All layout is here, on the 1080 x 1920 design canvas (the export size), measured with the sticker
 * engine's font tables so Node tests, the headless SVG render and a phone place text identically. The map root group is the
 * only node that changes every frame in a big way; tiles, the terrain silhouette, the chart and the route path are built once
 * and reused by identity, which is what lets the painter skip them.
 *
 * Safe area: the counter, the live readout and the chart sit above y = 1600 so Reels / Stories chrome (bottom 320 px) never
 * covers them.
 */
import { layerPaint } from '@/features/map/palette';
import type { RenderedTile } from '@/features/map/renderTile';
import { formatDate, formatDuration, formatDurationHM, formatNumber, formatPace, type Locale } from '@/features/stickers/core/format';
import { ICON_VIEWBOX, ICONS, type IconName } from '@/features/stickers/core/icons';
import type { FontRole, PathNode, SceneNode, TextNode } from '@/features/stickers/core/scene';
import { measureText, type FontMap } from '@/features/stickers/core/text';

import { mapMatrix, smoothstep } from './camera';
import type { BasemapStore, TilePlacement } from './basemap';
import { visibleLods } from './basemap';
import type { CalloutDef, CalloutKind } from './callouts';
import type { FrameState, PinState } from './frame';
import type { ReplayPlan } from './plan';
import type { MatrixGroup, ReplayNode, ReplayScene } from './scene';
import type { ReplayTheme } from './theme';

/** Design px per CSS px of the in-app map: the same road weights, scaled up to the 1080 canvas. */
export const DESIGN_K = 1080 / 390;
/** Width of the drawn route on screen, design px. */
export const ROUTE_W = 15;
const MARGIN_X = 72;
const CHART = { x: MARGIN_X, y: 1478, w: 1080 - MARGIN_X * 2, h: 122 };

export interface BuildOptions {
  watermark: boolean;
  /** The name to print on the summary card; only passed when the person opted in. */
  name: string | null;
}

export interface BuildContext {
  plan: ReplayPlan;
  theme: ReplayTheme;
  locale: Locale;
  /** Translator for the `replay` namespace. */
  t: (key: string, args?: Record<string, string | number>) => string;
  fonts: FontMap;
  store: BasemapStore;
  options: BuildOptions;
  /** The sport word ("Bersepeda"). */
  sportLabel: string;
  brand: { name: string; link: string };
}

const KIND_ICON: Record<CalloutKind, IconName> = {
  pr: 'trophy',
  highest: 'mountain',
  maxSpeed: 'speedometer',
  bestPace: 'speedometer',
  maxHr: 'heart',
  climb: 'mountain',
};

const SPORT_ICON: Record<string, IconName> = { ride: 'bike', run: 'run', walk: 'walk', swim: 'swim', other: 'fitness' };

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Mulberry32: a small seeded PRNG so a workout always gets the same silhouette. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A ridge line across `width` px (3 stacked sines), filled down to `bottom`. */
export function ridgePath(seed: number, layer: number, width: number, base: number, amp: number, bottom: number): string {
  const rnd = prng(seed + layer * 977);
  const waves = [1, 2.3, 5.1].map((f, i) => ({ f: (f * (1 + layer * 0.35) * Math.PI * 2) / 1080, ph: rnd() * Math.PI * 2, a: [0.55, 0.3, 0.15][i]! }));
  let d = '';
  for (let x = 0; x <= width; x += 18) {
    const v = waves.reduce((s, w) => s + Math.sin(x * w.f + w.ph) * w.a, 0);
    d += `${x === 0 ? 'M' : 'L'}${x} ${r1(base - amp * (0.5 + 0.5 * v))}`;
  }
  return `${d}L${width} ${bottom}L0 ${bottom}Z`;
}

/** Frame state -> scene; holds the caches (tile groups, silhouette, chart) between calls. */
export interface SceneBuilder {
  (frame: FrameState): ReplayScene;
}

export function createSceneBuilder(ctx: BuildContext): SceneBuilder {
  const { plan, theme, locale, t, fonts, store, options } = ctx;
  const W = 1080;
  const H = 1920;

  const text = (x: number, y: number, str: string, size: number, weight: number, fill: string, anchor: TextNode['anchor'] = 'start', font: FontRole = 'display', opacity?: number): TextNode => ({
    k: 'text',
    x,
    y,
    text: str,
    size,
    weight,
    font,
    fill,
    anchor,
    ...(opacity !== undefined && opacity < 1 ? { opacity } : {}),
  });
  const width = (str: string, size: number, weight: number, font: FontRole = 'display') => measureText(str, fonts.metrics(font, weight), size);

  const icon = (name: IconName, cx: number, cy: number, size: number, fill: string): PathNode[] => {
    const scale = size / ICON_VIEWBOX;
    return ICONS[name].map((d) => ({ k: 'path', d, fill, transform: { x: cx - size / 2, y: cy - size / 2, scale } }));
  };

  function applyOpacity(node: SceneNode, opacity: number): SceneNode {
    if (opacity >= 1) return node;
    if (node.k === 'group') {
      return { ...node, children: node.children.map((child) => applyOpacity(child, opacity)) };
    }
    return { ...node, opacity: (node.opacity ?? 1) * opacity };
  }

  const group = (children: SceneNode[], opacity?: number): SceneNode => {
    const flattened = opacity !== undefined && opacity < 1 ? children.map((c) => applyOpacity(c, opacity)) : children;
    return { k: 'group', children: flattened };
  };

  // ---- static pieces ------------------------------------------------------------------------------------------
  const bg: SceneNode = { k: 'rect', x: 0, y: 0, w: W, h: H, fill: theme.bg };
  const fogTop: SceneNode = {
    k: 'rect',
    x: 0,
    y: 0,
    w: W,
    h: 700,
    fill: { linear: { x1: 0, y1: 0, x2: 0, y2: 700, stops: [{ at: 0, color: theme.bg }, { at: 0.3, color: theme.bg }, { at: 1, color: `${theme.bg}00` }] } },
  };
  const fogBottom: SceneNode = {
    k: 'rect',
    x: 0,
    y: 1060,
    w: W,
    h: H - 1060,
    fill: { linear: { x1: 0, y1: 1060, x2: 0, y2: 1400, stops: [{ at: 0, color: `${theme.bg}00` }, { at: 1, color: theme.bg }] } },
  };
  const relief = (() => {
    const alts = plan.track.alt.filter((v): v is number => v !== null);
    if (alts.length === 0) return 0.5;
    return Math.min(1, Math.max(0.35, (Math.max(...alts) - Math.min(...alts)) / 500));
  })();
  const ridgeDefs = [
    { base: 360, amp: 150 * relief + 60, speed: 0.2, color: theme.ridges[0] },
    { base: 430, amp: 170 * relief + 70, speed: 0.45, color: theme.ridges[1] },
    { base: 500, amp: 190 * relief + 80, speed: 0.85, color: theme.ridges[2] },
  ].map((r, layer) => {
    const bottom = r.base + 170;
    return {
      d: ridgePath(plan.seed, layer, 2 * W, r.base, r.amp, bottom),
      speed: r.speed,
      fill: { linear: { x1: 0, y1: r.base - r.amp, x2: 0, y2: bottom, stops: [{ at: 0, color: r.color }, { at: 1, color: `${r.color}00` }] } },
    };
  });

  // Chart paths (once): altitude area and the line over it, full and clipped to the played part per frame.
  const chart = plan.chart;
  const range = (a: (number | null)[]) => {
    const v = a.filter((x): x is number => x !== null);
    return { lo: Math.min(...v), hi: Math.max(...v) };
  };
  const columns = (a: (number | null)[], top: number, bottom: number, pad: number) => {
    const { lo, hi } = range(a);
    const span = Math.max(hi - lo, 1e-6);
    const pts = a.map((v, j) => {
      const x = CHART.x + (j / (a.length - 1)) * CHART.w;
      const y = v === null ? bottom : bottom - pad - ((v - lo) / span) * (bottom - top - pad);
      return [x, y] as const;
    });
    return pts;
  };
  const chartTop = CHART.y + 8;
  const chartBottom = CHART.y + CHART.h;
  const altPts = chart.alt ? columns(chart.alt, chartTop + 30, chartBottom, 6) : null;
  const linePts = chart.line ? columns(chart.line, chartTop, chartBottom - 14, 0) : null;
  const polyline = (pts: readonly (readonly [number, number])[]) => pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${r1(x)} ${r1(y)}`).join('');
  const areaD = altPts ? `${polyline(altPts)}L${CHART.x + CHART.w} ${chartBottom}L${CHART.x} ${chartBottom}Z` : null;
  const lineD = linePts ? polyline(linePts) : null;
  const baseline: SceneNode = { k: 'rect', x: CHART.x, y: chartBottom, w: CHART.w, h: 3, rx: 1.5, fill: theme.line };
  const chartGhost: SceneNode[] = [
    ...(areaD ? [{ k: 'path', d: areaD, fill: `${theme.fg}14` } as SceneNode] : []),
    ...(lineD ? [{ k: 'path', d: lineD, stroke: { color: `${theme.fg}33`, width: 5, cap: 'round', join: 'round' } } as SceneNode] : []),
  ];
  const lineColor = chart.lineKind === 'hr' ? theme.hr : chart.lineKind === 'speed' ? theme.speed : theme.accent;
  const slicePts = (pts: readonly (readonly [number, number])[], p: number): readonly (readonly [number, number])[] => {
    if (pts.length === 0) return [];
    if (pts.length === 1 || p >= 1) return pts;
    const f = p * (pts.length - 1);
    const i = Math.max(0, Math.min(pts.length - 2, Math.floor(f)));
    const p0 = pts[i];
    const p1 = pts[i + 1];
    if (!p0 || !p1) return pts;
    const interY = p0[1] + (p1[1] - p0[1]) * (f - i);
    const interX = CHART.x + CHART.w * p;
    return [...pts.slice(0, i + 1), [interX, interY] as const];
  };
  const playedNodes = (p: number): SceneNode[] => {
    if (p <= 0.001) return [];
    const curAlt = altPts ? slicePts(altPts, p) : null;
    const curLine = linePts ? slicePts(linePts, p) : null;
    const x = CHART.x + CHART.w * p;
    const playedArea = curAlt ? `${polyline(curAlt)}L${r1(x)} ${chartBottom}L${CHART.x} ${chartBottom}Z` : null;
    const playedLine = curLine ? polyline(curLine) : null;
    return [
      ...(playedArea ? [{ k: 'path', d: playedArea, fill: `${theme.height}40` } as SceneNode] : []),
      ...(playedLine ? [{ k: 'path', d: playedLine, stroke: { color: lineColor, width: 6, cap: 'round', join: 'round' } } as SceneNode] : []),
    ];
  };
  const cursorY = (p: number): number => {
    const pts = linePts ?? altPts;
    if (!pts || pts.length === 0) return chartBottom;
    if (pts.length === 1) return pts[0]![1];
    const f = p * (pts.length - 1);
    const i = Math.max(0, Math.min(pts.length - 2, Math.floor(f)));
    const p0 = pts[i];
    const p1 = pts[i + 1];
    if (!p0 || !p1) return chartBottom;
    return p0[1] + (p1[1] - p0[1]) * (f - i);
  };

  const tileCache = new Map<string, MatrixGroup>();
  const K = DESIGN_K;
  function tileGroup(place: TilePlacement, rendered: RenderedTile, lodZ: number): MatrixGroup {
    const key = `${place.tile.key}`;
    const hit = tileCache.get(key);
    if (hit) return hit;
    const children: SceneNode[] = [];
    for (const l of rendered.layers) {
      const paint = layerPaint(l.kind, l.id, lodZ + 0.5, theme.map);
      if (!paint) continue;
      if (paint.fill) {
        children.push({ k: 'path', d: l.d, fill: paint.fill, fillRule: 'evenodd' });
      } else if (paint.stroke) {
        const dash = paint.dash && paint.dash.length >= 2 ? ([paint.dash[0]! * K, paint.dash[1]! * K] as [number, number]) : undefined;
        children.push({ k: 'path', d: l.d, stroke: { color: paint.stroke, width: paint.width * K, cap: dash ? 'butt' : 'round', join: 'round', ...(dash ? { dash } : {}) } });
      }
    }
    const node: MatrixGroup = { k: 'mgroup', id: key, children, sx: place.k, sy: place.k, tx: place.tx, ty: place.ty };
    tileCache.set(key, node);
    return node;
  }

  const sportIcon = SPORT_ICON[plan.track.kind] ?? 'fitness';
  const clockSec = plan.track.totals.movingSec > 0 ? plan.track.totals.movingSec : plan.track.totals.elapsedSec;

  const unit = (k: string) => t(`unit.${k}`);
  /** Pins and km marks the camera has left behind slide under the counter: they fade out before they reach it. */
  const hudFade = (y: number) => 1 - smoothstep(1110, 1250, y);

  // ---- pins ---------------------------------------------------------------------------------------------------
  function pinColor(kind: CalloutKind): string {
    switch (kind) {
      case 'maxHr':
        return theme.hr;
      case 'maxSpeed':
      case 'bestPace':
        return theme.speed;
      case 'pr':
        return theme.record;
      default:
        return theme.height;
    }
  }

  function chipText(def: CalloutDef): { main: string; sub: string } {
    switch (def.kind) {
      case 'maxHr':
        return { main: formatNumber(def.value, locale, 0), sub: unit('bpm') };
      case 'maxSpeed':
        return { main: formatNumber(def.value, locale, 1), sub: unit('kmh') };
      case 'bestPace':
        return { main: formatPace(def.value), sub: unit('pace') };
      case 'highest':
        return { main: formatNumber(def.value, locale, 0), sub: unit('m') };
      case 'pr': {
        const effort = def.effort ? t(`effort.${def.effort}`) : '';
        return { main: formatDuration(def.value), sub: t('callout.pr', { effort }) };
      }
      case 'climb':
        return { main: `+${formatNumber(def.value, locale, 0)}`, sub: `${unit('m')} ${t('callout.climb')}`.trim() };
    }
  }

  function pinNodes(pin: PinState): SceneNode[] {
    const out: SceneNode[] = [];
    const col = pinColor(pin.def.kind);
    const R = 30 * pin.pop;
    if (R < 1) return out;
    const showChip = pin.chip > 0.01;
    if (showChip) {
      const { main, sub } = chipText(pin.def);
      const mainW = width(main, 46, 800);
      const subW = width(sub, 30, 600);
      const w = 22 + 64 + 14 + mainW + 10 + subW + 28;
      const h = 92;
      const side = pin.x < W / 2 ? 1 : -1;
      const cx = Math.min(W - 24 - w / 2, Math.max(24 + w / 2, pin.x + side * (w / 2 + 28)));
      const rise = (1 - pin.chip) * 14;
      const cy = pin.y - 104 + rise;
      const left = cx - w / 2;
      const c: SceneNode[] = [
        { k: 'path', d: `M${r1(pin.x)} ${r1(pin.y)}L${r1(Math.min(Math.max(pin.x, left + 40), left + w - 40))} ${r1(cy)}`, stroke: { color: theme.line, width: 3, cap: 'round' } },
        { k: 'rect', x: left, y: cy - h / 2, w, h, rx: h / 2, fill: theme.surface, stroke: { color: theme.line, width: 2 } },
        { k: 'ellipse', cx: left + 22 + 32, cy, rx: 32, ry: 32, fill: col },
        ...icon(KIND_ICON[pin.def.kind], left + 22 + 32, cy, 34, '#ffffff'),
        text(left + 22 + 64 + 14, cy + 16, main, 46, 800, theme.fg),
        text(left + 22 + 64 + 14 + mainW + 10, cy + 12, sub, 30, 600, theme.fgMuted),
      ];
      out.push(group(c, pin.chip));
    }
    out.push(
      { k: 'ellipse', cx: pin.x, cy: pin.y, rx: R, ry: R, fill: col, stroke: { color: theme.bg, width: 5 } },
      ...icon(KIND_ICON[pin.def.kind], pin.x, pin.y, 32 * pin.pop, '#ffffff'),
    );
    return out;
  }

  // ---- HUD ----------------------------------------------------------------------------------------------------
  function counterNodes(f: FrameState): SceneNode[] {
    const km = formatNumber(f.distanceM / 1000, locale, 2);
    const numSize = 196;
    const wNum = width(km, numSize, 800);
    const nodes: SceneNode[] = [
      text(MARGIN_X, 1290, km, numSize, 800, theme.fg),
      text(MARGIN_X + 6, 1352, unit('km'), 52, 700, theme.fgMuted),
      ...icon(sportIcon, MARGIN_X + wNum + 70, 1290 - 92, 92, theme.accent),
    ];
    const live: { icon: IconName; color: string; main: string; sub: string }[] = [];
    const k = plan.track.kind;
    if (f.live.speedMs !== null && (k === 'ride' || k === 'other')) live.push({ icon: 'speedometer', color: theme.speed, main: formatNumber(f.live.speedMs * 3.6, locale, 1), sub: unit('kmh') });
    else if (f.live.paceSec !== null && (k === 'run' || k === 'walk')) live.push({ icon: 'speedometer', color: theme.speed, main: formatPace(f.live.paceSec), sub: unit('pace') });
    if (f.live.hr !== null && f.live.hr > 0) live.push({ icon: 'heart', color: theme.hr, main: formatNumber(f.live.hr, locale, 0), sub: unit('bpm') });
    if (f.live.power !== null && f.live.power > 0) live.push({ icon: 'flash', color: theme.record, main: formatNumber(f.live.power, locale, 0), sub: unit('w') });
    else if (f.live.altM !== null) live.push({ icon: 'mountain', color: theme.height, main: formatNumber(f.live.altM, locale, 0), sub: unit('m') });
    let x = MARGIN_X;
    for (const item of live.slice(0, 3)) {
      nodes.push(...icon(item.icon, x + 20, 1418, 40, item.color));
      const mw = width(item.main, 46, 700);
      nodes.push(text(x + 52, 1434, item.main, 46, 700, theme.fg), text(x + 52 + mw + 8, 1432, item.sub, 30, 600, theme.fgMuted));
      x += 52 + mw + 8 + width(item.sub, 30, 600) + 44;
    }
    return nodes;
  }

  function chartNodes(f: FrameState): SceneNode[] {
    if (!areaD && !lineD) return [];
    const p = f.p;
    const x = CHART.x + CHART.w * p;
    return [
      baseline,
      group(chartGhost),
      ...playedNodes(p),
      { k: 'rect', x: x - 2, y: chartTop, w: 4, h: chartBottom - chartTop, rx: 2, fill: `${theme.fg}80` },
      { k: 'ellipse', cx: x, cy: cursorY(p), rx: 11, ry: 11, fill: theme.accent, stroke: { color: theme.bg, width: 4 } },
    ];
  }

  function summaryNodes(): SceneNode[] {
    const x0 = MARGIN_X;
    const y0 = 1130;
    const w = W - MARGIN_X * 2;
    const h = 300;
    const cols: { label: string; value: string; sub: string }[] = [
      { label: t('summary.distance'), value: formatNumber(plan.track.totals.distanceM / 1000, locale, 2), sub: unit('km') },
    ];
    if (plan.track.totals.gainM !== null) cols.push({ label: t('summary.elevation'), value: formatNumber(plan.track.totals.gainM, locale, 0), sub: unit('m') });
    cols.push({ label: t('summary.time'), value: formatDurationHM(clockSec, locale), sub: '' });
    const nodes: SceneNode[] = [{ k: 'rect', x: x0, y: y0, w, h, rx: 44, fill: theme.surface, stroke: { color: theme.line, width: 2 } }];
    const head = [options.name, ctx.sportLabel].filter((s): s is string => !!s).join('  ');
    nodes.push(...icon(sportIcon, x0 + 24 + 28, y0 + 56, 56, theme.accent), text(x0 + 24 + 56 + 18, y0 + 70, head, 42, 700, theme.fg));
    nodes.push(text(x0 + w - 28, y0 + 70, formatDate(plan.track.startedAt, 'medium', locale), 34, 600, theme.fgMuted, 'end'));
    const colW = (w - 56) / cols.length;
    cols.forEach((c, i) => {
      const cx = x0 + 28 + colW * i;
      const vSize = 76;
      nodes.push(text(cx, y0 + 168, c.label, 30, 600, theme.fgMuted));
      nodes.push(text(cx, y0 + 252, c.value, vSize, 800, theme.fg));
      if (c.sub) nodes.push(text(cx + width(c.value, vSize, 800) + 10, y0 + 252, c.sub, 36, 700, theme.fgMuted));
    });
    return nodes;
  }

  const watermark: SceneNode[] = options.watermark
    ? [text(W / 2, 1712, ctx.brand.name, 36, 800, theme.fgSoft, 'middle'), text(W / 2, 1756, ctx.brand.link, 28, 500, theme.fgMuted, 'middle')]
    : [];

  return (f) => {
    const cam = f.camera;
    const vp = plan.vp;
    const m = mapMatrix(cam, vp, plan.basemap.refZoom, plan.basemap.ox, plan.basemap.oy);
    const lods = visibleLods(plan.basemap, cam, vp);

    const mapChildren: ReplayNode[] = [];
    for (const lod of lods) {
      const groups: ReplayNode[] = [];
      for (const place of lod.tiles) {
        const rendered = store.get(place.tile.key);
        if (rendered) groups.push(tileGroup(place, rendered, lod.z));
      }
      if (groups.length > 0) mapChildren.push({ k: 'mgroup', id: `lod${lod.index}`, children: groups, sx: 1, sy: 1, tx: 0, ty: 0, ...(lod.alpha < 1 ? { opacity: lod.alpha } : {}) });
    }
    const routeW = ROUTE_W / m.sx;
    const dashAll: [number, number] = [Math.max(f.drawnPx, 0.001), plan.routeLenPx * 2];
    mapChildren.push(
      { k: 'path', d: plan.routeD, stroke: { color: theme.ghost, width: routeW * 0.8, cap: 'round', join: 'round' } },
      { k: 'path', d: plan.routeD, stroke: { color: `${theme.bg}b3`, width: routeW * 1.5, cap: 'round', join: 'round', dash: dashAll } },
      { k: 'path', d: plan.routeD, stroke: { color: theme.accent, width: routeW, cap: 'round', join: 'round', dash: dashAll } },
    );
    const map: MatrixGroup = { k: 'mgroup', id: 'map', children: mapChildren, sx: m.sx, sy: m.sy, tx: m.tx, ty: m.ty };

    const shift = f.p;
    const ridges: SceneNode[] = ridgeDefs.map((r) => ({ k: 'path', d: r.d, fill: r.fill, transform: { x: -shift * W * r.speed, y: 0, scale: 1 } }));
    // The horizon clears as the camera flattens for the overview: the whole route must be readable.
    const clear = smoothstep(0, 0.6, f.outroP);
    const ridgeAlpha = 1 - clear;
    const fogAlpha = 1 - 0.9 * clear;

    // Screen-space marks.
    const marks: SceneNode[] = [];
    for (const mk of f.marks) {
      const label = String(mk.km);
      marks.push(
        group(
          [
            { k: 'ellipse', cx: mk.x, cy: mk.y, rx: 27, ry: 27, fill: theme.surfaceStrong, stroke: { color: theme.bg, width: 4 } },
            text(mk.x, mk.y + 10, label, label.length > 2 ? 24 : 28, 800, theme.fg, 'middle'),
          ],
          mk.alpha * hudFade(mk.y),
        ),
      );
    }

    const rs = f.phase === 'intro' ? 0.4 + 0.6 * f.introP : f.phase === 'outro' ? 1 - 0.5 * smoothstep(0, 0.5, f.outroP) : 1;
    const rider: SceneNode[] = [
      { k: 'ellipse', cx: f.rider.x, cy: f.rider.y, rx: 46 * rs, ry: 46 * rs, fill: `${theme.accent}33` },
      { k: 'ellipse', cx: f.rider.x, cy: f.rider.y, rx: 24 * rs, ry: 24 * rs, fill: '#ffffff', stroke: { color: theme.accent, width: 9 * rs } },
    ];

    // A fixed number of top-level slots, so a painter that keys by position never remounts a node when a pin appears.
    const nodes: ReplayNode[] = [
      bg,
      map,
      group([fogTop], fogAlpha),
      group(ridges, ridgeAlpha),
      fogBottom,
      group(marks),
      group(f.pins.flatMap((pin) => (hudFade(pin.y) > 0.02 ? [group(pinNodes(pin), hudFade(pin.y))] : []))),
      group(rider),
      group(f.counterAlpha > 0.01 ? counterNodes(f) : [], f.counterAlpha),
      group(chartNodes(f)),
      group(f.summaryAlpha > 0.01 ? summaryNodes() : [], f.summaryAlpha),
      ...watermark,
    ];
    return { width: W, height: H, nodes };
  };
}
