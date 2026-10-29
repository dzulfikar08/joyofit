import { buildTokens, resolveColor, withAlpha, type Mode, type Tokens } from "./color";
import {
  drawChart,
  drawRing,
  drawRoute,
  gradientStops,
  linearOver,
  radialGlow,
  r2,
  type DrawCtx,
  type Placed,
} from "./draw";
import {
  evalCondition,
  isMissing,
  lookupPath,
  resolveExpr,
  type Env,
  type Translate,
} from "./expr";
import type { Locale } from "./format";
import { ICONS, ICON_VIEWBOX, type IconName } from "./icons";
import type { Issue, Paint, PathNode, Scene, SceneNode, Stroke } from "./scene";
import type {
  Background,
  BrandLayer,
  GroupLayer,
  IconLayer,
  ImageLayer,
  Layer,
  ShapeLayer,
  StatLayer,
  Template,
  TextLayer,
} from "./schema";
import { fitText, measureText, sanitizeText, type FontMap } from "./text";

/**
 * template + data -> Scene. Total: bad input becomes `issues`, never an exception.
 * Layout is two-phase: `measure` produces a `Placed` (size + a paint function) and
 * the parent decides the position.
 */

export type ImageRef = { uri: string; width?: number; height?: number };

export type StickerOptions = {
  watermark: boolean;
  hideNumbers: boolean;
  showName: boolean;
  privacy: { routeTrimMeters: number };
};

export const DEFAULT_OPTIONS: StickerOptions = {
  watermark: true,
  hideNumbers: false,
  showName: false,
  privacy: { routeTrimMeters: 200 },
};

export type StickerData = {
  /** The sticker subject's date (`YYYY-MM-DD`, ISO timestamp or epoch ms), bound as `{date}`. */
  date?: string | number;
  data: Record<string, unknown>;
  assets?: Record<string, ImageRef | undefined>;
  options?: Partial<Omit<StickerOptions, "privacy">> & { privacy?: Partial<StickerOptions["privacy"]> };
};

export type LogoItem = {
  d: string;
  fill?: string;
  stroke?: { color: string; width: number; cap?: "round" | "butt" };
  transform?: { x: number; y: number; scale: number; rotate?: number };
};

/** Host brand art. Colors in the items are literal (or tokens); `tone` picks the ink. */
export type BrandMarks = {
  name: string;
  link: string;
  logo(tone: "light" | "dark" | "mono"): { viewBox: [number, number, number, number]; items: LogoItem[] };
};

export type ResolveCtx = {
  locale: Locale;
  mode: Mode;
  t: Translate;
  fonts: FontMap;
  brand: BrandMarks;
};

type Avail = { w?: number; h?: number; fixW?: number; fixH?: number };

type State = {
  template: Template;
  tokens: Tokens;
  env: Env;
  ctx: ResolveCtx;
  options: StickerOptions;
  issues: Issue[];
  images: string[];
  draw: DrawCtx;
};

export function resolveOptions(input: StickerData["options"]): StickerOptions {
  return {
    watermark: input?.watermark ?? DEFAULT_OPTIONS.watermark,
    hideNumbers: input?.hideNumbers ?? DEFAULT_OPTIONS.hideNumbers,
    showName: input?.showName ?? DEFAULT_OPTIONS.showName,
    privacy: {
      routeTrimMeters: Math.max(0, input?.privacy?.routeTrimMeters ?? DEFAULT_OPTIONS.privacy.routeTrimMeters),
    },
  };
}

function createGetter(input: StickerData, options: StickerOptions, brand: BrandMarks): (path: string) => unknown {
  const optObject = { hideNumbers: options.hideNumbers, showName: options.showName, watermark: options.watermark };
  const appObject = { name: brand.name, link: brand.link };
  const assets = input.assets ?? {};
  return (path) => {
    const dot = path.indexOf(".");
    const head = dot === -1 ? path : path.slice(0, dot);
    const rest = dot === -1 ? "" : path.slice(dot + 1);
    if (head === "opt") return rest ? lookupPath(optObject, rest) : undefined;
    if (head === "app") return rest ? lookupPath(appObject, rest) : undefined;
    if (path === "date") return input.date;
    if (head === "user" && !options.showName) return undefined;
    if (dot === -1 && Object.hasOwn(assets, head)) return assets[head];
    return lookupPath(input.data, path);
  };
}

/**
 * Whether a template can be offered for this data: every `requires` path resolves,
 * and a photo/route template has its photo/route. Cheap; no layout.
 */
export function isAvailable(template: Template, input: StickerData, brand: BrandMarks): boolean {
  const get = createGetter(input, resolveOptions(input.options), brand);
  if (template.requires?.some((path) => isMissing(get(path)))) return false;
  if (template.meta?.needsPhoto && isMissing(get("photo"))) return false;
  return true;
}

export function resolve(template: Template, input: StickerData, ctx: ResolveCtx): Scene {
  const issues: Issue[] = [];
  const options = resolveOptions(input.options);
  const tokens = buildTokens(template.themes[ctx.mode], ctx.mode);
  const get = createGetter(input, options, ctx.brand);
  const env: Env = { locale: ctx.locale, get, t: ctx.t, issues };
  const state: State = {
    template,
    tokens,
    env,
    ctx,
    options,
    issues,
    images: [],
    draw: { env, tokens, fonts: ctx.fonts, routeTrimMeters: options.privacy.routeTrimMeters },
  };
  const { width, height } = template.canvas;
  const nodes: SceneNode[] = [];
  const bg = paintBackground(state, template.background, width, height);
  nodes.push(...bg.nodes);
  for (const layer of template.layers) {
    const placed = measureLayer(state, layer, { w: width - layer.box.x, h: height - layer.box.y });
    if (placed) nodes.push(...placed.paint(layer.box.x, layer.box.y));
  }
  return {
    width,
    height,
    nodes,
    transparent: bg.transparent,
    needsImages: [...new Set(state.images)],
    issues,
  };
}

// ---------------------------------------------------------------- background

function imageFor(state: State, bind: string): ImageRef | null {
  const v = state.env.get(bind);
  if (v && typeof v === "object" && "uri" in v && typeof v.uri === "string" && v.uri) {
    return v as ImageRef;
  }
  return null;
}

function paintBackground(state: State, bg: Background, w: number, h: number): { nodes: SceneNode[]; transparent: boolean } {
  const { tokens } = state;
  switch (bg.kind) {
    case "transparent":
      return { nodes: [], transparent: true };
    case "color":
      return { nodes: [{ k: "rect", x: 0, y: 0, w, h, fill: resolveColor(bg.color, tokens) }], transparent: false };
    case "gradient": {
      const nodes: SceneNode[] = [
        { k: "rect", x: 0, y: 0, w, h, fill: linearOver(bg.angle, 0, 0, w, h, gradientStops(bg.stops, tokens)) },
      ];
      for (const glow of bg.glows ?? []) {
        nodes.push({
          k: "rect", x: 0, y: 0, w, h,
          fill: radialGlow(glow.x, glow.y, glow.r, resolveColor(glow.color, tokens), glow.opacity),
        });
      }
      return { nodes, transparent: false };
    }
    case "photo":
    case "map": {
      const image = imageFor(state, bg.bind);
      if (!image) return paintBackground(state, bg.fallback, w, h);
      state.images.push(image.uri);
      const nodes: SceneNode[] = [{ k: "image", x: 0, y: 0, w, h, uri: image.uri, fit: bg.fit }];
      if (bg.kind === "photo" && bg.tint) {
        nodes.push({ k: "rect", x: 0, y: 0, w, h, fill: resolveColor(bg.tint.color, tokens, bg.tint.opacity) });
      }
      if (bg.scrim) {
        const c = resolveColor(bg.scrim.color, tokens);
        const strong = withAlpha(c, bg.scrim.opacity);
        const clear = withAlpha(c, 0);
        const from = bg.scrim.from;
        const gradientRect = (y0: number, y1: number, stops: { at: number; color: string }[]) =>
          nodes.push({ k: "rect", x: 0, y: y0, w, h: y1 - y0, fill: linearOver(180, 0, y0, w, y1 - y0, stops) });
        if (bg.scrim.side === "full") nodes.push({ k: "rect", x: 0, y: 0, w, h, fill: strong });
        if (bg.scrim.side === "bottom" || bg.scrim.side === "both") {
          gradientRect(h * from, h, [{ at: 0, color: clear }, { at: 1, color: strong }]);
        }
        if (bg.scrim.side === "top" || bg.scrim.side === "both") {
          gradientRect(0, h * (1 - from), [{ at: 0, color: strong }, { at: 1, color: clear }]);
        }
      }
      return { nodes, transparent: false };
    }
  }
}

// ------------------------------------------------------------------- layers

function visible(state: State, layer: Layer): boolean {
  if (layer.role === "watermark" && !state.options.watermark) return false;
  if (layer.when && !evalCondition(layer.when, state.env)) return false;
  return true;
}

/** Forced > numeric box > fill (the offered size) > undefined (auto). */
function dimW(layer: Layer, a: Avail): number | undefined {
  if (a.fixW !== undefined) return a.fixW;
  if (typeof layer.box.w === "number") return layer.box.w;
  return layer.box.w === "fill" ? a.w : undefined;
}
function dimH(layer: Layer, a: Avail): number | undefined {
  if (a.fixH !== undefined) return a.fixH;
  if (typeof layer.box.h === "number") return layer.box.h;
  return layer.box.h === "fill" ? a.h : undefined;
}

function measureLayer(state: State, layer: Layer, avail: Avail): Placed | null {
  if (!visible(state, layer)) return null;
  const placed = measureInner(state, layer, avail);
  if (!placed) return null;
  if (layer.opacity === undefined && !layer.rotation) return placed;
  const { opacity, rotation } = layer;
  return {
    w: placed.w,
    h: placed.h,
    paint: (x, y) => {
      const children = placed.paint(x, y);
      const group: SceneNode = {
        k: "group",
        children,
        ...(opacity !== undefined && opacity < 1 ? { opacity } : {}),
        ...(rotation ? { rotate: { deg: rotation, cx: r2(x + placed.w / 2), cy: r2(y + placed.h / 2) } } : {}),
      };
      return [group];
    },
  };
}

function measureInner(state: State, layer: Layer, avail: Avail): Placed | null {
  switch (layer.type) {
    case "text":
      return measureTextLayer(state, layer, avail);
    case "stat":
      return measureStat(state, layer, avail);
    case "ring": {
      const { w, h } = squareish(layer, avail, 200);
      const paint = drawRing(layer, w, h, state.draw);
      return paint ? { w, h, paint } : null;
    }
    case "chart": {
      const { w, h } = squareish(layer, avail, 240);
      const paint = drawChart(layer, w, h, state.draw);
      return paint ? { w, h, paint } : null;
    }
    case "route": {
      const { w, h } = squareish(layer, avail, 600);
      const paint = drawRoute(layer, w, h, state.draw);
      return paint ? { w, h, paint } : null;
    }
    case "image":
      return measureImage(state, layer, avail);
    case "brand":
      return measureBrand(state, layer, avail);
    case "icon":
      return measureIcon(state, layer, avail);
    case "shape":
      return measureShape(state, layer, avail);
    case "group":
      return measureGroup(state, layer, avail);
  }
}

function squareish(layer: Layer, avail: Avail, fallback: number): { w: number; h: number } {
  return { w: dimW(layer, avail) ?? fallback, h: dimH(layer, avail) ?? dimW(layer, avail) ?? fallback };
}

// --- text

function anchorOf(align: "left" | "center" | "right"): "start" | "middle" | "end" {
  return align === "center" ? "middle" : align === "right" ? "end" : "start";
}

type TextRun = { lines: string[]; size: number; width: number };

function missingText(layer: { onMissing: "hide" | "keep"; fallback?: string }): string | null {
  return layer.onMissing === "keep" ? (layer.fallback ?? "-") : null;
}

function measureTextLayer(state: State, layer: TextLayer, avail: Avail): Placed | null {
  const { template, ctx } = state;
  const raw = resolveExpr(layer.value, state.env) ?? missingText(layer);
  if (raw === null) return null;
  const minFont = template.constraints.minFontSize;
  const text = sanitizeText(layer.case === "upper" ? raw.toUpperCase() : raw, template.constraints.maxTextChars);
  if (text === "") return null;
  const size = Math.max(layer.size, minFont);
  if (size !== layer.size) state.issues.push({ code: "text-too-small", message: `size ${layer.size} raised to ${minFont}`, layerId: layer.id });
  const metrics = ctx.fonts.metrics(layer.font, layer.weight);
  const fixedW = dimW(layer, avail);
  const cap = fixedW ?? avail.w ?? Infinity;
  const fitted: TextRun = fitText(text, metrics, {
    size,
    minSize: Math.max(layer.fit.minSize ?? minFont, minFont),
    maxWidth: cap,
    mode: layer.fit.mode,
    maxLines: layer.fit.maxLines ?? 2,
    letterSpacing: layer.letterSpacing,
  });
  const lineH = fitted.size * layer.lineHeight;
  const single = fitted.lines.length === 1;
  const capTrim = layer.trim === "cap" && single;
  const contentH = capTrim ? metrics.cap * fitted.size : fitted.lines.length * lineH;
  const w = fixedW ?? fitted.width;
  const boxH = dimH(layer, avail);
  const h = boxH ?? contentH;
  const offsetY = boxH === undefined ? 0 : layer.valign === "middle" ? (boxH - contentH) / 2 : layer.valign === "bottom" ? boxH - contentH : 0;
  const fill = resolveColor(layer.color, state.tokens);
  const anchor = anchorOf(layer.align);
  const dx = layer.align === "center" ? w / 2 : layer.align === "right" ? w : 0;
  return {
    w,
    h,
    paint: (x, y) => {
      const nodes: SceneNode[] = [];
      fitted.lines.forEach((line, i) => {
        const baseline = capTrim
          ? y + offsetY + metrics.cap * fitted.size
          : y + offsetY + i * lineH + (lineH - (metrics.asc + metrics.desc) * fitted.size) / 2 + metrics.asc * fitted.size;
        const base = {
          k: "text" as const,
          x: r2(x + dx),
          y: r2(baseline),
          text: line,
          size: fitted.size,
          weight: layer.weight,
          font: layer.font,
          anchor,
          ...(layer.letterSpacing ? { letterSpacing: layer.letterSpacing } : {}),
        };
        if (layer.shadow) nodes.push(...textShadow(base, fitted.size, fill));
        nodes.push({ ...base, fill });
      });
      return nodes;
    },
  };
}

/** Perceived brightness 0..1 of a resolved `#rrggbb[aa]`. */
function brightness(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  return 0.299 * r! + 0.587 * g! + 0.114 * b!;
}

/** Soft dark copies behind light text; dark ink never gets a smudge. */
function textShadow(base: Omit<Extract<SceneNode, { k: "text" }>, "fill">, size: number, ink: string): SceneNode[] {
  if (brightness(ink) < 0.55) return [];
  return [
    { ...base, y: r2(base.y + size * 0.05), fill: "#00000038" },
    { ...base, y: r2(base.y + size * 0.025), fill: "#0000004d" },
  ];
}

// --- stat

function measureStat(state: State, layer: StatLayer, avail: Avail): Placed | null {
  const { ctx, template } = state;
  const value = resolveExpr(layer.value, state.env) ?? missingText(layer);
  if (value === null) return null;
  const unit = layer.unit ? resolveExpr(layer.unit, state.env) : undefined;
  const label = layer.labelPos !== "none" && layer.label ? resolveExpr(layer.label, state.env) : undefined;
  const minFont = template.constraints.minFontSize;
  const fixedW = dimW(layer, avail);
  const cap = fixedW ?? avail.w ?? Infinity;
  const vMetrics = ctx.fonts.metrics(layer.font, layer.valueWeight);
  const uMetrics = ctx.fonts.metrics(layer.font, 700);
  const lMetrics = ctx.fonts.metrics("body", 600);
  const unitFor = (vs: number) => Math.max(minFont, layer.unitSize ? (layer.unitSize * vs) / layer.valueSize : vs * 0.34);
  const rowWidth = (vs: number, text: string) =>
    measureText(text, vMetrics, vs) + (unit ? unitFor(vs) * 0.3 + measureText(unit, uMetrics, unitFor(vs)) : 0);
  let vs = Math.max(layer.valueSize, minFont);
  const floor = Math.max(layer.fit.minSize ?? minFont, minFont);
  let valueText = sanitizeText(value, template.constraints.maxTextChars);
  while (vs > floor && rowWidth(vs, valueText) > cap) vs--;
  if (rowWidth(vs, valueText) > cap) {
    const unitW = unit ? unitFor(vs) * 1.3 + measureText(unit, uMetrics, unitFor(vs)) : 0;
    valueText = fitText(valueText, vMetrics, { size: vs, minSize: vs, maxWidth: Math.max(10, cap - unitW), mode: "ellipsis", maxLines: 1 }).lines[0] ?? valueText;
  }
  const us = unitFor(vs);
  const valueW = rowWidth(vs, valueText);
  const valueH = layer.trim === "cap" ? vMetrics.cap * vs : vs * 1.1;
  const ls = Math.max(layer.labelSize, minFont);
  const labelText = label ? fitText(sanitizeText(label), lMetrics, { size: ls, minSize: ls, maxWidth: cap, mode: "ellipsis", maxLines: 1 }) : null;
  const labelH = labelText ? ls * 1.15 : 0;
  const gap = labelText ? layer.gap : 0;
  const w = fixedW ?? Math.max(valueW, labelText?.width ?? 0);
  const h = valueH + gap + labelH;
  const fill = resolveColor(layer.color, state.tokens);
  const labelFill = resolveColor(layer.labelColor, state.tokens);
  const anchor = anchorOf(layer.align);
  const ax = layer.align === "center" ? w / 2 : layer.align === "right" ? w : 0;
  const rowStart = layer.align === "center" ? (w - valueW) / 2 : layer.align === "right" ? w - valueW : 0;
  return {
    w,
    h,
    paint: (x, y) => {
      const nodes: SceneNode[] = [];
      const labelTop = layer.labelPos === "above" ? y : y + valueH + gap;
      const valueTop = layer.labelPos === "above" && labelText ? y + labelH + gap : y;
      if (labelText) {
        const labelBaseline = (labelH - (lMetrics.asc + lMetrics.desc) * ls) / 2 + lMetrics.asc * ls;
        nodes.push({
          k: "text", x: r2(x + ax), y: r2(labelTop + labelBaseline), text: labelText.lines[0]!, size: ls, weight: 600,
          font: "body", fill: labelFill, anchor,
        });
      }
      const baseline = valueTop + (layer.trim === "cap" ? vMetrics.cap * vs : vs * 0.85);
      const textNode = (text: string, tx: number, size: number, weight: number, color: string, role: "display" | "body" | "mono", anchorTo: "start" | "middle" | "end"): SceneNode[] => {
        const node = { k: "text" as const, x: r2(tx), y: r2(baseline), text, size, weight, font: role, anchor: anchorTo };
        return layer.shadow ? [...textShadow(node, size, color), { ...node, fill: color }] : [{ ...node, fill: color }];
      };
      nodes.push(...textNode(valueText, x + rowStart, vs, layer.valueWeight, fill, layer.font, "start"));
      if (unit) {
        nodes.push(...textNode(unit, x + rowStart + measureText(valueText, vMetrics, vs) + us * 0.3, us, 700, resolveColor("$fgSoft", state.tokens), layer.font, "start"));
      }
      return nodes;
    },
  };
}

// --- image, brand, icon, shape

function measureImage(state: State, layer: ImageLayer, avail: Avail): Placed | null {
  const ref = "bind" in layer.src ? imageFor(state, layer.src.bind) : imageFor(state, layer.src.asset);
  if (!ref) return null;
  const w = dimW(layer, avail) ?? 256;
  const h = dimH(layer, avail) ?? w;
  state.images.push(ref.uri);
  const rx = layer.mask === "circle" ? Math.min(w, h) / 2 : layer.mask === "rounded" ? (layer.radius ?? 24) : layer.radius;
  return {
    w,
    h,
    paint: (x, y) => {
      const nodes: SceneNode[] = [{ k: "image", x: r2(x), y: r2(y), w, h, uri: ref.uri, fit: layer.fit, ...(rx ? { rx } : {}) }];
      if (layer.border && layer.border.width > 0) {
        nodes.push({ k: "rect", x: r2(x), y: r2(y), w, h, rx, stroke: { color: resolveColor(layer.border.color, state.tokens), width: layer.border.width } });
      }
      return nodes;
    },
  };
}

function logoNodes(
  state: State,
  tone: "light" | "dark" | "mono",
  x: number,
  y: number,
  size: number,
): { nodes: SceneNode[]; w: number } {
  const logo = state.ctx.brand.logo(tone);
  const [vx, vy, vw, vh] = logo.viewBox;
  const s = size / vh;
  const nodes: SceneNode[] = logo.items.map((item): PathNode => {
    const t = item.transform ?? { x: 0, y: 0, scale: 1 };
    const out: PathNode = {
      k: "path",
      d: item.d,
      transform: {
        x: r2(x + (t.x - vx) * s),
        y: r2(y + (t.y - vy) * s),
        scale: s * t.scale,
        ...(t.rotate ? { rotate: t.rotate } : {}),
      },
    };
    if (item.fill) out.fill = resolveColor(item.fill, state.tokens);
    if (item.stroke) {
      out.stroke = { color: resolveColor(item.stroke.color, state.tokens), width: item.stroke.width, cap: item.stroke.cap ?? "round" };
    }
    return out;
  });
  return { nodes, w: vw * s };
}

function measureBrand(state: State, layer: BrandLayer, avail: Avail): Placed | null {
  const { ctx } = state;
  const tone = layer.tone === "auto" ? (ctx.mode === "dark" ? "light" : "dark") : layer.tone;
  const h = layer.size ?? dimH(layer, avail) ?? 56;
  const ink = tone === "dark" ? resolveColor("#1d1a15", state.tokens) : tone === "mono" ? resolveColor("$fg", state.tokens) : resolveColor("#ffffff", state.tokens);
  const textSize = Math.max(state.template.constraints.minFontSize, h * 0.62);
  const metrics = (weight: number) => ctx.fonts.metrics("display", weight);
  if (layer.mark === "logo") {
    const { w } = logoNodes(state, tone, 0, 0, h);
    return { w, h, paint: (x, y) => logoNodes(state, tone, x, y, h).nodes };
  }
  if (layer.mark === "link") {
    const text = ctx.brand.link;
    const size = Math.max(state.template.constraints.minFontSize, layer.size ?? textSize);
    const w = measureText(text, metrics(600), size);
    const fill = resolveColor(layer.tone === "auto" ? "$fgMuted" : ink, state.tokens);
    return {
      w,
      h: size,
      paint: (x, y) => [{ k: "text", x: r2(x), y: r2(y + metrics(600).cap * size), text, size, weight: 600, font: "display", fill, anchor: "start" }],
    };
  }
  const nameW = measureText(ctx.brand.name, metrics(800), textSize);
  if (layer.mark === "wordmark") {
    const fill = resolveColor(layer.tone === "auto" ? "$fg" : ink, state.tokens);
    return {
      w: nameW,
      h: textSize,
      paint: (x, y) => [{ k: "text", x: r2(x), y: r2(y + metrics(800).cap * textSize), text: ctx.brand.name, size: textSize, weight: 800, font: "display", fill, anchor: "start" }],
    };
  }
  const logoW = logoNodes(state, tone, 0, 0, h).w;
  const gap = h * 0.28;
  const fill = resolveColor(layer.tone === "auto" ? "$fg" : ink, state.tokens);
  return {
    w: logoW + gap + nameW,
    h,
    paint: (x, y) => [
      ...logoNodes(state, tone, x, y, h).nodes,
      { k: "text", x: r2(x + logoW + gap), y: r2(y + h / 2 + (metrics(800).cap * textSize) / 2), text: ctx.brand.name, size: textSize, weight: 800, font: "display", fill, anchor: "start" },
    ],
  };
}

function measureIcon(state: State, layer: IconLayer, avail: Avail): Placed | null {
  const paths = ICONS[layer.name as IconName];
  if (!paths) {
    state.issues.push({ code: "unknown-icon", message: layer.name, layerId: layer.id });
    return null;
  }
  const w = dimW(layer, avail) ?? 48;
  const h = dimH(layer, avail) ?? w;
  const size = Math.min(w, h);
  const fill = resolveColor(layer.color, state.tokens);
  return {
    w,
    h,
    paint: (x, y) =>
      paths.map((d): SceneNode => ({
        k: "path",
        d,
        fill,
        transform: { x: r2(x + (w - size) / 2), y: r2(y + (h - size) / 2), scale: size / ICON_VIEWBOX },
      })),
  };
}

type PanelStyle = Pick<ShapeLayer, "fill" | "stroke" | "radius" | "glass">;

function paintOf(state: State, fill: NonNullable<PanelStyle["fill"]>, x: number, y: number, w: number, h: number): Paint {
  if (typeof fill === "string") return resolveColor(fill, state.tokens);
  return linearOver(fill.gradient.angle, x, y, w, h, gradientStops(fill.gradient.stops, state.tokens));
}

function panelNodes(state: State, style: PanelStyle, x: number, y: number, w: number, h: number): SceneNode[] {
  if (!style.fill && !style.stroke && !style.glass) return [];
  const rx = style.radius === undefined ? undefined : Math.min(style.radius, Math.min(w, h) / 2);
  const fill = style.fill ? paintOf(state, style.fill, x, y, w, h) : style.glass ? resolveColor("$surface", state.tokens) : undefined;
  let stroke: Stroke | undefined = style.stroke ? { color: resolveColor(style.stroke.color, state.tokens), width: style.stroke.width, ...(style.stroke.dash ? { dash: style.stroke.dash } : {}) } : undefined;
  if (style.glass && !stroke) {
    stroke = {
      color: linearOver(135, x, y, w, h, [
        { at: 0, color: "#ffffff73" },
        { at: 0.5, color: "#ffffff1a" },
        { at: 1, color: "#ffffff38" },
      ]),
      width: 2,
    };
  }
  return [{ k: "rect", x: r2(x), y: r2(y), w, h, ...(rx !== undefined ? { rx } : {}), ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) }];
}

function measureShape(state: State, layer: ShapeLayer, avail: Avail): Placed | null {
  const w = dimW(layer, avail) ?? 100;
  const h = dimH(layer, avail) ?? (layer.shape === "line" ? 0 : 100);
  return {
    w,
    h,
    paint: (x, y) => {
      if (layer.shape === "rect") return panelNodes(state, layer, x, y, w, h);
      if (layer.shape === "ellipse") {
        const fill = layer.fill ? paintOf(state, layer.fill, x, y, w, h) : layer.glass ? resolveColor("$surface", state.tokens) : undefined;
        const stroke = layer.stroke ? { color: resolveColor(layer.stroke.color, state.tokens), width: layer.stroke.width, ...(layer.stroke.dash ? { dash: layer.stroke.dash } : {}) } : undefined;
        return [{ k: "ellipse", cx: r2(x + w / 2), cy: r2(y + h / 2), rx: w / 2, ry: h / 2, ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) }];
      }
      if (layer.shape === "line") {
        const color = resolveColor(layer.stroke?.color ?? "$line", state.tokens);
        const width = layer.stroke?.width ?? 2;
        return [{ k: "path", d: `M${r2(x)} ${r2(y + h / 2)}L${r2(x + w)} ${r2(y + h / 2)}`, stroke: { color, width, cap: "round", ...(layer.stroke?.dash ? { dash: layer.stroke.dash } : {}) } }];
      }
      if (!layer.d) return [];
      const [vw, vh] = layer.viewBox ?? [0, 0];
      const scale = vw > 0 && vh > 0 ? Math.min(w / vw, h / vh) : 1;
      const ox = vw > 0 && vh > 0 ? (w - vw * scale) / 2 : 0;
      const oy = vw > 0 && vh > 0 ? (h - vh * scale) / 2 : 0;
      const node: PathNode = { k: "path", d: layer.d, transform: { x: r2(x + ox), y: r2(y + oy), scale } };
      if (layer.fill) node.fill = paintOf(state, layer.fill, x, y, w, h);
      if (layer.stroke) node.stroke = { color: resolveColor(layer.stroke.color, state.tokens), width: layer.stroke.width / scale, cap: "round", join: "round" };
      return [node];
    },
  };
}

// --- group

type Child = { placed: Placed; x: number; y: number };

function measureGroup(state: State, layer: GroupLayer, avail: Avail): Placed | null {
  const fixedW = dimW(layer, avail);
  const fixedH = dimH(layer, avail);
  const layout = layer.layout;
  let children: Child[];
  let w: number;
  let h: number;
  if (!layout) {
    children = [];
    for (const child of layer.children) {
      const placed = measureLayer(state, child, { w: (fixedW ?? avail.w ?? Infinity) - child.box.x, h: (fixedH ?? avail.h ?? Infinity) - child.box.y });
      if (placed) children.push({ placed, x: child.box.x, y: child.box.y });
    }
    w = fixedW ?? Math.max(0, ...children.map((c) => c.x + c.placed.w));
    h = fixedH ?? Math.max(0, ...children.map((c) => c.y + c.placed.h));
  } else {
    const stacked = layoutStack(state, layer, layout, fixedW, fixedH, avail);
    children = stacked.children;
    w = stacked.w;
    h = stacked.h;
  }
  if (children.length === 0 && !layer.fill && !layer.stroke && !layer.glass) return null;
  return {
    w,
    h,
    paint: (x, y) => {
      const nodes = panelNodes(state, layer, x, y, w, h);
      const inner = children.flatMap((c) => c.placed.paint(x + c.x, y + c.y));
      if (layer.clip) {
        nodes.push({ k: "group", clip: { x, y, w, h, rx: layer.radius }, children: inner });
      } else {
        nodes.push(...inner);
      }
      return nodes;
    },
  };
}

function layoutStack(
  state: State,
  layer: GroupLayer,
  layout: NonNullable<GroupLayer["layout"]>,
  fixedW: number | undefined,
  fixedH: number | undefined,
  avail: Avail,
): { children: Child[]; w: number; h: number } {
  const row = layout.dir === "row";
  const pad = layout.padding;
  const innerW = (fixedW ?? avail.w) === undefined ? undefined : (fixedW ?? avail.w!) - pad * 2;
  const innerH = (fixedH ?? avail.h) === undefined ? undefined : (fixedH ?? avail.h!) - pad * 2;
  const mainAvail = row ? innerW : innerH;
  const crossAvail = row ? innerH : innerW;
  const fillMain = (c: Layer) => (row ? c.box.w : c.box.h) === "fill";

  const placed: { layer: Layer; p: Placed | null }[] = layer.children.map((c) => ({ layer: c, p: null }));
  const visibleLayers = placed.filter((e) => visible(state, e.layer));
  // Pass 1: everything that does not fill the main axis.
  for (const e of visibleLayers) {
    if (fillMain(e.layer)) continue;
    e.p = measureLayer(state, e.layer, row ? { w: mainAvail, h: crossAvail } : { w: crossAvail, h: mainAvail });
  }
  const live1 = visibleLayers.filter((e) => e.p || fillMain(e.layer));
  const gaps = Math.max(0, live1.length - 1) * layout.gap;
  const used = live1.reduce((s, e) => s + (e.p ? (row ? e.p.w : e.p.h) : 0), 0);
  const fillers = live1.filter((e) => fillMain(e.layer));
  const share = mainAvail === undefined || fillers.length === 0 ? 0 : Math.max(0, (mainAvail - used - gaps) / fillers.length);
  for (const e of fillers) {
    e.p = measureLayer(state, e.layer, row ? { w: share, h: crossAvail, fixW: share } : { w: crossAvail, h: share, fixH: share });
  }
  const live = live1.filter((e) => e.p);
  const mainUsed = live.reduce((s, e) => s + (row ? e.p!.w : e.p!.h), 0) + Math.max(0, live.length - 1) * layout.gap;
  const crossContent = Math.max(0, ...live.map((e) => (row ? e.p!.h : e.p!.w)));
  const mainSize = (row ? fixedW : fixedH) ?? mainUsed + pad * 2;
  const crossSize = (row ? fixedH : fixedW) ?? crossContent + pad * 2;
  const innerMain = mainSize - pad * 2;
  const innerCross = crossSize - pad * 2;

  const slack = Math.max(0, innerMain - mainUsed);
  let cursor = pad;
  let between = layout.gap;
  if (layout.justify === "center") cursor += slack / 2;
  else if (layout.justify === "end") cursor += slack;
  else if (layout.justify === "between" && live.length > 1) between = layout.gap + slack / (live.length - 1);

  const children: Child[] = [];
  for (const e of live) {
    let p = e.p!;
    if (layout.align === "stretch" && (row ? e.layer.box.h : e.layer.box.w) === "auto") {
      const restretched = measureLayer(state, e.layer, row ? { w: p.w, h: innerCross, fixW: p.w, fixH: innerCross } : { w: innerCross, h: p.h, fixW: innerCross, fixH: p.h });
      if (restretched) p = restretched;
    }
    const crossSizeNow = row ? p.h : p.w;
    const crossOffset = layout.align === "center" ? (innerCross - crossSizeNow) / 2 : layout.align === "end" ? innerCross - crossSizeNow : 0;
    const cx = row ? cursor : pad + crossOffset;
    const cy = row ? pad + crossOffset : cursor;
    children.push({ placed: p, x: cx, y: cy });
    cursor += (row ? p.w : p.h) + between;
  }
  return { children, w: row ? mainSize : crossSize, h: row ? crossSize : mainSize };
}
