import { mixColors, resolveColor, withAlpha, type Tokens } from "./color";
import {
  resolveNum,
  resolveNumberList,
  resolveStringList,
  type Env,
} from "./expr";
import { projectRoute, readRoute, simplify, trimRoute, type XY } from "./route";
import type { LinearPaint, RadialPaint, SceneNode, Stop } from "./scene";
import type { ChartLayer, RingLayer, RouteLayer } from "./schema";
import { type FontMap, measureText } from "./text";

/** Geometry for the data-driven layers (ring, chart, route) plus shared paint helpers. */

export type Placed = { w: number; h: number; paint(x: number, y: number): SceneNode[] };

export type DrawCtx = {
  env: Env;
  tokens: Tokens;
  fonts: FontMap;
  routeTrimMeters: number;
};

export const r2 = (n: number) => Math.round(n * 100) / 100;

export function gradientStops(
  stops: { at: number; color: string }[],
  tokens: Tokens,
  opacity = 1,
): Stop[] {
  return stops.map((s) => ({ at: s.at, color: resolveColor(s.color, tokens, opacity) }));
}

/** CSS-style angle (0 = to top, 90 = to right, 180 = to bottom) over a box. */
export function linearOver(
  angle: number,
  x: number,
  y: number,
  w: number,
  h: number,
  stops: Stop[],
): LinearPaint {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = x + w / 2;
  const cy = y + h / 2;
  return {
    linear: {
      x1: r2(cx - (dx * len) / 2),
      y1: r2(cy - (dy * len) / 2),
      x2: r2(cx + (dx * len) / 2),
      y2: r2(cy + (dy * len) / 2),
      stops,
    },
  };
}

export function radialGlow(cx: number, cy: number, r: number, color: string, opacity: number): RadialPaint {
  return {
    radial: {
      cx,
      cy,
      r,
      stops: [
        { at: 0, color: withAlpha(color, opacity) },
        { at: 1, color: withAlpha(color, 0) },
      ],
    },
  };
}

const polar = (cx: number, cy: number, r: number, deg: number): XY => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

/** Clockwise arc (SVG y-down) from `startDeg` spanning `sweepDeg` (< 360). */
export function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const [x0, y0] = polar(cx, cy, r, startDeg);
  const [x1, y1] = polar(cx, cy, r, startDeg + sweepDeg);
  return `M${r2(x0)} ${r2(y0)}A${r2(r)} ${r2(r)} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${r2(x1)} ${r2(y1)}`;
}

export function drawRing(layer: RingLayer, w: number, h: number, d: DrawCtx): ((x: number, y: number) => SceneNode[]) | null {
  const progress = resolveNum(layer.progress, d.env);
  const segments = (layer.segments ?? []).map((s) => ({
    value: resolveNum(s.value, d.env),
    color: s.color,
  }));
  const hasSegments = segments.some((s) => s.value !== undefined);
  if (progress === undefined && !hasSegments) return null;
  const thickness = Math.min(layer.thickness, Math.min(w, h) / 2);
  const r = Math.max(1, Math.min(w, h) / 2 - thickness / 2);
  const sweep = layer.sweep;
  const full = sweep >= 359.9;
  const track = resolveColor(layer.track ?? "$line", d.tokens);
  return (x, y) => {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const nodes: SceneNode[] = [];
    const strokeOf = (color: string, cap: "round" | "butt") => ({
      color,
      width: thickness,
      cap,
    });
    const arc = (startFraction: number, fraction: number, color: string, cap: "round" | "butt") => {
      const f = Math.min(1, Math.max(0, fraction));
      if (f <= 0) return;
      if (full && f >= 0.9999) {
        nodes.push({ k: "ellipse", cx: r2(cx), cy: r2(cy), rx: r2(r), ry: r2(r), stroke: strokeOf(color, "butt") });
        return;
      }
      const span = Math.max(0.5, f * sweep);
      nodes.push({
        k: "path",
        d: arcPath(cx, cy, r, layer.startAngle + startFraction * sweep, Math.min(span, 359.9)),
        stroke: strokeOf(color, cap),
      });
    };
    if (full) {
      nodes.push({ k: "ellipse", cx: r2(cx), cy: r2(cy), rx: r2(r), ry: r2(r), stroke: strokeOf(track, "butt") });
    } else {
      nodes.push({ k: "path", d: arcPath(cx, cy, r, layer.startAngle, sweep), stroke: strokeOf(track, layer.cap) });
    }
    if (hasSegments) {
      let used = 0;
      for (const seg of segments) {
        if (seg.value === undefined || seg.value <= 0 || used >= 1) continue;
        const f = Math.min(seg.value, 1 - used);
        arc(used, f, resolveColor(seg.color, d.tokens), "butt");
        used += f;
      }
    } else if (progress !== undefined) {
      const p = Math.max(0, progress) / layer.max;
      const base = resolveColor(layer.color, d.tokens);
      arc(0, Math.min(p, 1), base, layer.cap);
      if (p > 1) arc(0, p - 1, resolveColor(layer.overColor ?? "$warn", d.tokens), layer.cap);
    }
    return nodes;
  };
}

/** Monotone cubic (Fritsch-Carlson) through points, as an SVG path starting with M. */
export function smoothPath(points: XY[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${r2(points[0]![0])} ${r2(points[0]![1])}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const ddx = points[i + 1]![0] - points[i]![0];
    dx.push(ddx);
    slope.push(ddx === 0 ? 0 : (points[i + 1]![1] - points[i]![1]) / ddx);
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    m.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  }
  m.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / slope[i]!;
    const b = m[i + 1]! / slope[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i]!;
      m[i + 1] = t * b * slope[i]!;
    }
  }
  let d = `M${r2(points[0]![0])} ${r2(points[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${r2(x0 + h)} ${r2(y0 + m[i]! * h)} ${r2(x1 - h)} ${r2(y1 - m[i + 1]! * h)} ${r2(x1)} ${r2(y1)}`;
  }
  return d;
}

const MAX_POINTS = 60;

export function drawChart(layer: ChartLayer, w: number, h: number, d: DrawCtx): ((x: number, y: number) => SceneNode[]) | null {
  if (layer.kind === "stack") return drawStack(layer, w, h, d);
  const raw = layer.series ? resolveNumberList(layer.series.bind, d.env) : undefined;
  if (!raw) return null;
  const values = raw.slice(0, MAX_POINTS);
  const labels = layer.labels ? resolveStringList(layer.labels.bind, d.env) : undefined;
  const colors = layer.colors ? resolveStringList(layer.colors.bind, d.env) : undefined;
  const base = layer.baseline === undefined ? undefined : resolveNum(layer.baseline, d.env);
  const finite = values.filter((v): v is number => v !== null);
  if (layer.kind === "bars" ? values.length === 0 || finite.length === 0 : finite.length < 2) return null;
  const color = resolveColor(layer.color, d.tokens);
  const color2 = layer.color2 ? resolveColor(layer.color2, d.tokens) : withAlpha(color, 0.4);
  if (layer.kind === "bars") return drawBars(layer, values, labels, colors, base, color, color2, w, h, d);
  return drawLine(layer, values, base, color, w, h);
}

function highlightIndex(highlight: ChartLayer["highlight"], values: (number | null)[]): number | undefined {
  if (highlight === undefined) return undefined;
  if (typeof highlight === "number") return highlight < values.length ? highlight : undefined;
  if (highlight === "last") return values.length - 1;
  let best: number | undefined;
  values.forEach((v, i) => {
    if (v === null) return;
    const cur = best === undefined ? undefined : values[best];
    if (cur == null || (highlight === "max" ? v > cur : v < cur)) best = i;
  });
  return best;
}

function drawBars(
  layer: ChartLayer,
  values: (number | null)[],
  labels: string[] | undefined,
  colors: string[] | undefined,
  baseline: number | undefined,
  color: string,
  color2: string,
  w: number,
  h: number,
  d: DrawCtx,
): (x: number, y: number) => SceneNode[] {
  const n = values.length;
  const hl = highlightIndex(layer.highlight, values);
  const finite = values.filter((v): v is number => v !== null);
  const top = layer.max ?? Math.max(...finite, baseline ?? 0, 1e-9);
  const lo = layer.min ?? 0;
  const span = Math.max(1e-9, top - lo);
  const labelMetrics = d.fonts.metrics("body", 600);
  const labelFill = resolveColor(layer.labelColor, d.tokens);
  const colorAt = (i: number): string => {
    const custom = colors?.[i];
    if (custom) return resolveColor(custom, d.tokens);
    return hl === undefined || i === hl ? color : color2;
  };
  return (x, y) => {
    const nodes: SceneNode[] = [];
    if (layer.horizontal) {
      const labelW = layer.showLabels && labels
        ? Math.min(w * 0.4, Math.max(...labels.slice(0, n).map((l) => measureText(l, labelMetrics, layer.labelSize))) + 20)
        : 0;
      const gap = Math.min(16, h / n / 3);
      const bh = (h - gap * (n - 1)) / n;
      const plotW = w - labelW;
      values.forEach((v, i) => {
        const by = y + i * (bh + gap);
        if (layer.showLabels && labels?.[i]) {
          nodes.push({
            k: "text", x: r2(x), y: r2(by + bh / 2 + layer.labelSize * 0.35), text: labels[i]!, size: layer.labelSize,
            weight: 600, font: "body", fill: labelFill, anchor: "start",
          });
        }
        const len = v === null ? 0 : Math.max(0, ((v - lo) / span) * plotW);
        const bw = Math.max(len, v ? Math.min(6, plotW) : 0);
        if (bw > 0) {
          nodes.push({ k: "rect", x: r2(x + labelW), y: r2(by), w: r2(bw), h: r2(bh), rx: Math.min(layer.barRadius, bh / 2, bw / 2), fill: colorAt(i) });
        }
      });
      if (baseline !== undefined) {
        const bx = x + labelW + ((baseline - lo) / span) * plotW;
        nodes.push({ k: "path", d: `M${r2(bx)} ${r2(y)}L${r2(bx)} ${r2(y + h)}`, stroke: { color: labelFill, width: 3, dash: [10, 8], cap: "butt" } });
      }
      return nodes;
    }
    const labelH = layer.showLabels ? layer.labelSize * 1.7 : 0;
    const plotH = h - labelH;
    const gap = Math.max(4, Math.min(24, (w / n) * 0.28));
    const bw = (w - gap * (n - 1)) / n;
    values.forEach((v, i) => {
      const bx = x + i * (bw + gap);
      const bar = v === null ? 0 : Math.max(0, ((v - lo) / span) * plotH);
      const bhh = v ? Math.max(bar, Math.min(6, plotH)) : 0;
      if (bhh > 0) {
        nodes.push({ k: "rect", x: r2(bx), y: r2(y + plotH - bhh), w: r2(bw), h: r2(bhh), rx: Math.min(layer.barRadius, bw / 2, bhh / 2), fill: colorAt(i) });
      } else {
        nodes.push({ k: "rect", x: r2(bx), y: r2(y + plotH - 4), w: r2(bw), h: 4, rx: 2, fill: withAlpha(labelFill, 0.45) });
      }
      if (layer.showLabels && labels?.[i]) {
        nodes.push({
          k: "text", x: r2(bx + bw / 2), y: r2(y + plotH + layer.labelSize * 1.25), text: labels[i]!, size: layer.labelSize,
          weight: i === hl ? 800 : 600, font: "body", fill: i === hl ? resolveColor("$fg", d.tokens) : labelFill, anchor: "middle",
        });
      }
    });
    if (baseline !== undefined) {
      const by = y + plotH - ((baseline - lo) / span) * plotH;
      nodes.push({ k: "path", d: `M${r2(x)} ${r2(by)}L${r2(x + w)} ${r2(by)}`, stroke: { color: labelFill, width: 3, dash: [10, 8], cap: "butt" } });
    }
    return nodes;
  };
}

function drawLine(
  layer: ChartLayer,
  values: (number | null)[],
  baseline: number | undefined,
  color: string,
  w: number,
  h: number,
): (x: number, y: number) => SceneNode[] {
  const pts = values
    .map((v, i) => (v === null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p !== null);
  const vs = pts.map((p) => p.v);
  const lo = layer.min ?? Math.min(...vs);
  const top = layer.max ?? Math.max(...vs, baseline ?? -Infinity);
  const span = Math.max(1e-9, top - lo);
  const pad = layer.strokeWidth;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const last = Math.max(1, values.length - 1);
  return (x, y) => {
    const xy: XY[] = pts.map((p) => [x + pad + (p.i / last) * innerW, y + pad + innerH - ((p.v - lo) / span) * innerH]);
    const line = smoothPath(xy);
    const nodes: SceneNode[] = [];
    if (layer.kind === "area") {
      const first = xy[0]!;
      const end = xy[xy.length - 1]!;
      nodes.push({
        k: "path",
        d: `${line}L${r2(end[0])} ${r2(y + h)}L${r2(first[0])} ${r2(y + h)}Z`,
        fill: linearOver(180, x, y, w, h, [
          { at: 0, color: withAlpha(color, 0.38) },
          { at: 1, color: withAlpha(color, 0) },
        ]),
      });
    }
    if (baseline !== undefined) {
      const by = y + pad + innerH - ((baseline - lo) / span) * innerH;
      nodes.push({ k: "path", d: `M${r2(x)} ${r2(by)}L${r2(x + w)} ${r2(by)}`, stroke: { color: withAlpha(color, 0.5), width: 3, dash: [10, 8], cap: "butt" } });
    }
    nodes.push({ k: "path", d: line, stroke: { color, width: layer.strokeWidth, cap: "round", join: "round" } });
    if (layer.kind === "spark") {
      const end = xy[xy.length - 1]!;
      nodes.push({ k: "ellipse", cx: r2(end[0]), cy: r2(end[1]), rx: layer.strokeWidth * 1.1, ry: layer.strokeWidth * 1.1, fill: color });
    }
    return nodes;
  };
}

function drawStack(layer: ChartLayer, w: number, h: number, d: DrawCtx): ((x: number, y: number) => SceneNode[]) | null {
  const segs = (layer.segments ?? [])
    .map((s) => ({ v: resolveNum(s.value, d.env), color: resolveColor(s.color, d.tokens) }))
    .filter((s): s is { v: number; color: string } => s.v !== undefined && s.v > 0);
  const total = segs.reduce((sum, s) => sum + s.v, 0);
  if (segs.length === 0 || total <= 0) return null;
  const gap = segs.length > 1 ? 4 : 0;
  const usable = w - gap * (segs.length - 1);
  return (x, y) => {
    const children: SceneNode[] = [];
    let cursor = x;
    for (const s of segs) {
      const sw = (s.v / total) * usable;
      children.push({ k: "rect", x: r2(cursor), y: r2(y), w: r2(sw), h: r2(h), fill: s.color });
      cursor += sw + gap;
    }
    return [{ k: "group", clip: { x, y, w, h, rx: Math.min(layer.barRadius, h / 2) }, children }];
  };
}

const MAX_ROUTE_NODES = 600;

export function drawRoute(layer: RouteLayer, w: number, h: number, d: DrawCtx): ((x: number, y: number) => SceneNode[]) | null {
  const points = readRoute(d.env.get(layer.points.bind));
  const trimM = layer.trim === "privacy" ? d.routeTrimMeters : layer.trim;
  const trimmed = trimRoute(points, trimM, trimM);
  if (!trimmed) return null;
  const projected = projectRoute(trimmed, w, h, layer.padding);
  if (!projected) return null;
  const pts = simplify(projected.points, Math.max(0.4, layer.strokeWidth / 12));
  const capped = pts.length > MAX_ROUTE_NODES ? simplify(pts, 2) : pts;
  const color = resolveColor(layer.color, d.tokens);
  const color2 = layer.color2 ? resolveColor(layer.color2, d.tokens) : null;
  return (x, y) => {
    const abs = capped.map(([px, py]): XY => [x + px, y + py]);
    const line = (list: XY[]) => `M${list.map(([px, py]) => `${r2(px)} ${r2(py)}`).join("L")}`;
    const nodes: SceneNode[] = [];
    const sw = layer.strokeWidth;
    if (layer.halo) {
      nodes.push({ k: "path", d: line(abs), stroke: { color: withAlpha(color2 ?? color, 0.28), width: sw * 2.6, cap: "round", join: "round" } });
    }
    if (color2) {
      const segs = 24;
      const lens = [0];
      for (let i = 1; i < abs.length; i++) lens.push(lens[i - 1]! + Math.hypot(abs[i]![0] - abs[i - 1]![0], abs[i]![1] - abs[i - 1]![1]));
      const total = lens[lens.length - 1] || 1;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * total;
        const b = ((s + 1) / segs) * total;
        const part = polylineBetween(abs, lens, a, b);
        if (part.length < 2) continue;
        const t = (s + 0.5) / segs;
        nodes.push({ k: "path", d: line(part), stroke: { color: mixColors(color, color2, t), width: sw, cap: "round", join: "round" } });
      }
    } else {
      nodes.push({
        k: "path",
        d: line(abs),
        stroke: { color, width: sw, cap: "round", join: "round", ...(layer.dash ? { dash: layer.dash } : {}) },
      });
    }
    if (layer.markers && abs.length >= 2) {
      const start = abs[0]!;
      const end = abs[abs.length - 1]!;
      const dot = (p: XY, fill: string) => {
        nodes.push({ k: "ellipse", cx: r2(p[0]), cy: r2(p[1]), rx: sw * 1.5, ry: sw * 1.5, fill, stroke: { color: resolveColor("$bg", d.tokens), width: sw * 0.6 } });
      };
      dot(start, resolveColor("$fg", d.tokens));
      dot(end, color2 ?? color);
    }
    return nodes;
  };
}

function polylineBetween(pts: XY[], lens: number[], from: number, to: number): XY[] {
  const out: XY[] = [];
  const at = (dist: number, i: number): XY => {
    const span = lens[i]! - lens[i - 1]!;
    const t = span === 0 ? 0 : (dist - lens[i - 1]!) / span;
    return [pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * t, pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * t];
  };
  for (let i = 1; i < pts.length; i++) {
    if (lens[i]! < from || lens[i - 1]! > to) continue;
    if (out.length === 0) out.push(at(Math.max(from, lens[i - 1]!), i));
    if (lens[i]! <= to) out.push(pts[i]!);
    else out.push(at(to, i));
  }
  return out;
}
