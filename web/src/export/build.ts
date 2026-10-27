import {
  FaceBuilder,
  previewSizes,
  VALUE_TYPE,
  checkFit4Limits,
  createHwt,
  describeLayout,
  encodeImage,
  getLayout,
  readHwt,
  readImageHeader,
  verifyWatchface,
  writeHwt,
  writeWatchface,
  FIT4_LIMITS,
  type ElementBuilder,
  type HwtPackage,
  type RgbaImage,
  type WatchfaceBinary,
} from "@joyofit/hwt";
import { getAsset } from "@/model/assets";
import { hwtFileName } from "@/model/defaults";
import type { ScreenSize } from "@/model/screens";
import type { Element, HandElement, Project, Sim } from "@/model/types";
import { i18n } from "@/i18n";
import { fieldDef } from "@/model/fields";
import { fontsOf } from "@/editor/useFonts";
import { renderIconSet } from "@/render/iconsets";
import { context2d, createSurface, newSprite, scaleSprite, spriteRgba, surfaceToJpeg, type Sprite } from "@/render/canvas";
import { ensureFont, fontFailed } from "@/render/fonts";
import type { DigitSet } from "@/render/glyphs";
import { layoutOf, renderBackgroundSprite, drawProject } from "@/render/scene";
import type { Part } from "@/render/layout";
import { shownSim, type DataRole } from "@/render/values";
import { renderHand, renderRing } from "@/render/shapes";
import { HAND_VALUE, minusDropped, elementSupport, isExportable, type SupportLevel } from "./support";
import { hwtTarget, type HwtStatus } from "./target";

export type NoteLevel = "info" | "warning" | "error";

export interface ExportNote {
  level: NoteLevel;
  text: string;
  /** A Huawei size limit: shown after the other notes. */
  limit?: boolean;
  /** Says the screen has not been tried on a watch: the export dialog shows that as its own row, so it skips this note. */
  screenStatus?: boolean;
}

export interface ExportOptions {
  /** Write elements whose ids are inferred rather than confirmed (hour and minute hands, seconds digits, inferred data fields). */
  includeExperimental: boolean;
}

export interface ExportedElement {
  id: string;
  name: string;
  type: Element["type"];
  exported: boolean;
  /** Why an element was left out, or what part of it was. */
  detail: string;
  /** How well the ids behind it are known. */
  level: SupportLevel;
  /** Parts of an exported element that stay preview only. */
  dropped: string[];
}

export interface ExportStats {
  images: number;
  /** Encoded bytes of all images in the face. */
  imageBytes: number;
  /** Bytes of the finished `.hwt`. */
  totalBytes: number;
  largestImageBytes: number;
  imageMemoryBytes: number;
  layerBytes: number;
}

export interface ExportResult {
  fileName: string;
  bytes: Uint8Array;
  notes: ExportNote[];
  elements: ExportedElement[];
  stats: ExportStats;
  /** The Huawei screen code and version the file is written for, and how far that can be trusted. */
  target: { code: string; version: string; status: HwtStatus; limitsKnown: boolean };
  /** Layout and image table as JSON, for the troubleshooting sidecar. */
  debug: Record<string, unknown>;
}

/** An element that cannot be placed on the watch's coordinate system (negative origin for a sprite). */
class LeftOut extends Error {}

const BLACK_AOD = "#000000";

function mixToBlack(hex: string, keep: number): string {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * keep));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Always-on display look: same layout, colors at 45 percent, no seconds. */
function dimmed(el: Element): Element {
  const keep = 0.45;
  switch (el.type) {
    case "time":
      return { ...el, color: mixToBlack(el.color, keep), outline: el.outline && { ...el.outline, color: mixToBlack(el.outline.color, keep) }, showSeconds: false, ampm: false };
    case "date":
      return { ...el, color: mixToBlack(el.color, keep), outline: el.outline && { ...el.outline, color: mixToBlack(el.outline.color, keep) } };
    case "hand":
      return el.shape === "custom" ? el : { ...el, color: mixToBlack(el.color, keep) };
    default:
      return el;
  }
}

function rgba(sprite: Sprite): RgbaImage {
  const { data, width, height } = spriteRgba(sprite);
  return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

function solid(width: number, height: number, color: string): Sprite {
  const { sprite, ctx } = newSprite(width, height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return sprite;
}

function digitImages(set: DigitSet): RgbaImage[] {
  return set.digits.map(rgba);
}

function ensureOnScreen(name: string, x: number, y: number): void {
  if (x < 0 || y < 0) throw new LeftOut(i18n.t("export:build.offScreen", { name }));
}

/** Copy of the part of `sprite` that lies on the screen, with its new origin, or null when none does. */
function cropToScreen(sprite: Sprite, x: number, y: number, screen: ScreenSize): { sprite: Sprite; x: number; y: number } | null {
  const left = Math.max(0, -x);
  const top = Math.max(0, -y);
  const right = Math.min(sprite.width, screen.width - x);
  const bottom = Math.min(sprite.height, screen.height - y);
  if (right <= left || bottom <= top) return null;
  if (left === 0 && top === 0 && right === sprite.width && bottom === sprite.height) return { sprite, x, y };
  const { sprite: out, ctx } = newSprite(right - left, bottom - top);
  ctx.drawImage(sprite.surface as unknown as CanvasImageSource, left, top, right - left, bottom - top, 0, 0, right - left, bottom - top);
  return { sprite: out, x: x + left, y: y + top };
}

/**
 * One image per call, split into horizontal bands when the encoded image would exceed Huawei's single image limit (750 KB, from
 * the HWHD13 page). Other screens get the same cut-off: their own limit is not known, and a smaller image is never the problem.
 */
function staticImage(e: ElementBuilder, sprite: Sprite, x: number, y: number, ambient: "normal" | "aod" | "both", screen: ScreenSize): number {
  const placed = cropToScreen(sprite, x, y, screen);
  if (!placed) return 0;
  const limit = FIT4_LIMITS.maxImageBytes * 0.92;
  const full = rgba(placed.sprite);
  if (encodeImage(full).length <= limit || placed.sprite.height < 2) {
    e.singleImage({ image: full, x: placed.x, y: placed.y, ambient });
    return 1;
  }
  let bands = 2;
  while (bands < placed.sprite.height) {
    const rows = Math.ceil(placed.sprite.height / bands);
    let fits = true;
    for (let top = 0; top < placed.sprite.height && fits; top += rows) {
      const h = Math.min(rows, placed.sprite.height - top);
      const slice = newSprite(placed.sprite.width, h);
      slice.ctx.drawImage(placed.sprite.surface as unknown as CanvasImageSource, 0, top, placed.sprite.width, h, 0, 0, placed.sprite.width, h);
      fits = encodeImage(rgba(slice.sprite)).length <= limit;
    }
    if (fits) break;
    bands++;
  }
  const rows = Math.ceil(placed.sprite.height / bands);
  let count = 0;
  for (let top = 0; top < placed.sprite.height; top += rows) {
    const h = Math.min(rows, placed.sprite.height - top);
    const slice = newSprite(placed.sprite.width, h);
    slice.ctx.drawImage(placed.sprite.surface as unknown as CanvasImageSource, 0, top, placed.sprite.width, h, 0, 0, placed.sprite.width, h);
    e.singleImage({ image: rgba(slice.sprite), x: placed.x, y: placed.y + top, ambient });
    count++;
  }
  return count;
}

type Mode = "normal" | "aod";

/** Emits the parts of a text-like element (time, date, widget). Returns what was left out. */
function emitParts(e: ElementBuilder, el: Element, parts: Part[], mode: Mode, notes: string[]): void {
  for (const part of parts) {
    const x = el.x + part.x;
    const y = el.y + part.y;
    if (part.kind === "icon") {
      ensureOnScreen(el.name, x, y);
      e.singleImage({ image: rgba(part.sprite), x, y, ambient: mode });
    } else if (part.kind === "colon") {
      ensureOnScreen(el.name, x, y);
      e.singleImage({ image: rgba(part.set.colon), x, y, ambient: mode });
    } else if (part.kind === "words") {
      if (part.role === "ampm") {
        if (!notes.includes("AM/PM marker")) notes.push("AM/PM marker");
        continue;
      }
      ensureOnScreen(el.name, x, y);
      const images = part.words.map((w) => rgba(part.set.words.get(w)!));
      // Index = value: 1..7 Monday..Sunday and 1..12 January..December; slot 0 repeats slot 1 as the samples do.
      e.selected({ images: [images[0]!, ...images], x, y, valueType: part.role === "weekday" ? VALUE_TYPE.week : VALUE_TYPE.month, ambient: mode });
    } else if (part.role === "second") {
      const lowX = x + part.set.cellW;
      ensureOnScreen(el.name, x, y);
      const imgs = digitImages(part.set);
      e.selected({ images: imgs.slice(0, 6), x, y, valueType: VALUE_TYPE.secondHigh, ambient: mode });
      e.selected({ images: imgs, x: lowX, y, valueType: VALUE_TYPE.secondLow, ambient: mode });
    } else {
      // A data number: its id is the element's own. The sign glyph goes out as `res_sign`; a minus sign has no codec field.
      const valueType = part.role === "field" ? part.field! : clockDigitsId(part.role);
      if (part.minus && !notes.includes(minusDropped())) notes.push(minusDropped());
      const cx = part.align === "center" ? Math.round(x) : x;
      ensureOnScreen(el.name, part.align === "center" ? cx - Math.round((part.count * part.set.cellW) / 2) : cx, y);
      e.digits({ digits: digitImages(part.set), x: cx, y, align: part.align, valueType, sign: part.sign ? rgba(part.set[part.sign]) : undefined, ambient: mode });
    }
  }
}

function clockDigitsId(role: DataRole): number {
  switch (role) {
    case "hour":
      return VALUE_TYPE.hour;
    case "minute":
      return VALUE_TYPE.minute;
    case "day":
      return VALUE_TYPE.date;
    default:
      throw new Error(`no value id for ${role}`);
  }
}

function emitHand(e: ElementBuilder, el: HandElement, mode: Mode): void {
  const asset = getAsset(el.assetId);
  if (el.shape === "custom" && !asset) throw new LeftOut(i18n.t("export:build.handNotLoaded", { name: el.name }));
  const hs = renderHand(el, asset);
  // The rotation box is a square centred on the pivot, as far across as the tip is from it (as in the samples).
  const reach = Math.max(1, Math.round(Math.max(hs.pivotY, hs.sprite.height - hs.pivotY, hs.pivotX, hs.sprite.width - hs.pivotX)));
  e.hand({
    image: rgba(hs.sprite),
    rect: { x: Math.round(el.x) - reach, y: Math.round(el.y) - reach, width: reach * 2, height: reach * 2 },
    pivot: { x: hs.pivotX, y: hs.pivotY },
    startAngle: 0,
    endAngle: 360,
    valueType: HAND_VALUE[el.hand],
    ambient: mode,
  });
}

function emitElement(fb: FaceBuilder, el: Element, screen: ScreenSize): string[] {
  const left: string[] = [];
  switch (el.type) {
    case "background":
      break;
    case "image": {
      const img = getAsset(el.assetId);
      if (!img) throw new LeftOut(i18n.t("export:build.imageNotLoaded", { name: el.name }));
      const sprite = newSprite(Math.round(el.w), Math.round(el.h));
      sprite.ctx.imageSmoothingQuality = "high";
      sprite.ctx.drawImage(img.source, 0, 0, sprite.sprite.width, sprite.sprite.height);
      fb.element("background", (e) => {
        staticImage(e, sprite.sprite, Math.round(el.x), Math.round(el.y), "normal", screen);
      });
      break;
    }
    case "time":
    case "date": {
      fb.element(el.type, (e) => {
        emitParts(e, el, layoutOf(el)!.parts, "normal", left);
        const aod = dimmed(el);
        emitParts(e, aod, layoutOf(aod)!.parts, "aod", []);
      });
      break;
    }
    case "hand":
      fb.element("time", (e) => {
        emitHand(e, el, "normal");
        if (el.hand !== "second") emitHand(e, dimmed(el) as HandElement, "aod");
      });
      break;
    case "widget": {
      const layout = layoutOf(el)!;
      fb.element("widget", (e) =>
        e.container(
          (c) => emitParts(c, el, layout.parts, "normal", left),
          { dataType: fieldDef(el.valueType)!.slot, rect: { x: Math.round(el.x), y: Math.round(el.y), width: Math.round(layout.w), height: Math.round(layout.h) } },
        ),
      );
      break;
    }
    case "ring": {
      const def = fieldDef(el.valueType)!;
      const ring = renderRing(el);
      const size = ring.size;
      fb.element("widget", (e) =>
        e.container(
          (c) => {
            staticImage(c, ring.track, Math.round(el.x), Math.round(el.y), "normal", screen);
            c.arc({
              image: rgba(ring.fill),
              rect: { x: Math.round(el.x), y: Math.round(el.y), width: size, height: size },
              center: { x: Math.round(ring.cx), y: Math.round(ring.cy) },
              radius: Math.round(ring.radius),
              lineWidth: Math.round(el.thickness),
              startAngle: Math.round(el.startAngle),
              endAngle: Math.round(el.startAngle + el.sweep),
              valueType: def.id,
              ambient: "normal",
            });
          },
          { dataType: def.slot, rect: { x: Math.round(el.x), y: Math.round(el.y), width: size, height: size } },
        ),
      );
      break;
    }
    case "iconset": {
      const def = fieldDef(el.valueType)!;
      ensureOnScreen(el.name, el.x, el.y);
      const images = renderIconSet(el.valueType, el.size, el.color).map(rgba);
      const side = Math.max(8, Math.round(el.size));
      fb.element("widget", (e) =>
        e.container(
          (c) => c.selected({ images, x: Math.round(el.x), y: Math.round(el.y), valueType: def.id, ambient: "normal" }),
          { dataType: def.slot, rect: { x: Math.round(el.x), y: Math.round(el.y), width: side, height: side } },
        ),
      );
      break;
    }
  }
  return left;
}

/** Face as the always-on display shows it: black, with time, date and the hour and minute hands dimmed. */
export function aodElements(elements: Element[]): Element[] {
  const kept = elements.filter((el) => el.type === "time" || el.type === "date" || (el.type === "hand" && el.hand !== "second"));
  return kept.map(dimmed);
}

const AOD_LIT_LIMIT = 0.2;

/** Share of pixels that are visibly lit (any channel above 16 of 255). */
function litFraction(sprite: Sprite): number {
  const { data } = spriteRgba(sprite);
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i]! > 16 || data[i + 1]! > 16 || data[i + 2]! > 16) lit++;
  return lit / (data.length / 4);
}

function renderPreview(project: Project, elements: Element[], sim: Sim, width: number, height: number, background: string): Sprite {
  const { screen } = project;
  const surface = createSurface(width, height);
  const ctx = context2d(surface);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.scale(width / screen.width, height / screen.height);
  ctx.imageSmoothingQuality = "high";
  drawProject(ctx, { ...project, elements }, sim);
  return { width, height, surface };
}

function binaryOf(pkg: HwtPackage): WatchfaceBinary {
  if (!pkg.watchface) throw new Error(i18n.t("export:build.noWatchface"));
  return pkg.watchface;
}

export async function buildHwt(project: Project, stageSim: Sim, options: ExportOptions): Promise<ExportResult> {
  const screen = project.screen;
  const target = hwtTarget(screen);
  if (!target.ok) throw new Error(target.reason);
  const preview = previewSizes(screen.width, screen.height);
  // The cover and the always-on preview show the time the stage shows: a running clock is read now.
  const sim = shownSim(stageSim);
  await Promise.all(fontsOf(project.elements).map(ensureFont));

  const notes: ExportNote[] = [];
  const report: ExportedElement[] = [];
  const toExport: Element[] = [];
  for (const el of project.elements) {
    const base = { id: el.id, name: el.name, type: el.type };
    const support = elementSupport(el);
    if (!el.visible) {
      report.push({ ...base, exported: false, detail: i18n.t("export:build.hiddenLayer"), level: support.level, dropped: [] });
    } else if (!isExportable(el, options.includeExperimental)) {
      const why = support.level === "preview-only" ? i18n.t("export:build.previewOnly", { note: support.note }) : i18n.t("export:build.experimentalOff");
      report.push({ ...base, exported: false, detail: why, level: support.level, dropped: [] });
    } else {
      toExport.push(el);
    }
  }

  const coverSprite = renderPreview(project, toExport, sim, preview.cover.width, preview.cover.height, "#000000");
  const cover = await surfaceToJpeg(coverSprite.surface, 0.92);
  const aodSprite = renderPreview(project, aodElements(toExport), sim, preview.aod.width, preview.aod.height, BLACK_AOD);
  const aod = await surfaceToJpeg(aodSprite.surface, 0.92);
  const aodLit = litFraction(aodSprite);
  const iconSmall = await surfaceToJpeg(scaleSprite(coverSprite, preview.iconSmall.width, preview.iconSmall.height).surface, 0.92);
  const thumbnail = rgba(scaleSprite(coverSprite, preview.thumbnail.width, preview.thumbnail.height));

  const title = project.name.trim() || "My face";
  const pkg = createHwt({ title, titleCn: title.slice(0, 8), author: project.author.trim(), screen: target.code, version: target.version, cover, aod, iconSmall, thumbnail });
  const fb = new FaceBuilder(binaryOf(pkg));

  const background = toExport.find((el) => el.type === "background");
  const bgFill = background?.type === "background" ? background.fill : { kind: "solid" as const, color: "#000000" };
  const bgSprite = renderBackgroundSprite(bgFill, screen);
  const bgImage = rgba(bgSprite);
  // The samples point the background's customisation preview at the background image itself (one shared slot).
  const bgPreview = encodeImage(bgImage).length <= FIT4_LIMITS.maxImageBytes * 0.92 ? bgImage : undefined;
  fb.element(
    "background",
    (e) => {
      staticImage(e, bgSprite, 0, 0, "normal", screen);
      staticImage(e, solid(screen.width, screen.height, BLACK_AOD), 0, 0, "aod", screen);
    },
    bgPreview ? { preview: bgPreview } : {},
  );
  if (background) {
    report.push({ id: background.id, name: background.name, type: background.type, exported: true, detail: i18n.t("export:build.backgroundDetail"), level: "verified", dropped: [] });
  }

  for (const el of toExport) {
    if (el.type === "background") continue;
    const base = { id: el.id, name: el.name, type: el.type };
    try {
      const left = emitElement(fb, el, screen);
      const support = elementSupport(el);
      const dropped = [...new Set(left)];
      report.push({ ...base, exported: true, detail: support.level === "experimental" ? support.note : "", level: support.level, dropped });
    } catch (err) {
      if (err instanceof LeftOut) {
        report.push({ ...base, exported: false, detail: err.message, level: elementSupport(el).level, dropped: [] });
        notes.push({ level: "warning", text: err.message });
      } else {
        throw err;
      }
    }
  }
  const exportedIds = new Set(report.filter((r) => r.exported).map((r) => r.id));
  for (const font of fontsOf(toExport.filter((el) => exportedIds.has(el.id)))) {
    if (fontFailed(font)) {
      notes.push({ level: "warning", text: i18n.t("export:build.fontFailed", { family: font.family, weight: font.weight }) });
    }
  }
  fb.commit();

  const bytes = writeHwt(pkg);
  const readBack = readHwt(bytes);
  const wfBytes = binaryOf(readBack);
  const binary = writeWatchface(wfBytes);
  const verify = verifyWatchface(binary);
  if (!verify.ok) throw new Error(i18n.t("export:build.selfCheck", { problems: verify.problems.join("; ") }));

  const limits = checkFit4Limits(wfBytes, binary.length, bytes.length);
  notes.push({
    level: aodLit > AOD_LIT_LIMIT ? "warning" : "info",
    text: i18n.t(aodLit > AOD_LIT_LIMIT ? "export:build.aodHigh" : "export:build.aodOk", { percent: Math.round(aodLit * 100) }),
  });
  if (target.status === "untested") notes.push({ level: "warning", text: i18n.t("export:build.notTried", { code: target.code }), screenStatus: true });
  if (target.status === "experimental") notes.push({ level: "warning", text: i18n.t("export:build.experimentalCode", { code: target.code, version: target.version }) });
  if (target.limitsKnown) {
    // The codec's limit report is English only; the same checks are restated here from its numbers so the text follows the language.
    const limitProblems: string[] = [];
    if (limits.binaryBytes > FIT4_LIMITS.maxBinaryBytes) limitProblems.push(i18n.t("export:build.limitBinary", { bytes: limits.binaryBytes, limit: FIT4_LIMITS.maxBinaryBytes }));
    if (limits.hwtBytes !== undefined && limits.hwtBytes > FIT4_LIMITS.maxHwtBytes) limitProblems.push(i18n.t("export:build.limitPackage", { bytes: limits.hwtBytes, limit: FIT4_LIMITS.maxHwtBytes }));
    if (limits.imageMemoryBytes > FIT4_LIMITS.maxImageMemoryBytes) limitProblems.push(i18n.t("export:build.limitMemory", { bytes: limits.imageMemoryBytes, limit: FIT4_LIMITS.maxImageMemoryBytes }));
    for (const problem of limitProblems) notes.push({ level: "error", text: i18n.t("export:build.limitPrefix", { problem }), limit: true });
    if (limits.layerBytes > FIT4_LIMITS.maxLayerBytes) {
      notes.push({ level: "warning", text: i18n.t("export:build.limitLayer", { bytes: limits.layerBytes, limit: FIT4_LIMITS.maxLayerBytes }) });
    }
  } else {
    // The sizes in `stats` are measurements; only Huawei's HWHD13 page says what is too big.
    notes.push({ level: "warning", text: i18n.t("export:build.limitsUnknown") });
  }

  const images = wfBytes.images;
  const imageTable = images.map((blob, index) => {
    if (blob.length < 8) return { index, width: 0, height: 0, bytes: blob.length };
    const h = readImageHeader(blob);
    return { index, width: h.width, height: h.height, bytes: blob.length };
  });
  const stats: ExportStats = {
    images: images.length,
    imageBytes: images.reduce((n, b) => n + b.length, 0),
    totalBytes: bytes.length,
    largestImageBytes: limits.largestImageBytes,
    imageMemoryBytes: limits.imageMemoryBytes,
    layerBytes: limits.layerBytes,
  };

  return {
    fileName: `${hwtFileName(project.name)}.hwt`,
    bytes,
    notes,
    elements: report,
    stats,
    target: { code: target.code, version: target.version, status: target.status, limitsKnown: target.limitsKnown },
    debug: {
      generator: "JoyoFit Studio",
      screen: target.code,
      screenSize: { width: screen.width, height: screen.height },
      title,
      options,
      sim,
      elements: report,
      stats,
      images: imageTable,
      layout: describeLayout(getLayout(wfBytes)),
    },
  };
}
