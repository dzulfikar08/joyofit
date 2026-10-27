import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SCREEN, SCREEN_PRESETS, presetById, presetScreen } from "@/model/screens";
import { surfaceToPng } from "@/render/canvas";
import { elementBounds, renderProjectSprite } from "@/render/scene";
import { defaultSim } from "@/render/values";
import { TEMPLATES } from "./index";

const out = process.env.RENDER_OUT;

describe("templates", () => {
  for (const template of TEMPLATES) {
    it(`${template.name} builds and renders`, async () => {
      const project = await template.build(DEFAULT_SCREEN);
      expect(project.screen).toEqual(DEFAULT_SCREEN);
      expect(project.elements[0]?.type).toBe("background");
      expect(project.elements.length).toBeGreaterThan(1);
      const sprite = renderProjectSprite(project, defaultSim());
      const png = await surfaceToPng(sprite.surface);
      expect(png.length).toBeGreaterThan(1000);
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(`${out}/tpl-${template.id}.png`, png);
      }
    });
  }

  const screens = [...SCREEN_PRESETS.map(presetScreen), { presetId: null, width: 300, height: 300, shape: "squircle" as const, cornerRadius: 70 }];
  for (const screen of screens) {
    const name = presetById(screen.presetId)?.name ?? "custom 300 x 300";
    it(`every template builds for ${name}: sized to it and inside it`, async () => {
      for (const template of TEMPLATES) {
        const project = await template.build(screen);
        expect(project.screen).toEqual(screen);
        const sprite = renderProjectSprite(project, defaultSim());
        expect([sprite.width, sprite.height]).toEqual([screen.width, screen.height]);
        // Text layout rounds its glyph cells to whole pixels, so a scaled line can end a few px past the linear scale.
        const slack = Math.ceil(Math.max(screen.width, screen.height) * 0.03);
        for (const el of project.elements) {
          if (el.type === "background" || el.type === "hand") continue;
          const b = elementBounds(el, defaultSim());
          expect(b.x, `${template.id} ${el.name} left`).toBeGreaterThanOrEqual(-slack);
          expect(b.y, `${template.id} ${el.name} top`).toBeGreaterThanOrEqual(-slack);
          expect(b.x + b.w, `${template.id} ${el.name} right`).toBeLessThanOrEqual(screen.width + slack);
          expect(b.y + b.h, `${template.id} ${el.name} bottom`).toBeLessThanOrEqual(screen.height + slack);
        }
        if (out) {
          mkdirSync(out, { recursive: true });
          writeFileSync(`${out}/tpl-${template.id}-${screen.presetId ?? "custom"}.png`, await surfaceToPng(sprite.surface));
        }
      }
    });
  }
});
