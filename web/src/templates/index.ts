import { i18n } from "@/i18n";
import { VALUE_TYPE } from "@joyofit/hwt";
import { addGeneratedAsset } from "@/model/assets";
import { newBackground, newDate, newHand, newRing, newTime, newWidget } from "@/model/defaults";
import { fitElements, fitOf } from "@/model/fit";
import { DEFAULT_SCREEN, type ScreenSpec } from "@/model/screens";
import { PROJECT_VERSION, type Element, type Project } from "@/model/types";
import { fontsOf } from "@/editor/useFonts";
import { newSprite } from "@/render/canvas";
import { ensureFont } from "@/render/fonts";
import { layoutOf } from "@/render/scene";

/**
 * Starter faces. Each is laid out for the Watch Fit 4 screen (408 x 480) from the same element factories the editor uses, then fitted
 * to the screen it is built for (`fitElements`: uniform scale by the smaller ratio, centred), so a template is an ordinary project the
 * user can change freely. Palette: JoyoFit's ink teal with per-metric colors.
 */
export interface Template {
  id: string;
  name: string;
  blurb: string;
  build: (screen?: ScreenSpec) => Promise<Project>;
}

const INK = "#F2F7F8";
const MUTED = "#8FA9B1";
const TEAL = "#5FD3EE";
const ROSE = "#FF8FA4";
const GREEN = "#6EE7A0";
const AMBER = "#F5B35A";
const TRACK = "#1D4250";

/** The face of a template: `elements` are laid out for the Fit 4 screen and fitted to `screen`. */
function project(name: string, elements: Element[], screen: ScreenSpec): Project {
  return { version: PROJECT_VERSION, name, author: "", screen, elements: fitElements(elements, DEFAULT_SCREEN, screen) };
}

const REF_CENTER_X = DEFAULT_SCREEN.width / 2;
const REF_CENTER_Y = DEFAULT_SCREEN.height / 2;

async function ready(elements: Element[]): Promise<void> {
  await Promise.all(fontsOf(elements).map(ensureFont));
}

/** Sets x so the element's layout is centred on `cx`. Needs the fonts loaded. */
function centreX<T extends Element>(el: T, cx = REF_CENTER_X): T {
  const w = layoutOf(el)?.w ?? 0;
  return { ...el, x: Math.round(cx - w / 2) };
}

function bounds(el: Element): { w: number; h: number } {
  const l = layoutOf(el);
  return { w: l?.w ?? 0, h: l?.h ?? 0 };
}

const quiet: Template = {
  id: "quiet",
  get name() {
    return i18n.t("templates:items.quiet.name");
  },
  get blurb() {
    return i18n.t("templates:items.quiet.blurb");
  },
  build: async (screen = DEFAULT_SCREEN) => {
    const bg = { ...newBackground(), fill: { kind: "solid" as const, color: "#000000" } };
    let time = newTime({ name: i18n.t("templates:layers.time"), font: { family: "Outfit", weight: 300 }, size: 88, color: INK, tracking: 0, y: 0 });
    let date = newDate({ name: i18n.t("templates:layers.date"), font: { family: "Outfit", weight: 500 }, size: 24, color: MUTED, parts: ["weekday", "day"], tracking: -3 });
    await ready([time, date]);
    time = centreX({ ...time, y: Math.round(REF_CENTER_Y - bounds(time).h / 2 + 8) });
    date = centreX({ ...date, y: time.y - 46 });
    return project(i18n.t("templates:items.quiet.name"), [bg, time, date], screen);
  },
};

const stackRing: Template = {
  id: "stack-ring",
  get name() {
    return i18n.t("templates:items.stack-ring.name");
  },
  get blurb() {
    return i18n.t("templates:items.stack-ring.blurb");
  },
  build: async (screen = DEFAULT_SCREEN) => {
    const bg = { ...newBackground(), fill: { kind: "gradient" as const, from: "#0F2F3A", to: "#02080A", angle: 180 } };
    const ring = newRing(VALUE_TYPE.stepsRatio, { x: 20, y: 48, size: 368, thickness: 16, color: TEAL, trackColor: TRACK });
    let time = newTime({
      name: i18n.t("templates:layers.time"),
      layout: "stack",
      font: { family: "Big Shoulders Display", weight: 900 },
      size: 100,
      color: INK,
      tracking: -4,
    });
    let steps = newWidget(VALUE_TYPE.steps, { font: { family: "Big Shoulders Display", weight: 700 }, size: 30, color: TEAL, iconColor: TEAL, layout: "side" });
    await ready([time, steps]);
    time = centreX({ ...time, y: Math.round(REF_CENTER_Y - bounds(time).h / 2 - 30) });
    steps = centreX({ ...steps, y: time.y + bounds(time).h + 12 });
    return project(i18n.t("templates:items.stack-ring.name"), [bg, ring, time, steps], screen);
  },
};

/** Dial artwork: hour and minute ticks and four numerals, drawn once and used as the background photo, sized to the screen. */
async function dialAsset(screen: ScreenSpec): Promise<string> {
  const { sprite, ctx } = newSprite(screen.width, screen.height);
  ctx.fillStyle = "#050B0D";
  ctx.fillRect(0, 0, screen.width, screen.height);
  // Drawn for the Fit 4 screen, then placed the way `fitElements` places the hands that sit on it.
  const { k, dx, dy } = fitOf(DEFAULT_SCREEN, screen);
  ctx.translate(dx, dy);
  ctx.scale(k, k);
  const cx = REF_CENTER_X;
  const cy = REF_CENTER_Y;
  ctx.lineCap = "round";
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const hour = i % 5 === 0;
    const outer = 200;
    const inner = hour ? 176 : 190;
    ctx.strokeStyle = hour ? INK : "#4B6A73";
    ctx.lineWidth = hour ? 5 : 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner);
    ctx.lineTo(cx + Math.sin(a) * outer, cy - Math.cos(a) * outer);
    ctx.stroke();
  }
  ctx.fillStyle = INK;
  ctx.font = '700 40px "Plus Jakarta Sans Variable"';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [label, a] of [["12", 0], ["3", 90], ["9", 270]] as const) {
    const r = 132;
    ctx.fillText(label, cx + Math.sin((a * Math.PI) / 180) * r, cy - Math.cos((a * Math.PI) / 180) * r + 2);
  }
  return addGeneratedAsset(sprite.surface, "classic-dial.png");
}

const classic: Template = {
  id: "classic",
  get name() {
    return i18n.t("templates:items.classic.name");
  },
  get blurb() {
    return i18n.t("templates:items.classic.blurb");
  },
  build: async (screen = DEFAULT_SCREEN) => {
    const assetId = await dialAsset(screen);
    const bg = { ...newBackground(), fill: { kind: "image" as const, assetId, zoom: 1, offsetX: 0, offsetY: 0, dim: 0 } };
    let date = newDate({ font: { family: "Plus Jakarta Sans Variable", weight: 700 }, size: 22, color: AMBER, parts: ["weekday", "day"], tracking: -2 });
    await ready([date]);
    date = centreX({ ...date, y: 340 });
    const hour = newHand("hour", { length: 96, width: 14, tail: 16, color: INK, shape: "classic" });
    const minute = newHand("minute", { length: 156, width: 10, tail: 20, color: INK, shape: "classic" });
    const second = newHand("second", { length: 178, width: 3, tail: 38, color: AMBER, shape: "needle" });
    return project(i18n.t("templates:items.classic.name"), [bg, date, hour, minute, second], screen);
  },
};

/** A dusk landscape drawn in code: sky gradient, a low sun and two ridges. Stands in until the user adds a photo. */
async function backdropAsset(screen: ScreenSpec): Promise<string> {
  const w = screen.width * 2;
  const h = screen.height * 2;
  const { sprite, ctx } = newSprite(w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#1B2A52");
  sky.addColorStop(0.55, "#B6577A");
  sky.addColorStop(0.78, "#F3A66B");
  sky.addColorStop(1, "#F7D08A");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const sun = ctx.createRadialGradient(w * 0.68, h * 0.72, 10, w * 0.68, h * 0.72, w * 0.55);
  sun.addColorStop(0, "rgba(255,244,214,0.95)");
  sun.addColorStop(0.25, "rgba(255,200,140,0.55)");
  sun.addColorStop(1, "rgba(255,160,120,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  const ridge = (base: number, amp: number, phase: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      const y = base + Math.sin(x / 190 + phase) * amp + Math.sin(x / 71 + phase * 2) * amp * 0.35;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  };
  ridge(h * 0.8, 46, 1.2, "#4A2F4F");
  ridge(h * 0.88, 38, 3.4, "#241632");
  return addGeneratedAsset(sprite.surface, "dusk-backdrop.png");
}

const photo: Template = {
  id: "photo",
  get name() {
    return i18n.t("templates:items.photo.name");
  },
  get blurb() {
    return i18n.t("templates:items.photo.blurb");
  },
  build: async (screen = DEFAULT_SCREEN) => {
    const assetId = await backdropAsset(screen);
    const bg = { ...newBackground(), fill: { kind: "image" as const, assetId, zoom: 1, offsetX: 0, offsetY: 0, dim: 0.12 } };
    let date = newDate({ font: { family: "Outfit", weight: 700 }, size: 26, color: "#FFFFFF", parts: ["weekday", "day"], tracking: -2, outline: { color: "#2A1633", width: 2 } });
    let time = newTime({ font: { family: "Outfit", weight: 700 }, layout: "stack", size: 104, color: "#FFFFFF", tracking: 0, outline: { color: "#2A1633", width: 3 } });
    await ready([time, date]);
    time = { ...time, x: 36, y: 62 };
    date = { ...date, x: 44, y: time.y + bounds(time).h + 16 };
    return project(i18n.t("templates:items.photo.name"), [bg, date, time], screen);
  },
};

const sport: Template = {
  id: "sport",
  get name() {
    return i18n.t("templates:items.sport.name");
  },
  get blurb() {
    return i18n.t("templates:items.sport.blurb");
  },
  build: async (screen = DEFAULT_SCREEN) => {
    const bg = { ...newBackground(), fill: { kind: "solid" as const, color: "#070D0F" } };
    let time = newTime({ font: { family: "Oswald", weight: 600 }, size: 92, color: INK, tracking: 2 });
    let date = newDate({ font: { family: "Oswald", weight: 400 }, size: 24, color: MUTED, parts: ["weekday", "day"], tracking: -1 });
    const font = { family: "Oswald", weight: 600 };
    let steps = newWidget(VALUE_TYPE.steps, { font, size: 28, color: INK, iconColor: TEAL, layout: "stack" });
    let heart = newWidget(VALUE_TYPE.heartRate, { font, size: 44, color: INK, iconColor: ROSE });
    let battery = newWidget(VALUE_TYPE.power, { font, size: 44, color: INK, iconColor: GREEN });
    const ring = newRing(VALUE_TYPE.stepsRatio, { size: 168, thickness: 14, color: TEAL, trackColor: TRACK, x: 0, y: 0 });
    await ready([time, date, steps, heart, battery]);
    time = centreX({ ...time, y: 76 });
    date = centreX({ ...date, y: 40 });
    heart = { ...heart, x: 52, y: 262 };
    battery = { ...battery, x: 52, y: 340 };
    const ringX = 214;
    const ringY = 246;
    steps = centreX({ ...steps, y: ringY + Math.round((ring.size - bounds(steps).h) / 2) }, ringX + ring.size / 2);
    return project(i18n.t("templates:items.sport.name"), [bg, { ...ring, x: ringX, y: ringY }, time, date, steps, heart, battery], screen);
  },
};

const orbit: Template = {
  id: "orbit",
  get name() {
    return i18n.t("templates:items.orbit.name");
  },
  get blurb() {
    return i18n.t("templates:items.orbit.blurb");
  },
  build: async (screen = DEFAULT_SCREEN) => {
    const bg = { ...newBackground(), fill: { kind: "gradient" as const, from: "#10242C", to: "#03090B", angle: 160 } };
    const outer = newRing(VALUE_TYPE.stepsRatio, { x: 16, y: 52, size: 376, thickness: 14, startAngle: 225, sweep: 270, color: TEAL, trackColor: TRACK });
    const inner = newRing(VALUE_TYPE.powerRatio, { x: 44, y: 80, size: 320, thickness: 10, startAngle: 225, sweep: 270, color: GREEN, trackColor: TRACK });
    let date = newDate({ font: { family: "Plus Jakarta Sans Variable", weight: 700 }, size: 22, color: INK, parts: ["weekday", "day"], tracking: -2 });
    let time = newTime({ font: { family: "Plus Jakarta Sans Variable", weight: 700 }, size: 34, color: MUTED, tracking: 0 });
    await ready([date, time]);
    date = centreX({ ...date, y: 150 });
    time = centreX({ ...time, y: 396 });
    const hour = newHand("hour", { length: 84, width: 12, tail: 14, color: INK, shape: "baton" });
    const minute = newHand("minute", { length: 130, width: 9, tail: 18, color: INK, shape: "baton" });
    const second = newHand("second", { length: 146, width: 3, tail: 30, color: AMBER, shape: "needle" });
    return project(i18n.t("templates:items.orbit.name"), [bg, outer, inner, date, time, hour, minute, second], screen);
  },
};

export const TEMPLATES: Template[] = [quiet, stackRing, classic, photo, sport, orbit];
