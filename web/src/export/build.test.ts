import { mkdirSync, writeFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import {
  FIT4_SCREEN,
  VALUE_TYPE,
  decodeImage,
  getEntry,
  getLayout,
  describeLayout,
  parseWatchface,
  previewSizes,
  readHwt,
  verifyWatchface,
  writeWatchface,
  type NamedObject,
} from "@joyofit/hwt";
import { describe, expect, it } from "vitest";
import { emptyProject, newDate, newHand, newImage, newRing, newTime, newWidget } from "@/model/defaults";
import { LEGACY_CALORIES_ID } from "@/model/fields";
import { presetById, presetScreen, type ScreenSpec } from "@/model/screens";
import type { Element, Project } from "@/model/types";
import { defaultSim } from "@/render/values";
import { TEMPLATES } from "@/templates";
import { registerTestAsset } from "@/test/node-canvas";
import { buildHwt } from "./build";

const out = process.env.RENDER_OUT;
const sim = defaultSim();

function list(value: unknown): NamedObject[] {
  return Array.isArray(value) ? (value as NamedObject[]) : [];
}

/** Every layer of the layout in file order, flattening containers, with the element label it sits in. */
function layers(bytes: Uint8Array): Array<{ label: string; layer: NamedObject }> {
  const pkg = readHwt(bytes);
  const named = describeLayout(getLayout(pkg.watchface!));
  const result: Array<{ label: string; layer: NamedObject }> = [];
  for (const element of list(named.element)) {
    const label = String(element.label);
    for (const layer of list(element.layer)) result.push({ label, layer });
    for (const container of list(element.container)) for (const layer of list(container.layer)) result.push({ label, layer });
  }
  return result;
}

function bodyOf(layer: NamedObject): NamedObject {
  const key = Object.keys(layer).find((k) => k !== "index" && k !== "draw_type")!;
  return layer[key] as NamedObject;
}

function withElements(elements: Element[]): Project {
  const base = emptyProject("Test face");
  return { ...base, elements: [base.elements[0]!, ...elements] };
}

describe("export assembly", () => {
  for (const template of TEMPLATES) {
    it(`${template.name}: re-reads with consistent header, image table and layout`, async () => {
      const project = await template.build();
      const result = await buildHwt(project, sim, { includeExperimental: true });
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(`${out}/${result.fileName}`, result.bytes);
        writeFileSync(`${out}/${result.fileName}.layout.json`, JSON.stringify(result.debug, null, 2));
      }

      const pkg = readHwt(result.bytes);
      expect(pkg.description.screen).toBe(FIT4_SCREEN);
      expect(pkg.description.title).toBe(project.name);
      expect(getEntry(pkg, "preview/cover.jpg")?.length).toBeGreaterThan(1000);
      expect(getEntry(pkg, "preview/aod.jpg")?.length).toBeGreaterThan(500);
      expect(getEntry(pkg, "preview/icon_small.jpg")?.length).toBeGreaterThan(500);

      const wf = pkg.watchface!;
      const binary = writeWatchface(wf);
      const report = verifyWatchface(binary);
      expect(report.problems).toEqual([]);
      expect(report.header.tableLen).toBe(wf.images.length * 8);
      expect(report.images).toBe(wf.images.length);
      expect(parseWatchface(binary).images.length).toBe(wf.images.length);

      // Slot 0 is the picker thumbnail.
      const thumb = decodeImage(wf.images[0]!);
      expect({ w: thumb.width, h: thumb.height }).toEqual({ w: previewSizes(408, 480).thumbnail.width, h: previewSizes(408, 480).thumbnail.height });

      // Every image reference in the layout names a real slot and decodes.
      const refs = new Set<number>();
      for (const { layer } of layers(result.bytes)) {
        const body = bodyOf(layer);
        const names = ([] as string[]).concat((body.res_name as string[] | string | undefined) ?? [], (body.res_sign as string | undefined) ?? []);
        for (const ref of names) if (ref) refs.add(Number(ref) - 1);
      }
      expect(refs.size).toBeGreaterThan(0);
      for (const index of refs) {
        expect(index).toBeGreaterThan(0);
        const img = decodeImage(wf.images[index]!);
        expect(img.width).toBeGreaterThan(0);
        expect(img.height).toBeGreaterThan(0);
        expect(img.width).toBeLessThanOrEqual(816);
      }

      expect(result.stats.images).toBe(wf.images.length);
      expect(result.notes.filter((n) => n.level === "error")).toEqual([]);
    });
  }

  it("writes a time element as hour and minute digit sequences with ten 0-9 images", async () => {
    const result = await buildHwt(withElements([newTime({ x: 40, y: 120 })]), sim, { includeExperimental: false });
    const time = layers(result.bytes).filter(({ label, layer }) => label === "ELEMENT_LABEL_TIME" && layer.draw_type === "DRAW_TYPE_COMBINED_RES");
    const normal = time.filter(({ layer }) => bodyOf(layer).ambient_mode === "NORMAL_ONLY").map(({ layer }) => bodyOf(layer));
    expect(normal.map((b) => b.value_type)).toEqual([VALUE_TYPE.hour, VALUE_TYPE.minute]);
    for (const body of normal) {
      expect((body.res_name as string[]).length).toBe(10);
      expect(body.res_align).toBe("LEFT");
    }
    // The AOD copy exists too, with its own dimmed sprites.
    expect(time.some(({ layer }) => bodyOf(layer).ambient_mode === "AMBIENT_ONLY")).toBe(true);

    const wf = readHwt(result.bytes).watchface!;
    const sizes = new Set((normal[0]!.res_name as string[]).map((r) => { const i = decodeImage(wf.images[Number(r) - 1]!); return `${i.width}x${i.height}`; }));
    expect(sizes.size).toBe(1);
  });

  it("encodes weekday, day and month, and keeps seconds out unless unconfirmed elements are on", async () => {
    const date = newDate({ x: 60, y: 60, parts: ["weekday", "day", "month"] });
    const time = newTime({ showSeconds: true });
    const project = withElements([date, time]);

    const strict = await buildHwt(project, sim, { includeExperimental: false });
    const strictTypes = layers(strict.bytes).map(({ layer }) => bodyOf(layer).value_type);
    expect(strictTypes).toEqual(expect.arrayContaining([VALUE_TYPE.week, VALUE_TYPE.date, VALUE_TYPE.month]));
    expect(strictTypes).not.toContain(VALUE_TYPE.secondLow);
    expect(strict.elements.filter((e) => !e.exported).map((e) => e.id)).toEqual([time.id]);

    const loose = await buildHwt(project, sim, { includeExperimental: true });
    const looseTypes = layers(loose.bytes).map(({ layer }) => bodyOf(layer).value_type);
    expect(looseTypes).toEqual(expect.arrayContaining([VALUE_TYPE.week, VALUE_TYPE.date, VALUE_TYPE.month, VALUE_TYPE.secondHigh, VALUE_TYPE.secondLow]));
    const week = layers(loose.bytes).find(({ layer }) => bodyOf(layer).value_type === VALUE_TYPE.week)!;
    const monthLayer = layers(loose.bytes).find(({ layer }) => bodyOf(layer).value_type === VALUE_TYPE.month)!;
    expect((bodyOf(week.layer).res_name as string[]).length).toBe(8);
    expect((bodyOf(monthLayer.layer).res_name as string[]).length).toBe(13);
  });

  it("leaves preview-only elements out and says so", async () => {
    const calories = newWidget(LEGACY_CALORIES_ID);
    const ampm = newTime({ ampm: true, name: "Clock" });
    const result = await buildHwt(withElements([calories, ampm]), sim, { includeExperimental: true });
    const left = result.elements.find((e) => e.id === calories.id)!;
    expect(left.exported).toBe(false);
    expect(left.detail).toMatch(/Preview only/);
    const clock = result.elements.find((e) => e.id === ampm.id)!;
    expect(clock.exported).toBe(true);
    expect(clock.dropped.join(" ")).toMatch(/AM\/PM/);
    expect(layers(result.bytes).some(({ layer }) => bodyOf(layer).value_type === undefined && layer.draw_type === "DRAW_TYPE_SELECTED_RES")).toBe(false);
  });

  it("writes the second hand (verified id) in strict mode and leaves the inferred hour hand out", async () => {
    const hour = newHand("hour");
    const second = newHand("second");
    const strict = await buildHwt(withElements([hour, second]), sim, { includeExperimental: false });
    const ids = layers(strict.bytes).filter(({ layer }) => layer.draw_type === "DRAW_TYPE_HAND_RES").map(({ layer }) => bodyOf(layer).value_type);
    expect(ids).toEqual([VALUE_TYPE.secondRatio]);
    expect(strict.elements.find((e) => e.id === hour.id)!.exported).toBe(false);
  });

  it("builds hands whose rotation box is centred on the pivot", async () => {
    const hand = newHand("minute", { x: 204, y: 240, length: 150 });
    const result = await buildHwt(withElements([hand]), sim, { includeExperimental: true });
    const handLayer = layers(result.bytes).find(({ layer }) => layer.draw_type === "DRAW_TYPE_HAND_RES" && bodyOf(layer).ambient_mode === "NORMAL_ONLY")!;
    const body = bodyOf(handLayer.layer);
    const rect = body.rotate_rect as { x: number; y: number; width: number; height: number };
    const pivot = body.rotate_point_hand as { x: number; y: number };
    expect(body.value_type).toBe(VALUE_TYPE.minuteRatio);
    expect(rect.x + rect.width / 2).toBe(204);
    expect(rect.y + rect.height / 2).toBe(240);
    expect(rect.width / 2).toBe(pivot.y);
    const wf = readHwt(result.bytes).watchface!;
    const img = decodeImage(wf.images[Number(body.res_name) - 1]!);
    expect(pivot.x).toBeLessThan(img.width);
    expect(pivot.y).toBeLessThan(img.height);
  });

  it("builds a ring as a track image plus an arc layer with the sweep as angles", async () => {
    const ring = newRing(VALUE_TYPE.powerRatio, { startAngle: 225, sweep: 270, size: 300, thickness: 12 });
    const result = await buildHwt(withElements([ring]), sim, { includeExperimental: true });
    const arc = layers(result.bytes).find(({ layer }) => layer.draw_type === "DRAW_TYPE_ARC_RES")!;
    const body = bodyOf(arc.layer);
    expect(body.value_type).toBe(VALUE_TYPE.powerRatio);
    expect(body.start_angle).toBe(225);
    expect(body.end_angle).toBe(495);
    expect(body.radius).toBe(144);
    expect(body.line_width).toBe(12);
  });

  it("crops images that hang off the screen instead of writing negative positions", async () => {
    await registerTestAsset("sticker", Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR4nGP4z8Dwn4EBCBgYGBgYGAAAFgAC/yvH4gAAAABJRU5ErkJggg==",
      "base64",
    ));
    const sticker = newImage("sticker", 100, 100, { x: -30, y: 20 });
    const result = await buildHwt(withElements([sticker]), sim, { includeExperimental: true });
    const single = layers(result.bytes).filter(({ layer }) => layer.draw_type === "DRAW_TYPE_SINGLE_RES");
    const placed = single.map(({ layer }) => bodyOf(layer).res_position as { x: number; y: number });
    expect(placed.every((p) => p.x >= 0 && p.y >= 0)).toBe(true);
  });

  it("splits a photo background that would exceed the single image limit into bands", async () => {
    const noise = createCanvas(480, 560);
    const nctx = noise.getContext("2d");
    const pixels = nctx.createImageData(480, 560);
    let seed = 12345;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      pixels.data[i] = seed & 255;
      pixels.data[i + 1] = (seed >> 8) & 255;
      pixels.data[i + 2] = (seed >> 16) & 255;
      pixels.data[i + 3] = 255;
    }
    nctx.putImageData(pixels, 0, 0);
    await registerTestAsset("noise", noise.toBuffer("image/png"));

    const project = withElements([]);
    project.elements[0] = { ...project.elements[0]!, fill: { kind: "image", assetId: "noise", zoom: 1, offsetX: 0, offsetY: 0, dim: 0 } } as Element;
    const result = await buildHwt(project, sim, { includeExperimental: true });
    const wf = readHwt(result.bytes).watchface!;
    expect(wf.images.every((b) => b.length <= 750 * 1024)).toBe(true);
    const normal = layers(result.bytes).filter(({ label, layer }) => label === "ELEMENT_LABEL_BACKGROUND" && bodyOf(layer).ambient_mode === "NORMAL_ONLY");
    expect(normal.length).toBeGreaterThanOrEqual(2);
    // The bands tile the whole screen: positions ascend and heights sum to 480.
    const rows = normal.map(({ layer }) => {
      const body = bodyOf(layer);
      const img = decodeImage(wf.images[Number(body.res_name) - 1]!);
      return { y: (body.res_position as { y: number }).y, h: img.height, w: img.width };
    });
    expect(rows[0]!.y).toBe(0);
    expect(rows.reduce((n, r) => n + r.h, 0)).toBe(480);
    expect(rows.every((r) => r.w === 408)).toBe(true);
    expect(result.notes.filter((n) => n.level === "error")).toEqual([]);
  });

  it("reports an element left out when it cannot be placed", async () => {
    const time = newTime({ x: -40, y: 100, name: "Clock" });
    const result = await buildHwt(withElements([time]), sim, { includeExperimental: true });
    const entry = result.elements.find((e) => e.id === time.id)!;
    expect(entry.exported).toBe(false);
    expect(result.notes.some((n) => n.level === "warning" && /Clock/.test(n.text))).toBe(true);
  });

  it("names the file with letters and digits only", async () => {
    const result = await buildHwt({ ...emptyProject("My cool face #1!"), name: "My cool face #1!" }, sim, { includeExperimental: true });
    expect(result.fileName).toBe("Mycoolface1.hwt");
  });
});

/**
 * Width and height of a preview. In a browser it is a JPEG (size from the first SOF marker); the node canvas these tests run on
 * writes a PNG for the same request, which carries its size in the IHDR chunk.
 */
function imageSize(bytes: Uint8Array): [number, number] {
  const u32 = (at: number) => ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return [u32(16), u32(20)];
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [(bytes[i + 7]! << 8) | bytes[i + 8]!, (bytes[i + 5]! << 8) | bytes[i + 6]!];
    i += 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!);
  }
  throw new Error("no SOF marker");
}

const onScreen = (screen: ScreenSpec, ...elements: Element[]): Project => {
  const base = emptyProject("Screen test", screen);
  return { ...base, elements: [base.elements[0]!, ...elements] };
};

const preset = (id: string): ScreenSpec => presetScreen(presetById(id)!);

describe("export for other screens", () => {
  it("writes the Watch Fit 4 face as before: HWHD13, version 2.1.1, tested, Huawei's limits checked", async () => {
    const result = await buildHwt(onScreen(preset("fit4"), newTime({ x: 40, y: 120 })), sim, { includeExperimental: true });
    const pkg = readHwt(result.bytes);
    expect(pkg.description).toMatchObject({ screen: FIT4_SCREEN, version: "2.1.1" });
    expect(result.target).toEqual({ code: "HWHD13", version: "2.1.1", status: "tested", limitsKnown: true });
    expect(imageSize(getEntry(pkg, "preview/cover.jpg")!)).toEqual([816, 960]);
    expect(imageSize(getEntry(pkg, "preview/icon_small.jpg")!)).toEqual([331, 390]);
    expect(result.notes.some((n) => /not known to Studio|Not tried|Experimental|has not tried/.test(n.text))).toBe(false);
  });

  for (const [id, code, width, height, thumb] of [
    ["gt466", "HWHD09", 466, 466, { width: 260, height: 261 }],
    ["band194", "HWHD07", 194, 368, { width: 108, height: 206 }],
  ] as const) {
    it(`${id}: ${code} .hwt with ${width} x ${height} images, no Fit 4 limit errors, marked untested`, async () => {
      const result = await buildHwt(onScreen(preset(id), newTime({ x: 20, y: 60 })), sim, { includeExperimental: true });
      const pkg = readHwt(result.bytes);
      expect(pkg.description.screen).toBe(code);
      expect(result.target).toMatchObject({ code, status: "untested", limitsKnown: false });

      const wf = pkg.watchface!;
      expect(verifyWatchface(writeWatchface(wf)).problems).toEqual([]);
      const picker = decodeImage(wf.images[0]!);
      expect({ width: picker.width, height: picker.height }).toEqual(thumb);
      expect(imageSize(getEntry(pkg, "preview/cover.jpg")!)).toEqual([width * 2, height * 2]);
      expect(imageSize(getEntry(pkg, "preview/aod.jpg")!)).toEqual([width * 2, height * 2]);

      const background = layers(result.bytes).filter(({ label, layer }) => label === "ELEMENT_LABEL_BACKGROUND" && bodyOf(layer).ambient_mode === "NORMAL_ONLY");
      expect(background).toHaveLength(1);
      const bg = decodeImage(wf.images[Number(bodyOf(background[0]!.layer).res_name) - 1]!);
      expect({ width: bg.width, height: bg.height }).toEqual({ width, height });

      expect(result.notes.filter((n) => n.level === "error" || n.limit)).toEqual([]);
      expect(result.notes.some((n) => n.screenStatus && n.text.includes(code))).toBe(true);
      expect(result.notes.some((n) => n.text === "Size limits for this screen are not known to Studio; Huawei's tool may refuse it.")).toBe(true);
      expect(result.debug).toMatchObject({ screen: code, screenSize: { width, height } });
    });
  }

  it("crops to the project's screen, not to 408 x 480", async () => {
    await registerTestAsset("wide", Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR4nGP4z8Dwn4EBCBgYGBgYGAAAFgAC/yvH4gAAAABJRU5ErkJggg==",
      "base64",
    ));
    const sticker = newImage("wide", 100, 100, { x: 150, y: 300 });
    const result = await buildHwt(onScreen(preset("band194"), sticker), sim, { includeExperimental: true });
    const wf = readHwt(result.bytes).watchface!;
    const single = layers(result.bytes).filter(({ label, layer }) => label === "ELEMENT_LABEL_BACKGROUND" && layer.draw_type === "DRAW_TYPE_SINGLE_RES" && bodyOf(layer).ambient_mode === "NORMAL_ONLY");
    const sizes = single.map(({ layer }) => decodeImage(wf.images[Number(bodyOf(layer).res_name) - 1]!)).map((i) => `${i.width}x${i.height}`);
    // Background, then the sticker cut to the 44 x 68 px left of the 194 x 368 screen.
    expect(sizes).toContain("44x68");
  });

  it("splits a photo background into bands that use the screen's width and height", async () => {
    const noise = createCanvas(480, 480);
    const nctx = noise.getContext("2d");
    const pixels = nctx.createImageData(480, 480);
    let seed = 777;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      pixels.data[i] = seed & 255;
      pixels.data[i + 1] = (seed >> 8) & 255;
      pixels.data[i + 2] = (seed >> 16) & 255;
      pixels.data[i + 3] = 255;
    }
    nctx.putImageData(pixels, 0, 0);
    await registerTestAsset("noise466", noise.toBuffer("image/png"));

    const project = onScreen(preset("gt466"));
    project.elements[0] = { ...project.elements[0]!, fill: { kind: "image", assetId: "noise466", zoom: 1, offsetX: 0, offsetY: 0, dim: 0 } } as Element;
    const result = await buildHwt(project, sim, { includeExperimental: true });
    const wf = readHwt(result.bytes).watchface!;
    expect(wf.images.every((b) => b.length <= 750 * 1024)).toBe(true);
    const normal = layers(result.bytes).filter(({ label, layer }) => label === "ELEMENT_LABEL_BACKGROUND" && bodyOf(layer).ambient_mode === "NORMAL_ONLY");
    expect(normal.length).toBeGreaterThanOrEqual(2);
    const rows = normal.map(({ layer }) => {
      const body = bodyOf(layer);
      const img = decodeImage(wf.images[Number(body.res_name) - 1]!);
      return { y: (body.res_position as { y: number }).y, h: img.height, w: img.width };
    });
    expect(rows[0]!.y).toBe(0);
    expect(rows.reduce((n, r) => n + r.h, 0)).toBe(466);
    expect(rows.every((r) => r.w === 466)).toBe(true);
  });

  it("a custom size that matches a Huawei screen code exports as experimental with that code", async () => {
    const custom: ScreenSpec = { presetId: null, width: 466, height: 466, shape: "circle", cornerRadius: 0 };
    const result = await buildHwt(onScreen(custom, newTime({ x: 20, y: 60 })), sim, { includeExperimental: true });
    expect(readHwt(result.bytes).description).toMatchObject({ screen: "HWHD09", version: "2.1.1" });
    expect(result.target).toEqual({ code: "HWHD09", version: "2.1.1", status: "experimental", limitsKnown: false });
    expect(result.notes.some((n) => /^Experimental: .*HWHD09.*2\.1\.1/.test(n.text))).toBe(true);
  });

  it("refuses a custom size Huawei has no screen code for, with the reason", async () => {
    const custom: ScreenSpec = { presetId: null, width: 300, height: 300, shape: "squircle", cornerRadius: 60 };
    await expect(buildHwt(onScreen(custom), sim, { includeExperimental: true })).rejects.toThrow("Huawei has no screen code for 300 × 300");
  });
});
