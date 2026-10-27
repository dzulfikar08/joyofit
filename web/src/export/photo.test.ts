import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { emptyProject, newDate, newHand, newImage, newRing, newTime, newWidget } from "@/model/defaults";
import { presetById, presetScreen, type ScreenSpec } from "@/model/screens";
import type { Element, Project } from "@/model/types";
import { defaultSim } from "@/render/values";
import { registerTestAsset } from "@/test/node-canvas";
import { VALUE_TYPE } from "@joyofit/hwt";
import { buildPhotoFace } from "./photo";
import { isStaticElement } from "./support";
import { canSendPhotoFace } from "./target";

const sim = defaultSim();

function solidPng(width: number, height: number, fill: string): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

/** Decodes the PNG the export wrote and returns its pixels. */
async function pixels(png: Uint8Array) {
  const image = await loadImage(Buffer.from(png));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  const at = (x: number, y: number) => [data[(y * image.width + x) * 4]!, data[(y * image.width + x) * 4 + 1]!, data[(y * image.width + x) * 4 + 2]!, data[(y * image.width + x) * 4 + 3]!] as const;
  return { width: image.width, height: image.height, data, at };
}

function face(...elements: Element[]): Project {
  const base = emptyProject("Photo face test");
  return { ...base, elements: [base.elements[0]!, ...elements] };
}

describe("photo-face export", () => {
  it("decides what is static in one place", () => {
    expect(isStaticElement(emptyProject().elements[0]!)).toBe(true);
    expect(isStaticElement(newImage(null, 10, 10))).toBe(true);
    for (const live of [newTime(), newDate(), newHand("minute"), newWidget(VALUE_TYPE.steps), newRing(VALUE_TYPE.stepsRatio)]) expect(isStaticElement(live)).toBe(false);
  });

  it("writes a 408 x 480 opaque PNG with the static layer's pixels and none of a live layer's", async () => {
    await registerTestAsset("photo-red", solidPng(100, 80, "#FF0000"));
    const background = { ...emptyProject().elements[0]!, fill: { kind: "solid", color: "#102030" } } as Element;
    const sticker = newImage("photo-red", 100, 80, { x: 50, y: 60, name: "Red sticker" });
    // A big green clock and a green ring: nothing green may reach the picture.
    const clock = newTime({ x: 40, y: 300, size: 120, color: "#00FF00", name: "Clock" });
    const ring = newRing(VALUE_TYPE.stepsRatio, { x: 100, y: 120, size: 200, thickness: 40, color: "#00FF00", trackColor: "#00FF00" });
    const result = await buildPhotoFace({ ...emptyProject("My photo"), elements: [background, sticker, clock, ring] }, sim);

    expect(result.fileName).toBe("Myphoto.photo.png");
    expect([result.width, result.height]).toEqual([408, 480]);
    const img = await pixels(result.png);
    expect([img.width, img.height]).toEqual([408, 480]);

    // The static layers are there: the sticker over the background.
    expect(img.at(100, 100)).toEqual([255, 0, 0, 255]);
    expect(img.at(5, 5)).toEqual([16, 32, 48, 255]);
    // No live layer: not one greenish pixel anywhere, and the clock's box shows the background.
    let green = 0;
    let transparent = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 1]! > 200 && img.data[i]! < 80 && img.data[i + 2]! < 80) green++;
      if (img.data[i + 3]! !== 255) transparent++;
    }
    expect(green).toBe(0);
    expect(transparent).toBe(0);
    expect(img.at(200, 360)).toEqual([16, 32, 48, 255]);

    expect(result.liveLeftOut).toEqual(["Clock", ring.name]);
    expect(result.layers.filter((l) => l.included).map((l) => l.name)).toEqual(["Background", "Red sticker"]);
  });

  for (const [id, width, height] of [
    ["gt466", 466, 466],
    ["band194", 194, 368],
  ] as const) {
    it(`${id}: the PNG is ${width} x ${height} and its background fills it`, async () => {
      const screen = presetScreen(presetById(id)!);
      const background = { ...emptyProject().elements[0]!, fill: { kind: "solid", color: "#102030" } } as Element;
      const result = await buildPhotoFace({ ...emptyProject("Other screen", screen), elements: [background] }, sim);
      expect([result.width, result.height]).toEqual([width, height]);
      const img = await pixels(result.png);
      expect([img.width, img.height]).toEqual([width, height]);
      expect(img.at(width - 1, height - 1)).toEqual([16, 32, 48, 255]);
      expect(canSendPhotoFace(screen)).toBe(false);
    });
  }

  it("a custom 300 x 300 screen gives a 300 x 300 PNG that JoyoFit can't send", async () => {
    const screen: ScreenSpec = { presetId: null, width: 300, height: 300, shape: "squircle", cornerRadius: 60 };
    const result = await buildPhotoFace(emptyProject("Custom", screen), sim);
    expect([result.width, result.height]).toEqual([300, 300]);
    expect(canSendPhotoFace(screen)).toBe(false);
    expect(canSendPhotoFace(presetScreen(presetById("fit4")!))).toBe(true);
  });

  it("flattens transparency onto opaque black", async () => {
    const half = createCanvas(40, 40);
    const hctx = half.getContext("2d");
    hctx.fillStyle = "rgba(255,255,255,0.5)";
    hctx.fillRect(0, 0, 40, 40);
    await registerTestAsset("photo-half", half.toBuffer("image/png"));
    const bg = { ...emptyProject().elements[0]!, fill: { kind: "solid", color: "#000000" } } as Element;
    const result = await buildPhotoFace({ ...emptyProject(), elements: [bg, newImage("photo-half", 40, 40, { x: 10, y: 10 })] }, sim);
    const img = await pixels(result.png);
    const [r, g, b, a] = img.at(20, 20);
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(135);
    expect([g, b]).toEqual([r, r]);
    expect(img.at(100, 100)).toEqual([0, 0, 0, 255]);
  });

  it("applies no rounded-corner mask", async () => {
    const bg = { ...emptyProject().elements[0]!, fill: { kind: "solid", color: "#336699" } } as Element;
    const result = await buildPhotoFace({ ...emptyProject(), elements: [bg] }, sim);
    const img = await pixels(result.png);
    for (const [x, y] of [[0, 0], [407, 0], [0, 479], [407, 479]] as const) expect(img.at(x, y)).toEqual([51, 102, 153, 255]);
  });

  it("leaves out hidden layers and layers whose image is missing, without a placeholder box", async () => {
    await registerTestAsset("photo-red", solidPng(100, 80, "#FF0000"));
    const hidden = newImage("photo-red", 100, 80, { x: 200, y: 60, visible: false, name: "Hidden" });
    const missing = newImage("not-loaded", 120, 120, { x: 100, y: 200, name: "Missing" });
    const empty = newImage(null, 50, 50, { x: 300, y: 300, name: "Empty" });
    const result = await buildPhotoFace(face(hidden, missing, empty), sim);
    const img = await pixels(result.png);
    // The background is black and the dashed placeholder the stage draws for a missing image is not in the picture.
    for (const [x, y] of [[250, 100], [150, 250], [160, 260], [320, 320]] as const) expect(img.at(x, y)).toEqual([0, 0, 0, 255]);
    const byName = Object.fromEntries(result.layers.map((l) => [l.name, l]));
    expect(byName.Hidden).toMatchObject({ included: false });
    expect(byName.Missing).toMatchObject({ included: false });
    expect(byName.Missing!.detail).toMatch(/did not load/);
    expect(byName.Empty!.detail).toMatch(/No image chosen/);
  });

  it("says when a photo background is missing and draws plain black", async () => {
    const bg = { ...emptyProject().elements[0]!, fill: { kind: "image", assetId: "gone", zoom: 1, offsetX: 0, offsetY: 0, dim: 0 } } as Element;
    const result = await buildPhotoFace({ ...emptyProject(), elements: [bg] }, sim);
    expect(result.layers[0]!.detail).toMatch(/plain black/);
    expect((await pixels(result.png)).at(200, 240)).toEqual([0, 0, 0, 255]);
  });
});
