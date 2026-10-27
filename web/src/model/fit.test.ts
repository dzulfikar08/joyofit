import { VALUE_TYPE } from "@joyofit/hwt";
import { describe, expect, it } from "vitest";
import { emptyProject, newHand, newRing, newTime } from "./defaults";
import { fitElements, fitOf } from "./fit";
import { DEFAULT_SCREEN, presetById } from "./screens";
import type { HandElement, RingElement, TimeElement } from "./types";

const band = presetById("band194")!;
const gt = presetById("gt466")!;

describe("fitOf", () => {
  it("scales by the smaller ratio and centres the rest", () => {
    const { k, dx, dy } = fitOf(DEFAULT_SCREEN, band);
    expect(k).toBeCloseTo(194 / 408, 6);
    expect(dx).toBeCloseTo(0, 6);
    expect(dy).toBeCloseTo((368 - 480 * k) / 2, 6);
  });
});

describe("fitElements", () => {
  it("returns the same array for the same screen size", () => {
    const elements = emptyProject().elements;
    expect(fitElements(elements, DEFAULT_SCREEN, { width: 408, height: 480 })).toBe(elements);
  });

  it("scales positions, sizes and spacing about the new centre and leaves the background alone", () => {
    const time = newTime({ x: 58, y: 190, size: 72, tracking: 2, outline: { color: "#000000", width: 4 } });
    const base = emptyProject().elements[0]!;
    const [bg, out] = fitElements([base, time], DEFAULT_SCREEN, band) as [typeof base, TimeElement];
    expect(bg).toBe(base);
    const k = 194 / 408;
    const dy = (368 - 480 * k) / 2;
    expect(out.x).toBe(Math.round(58 * k));
    expect(out.y).toBe(Math.round(dy + 190 * k));
    expect(out.size).toBe(Math.round(72 * k));
    expect(out.tracking).toBe(Math.round(2 * k));
    expect(out.outline).toEqual({ color: "#000000", width: Math.round(4 * k) });
  });

  it("keeps the centre of the old screen at the centre of the new one", () => {
    const hand = newHand("minute");
    expect([hand.x, hand.y]).toEqual([204, 240]);
    for (const screen of [band, gt, presetById("band286")!]) {
      const [out] = fitElements([hand], DEFAULT_SCREEN, screen) as [HandElement];
      expect(Math.abs(out.x - screen.width / 2)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(out.y - screen.height / 2)).toBeLessThanOrEqual(0.5);
    }
    const [out] = fitElements([hand], DEFAULT_SCREEN, band) as [HandElement];
    expect(out.length).toBe(Math.round(160 * (194 / 408)));
  });

  it("scales a ring's diameter and thickness together", () => {
    const ring = newRing(VALUE_TYPE.stepsRatio, { x: 20, y: 48, size: 368, thickness: 16 });
    const [out] = fitElements([ring], DEFAULT_SCREEN, gt) as [RingElement];
    const k = 466 / 480;
    expect(out.size).toBe(Math.round(368 * k));
    expect(out.thickness).toBe(Math.round(16 * k));
  });

  it("keeps a scaled design inside the new screen", () => {
    const ring = newRing(VALUE_TYPE.stepsRatio, { x: 0, y: 0, size: 408, thickness: 16 });
    const [out] = fitElements([ring], DEFAULT_SCREEN, band) as [RingElement];
    expect(out.x).toBeGreaterThanOrEqual(0);
    expect(out.x + out.size).toBeLessThanOrEqual(194);
  });

  it("scales up as well as down", () => {
    const big = { ...DEFAULT_SCREEN, presetId: null, width: 600, height: 600 };
    const time = newTime({ x: 100, y: 100, size: 60 });
    const [out] = fitElements([time], DEFAULT_SCREEN, big) as [TimeElement];
    expect(out.size).toBe(Math.round(60 * (600 / 480)));
  });
});
