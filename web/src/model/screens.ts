/**
 * The watch screen a project is designed for. Presets come from Huawei's "Resolutions and Version Numbers" table
 * (docs/watchfaces-signing.md, section 1.3); a custom screen takes any size and shape. Element coordinates are pixels of the
 * project's screen, top left at 0,0.
 *
 * Only the Watch Fit 4 / Fit 4 Pro is tested with JoyoFit (photo face upload and an installed .hwt). Every other preset is a size
 * from Huawei's table that nobody has checked on a watch from Studio; the UI says so and never calls those watches supported.
 */

/** `squircle`: the superellipse of the Watch Fit; `circle`: round GT faces; `rect`: a rectangle with `cornerRadius` corners (bands). */
export type ScreenShape = "squircle" | "circle" | "rect";

export interface ScreenSpec {
  /** Preset id when the screen is a preset, null for a custom size. */
  presetId: string | null;
  width: number;
  height: number;
  shape: ScreenShape;
  /** Corner radius in px for `rect`; for `squircle`, the size of the rounded part along each edge. Ignored for `circle`. */
  cornerRadius: number;
}

/** What drawing and layout code needs of a screen: its pixel size. A `ScreenSpec` is one. */
export type ScreenSize = Pick<ScreenSpec, "width" | "height">;

export interface ScreenPreset extends ScreenSpec {
  presetId: string;
  /** Short name for pickers and the header; the same in every language (model names and sizes). */
  name: string;
  /** Watches with this screen, as Huawei's table names them. */
  devices: string;
  /** Huawei theme-version code written to the .hwt `<screen>`. */
  hwtScreen: string;
  /** `<version>` for a basic face on this screen (the `x.y` Huawei's table lists first, revision 1). */
  hwtVersion: string;
  /** JoyoFit can upload the photo face PNG to this watch (Watch → Photo face). */
  photoFace: boolean;
  /** Checked on a real watch with JoyoFit. */
  tested: boolean;
}

export const SCREEN_PRESETS: readonly ScreenPreset[] = [
  {
    presetId: "fit4",
    name: "Watch Fit 4 / 4 Pro",
    devices: "Watch Fit 3, Fit 4, Fit 4 Pro, Fit 5",
    width: 408,
    height: 480,
    shape: "squircle",
    cornerRadius: 90,
    hwtScreen: "HWHD13",
    hwtVersion: "2.1.1",
    photoFace: true,
    tested: true,
  },
  {
    presetId: "gt466",
    name: "GT 466",
    devices: "Watch GT 4, GT 5, GT 6 (46 mm), Watch 3 and later",
    width: 466,
    height: 466,
    shape: "circle",
    cornerRadius: 0,
    hwtScreen: "HWHD09",
    hwtVersion: "2.1.1",
    photoFace: false,
    tested: false,
  },
  {
    presetId: "gt454",
    name: "GT 454",
    devices: "Watch GT 2 (46 mm), GT 2 Pro, GT 2e",
    width: 454,
    height: 454,
    shape: "circle",
    cornerRadius: 0,
    hwtScreen: "HWHD02",
    hwtVersion: "2.5.1",
    photoFace: false,
    tested: false,
  },
  {
    presetId: "gt390",
    name: "GT 390",
    devices: "Watch GT 2 (42 mm)",
    width: 390,
    height: 390,
    shape: "circle",
    cornerRadius: 0,
    hwtScreen: "HWHD01",
    hwtVersion: "3.5.1",
    photoFace: false,
    tested: false,
  },
  {
    presetId: "band194",
    name: "Band 6-10",
    devices: "Band 6, 7, 8, 9, 10, Watch Fit mini",
    width: 194,
    height: 368,
    shape: "rect",
    cornerRadius: 40,
    hwtScreen: "HWHD07",
    hwtVersion: "2.1.1",
    photoFace: false,
    tested: false,
  },
  {
    presetId: "band286",
    name: "Band 11",
    devices: "Band 11",
    width: 286,
    height: 482,
    shape: "rect",
    cornerRadius: 56,
    hwtScreen: "HWHD14",
    hwtVersion: "2.1.1",
    photoFace: false,
    tested: false,
  },
];

export const DEFAULT_SCREEN: ScreenSpec = { presetId: "fit4", width: 408, height: 480, shape: "squircle", cornerRadius: 90 };

/** Bounds of a custom screen, px. */
export const CUSTOM_MIN = 120;
export const CUSTOM_MAX = 600;

export const presetById = (id: string | null): ScreenPreset | null => SCREEN_PRESETS.find((p) => p.presetId === id) ?? null;

export function presetScreen(preset: ScreenPreset): ScreenSpec {
  const { presetId, width, height, shape, cornerRadius } = preset;
  return { presetId, width, height, shape, cornerRadius };
}

export const sameScreen = (a: ScreenSpec, b: ScreenSpec): boolean =>
  a.width === b.width && a.height === b.height && a.shape === b.shape && a.presetId === b.presetId && (a.shape === "circle" || a.cornerRadius === b.cornerRadius);

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null;

/** Reads a stored screen; anything missing or invalid (every project saved before screens existed) is the Watch Fit 4. */
export function parseScreen(raw: unknown): ScreenSpec {
  if (!raw || typeof raw !== "object") return DEFAULT_SCREEN;
  const r = raw as Partial<ScreenSpec>;
  const preset = presetById(typeof r.presetId === "string" ? r.presetId : null);
  if (preset) return presetScreen(preset);
  const width = int(r.width, CUSTOM_MIN, CUSTOM_MAX);
  const height = int(r.height, CUSTOM_MIN, CUSTOM_MAX);
  const shape = r.shape === "circle" || r.shape === "rect" || r.shape === "squircle" ? r.shape : null;
  if (width === null || height === null || shape === null) return DEFAULT_SCREEN;
  return { presetId: null, width, height, shape, cornerRadius: int(r.cornerRadius, 0, Math.floor(Math.min(width, height) / 2)) ?? 0 };
}
