/**
 * The JoyoFit Studio document model. Everything here is plain JSON so a project can be autosaved, undone
 * (snapshots are cheap because updates are immutable) and exported as a `.json` file.
 *
 * Coordinates are pixels of the project's own screen (`Project.screen`, see `screens.ts`), top left at 0,0.
 * Elements are listed bottom to top.
 */

import type { ScreenSpec } from "./screens";

export const PROJECT_VERSION = 1;

export type FontRef = { family: string; weight: number };

export type Outline = { color: string; width: number } | null;

export type BackgroundFill =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angle: number }
  | {
      kind: "image";
      assetId: string | null;
      /** 1 = the photo just covers the screen, larger zooms in. */
      zoom: number;
      /** Pan of the photo, -1..1 of the free space in each direction. */
      offsetX: number;
      offsetY: number;
      /** Black overlay 0..0.8 to keep the digits readable on a bright photo. */
      dim: number;
    };

interface Base {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** Top left of the element's bounds (the pivot for hands). */
  x: number;
  y: number;
}

export interface BackgroundElement extends Base {
  type: "background";
  fill: BackgroundFill;
}

export interface TimeElement extends Base {
  type: "time";
  font: FontRef;
  /** Digit height in px. */
  size: number;
  color: string;
  outline: Outline;
  layout: "row" | "stack";
  showColon: boolean;
  showSeconds: boolean;
  /** Seconds digit height as a fraction of `size`. */
  secondsScale: number;
  /** 12 hour clock with an AM/PM marker. */
  ampm: boolean;
  /** Extra px between digit cells. */
  tracking: number;
}

export type DatePart = "weekday" | "day" | "month";

export interface DateElement extends Base {
  type: "date";
  font: FontRef;
  size: number;
  color: string;
  outline: Outline;
  parts: DatePart[];
  upper: boolean;
  tracking: number;
}

export type HandKind = "hour" | "minute" | "second";
export type HandShape = "classic" | "baton" | "sword" | "needle" | "custom";

export interface HandElement extends Base {
  type: "hand";
  hand: HandKind;
  shape: HandShape;
  color: string;
  /** Pivot to tip, px. */
  length: number;
  width: number;
  /** Counterweight behind the pivot, px. */
  tail: number;
  /** Uploaded PNG for `shape: "custom"`: the hand must point up. */
  assetId: string | null;
  /** Pivot inside the uploaded image, px from its top left. */
  pivotX: number;
  pivotY: number;
  /** Uploaded image scale. */
  scale: number;
}

export interface ImageElement extends Base {
  type: "image";
  assetId: string | null;
  w: number;
  h: number;
}

export type IconName = "steps" | "heart" | "battery" | "flame" | "mountain" | "thermometer";

export interface WidgetElement extends Base {
  type: "widget";
  /** Codec `value_type` id of a number field (`model/fields.ts`). */
  valueType: number;
  font: FontRef;
  size: number;
  color: string;
  outline: Outline;
  showIcon: boolean;
  iconColor: string;
  layout: "side" | "stack";
  tracking: number;
}

/** An enum value drawn as a set of images, one per value (`SELECTED_RES`). */
export interface IconSetElement extends Base {
  type: "iconset";
  /** Codec `value_type` id of an enum field with a known image set. */
  valueType: number;
  /** Edge of the square icons, px. */
  size: number;
  color: string;
}

export interface RingElement extends Base {
  type: "ring";
  /** Codec `value_type` id of a ratio field (`model/fields.ts`). */
  valueType: number;
  /** Outer diameter. */
  size: number;
  thickness: number;
  /** Degrees clockwise from 12 o'clock where the arc starts. */
  startAngle: number;
  /** Total sweep in degrees (360 = full ring). */
  sweep: number;
  color: string;
  trackColor: string;
  roundCap: boolean;
}

export type Element =
  | BackgroundElement
  | TimeElement
  | DateElement
  | HandElement
  | ImageElement
  | WidgetElement
  | RingElement
  | IconSetElement;

export type ElementType = Element["type"];

export interface Project {
  version: typeof PROJECT_VERSION;
  /** Free-form title; the .hwt file name is derived from it (letters and digits only). */
  name: string;
  author: string;
  /** The watch screen the face is designed for: its size, shape and corner radius. Elements are placed in its pixels. */
  screen: ScreenSpec;
  elements: Element[];
}

/**
 * The simulated watch state that drives the live preview. Data values are keyed by codec `value_type` id (see
 * `model/fields.ts`); an id without an entry shows the registry's default.
 */
export interface Sim {
  /** Epoch ms shown by the clock when `live` is false. */
  timeMs: number;
  live: boolean;
  /** Daily step goal the steps ratio is measured against. */
  stepGoal: number;
  values: Record<number, number>;
}
