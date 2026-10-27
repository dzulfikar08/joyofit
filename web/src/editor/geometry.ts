import { scaleSizes } from "@/model/fit";
import type { ScreenSize } from "@/model/screens";
import type { BackgroundElement, Element, Sim } from "@/model/types";
import { elementBounds, type Rect } from "@/render/scene";

export type Corner = "nw" | "ne" | "sw" | "se";

export interface SnapResult {
  dx: number;
  dy: number;
  /** Screen x of a vertical guide line, when snapped on x. */
  guideX: number | null;
  guideY: number | null;
}

function nearest(values: number[], targets: number[], threshold: number): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null;
  for (const v of values) {
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, target: t };
    }
  }
  return best;
}

export interface SnapTargets {
  xs: number[];
  ys: number[];
}

/** Snap targets: screen edges and centre lines, plus the edges and centres of the other elements. */
export function snapTargets(others: Rect[], screen: ScreenSize): SnapTargets {
  const xs = [0, screen.width / 2, screen.width];
  const ys = [0, screen.height / 2, screen.height];
  for (const r of others) {
    xs.push(r.x, r.x + r.w / 2, r.x + r.w);
    ys.push(r.y, r.y + r.h / 2, r.y + r.h);
  }
  return { xs, ys };
}

/** How far to nudge `rect` so one of its edges or its centre lands on a target within `threshold` px. */
export function snapMove(rect: Rect, targets: SnapTargets, threshold: number): SnapResult {
  const sx = nearest([rect.x, rect.x + rect.w / 2, rect.x + rect.w], targets.xs, threshold);
  const sy = nearest([rect.y, rect.y + rect.h / 2, rect.y + rect.h], targets.ys, threshold);
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, guideX: sx?.target ?? null, guideY: sy?.target ?? null };
}

export function otherBounds(elements: Element[], skipId: string, sim: Sim): Rect[] {
  return elements
    .filter((e): e is Exclude<Element, BackgroundElement> => e.id !== skipId && e.visible && e.type !== "background")
    .map((e) => elementBounds(e, sim));
}

export function contains(r: Rect, x: number, y: number, slop = 0): boolean {
  return x >= r.x - slop && x <= r.x + r.w + slop && y >= r.y - slop && y <= r.y + r.h + slop;
}

/** Topmost visible, unlocked element under a point; the background when nothing else is hit. */
export function hitTest(elements: Element[], x: number, y: number, sim: Sim, slop: number): Element | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!;
    if (!el.visible || el.locked || el.type === "background") continue;
    if (contains(elementBounds(el, sim), x, y, slop)) return el;
  }
  const bg = elements.find((e) => e.type === "background");
  return bg && !bg.locked ? bg : null;
}

export function isScalable(el: Element): boolean {
  return el.type !== "background" && el.type !== "hand";
}

/**
 * Applies a uniform scale `k` to an element and keeps the corner opposite to `corner` fixed.
 * Text-like elements scale their font size, rings their diameter, images their box.
 */
export function scaleElement(el: Element, k: number, corner: Corner, sim: Sim): Element {
  if (el.type === "background" || el.type === "hand") return el;
  const before = elementBounds(el, sim);
  const next = scaleSizes(el, k);
  if (next === el) return el;
  const after = elementBounds(next as typeof el, sim);
  const anchorX = corner === "nw" || corner === "sw" ? before.x + before.w : before.x;
  const anchorY = corner === "nw" || corner === "ne" ? before.y + before.h : before.y;
  const newAnchorX = corner === "nw" || corner === "sw" ? after.x + after.w : after.x;
  const newAnchorY = corner === "nw" || corner === "ne" ? after.y + after.h : after.y;
  return { ...next, x: Math.round(next.x + anchorX - newAnchorX), y: Math.round(next.y + anchorY - newAnchorY) };
}
