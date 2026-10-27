import { describe, expect, it } from "vitest";
import { newImage, newTime } from "@/model/defaults";
import { DEFAULT_SCREEN, presetById } from "@/model/screens";
import { defaultSim } from "@/render/values";
import { elementBounds } from "@/render/scene";
import { hitTest, scaleElement, snapMove, snapTargets } from "./geometry";

const sim = defaultSim();

describe("snapping", () => {
  const targets = snapTargets([{ x: 100, y: 300, w: 50, h: 40 }], DEFAULT_SCREEN);

  it("snaps an element's centre to the screen centre", () => {
    const r = snapMove({ x: 150, y: 10, w: 100, h: 20 }, snapTargets([], DEFAULT_SCREEN), 6);
    expect(r.dx).toBe(204 - 200);
    expect(r.guideX).toBe(204);
  });

  it("snaps to the centre and edges of whatever screen the face has", () => {
    const band = presetById("band194")!;
    const centred = snapMove({ x: 50, y: 10, w: 100, h: 20 }, snapTargets([], band), 6);
    expect(centred.guideX).toBe(97);
    expect(centred.dx).toBe(97 - 100);
    const bottom = snapMove({ x: 10, y: 345, w: 40, h: 20 }, snapTargets([], band), 6);
    expect(bottom.guideY).toBe(368);
    expect(bottom.dy).toBe(3);
  });

  it("snaps edges to the screen edge and to other elements", () => {
    expect(snapMove({ x: 4, y: 100, w: 50, h: 50 }, targets, 6).dx).toBe(-4);
    const toOther = snapMove({ x: 20, y: 298, w: 50, h: 60 }, targets, 6);
    expect(toOther.dy).toBe(2);
    expect(toOther.guideY).toBe(300);
  });

  it("does nothing outside the threshold", () => {
    const r = snapMove({ x: 120, y: 100, w: 40, h: 40 }, snapTargets([], DEFAULT_SCREEN), 6);
    expect(r).toEqual({ dx: 0, dy: 0, guideX: null, guideY: null });
  });
});

describe("hit testing", () => {
  it("returns the topmost unlocked element under the point", () => {
    const bg = { id: "bg", type: "background", name: "bg", visible: true, locked: false, x: 0, y: 0, fill: { kind: "solid", color: "#000" } } as const;
    const a = newImage(null, 100, 100, { id: "a", x: 50, y: 50 });
    const b = newImage(null, 100, 100, { id: "b", x: 80, y: 80 });
    expect(hitTest([bg, a, b], 90, 90, sim, 0)?.id).toBe("b");
    expect(hitTest([bg, a, { ...b, locked: true }], 90, 90, sim, 0)?.id).toBe("a");
    expect(hitTest([bg, a, { ...b, visible: false }], 160, 160, sim, 0)?.id).toBe("bg");
    expect(hitTest([bg, a], 300, 400, sim, 0)?.id).toBe("bg");
  });
});

describe("scaling", () => {
  it("scales an image about the opposite corner", () => {
    const img = newImage(null, 100, 60, { x: 40, y: 50 });
    const bigger = scaleElement(img, 2, "se", sim);
    expect(bigger).toMatchObject({ w: 200, h: 120, x: 40, y: 50 });
    const fromNw = scaleElement(img, 2, "nw", sim);
    expect(fromNw.x + (fromNw as typeof img).w).toBe(140);
    expect(fromNw.y + (fromNw as typeof img).h).toBe(110);
  });

  it("scales a time element by its font size and keeps the anchored corner", () => {
    const time = newTime({ x: 60, y: 120, size: 60 });
    const before = elementBounds(time, sim);
    const bigger = scaleElement(time, 1.5, "ne", sim) as typeof time;
    expect(bigger.size).toBe(90);
    const after = elementBounds(bigger, sim);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y + after.h).toBeCloseTo(before.y + before.h, 0);
    expect(after.w).toBeGreaterThan(before.w);
  });
});
