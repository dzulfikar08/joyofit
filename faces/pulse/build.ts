/**
 * Builds JoyoFitPulse.hwt for the Huawei Watch Fit 4 Pro (HWHD13, 408 x 480).
 *
 *   bun faces/pulse/build.ts
 *
 * Output: faces/pulse/dist/JoyoFitPulse.hwt, faces/pulse/dist/sprites/*.png (1x sprite sheet for inspection) and
 * faces/pulse/dist/spec.json (value types, positions, image table: what the Studio template needs).
 *
 * The layout is assembled with FaceBuilder from @joyofit/hwt (no lossless-JSON patching needed). Previews are drawn by the
 * layout simulator at 2x from hi-res renders of the very same sprites, so they cannot drift from the layout.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import jpeg from "jpeg-js";
import {
  FaceBuilder,
  VALUE_TYPE,
  WIDGET_DATA_TYPE,
  checkFit4Limits,
  createHwt,
  encodePng,
  usedImageIndices,
  getLayout,
  imageIndex,
  previewSizes,
  verifyWatchface,
  writeHwt,
  writeWatchface,
  type RgbaImage,
} from "../../packages/hwt/src/index";
import { STEPS_RING, SCREEN, TICK, layoutFor } from "./design";
import { renderFace, litFraction, type FaceSurface } from "./simulate";
import { makeCatalogue, type Sprite } from "./sprites";

const DIST = new URL("./dist/", import.meta.url).pathname;
const SPRITES_DIR = `${DIST}sprites/`;
mkdirSync(SPRITES_DIR, { recursive: true });

const cat = makeCatalogue();
const pos = layoutFor(cat);

/** Resamples `surface` to w x h with resvg (bicubic) and returns opaque RGBA. */
function resample(surface: FaceSurface, w: number, h: number): RgbaImage {
  const png = encodePng({ width: surface.width, height: surface.height, data: surface.data });
  const href = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000"/><image width="${w}" height="${h}" preserveAspectRatio="none" href="${href}"/></svg>`;
  const out = new Resvg(svg, { fitTo: { mode: "original" } }).render();
  return { width: out.width, height: out.height, data: new Uint8Array(out.pixels) };
}

function toJpeg(img: RgbaImage, quality = 92): Uint8Array {
  return new Uint8Array(jpeg.encode({ data: Buffer.from(img.data), width: img.width, height: img.height }, quality).data);
}

interface Previews {
  cover: Uint8Array;
  aod: Uint8Array;
  iconSmall: Uint8Array;
  thumbnail: RgbaImage;
}

const PREVIEW = previewSizes(SCREEN.w, SCREEN.h);

const blackPreviews = (): Previews => {
  const black = (w: number, h: number): RgbaImage => ({ width: w, height: h, data: new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : 0)) });
  const j = (w: number, h: number) => toJpeg(black(w, h));
  return {
    cover: j(PREVIEW.cover.width, PREVIEW.cover.height),
    aod: j(PREVIEW.aod.width, PREVIEW.aod.height),
    iconSmall: j(PREVIEW.iconSmall.width, PREVIEW.iconSmall.height),
    thumbnail: black(PREVIEW.thumbnail.width, PREVIEW.thumbnail.height),
  };
};

function assemble(previews: Previews) {
  const pkg = createHwt({
    title: "JoyoFitPulse",
    titleCn: "JoyoFit",
    author: "JoyoDigitama",
    designer: "JoyoDigitama",
    screen: "HWHD13",
    version: "2.1.1",
    cover: previews.cover,
    aod: previews.aod,
    iconSmall: previews.iconSmall,
    thumbnail: previews.thumbnail,
  });
  const face = new FaceBuilder(pkg.watchface!);

  // Sprite -> layout reference. Identical pixels share one slot (FaceBuilder dedupes), so names map many-to-one.
  const refOf = new Map<string, string>();
  const refNames = new Map<string, string>();
  const ref = (s: Sprite): string => {
    let r = refOf.get(s.name);
    if (!r) {
      r = face.image(s.render(1));
      refOf.set(s.name, r);
      if (!refNames.has(r)) refNames.set(r, s.name);
    }
    return r;
  };
  const refs = (list: readonly Sprite[]): string[] => list.map(ref);

  const { smallDigits, stepsDigits } = cat;

  // BACKGROUND: pure black, no layers (FunctionalForHikes does the same; an AMOLED black costs nothing).
  face.element("background", () => {});

  // WIDGET: one container per slot, `data_type` as in the samples (10 steps, 11 heart rate, 17 power).
  face.element("widget", (e) => {
    e.container(
      (c) => {
        c.singleImage({ image: ref(cat.ringTrack), x: pos.ringRect.x, y: pos.ringRect.y });
        c.arc({
          image: ref(cat.ringFill),
          rect: pos.ringRect,
          center: { x: STEPS_RING.size / 2, y: STEPS_RING.size / 2 },
          radius: STEPS_RING.radius,
          lineWidth: STEPS_RING.lineWidth,
          startAngle: STEPS_RING.startAngle,
          endAngle: STEPS_RING.endAngle,
          valueType: VALUE_TYPE.stepsRatio,
        });
        c.singleImage({ image: ref(cat.iconSteps), x: pos.stepsIcon.x, y: pos.stepsIcon.y });
        c.digits({ digits: refs(stepsDigits), x: pos.stepsNumber.x, y: pos.stepsNumber.y, align: "center", valueType: VALUE_TYPE.steps });
      },
      { dataType: WIDGET_DATA_TYPE.steps, rect: pos.ringRect },
    );
    e.container(
      (c) => {
        c.singleImage({ image: ref(cat.chipHeart), x: pos.chips.heart.x, y: pos.chips.heart.y });
        c.singleImage({ image: ref(cat.iconHeart), x: pos.heartIcon.x, y: pos.heartIcon.y });
        c.digits({ digits: refs(smallDigits), x: pos.heartNumber.x, y: pos.heartNumber.y, align: "right", valueType: VALUE_TYPE.heartRate });
        c.singleImage({ image: ref(cat.unitBpm), x: pos.heartUnit.x, y: pos.heartUnit.y });
      },
      { dataType: WIDGET_DATA_TYPE.heartRate, rect: { ...pos.chips.heart, width: cat.chipHeart.w, height: cat.chipHeart.h } },
    );
    e.container(
      (c) => {
        c.singleImage({ image: ref(cat.chipBattery), x: pos.chips.battery.x, y: pos.chips.battery.y });
        c.singleImage({ image: ref(cat.iconBattery), x: pos.batteryIcon.x, y: pos.batteryIcon.y });
        c.digits({ digits: refs(smallDigits), x: pos.batteryNumber.x, y: pos.batteryNumber.y, align: "right", valueType: VALUE_TYPE.power });
        c.singleImage({ image: ref(cat.unitPercent), x: pos.batteryUnit.x, y: pos.batteryUnit.y });
      },
      { dataType: WIDGET_DATA_TYPE.power, rect: { ...pos.chips.battery, width: cat.chipBattery.w, height: cat.chipBattery.h } },
    );
  });

  // DATE: weekday glyph (right-aligned to the axis) + day of month (left-aligned from it). Normal display only.
  face.element("date", (e) => {
    e.selected({ images: refs(cat.weekdays), x: pos.weekdayX, y: pos.dateY, valueType: VALUE_TYPE.week });
    e.digits({ digits: refs(cat.dateDigits), x: pos.dateDigitsX, y: pos.dateY, align: "left", valueType: VALUE_TYPE.date });
  });

  // TIME: hero hour over minute, seconds tick, and the AOD copies (outlined, dim, screen-centred) in AMBIENT_ONLY layers.
  face.element("time", (e) => {
    e.digits({ digits: refs(cat.heroDigits), x: pos.hourX, y: pos.hourY, align: "left", valueType: VALUE_TYPE.hour, ambient: "normal" });
    e.digits({ digits: refs(cat.heroDigits), x: pos.minuteX, y: pos.minuteY, align: "left", valueType: VALUE_TYPE.minute, ambient: "normal" });
    e.hand({ image: ref(cat.tick), rect: pos.tickRect, pivot: pos.tickPivot, startAngle: 0, endAngle: 360, valueType: VALUE_TYPE.secondRatio, ambient: "normal" });
    e.digits({ digits: refs(cat.heroDigitsAod), x: pos.aodHour.x, y: pos.aodHour.y, align: "left", valueType: VALUE_TYPE.hour, ambient: "aod" });
    e.digits({ digits: refs(cat.heroDigitsAod), x: pos.aodMinute.x, y: pos.aodMinute.y, align: "left", valueType: VALUE_TYPE.minute, ambient: "aod" });
  });

  face.commit();
  return { pkg, refNames };
}

// Pass 1: package with black previews, used to render the real previews through the simulator.
const first = assemble(blackPreviews());
const wf1 = first.pkg.watchface!;
const spriteForSlot = (index: number): Sprite => {
  const name = first.refNames.get(String(index + 1).padStart(3, "0"));
  const sprite = name ? cat.byName.get(name) : undefined;
  if (!sprite) throw new Error(`no sprite recorded for image slot ${index}`);
  return sprite;
};
const hi = (scale: number) => (index: number): RgbaImage => spriteForSlot(index).render(scale);

const normal2x = renderFace(wf1, { mode: "normal", scale: 2, images: hi(2) });
const aod2x = renderFace(wf1, { mode: "aod", scale: 2, images: hi(2) });
const previews: Previews = {
  cover: toJpeg(normal2x as RgbaImage),
  aod: toJpeg(aod2x as RgbaImage),
  iconSmall: toJpeg(resample(normal2x, PREVIEW.iconSmall.width, PREVIEW.iconSmall.height)),
  thumbnail: resample(normal2x, PREVIEW.thumbnail.width, PREVIEW.thumbnail.height),
};

// Pass 2: the real package.
const { pkg, refNames } = assemble(previews);
const bytes = writeHwt(pkg);
writeFileSync(`${DIST}JoyoFitPulse.hwt`, bytes);

// Inspection artefacts.
for (const s of cat.all) writeFileSync(`${SPRITES_DIR}${s.name}.png`, encodePng(s.render(1)));
writeFileSync(`${DIST}preview-cover.jpg`, previews.cover);
writeFileSync(`${DIST}preview-aod.jpg`, previews.aod);

const wf = pkg.watchface!;
const binary = writeWatchface(wf);
const report = verifyWatchface(binary);
const limits = checkFit4Limits(wf, binary.length, bytes.length);
const used = usedImageIndices(getLayout(wf));

const spec = {
  face: "JoyoFitPulse",
  screen: "HWHD13 408x480",
  version: pkg.description.version,
  files: { hwt: "faces/pulse/dist/JoyoFitPulse.hwt", build: "faces/pulse/build.ts", design: "faces/pulse/design.ts", sprites: "faces/pulse/sprites.ts", simulator: "faces/pulse/simulate.ts" },
  size: { hwtBytes: bytes.length, binaryBytes: binary.length, images: wf.images.length, usedImages: used.length, imageMemoryBytes: limits.imageMemoryBytes, largestImageBytes: limits.largestImageBytes, estLayerBytes: limits.layerBytes },
  aodLitPercent: Number((litFraction(renderFace(wf, { mode: "aod" })) * 100).toFixed(2)),
  elements: ["background (empty, black)", "widget: steps ring (data_type 10), heart-rate chip (11), battery chip (17)", "date: weekday + day", "time: hour/minute hero, seconds tick, AOD outline copies"],
  valueTypes: {
    hour: VALUE_TYPE.hour,
    minute: VALUE_TYPE.minute,
    date: VALUE_TYPE.date,
    week: VALUE_TYPE.week,
    steps: VALUE_TYPE.steps,
    heartRate: VALUE_TYPE.heartRate,
    power: VALUE_TYPE.power,
    secondRatio: VALUE_TYPE.secondRatio,
    stepsRatio: `${VALUE_TYPE.stepsRatio} (inferred, not verified)`,
  },
  positions: pos,
  tick: TICK,
  stepsRing: STEPS_RING,
  screenSize: SCREEN,
  slotNames: Object.fromEntries([...refNames].map(([r, n]) => [imageIndex(r), n])),
};
writeFileSync(`${DIST}spec.json`, `${JSON.stringify(spec, null, 2)}\n`);

console.log(`wrote ${DIST}JoyoFitPulse.hwt (${bytes.length} bytes)`);
console.log(`watchface ${binary.length} B, ${wf.images.length} images (${used.length} used), image memory ${limits.imageMemoryBytes} B, largest image ${limits.largestImageBytes} B`);
console.log(`verifyWatchface: ${JSON.stringify(report).slice(0, 300)}`);
console.log(`limits ok=${limits.ok} problems=${JSON.stringify(limits.problems)} warnings=${JSON.stringify(limits.warnings)}`);
console.log(`hero cell ${cat.heroCell.w}x${cat.heroCell.h}, small cell ${cat.smallCell.w}x${cat.smallCell.h}, date cell ${cat.dateCell.w}x${cat.dateCell.h}`);
console.log(`positions ${JSON.stringify(pos)}`);
