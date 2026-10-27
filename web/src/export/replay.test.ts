import { createCanvas, ImageData } from "@napi-rs/canvas";
import { VALUE_TYPE, decodeImage, describeLayout, getLayout, readHwt, type NamedObject, type RgbaImage } from "@joyofit/hwt";
import { describe, expect, it } from "vitest";
import { DEFAULT_SCREEN } from "@/model/screens";
import { renderProjectSprite, handAngle } from "@/render/scene";
import { spriteRgba } from "@/render/canvas";
import { clockFields, defaultSim, fieldFraction, fieldValue } from "@/render/values";
import { TEMPLATES } from "@/templates";
import { buildHwt } from "./build";

const { width: SCREEN_W, height: SCREEN_H } = DEFAULT_SCREEN;

/**
 * Re-reads an exported .hwt the way the watch is documented to read it (layers in order, images by reference, digits by
 * value, hands rotated about their pivot, arcs clipped to the ratio) and compares the result with the editor's preview.
 * It checks the encode and decode chain, positions and the value-to-image indexing end to end. It cannot check what the
 * watch really does with a layout: that is what the checklist marks as unconfirmed.
 */

const sim = defaultSim();
const RAD = Math.PI / 180;
const clock = clockFields(sim.timeMs, false);

function list(value: unknown): NamedObject[] {
  return Array.isArray(value) ? (value as NamedObject[]) : [];
}

function toCanvasImage(img: RgbaImage) {
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

/** The value a layer shows, and whether the watch would zero-pad it (the preview pads time and day to two places). */
function valueOf(valueType: number): { value: number; pad: number } {
  switch (valueType) {
    case VALUE_TYPE.hour:
      return { value: clock.hour, pad: 2 };
    case VALUE_TYPE.minute:
      return { value: clock.minute, pad: 2 };
    case VALUE_TYPE.date:
      return { value: clock.day, pad: 2 };
    case VALUE_TYPE.week:
      return { value: clock.weekday + 1, pad: 1 };
    case VALUE_TYPE.month:
      return { value: clock.month + 1, pad: 1 };
    case VALUE_TYPE.secondHigh:
      return { value: Math.floor(clock.second / 10), pad: 1 };
    case VALUE_TYPE.secondLow:
      return { value: clock.second % 10, pad: 1 };
    case VALUE_TYPE.steps:
    case VALUE_TYPE.heartRate:
    case VALUE_TYPE.power:
      return { value: fieldValue(valueType, sim), pad: 1 };
    default:
      throw new Error(`replay does not know value type ${valueType}`);
  }
}

function ratioOf(valueType: number): number {
  switch (valueType) {
    case VALUE_TYPE.hourRatio:
      return handAngle("hour", sim.timeMs) / 360;
    case VALUE_TYPE.minuteRatio:
      return handAngle("minute", sim.timeMs) / 360;
    case VALUE_TYPE.secondRatio:
      return handAngle("second", sim.timeMs) / 360;
    case VALUE_TYPE.stepsRatio:
    case VALUE_TYPE.powerRatio:
      return fieldFraction(valueType, sim);
    default:
      throw new Error(`replay does not know ratio ${valueType}`);
  }
}

function replay(bytes: Uint8Array) {
  const wf = readHwt(bytes).watchface!;
  const image = (ref: string) => toCanvasImage(decodeImage(wf.images[Number(ref) - 1]!));
  const canvas = createCanvas(SCREEN_W, SCREEN_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  const drawLayer = (layer: NamedObject) => {
    const key = Object.keys(layer).find((k) => k !== "index" && k !== "draw_type")!;
    const body = layer[key] as NamedObject;
    if (body.ambient_mode !== "NORMAL_ONLY") return;
    switch (layer.draw_type) {
      case "DRAW_TYPE_SINGLE_RES": {
        const p = body.res_position as { x: number; y: number };
        ctx.drawImage(image(body.res_name as string), p.x, p.y);
        break;
      }
      case "DRAW_TYPE_COMBINED_RES": {
        const { value, pad } = valueOf(body.value_type as number);
        const refs = body.res_name as string[];
        const digits = String(value).padStart(pad, "0").split("").map(Number);
        const imgs = digits.map((d) => image(refs[d]!));
        const total = imgs.reduce((n, i) => n + i.width, 0);
        const p = body.res_position as { x: number; y: number };
        let x = body.res_align === "CENTER" ? p.x - Math.round(total / 2) : p.x;
        for (const img of imgs) {
          ctx.drawImage(img, x, p.y);
          x += img.width;
        }
        break;
      }
      case "DRAW_TYPE_SELECTED_RES": {
        const { value } = valueOf(body.value_type as number);
        const p = body.res_position as { x: number; y: number };
        ctx.drawImage(image((body.res_name as string[])[value]!), p.x, p.y);
        break;
      }
      case "DRAW_TYPE_HAND_RES": {
        const rect = body.rotate_rect as { x: number; y: number; width: number; height: number };
        const pivot = body.rotate_point_hand as { x: number; y: number };
        const start = body.rotate_start_angel as number;
        const end = body.rotate_end_angel as number;
        const angle = start + (end - start) * ratioOf(body.value_type as number);
        ctx.save();
        ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
        ctx.rotate(angle * RAD);
        ctx.drawImage(image(body.res_name as string), -pivot.x, -pivot.y);
        ctx.restore();
        break;
      }
      case "DRAW_TYPE_ARC_RES": {
        const rect = body.rect as { x: number; y: number; width: number; height: number };
        const c = body.center_point as { x: number; y: number };
        const start = body.start_angle as number;
        const end = body.end_angle as number;
        const sweep = (end - start) * ratioOf(body.value_type as number);
        ctx.save();
        if (sweep <= 0) {
          ctx.restore();
          break;
        }
        if (sweep < Math.abs(end - start)) {
          ctx.beginPath();
          ctx.moveTo(rect.x + c.x, rect.y + c.y);
          ctx.arc(rect.x + c.x, rect.y + c.y, rect.width, (start - 90) * RAD, (start + sweep - 90) * RAD);
          ctx.closePath();
          ctx.clip();
        }
        ctx.drawImage(image(body.res_name as string), rect.x, rect.y);
        ctx.restore();
        break;
      }
      default:
        throw new Error(`replay does not draw ${String(layer.draw_type)}`);
    }
  };

  const named = describeLayout(getLayout(wf));
  for (const element of list(named.element)) {
    for (const layer of list(element.layer)) drawLayer(layer);
    for (const container of list(element.container)) for (const layer of list(container.layer)) drawLayer(layer);
  }
  return ctx.getImageData(0, 0, SCREEN_W, SCREEN_H).data;
}

describe("exported faces replayed from the layout", () => {
  for (const template of TEMPLATES) {
    it(`${template.name}: the replay matches the editor preview`, async () => {
      const project = await template.build();
      const result = await buildHwt(project, sim, { includeExperimental: true });
      const replayed = replay(result.bytes);
      const preview = spriteRgba(renderProjectSprite(project, sim)).data;

      let differing = 0;
      for (let i = 0; i < preview.length; i += 4) {
        const d = Math.abs(preview[i]! - replayed[i]!) + Math.abs(preview[i + 1]! - replayed[i + 1]!) + Math.abs(preview[i + 2]! - replayed[i + 2]!);
        if (d > 24) differing++;
      }
      // Antialiased edges of rotated hands and clipped arcs may differ by a pixel; whole elements must not.
      expect(differing / (preview.length / 4)).toBeLessThan(0.004);
    });
  }
});
