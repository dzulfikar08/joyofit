import { describe, expect, it } from "vitest";
import { SCREEN_PRESETS, type ScreenSpec } from "@/model/screens";
import { createSurface, context2d } from "./canvas";
import { screenPath, screenPathData } from "./shapes";

const inside = (screen: ScreenSpec, x: number, y: number) => {
  const ctx = context2d(createSurface(screen.width, screen.height)) as unknown as { isPointInPath(path: Path2D, x: number, y: number): boolean };
  return ctx.isPointInPath(screenPath(screen), x, y);
};

const custom = (shape: ScreenSpec["shape"], width: number, height: number, cornerRadius: number): ScreenSpec => ({ presetId: null, width, height, shape, cornerRadius });

describe("screen outline", () => {
  it("is one closed subpath for every shape", () => {
    for (const s of [...SCREEN_PRESETS, custom("squircle", 300, 300, 0), custom("rect", 300, 200, 0), custom("rect", 300, 200, 999)]) {
      const d = screenPathData(s);
      expect(d.startsWith("M")).toBe(true);
      expect(d.endsWith("Z")).toBe(true);
      expect(d.match(/M/g)).toHaveLength(1);
    }
  });

  it("keeps every point of a squircle inside the screen's box", () => {
    const s = SCREEN_PRESETS[0]!;
    const numbers = screenPathData(s).replace(/[MLHVZ]/g, " ").trim().split(/\s+/).map(Number);
    expect(numbers.every(Number.isFinite)).toBe(true);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(480);
  });

  it("cuts the corners of a squircle and a band, and keeps the middle of every edge", () => {
    for (const id of ["fit4", "band194", "band286"]) {
      const s = SCREEN_PRESETS.find((p) => p.presetId === id)!;
      expect(inside(s, 1, 1)).toBe(false);
      expect(inside(s, s.width - 1, s.height - 1)).toBe(false);
      expect(inside(s, s.width / 2, 1)).toBe(true);
      expect(inside(s, 1, s.height / 2)).toBe(true);
      expect(inside(s, s.width / 2, s.height / 2)).toBe(true);
    }
  });

  it("is a circle for the GT screens", () => {
    for (const id of ["gt466", "gt454", "gt390"]) {
      const s = SCREEN_PRESETS.find((p) => p.presetId === id)!;
      const r = s.width / 2;
      expect(inside(s, r, r)).toBe(true);
      expect(inside(s, r + r * 0.69, r + r * 0.69)).toBe(true);
      expect(inside(s, r + r * 0.73, r + r * 0.73)).toBe(false);
      expect(inside(s, 1, 1)).toBe(false);
    }
  });

  it("is the whole box when the corner radius is 0", () => {
    for (const shape of ["squircle", "rect"] as const) {
      const s = custom(shape, 300, 200, 0);
      expect(inside(s, 1, 1)).toBe(true);
      expect(inside(s, 299, 199)).toBe(true);
    }
  });

  it("limits the corner to half the shorter side and scales with `scale`", () => {
    const s = custom("rect", 300, 200, 999);
    expect(inside(s, 150, 100)).toBe(true);
    expect(inside(s, 20, 20)).toBe(false);
    expect(screenPathData(s, 2)).toBe(screenPathData({ ...s, width: 600, height: 400, cornerRadius: 200 }, 1));
  });

  it("makes the squircle corner squarer than a circle of the same size", () => {
    const squircle = custom("squircle", 300, 300, 90);
    const rounded = custom("rect", 300, 300, 90);
    // On the diagonal, a point 20 px in from the corner is on the squircle's face but off a circular corner of the same size.
    expect(inside(squircle, 20, 20)).toBe(true);
    expect(inside(rounded, 20, 20)).toBe(false);
  });
});
