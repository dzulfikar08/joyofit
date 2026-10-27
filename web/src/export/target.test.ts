import { describe, expect, it } from "vitest";
import { SCREEN_PRESETS, presetScreen, type ScreenSpec } from "@/model/screens";
import { canSendPhotoFace, hwtTarget } from "./target";

const custom = (width: number, height: number): ScreenSpec => ({ presetId: null, width, height, shape: "rect", cornerRadius: 0 });

describe("hwtTarget", () => {
  it("takes code and version from the preset and marks only the Watch Fit 4 as tested", () => {
    for (const preset of SCREEN_PRESETS) {
      expect(hwtTarget(presetScreen(preset))).toEqual({
        ok: true,
        code: preset.hwtScreen,
        version: preset.hwtVersion,
        status: preset.tested ? "tested" : "untested",
        limitsKnown: preset.hwtScreen === "HWHD13",
      });
    }
    expect(SCREEN_PRESETS.filter((p) => p.tested).map((p) => p.presetId)).toEqual(["fit4"]);
  });

  it("finds the Huawei code of a custom size by width and height, not height and width", () => {
    // Gadgetbridge lists HWHD13 as 480 x 408 (height first); the screen is 408 wide.
    expect(hwtTarget(custom(408, 480))).toMatchObject({ ok: true, code: "HWHD13", status: "experimental", limitsKnown: true });
    expect(hwtTarget(custom(480, 408))).toMatchObject({ ok: false });
    expect(hwtTarget(custom(320, 320))).toMatchObject({ ok: true, code: "HWHD08", version: "2.1.1", status: "experimental" });
  });

  it("reuses the preset's version for a custom size that matches its code", () => {
    expect(hwtTarget(custom(454, 454))).toMatchObject({ code: "HWHD02", version: "2.5.1" });
  });

  it("says why there is no .hwt for a size without a code", () => {
    expect(hwtTarget(custom(300, 300))).toEqual({ ok: false, reason: "Huawei has no screen code for 300 × 300" });
  });
});

describe("canSendPhotoFace", () => {
  it("is true for the Watch Fit 4 preset only", () => {
    expect(SCREEN_PRESETS.filter((p) => canSendPhotoFace(presetScreen(p))).map((p) => p.presetId)).toEqual(["fit4"]);
    expect(canSendPhotoFace(custom(408, 480))).toBe(false);
  });
});
