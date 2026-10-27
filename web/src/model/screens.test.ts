import { describe, expect, it } from "vitest";
import { CUSTOM_MAX, CUSTOM_MIN, DEFAULT_SCREEN, SCREEN_PRESETS, parseScreen, presetById, presetScreen, sameScreen } from "./screens";

describe("parseScreen", () => {
  it("reads anything missing or damaged as the Watch Fit 4", () => {
    for (const raw of [undefined, null, 5, "x", {}, { width: 300 }, { width: "300", height: 300, shape: "circle" }, { width: 300, height: 300, shape: "hexagon" }]) {
      expect(parseScreen(raw)).toEqual(DEFAULT_SCREEN);
    }
  });

  it("takes a preset by id and ignores sizes stored beside it", () => {
    expect(parseScreen({ presetId: "band194", width: 1, height: 1, shape: "circle" })).toEqual(presetScreen(presetById("band194")!));
  });

  it("keeps a custom screen, rounded and clamped to the allowed sizes", () => {
    expect(parseScreen({ presetId: null, width: 300.4, height: 301, shape: "squircle", cornerRadius: 60 })).toEqual({ presetId: null, width: 300, height: 301, shape: "squircle", cornerRadius: 60 });
    expect(parseScreen({ presetId: "gone", width: 10, height: 9999, shape: "rect", cornerRadius: 9999 })).toEqual({
      presetId: null,
      width: CUSTOM_MIN,
      height: CUSTOM_MAX,
      shape: "rect",
      cornerRadius: CUSTOM_MIN / 2,
    });
  });
});

describe("presets", () => {
  it("are all inside the custom bounds and only the Watch Fit 4 is tested", () => {
    for (const p of SCREEN_PRESETS) {
      expect(p.width).toBeGreaterThanOrEqual(CUSTOM_MIN);
      expect(p.height).toBeLessThanOrEqual(CUSTOM_MAX);
      expect(parseScreen(presetScreen(p))).toEqual(presetScreen(p));
    }
    expect(SCREEN_PRESETS.filter((p) => p.tested).map((p) => p.presetId)).toEqual(["fit4"]);
    expect(SCREEN_PRESETS.filter((p) => p.photoFace).map((p) => p.presetId)).toEqual(["fit4"]);
  });
});

describe("sameScreen", () => {
  it("compares size, shape and corners, and ignores the corner of a circle", () => {
    expect(sameScreen(DEFAULT_SCREEN, { ...DEFAULT_SCREEN })).toBe(true);
    expect(sameScreen(DEFAULT_SCREEN, { ...DEFAULT_SCREEN, cornerRadius: 50 })).toBe(false);
    expect(sameScreen(DEFAULT_SCREEN, { ...DEFAULT_SCREEN, presetId: null })).toBe(false);
    const round = presetScreen(presetById("gt466")!);
    expect(sameScreen(round, { ...round, cornerRadius: 12 })).toBe(true);
  });
});
