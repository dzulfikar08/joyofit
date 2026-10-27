import type { Element } from "./types";
import type { ScreenSize } from "./screens";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Largest icon edge, px: the biggest screen a custom size allows. */
export const ICON_MAX = 600;

/**
 * The size fields of an element multiplied by `k`: text height, ring diameter and thickness, icon edge, image box. The editor's
 * corner handle uses the default floors (the smallest a control can set); `free` lowers them so a whole design can shrink
 * proportionally onto a small screen. Elements without a size to scale come back unchanged.
 */
export function scaleSizes(el: Element, k: number, free = false): Element {
  switch (el.type) {
    case "time":
    case "date":
    case "widget":
      return { ...el, size: clamp(Math.round(el.size * k), free ? 6 : 8, 360) };
    case "ring":
      return { ...el, size: clamp(Math.round(el.size * k), free ? 12 : 48, 800), thickness: clamp(Math.round(el.thickness * k), free ? 1 : 2, 120) };
    case "iconset":
      return { ...el, size: clamp(Math.round(el.size * k), free ? 6 : 8, ICON_MAX) };
    case "image":
      return { ...el, w: clamp(Math.round(el.w * k), free ? 2 : 8, 1600), h: clamp(Math.round(el.h * k), free ? 2 : 8, 1600) };
    default:
      return el;
  }
}

/** How a design made for one screen maps onto another: uniform scale by the smaller ratio, centred. */
export function fitOf(from: ScreenSize, to: ScreenSize): { k: number; dx: number; dy: number } {
  const k = Math.min(to.width / from.width, to.height / from.height);
  return { k, dx: (to.width - from.width * k) / 2, dy: (to.height - from.height * k) / 2 };
}

/**
 * The elements of a design for the `from` screen, scaled uniformly (by the smaller of the two size ratios) and centred on the
 * `to` screen: positions, sizes, thicknesses, hand lengths, spacing and outlines all follow. The background is not touched, it
 * always covers the whole screen. The same screen size gives the same array back.
 */
export function fitElements(elements: Element[], from: ScreenSize, to: ScreenSize): Element[] {
  if (from.width === to.width && from.height === to.height) return elements;
  const { k, dx, dy } = fitOf(from, to);
  return elements.map((el) => {
    if (el.type === "background") return el;
    const moved = { ...el, x: Math.round(dx + el.x * k), y: Math.round(dy + el.y * k) };
    switch (moved.type) {
      case "time":
      case "date":
      case "widget": {
        const sized = scaleSizes(moved, k, true) as typeof moved;
        const outline = moved.outline ? { ...moved.outline, width: Math.max(1, Math.round(moved.outline.width * k)) } : null;
        return { ...sized, tracking: Math.round(moved.tracking * k), outline };
      }
      case "hand":
        // The pivot inside an uploaded hand image is in that image's pixels; `scale` carries the size.
        return {
          ...moved,
          length: Math.max(1, Math.round(moved.length * k)),
          width: Math.max(1, Math.round(moved.width * k)),
          tail: Math.round(moved.tail * k),
          scale: moved.scale * k,
        };
      default:
        return scaleSizes(moved, k, true);
    }
  });
}
