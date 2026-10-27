import { i18n } from "@/i18n";
import { DEFAULT_FONT } from "@/render/fonts";
import { VALUE_TYPE } from "@joyofit/hwt";
import { fitElements } from "./fit";
import { fieldDef, type FieldDef } from "./fields";
import { DEFAULT_SCREEN, type ScreenSpec } from "./screens";
import {
  PROJECT_VERSION,
  type BackgroundElement,
  type DateElement,
  type Element,
  type ElementType,
  type HandElement,
  type HandKind,
  type IconSetElement,
  type ImageElement,
  type Project,
  type RingElement,
  type TimeElement,
  type WidgetElement,
} from "./types";

export function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

const INK = "#F2F7F8";
/** New elements are drawn for the Watch Fit 4 screen; the editor fits them to the project's screen when it adds them (`fitElements`). */
const REF_CENTER_X = DEFAULT_SCREEN.width / 2;
const REF_CENTER_Y = DEFAULT_SCREEN.height / 2;

export function newBackground(): BackgroundElement {
  return {
    id: uid(),
    type: "background",
    name: i18n.t("editor:defaults.background"),
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    fill: { kind: "solid", color: "#000000" },
  };
}

export function newTime(patch: Partial<TimeElement> = {}): TimeElement {
  return {
    id: uid(),
    type: "time",
    name: i18n.t("editor:defaults.time"),
    visible: true,
    locked: false,
    x: 58,
    y: 190,
    font: DEFAULT_FONT,
    size: 72,
    color: INK,
    outline: null,
    layout: "row",
    showColon: true,
    showSeconds: false,
    secondsScale: 0.4,
    ampm: false,
    tracking: 2,
    ...patch,
  };
}

export function newDate(patch: Partial<DateElement> = {}): DateElement {
  return {
    id: uid(),
    type: "date",
    name: i18n.t("editor:defaults.date"),
    visible: true,
    locked: false,
    x: 120,
    y: 110,
    font: DEFAULT_FONT,
    size: 26,
    color: "#A9C2C9",
    outline: null,
    parts: ["weekday", "day", "month"],
    upper: true,
    tracking: 1,
    ...patch,
  };
}

export function newHand(hand: HandKind, patch: Partial<HandElement> = {}): HandElement {
  const base: Record<HandKind, Pick<HandElement, "length" | "width" | "tail" | "color" | "shape" | "name">> = {
    hour: { length: 100, width: 14, tail: 18, color: "#F2F7F8", shape: "classic", name: i18n.t("editor:defaults.hourHand") },
    minute: { length: 160, width: 10, tail: 22, color: "#F2F7F8", shape: "classic", name: i18n.t("editor:defaults.minuteHand") },
    second: { length: 175, width: 3, tail: 36, color: "#FF8FA4", shape: "needle", name: i18n.t("editor:defaults.secondHand") },
  };
  return {
    id: uid(),
    type: "hand",
    hand,
    visible: true,
    locked: false,
    x: REF_CENTER_X,
    y: REF_CENTER_Y,
    assetId: null,
    pivotX: 0,
    pivotY: 0,
    scale: 1,
    ...base[hand],
    ...patch,
  };
}

export function newImage(assetId: string | null, w: number, h: number, patch: Partial<ImageElement> = {}): ImageElement {
  return {
    id: uid(),
    type: "image",
    name: i18n.t("editor:defaults.image"),
    visible: true,
    locked: false,
    x: Math.round((DEFAULT_SCREEN.width - w) / 2),
    y: Math.round((DEFAULT_SCREEN.height - h) / 2),
    assetId,
    w,
    h,
    ...patch,
  };
}

function field(valueType: number): FieldDef {
  const def = fieldDef(valueType);
  if (!def) throw new Error(`value type ${valueType} is not in the field registry`);
  return def;
}

export function newWidget(valueType: number, patch: Partial<WidgetElement> = {}): WidgetElement {
  const def = field(valueType);
  return {
    id: uid(),
    type: "widget",
    name: def.label,
    visible: true,
    locked: false,
    x: 120,
    y: 360,
    valueType,
    font: DEFAULT_FONT,
    size: 34,
    color: INK,
    outline: null,
    showIcon: true,
    iconColor: def.color,
    layout: "side",
    tracking: 1,
    ...patch,
  };
}

export function newRing(valueType: number, patch: Partial<RingElement> = {}): RingElement {
  const def = field(valueType);
  return {
    id: uid(),
    type: "ring",
    name: i18n.t("editor:defaults.ring", { label: def.label }),
    visible: true,
    locked: false,
    x: 12,
    y: 36,
    valueType,
    size: 384,
    thickness: 14,
    startAngle: 0,
    sweep: 360,
    color: def.color,
    trackColor: "#24505E",
    roundCap: true,
    ...patch,
  };
}

export function newIconSet(valueType: number, patch: Partial<IconSetElement> = {}): IconSetElement {
  const def = field(valueType);
  return {
    id: uid(),
    type: "iconset",
    name: i18n.t("editor:defaults.icons", { label: def.label }),
    visible: true,
    locked: false,
    x: 180,
    y: 360,
    valueType,
    size: 48,
    color: def.color,
    ...patch,
  };
}

export function newElement(type: ElementType): Element {
  switch (type) {
    case "background":
      return newBackground();
    case "time":
      return newTime();
    case "date":
      return newDate();
    case "hand":
      return newHand("minute");
    case "image":
      return newImage(null, 120, 120);
    case "widget":
      return newWidget(VALUE_TYPE.steps);
    case "ring":
      return newRing(VALUE_TYPE.stepsRatio);
    case "iconset":
      return newIconSet(VALUE_TYPE.powerEnum);
  }
}

export function emptyProject(name: string = i18n.t("editor:defaults.project"), screen: ScreenSpec = DEFAULT_SCREEN): Project {
  return {
    version: PROJECT_VERSION,
    name,
    author: "",
    screen,
    elements: fitElements([newBackground(), newTime()], DEFAULT_SCREEN, screen),
  };
}

/** Display names of the element types, resolved when read so a language switch applies. */
export const ELEMENT_LABELS: Record<ElementType, string> = {
  get background() {
    return i18n.t("editor:elementType.background");
  },
  get time() {
    return i18n.t("editor:elementType.time");
  },
  get date() {
    return i18n.t("editor:elementType.date");
  },
  get hand() {
    return i18n.t("editor:elementType.hand");
  },
  get image() {
    return i18n.t("editor:elementType.image");
  },
  get widget() {
    return i18n.t("editor:elementType.widget");
  },
  get ring() {
    return i18n.t("editor:elementType.ring");
  },
  get iconset() {
    return i18n.t("editor:elementType.iconset");
  },
};

/** A `.hwt` file name: letters and digits only, as Huawei requires. */
export function hwtFileName(name: string): string {
  const base = name.replace(/[^A-Za-z0-9]/g, "");
  return base.length > 0 ? base : "JoyoFitFace";
}
