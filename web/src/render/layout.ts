import type { DateElement, TextAlign, TimeElement, WidgetElement } from "@/model/types";
import { fieldDef } from "@/model/fields";
import { dateWords, renderDigitSet, renderWordSet, type DigitSet, type GlyphStyle, type WordSet } from "./glyphs";
import { renderIcon } from "./shapes";
import type { Sprite } from "./canvas";
import type { DataRole } from "./values";

/**
 * Where the pieces of a text-like element go, relative to the element's top left. Both the live preview
 * and the exporter read this, so the exported face is positioned exactly like the editor shows it.
 */
export type Part =
  | {
      kind: "digits";
      role: DataRole;
      set: DigitSet;
      x: number;
      y: number;
      /** Digits shown by the watch (fixed for time and date, the maximum for data numbers). */
      count: number;
      /** `left`: x is the left edge. `center`: x is the horizontal centre of the shown digits. */
      align: "left" | "center";
      /** Pads with leading zeros up to `count` when true; data numbers show only the digits they need. */
      zeroPad: boolean;
      /** Data number: the codec value id, whether a minus sign shows for a negative value, and the glyph after the digits. */
      field?: number;
      minus?: boolean;
      sign?: "degree";
    }
  | { kind: "colon"; set: DigitSet; x: number; y: number }
  | { kind: "words"; role: DataRole; set: WordSet; words: string[]; x: number; y: number }
  | { kind: "icon"; sprite: Sprite; x: number; y: number };

export interface Layout {
  w: number;
  h: number;
  parts: Part[];
}

/** Horizontal shift of a text element's whole block so its `x` is the left edge, the centre, or the right edge of the block. */
export function alignOffsetX(align: TextAlign, width: number): number {
  if (align === "center") return -Math.round(width / 2);
  if (align === "right") return -width;
  return 0;
}

function style(el: { font: GlyphStyle["font"]; color: string; outline: GlyphStyle["outline"]; tracking: number }, digitHeight: number): GlyphStyle {
  return { font: el.font, color: el.color, outline: el.outline, digitHeight: Math.max(6, Math.round(digitHeight)), tracking: el.tracking };
}

function digitsWidth(set: DigitSet, count: number): number {
  return count * set.cellW;
}

export function layoutTime(el: TimeElement): Layout {
  const main = renderDigitSet(style(el, el.size));
  const small = el.showSeconds || el.ampm ? renderDigitSet(style(el, el.size * el.secondsScale)) : null;
  const ampmSet = el.ampm ? renderWordSet(["AM", "PM"], style(el, el.size * el.secondsScale)) : null;
  const t = el.tracking;
  const parts: Part[] = [];
  const digits = (role: DataRole, set: DigitSet, x: number, y: number): Part => ({
    kind: "digits",
    role,
    set,
    x,
    y,
    count: 2,
    align: "left",
    zeroPad: true,
  });
  const pairW = digitsWidth(main, 2);

  let mainW: number;
  let mainBottom: number;
  let hourMinuteBaseline: number;
  if (el.layout === "stack") {
    parts.push(digits("hour", main, 0, 0));
    const y2 = main.cellH + Math.round(el.size * 0.08) + Math.max(0, t);
    parts.push(digits("minute", main, 0, y2));
    mainW = pairW;
    mainBottom = y2 + main.cellH;
    hourMinuteBaseline = y2 + main.baseline;
  } else {
    parts.push(digits("hour", main, 0, 0));
    let x = pairW + t;
    if (el.showColon) {
      parts.push({ kind: "colon", set: main, x, y: 0 });
      x += main.colon.width + t;
    }
    parts.push(digits("minute", main, x, 0));
    mainW = x + pairW;
    mainBottom = main.cellH;
    hourMinuteBaseline = main.baseline;
  }

  let colW = 0;
  let bottom = mainBottom;
  const colX = mainW + Math.round(el.size * 0.12) + t;
  if (ampmSet) {
    parts.push({ kind: "words", role: "ampm", set: ampmSet, words: ["AM", "PM"], x: colX, y: 0 });
    colW = Math.max(colW, ampmSet.cellW);
    bottom = Math.max(bottom, ampmSet.cellH);
  }
  if (el.showSeconds && small) {
    const y = Math.round(hourMinuteBaseline - small.baseline);
    parts.push(digits("second", small, colX, y));
    colW = Math.max(colW, digitsWidth(small, 2));
    bottom = Math.max(bottom, y + small.cellH);
  }
  return { w: colW > 0 ? colX + colW : mainW, h: bottom, parts };
}

export function layoutDate(el: DateElement): Layout {
  const digitStyle = style(el, el.size);
  const digits = renderDigitSet(digitStyle);
  const gap = Math.round(el.size * 0.3 + el.tracking);
  const parts: Part[] = [];
  let x = 0;
  let h = digits.cellH;
  for (const part of ["weekday", "day", "month"] as const) {
    if (!el.parts.includes(part)) continue;
    if (part === "day") {
      parts.push({ kind: "digits", role: "day", set: digits, x, y: 0, count: 2, align: "left", zeroPad: true });
      x += digitsWidth(digits, 2) + gap;
    } else {
      const words = dateWords(part, el.upper);
      const set = renderWordSet(words, digitStyle);
      const y = Math.round(digits.baseline - set.baseline);
      parts.push({ kind: "words", role: part, set, words, x, y });
      x += set.cellW + gap;
      h = Math.max(h, y + set.cellH);
    }
  }
  return { w: Math.max(0, x - gap), h, parts };
}

export function layoutWidget(el: WidgetElement): Layout {
  const def = fieldDef(el.valueType);
  const spec = def?.number;
  if (!def || !spec) throw new Error(`value type ${el.valueType} is not a number field`);
  const set = renderDigitSet(style(el, el.size));
  const minusW = spec.min < 0 ? set.minus.width : 0;
  const signW = spec.sign ? set[spec.sign].width : 0;
  const digitsW = digitsWidth(set, spec.digits);
  // The run is [minus][digits][sign]; the minus shows only for a negative value but its room is always reserved.
  const numW = minusW + digitsW + signW;
  const parts: Part[] = [];
  const number = (x: number, y: number, align: "left" | "center"): Part => ({
    kind: "digits",
    role: "field",
    field: def.id,
    minus: spec.min < 0,
    sign: spec.sign,
    set,
    x,
    y,
    count: spec.digits,
    align,
    zeroPad: false,
  });
  if (!el.showIcon) {
    parts.push(number(minusW, 0, "left"));
    return { w: numW, h: set.cellH, parts };
  }
  const iconSize = Math.round(el.size * 1.1);
  const icon = renderIcon(def.icon, iconSize, el.iconColor);
  const gap = Math.round(el.size * 0.28);
  if (el.layout === "side") {
    const h = Math.max(set.cellH, icon.height);
    parts.push({ kind: "icon", sprite: icon, x: 0, y: Math.round((h - icon.height) / 2) });
    parts.push(number(icon.width + gap + minusW, Math.round((h - set.cellH) / 2), "left"));
    return { w: icon.width + gap + numW, h, parts };
  }
  const w = Math.max(numW, icon.width);
  parts.push({ kind: "icon", sprite: icon, x: Math.round((w - icon.width) / 2), y: 0 });
  parts.push(number((w - numW) / 2 + minusW + digitsW / 2, icon.height + gap, "center"));
  return { w, h: icon.height + gap + set.cellH, parts };
}
