import { describe, expect, it } from "vitest";
import { DEFAULT_SCREEN, SCREEN_PRESETS } from "@/model/screens";
import { THUMB_LIMIT, fitThumbnail, thumbSteps } from "./thumbnail";

describe("fitThumbnail", () => {
  it("keeps the nicest picture when it fits", async () => {
    const seen: number[] = [];
    const result = await fitThumbnail(DEFAULT_SCREEN, async (step) => {
      seen.push(step.width);
      return "x".repeat(1000);
    });
    expect(result).toHaveLength(1000);
    expect(seen).toEqual([102]);
  });

  it("steps down until the data URL fits", async () => {
    const used: number[] = [];
    const result = await fitThumbnail(DEFAULT_SCREEN, async (step) => {
      used.push(step.quality);
      return "x".repeat(step.width === 68 ? 5000 : 20_000);
    });
    expect(result).toHaveLength(5000);
    expect(used).toEqual([0.6, 0.4, 0.4, 0.35]);
  });

  it("gives up with null when even the smallest is too big", async () => {
    expect(await fitThumbnail(DEFAULT_SCREEN, async () => "x".repeat(THUMB_LIMIT + 1))).toBeNull();
  });

  it("accepts a data URL exactly at the limit", async () => {
    expect(await fitThumbnail(DEFAULT_SCREEN, async () => "x".repeat(THUMB_LIMIT))).toHaveLength(THUMB_LIMIT);
  });
});

describe("thumbSteps", () => {
  it("gives a Watch Fit 4 face the steps it always had", () => {
    expect(thumbSteps(DEFAULT_SCREEN).map((s) => [s.width, s.height, s.quality])).toEqual([
      [102, 120, 0.6],
      [102, 120, 0.4],
      [85, 100, 0.4],
      [68, 80, 0.35],
      [51, 60, 0.3],
    ]);
  });

  it("keeps the screen's own aspect ratio at every step and gets smaller", () => {
    const screens = [...SCREEN_PRESETS, { width: 600, height: 120 }, { width: 120, height: 600 }, { width: 300, height: 300 }];
    for (const screen of screens) {
      const steps = thumbSteps(screen);
      for (const step of steps) expect(Math.abs(step.width / step.height - screen.width / screen.height)).toBeLessThan(0.04);
      const sizes = steps.map((s) => s.width * s.height * s.quality);
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    }
  });

  it("makes the longer side 120 px for a band, a wide screen and a round one", () => {
    expect(thumbSteps({ width: 194, height: 368 })[0]).toMatchObject({ width: 63, height: 120 });
    expect(thumbSteps({ width: 600, height: 300 })[0]).toMatchObject({ width: 120, height: 60 });
    expect(thumbSteps({ width: 466, height: 466 })[0]).toMatchObject({ width: 120, height: 120 });
  });
});
