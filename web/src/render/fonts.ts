import type propsId from "@/i18n/locales/id/props";
import type { FontRef } from "@/model/types";

type FontNote = keyof (typeof propsId)["fontNote"];

/**
 * Curated fonts for digit, date and widget sprites. They come from @fontsource (Google Fonts, SIL OFL),
 * bundled with the app so the sprites a face carries never depend on a third-party request, and each
 * weight is a separate lazily loaded CSS chunk.
 */
export interface FontChoice {
  family: string;
  label: string;
  weights: number[];
  /** Style character for the picker: a key of `props:fontNote`. */
  note: FontNote;
}

export const FONTS: FontChoice[] = [
  { family: "Plus Jakarta Sans Variable", label: "Plus Jakarta Sans", weights: [500, 700, 800], note: "friendlySans" },
  { family: "Outfit", label: "Outfit", weights: [300, 500, 700], note: "geometric" },
  { family: "Sora", label: "Sora", weights: [300, 600], note: "wideTechy" },
  { family: "Oswald", label: "Oswald", weights: [400, 600], note: "condensed" },
  { family: "Bebas Neue", label: "Bebas Neue", weights: [400], note: "tallCaps" },
  { family: "Anton", label: "Anton", weights: [400], note: "heavyCondensed" },
  { family: "Big Shoulders Display", label: "Big Shoulders", weights: [700, 900], note: "sporty" },
  { family: "Orbitron", label: "Orbitron", weights: [500, 800], note: "futuristic" },
  { family: "Rajdhani", label: "Rajdhani", weights: [500, 700], note: "squared" },
  { family: "Chakra Petch", label: "Chakra Petch", weights: [500, 700], note: "cutCorners" },
  { family: "Russo One", label: "Russo One", weights: [400], note: "boldIndustrial" },
  { family: "Unbounded", label: "Unbounded", weights: [400, 700], note: "roundWide" },
  { family: "Audiowide", label: "Audiowide", weights: [400], note: "retroDigital" },
  { family: "DM Mono", label: "DM Mono", weights: [400, 500], note: "monospace" },
  { family: "Playfair Display", label: "Playfair Display", weights: [400, 700], note: "classicSerif" },
  { family: "Teko", label: "Teko", weights: [400, 600], note: "condensed" },
  { family: "Saira Condensed", label: "Saira Condensed", weights: [500, 700], note: "condensed" },
  { family: "Space Grotesk", label: "Space Grotesk", weights: [400, 600], note: "geometric" },
  { family: "Michroma", label: "Michroma", weights: [400], note: "futuristic" },
  { family: "Syncopate", label: "Syncopate", weights: [400, 700], note: "wideTechy" },
  { family: "Share Tech Mono", label: "Share Tech Mono", weights: [400], note: "retroDigital" },
];

export const DEFAULT_FONT: FontRef = { family: "Plus Jakarta Sans Variable", weight: 700 };

export function fontChoice(family: string): FontChoice | undefined {
  return FONTS.find((f) => f.family === family);
}

/** Nearest weight the family ships, so an element never asks for a file that does not exist. */
export function nearestWeight(family: string, weight: number): number {
  const choice = fontChoice(family);
  if (!choice) return weight;
  return choice.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));
}

/** One lazily loaded stylesheet per family and weight, so a face only downloads the font files it uses. */
const FONT_CSS: Record<string, () => Promise<unknown>> = {
  "outfit-300": () => import("../../node_modules/@fontsource/outfit/latin-300.css"),
  "outfit-500": () => import("../../node_modules/@fontsource/outfit/latin-500.css"),
  "outfit-700": () => import("../../node_modules/@fontsource/outfit/latin-700.css"),
  "sora-300": () => import("../../node_modules/@fontsource/sora/latin-300.css"),
  "sora-600": () => import("../../node_modules/@fontsource/sora/latin-600.css"),
  "oswald-400": () => import("../../node_modules/@fontsource/oswald/latin-400.css"),
  "oswald-600": () => import("../../node_modules/@fontsource/oswald/latin-600.css"),
  "bebas-neue-400": () => import("../../node_modules/@fontsource/bebas-neue/latin-400.css"),
  "anton-400": () => import("../../node_modules/@fontsource/anton/latin-400.css"),
  "big-shoulders-display-700": () => import("../../node_modules/@fontsource/big-shoulders-display/latin-700.css"),
  "big-shoulders-display-900": () => import("../../node_modules/@fontsource/big-shoulders-display/latin-900.css"),
  "orbitron-500": () => import("../../node_modules/@fontsource/orbitron/latin-500.css"),
  "orbitron-800": () => import("../../node_modules/@fontsource/orbitron/latin-800.css"),
  "rajdhani-500": () => import("../../node_modules/@fontsource/rajdhani/latin-500.css"),
  "rajdhani-700": () => import("../../node_modules/@fontsource/rajdhani/latin-700.css"),
  "chakra-petch-500": () => import("../../node_modules/@fontsource/chakra-petch/latin-500.css"),
  "chakra-petch-700": () => import("../../node_modules/@fontsource/chakra-petch/latin-700.css"),
  "russo-one-400": () => import("../../node_modules/@fontsource/russo-one/latin-400.css"),
  "unbounded-400": () => import("../../node_modules/@fontsource/unbounded/latin-400.css"),
  "unbounded-700": () => import("../../node_modules/@fontsource/unbounded/latin-700.css"),
  "audiowide-400": () => import("../../node_modules/@fontsource/audiowide/latin-400.css"),
  "dm-mono-400": () => import("../../node_modules/@fontsource/dm-mono/latin-400.css"),
  "dm-mono-500": () => import("../../node_modules/@fontsource/dm-mono/latin-500.css"),
  "playfair-display-400": () => import("../../node_modules/@fontsource/playfair-display/latin-400.css"),
  "playfair-display-700": () => import("../../node_modules/@fontsource/playfair-display/latin-700.css"),
  "teko-400": () => import("../../node_modules/@fontsource/teko/latin-400.css"),
  "teko-600": () => import("../../node_modules/@fontsource/teko/latin-600.css"),
  "saira-condensed-500": () => import("../../node_modules/@fontsource/saira-condensed/latin-500.css"),
  "saira-condensed-700": () => import("../../node_modules/@fontsource/saira-condensed/latin-700.css"),
  "space-grotesk-400": () => import("../../node_modules/@fontsource/space-grotesk/latin-400.css"),
  "space-grotesk-600": () => import("../../node_modules/@fontsource/space-grotesk/latin-600.css"),
  "michroma-400": () => import("../../node_modules/@fontsource/michroma/latin-400.css"),
  "syncopate-400": () => import("../../node_modules/@fontsource/syncopate/latin-400.css"),
  "syncopate-700": () => import("../../node_modules/@fontsource/syncopate/latin-700.css"),
  "share-tech-mono-400": () => import("../../node_modules/@fontsource/share-tech-mono/latin-400.css"),
};

function packageName(family: string): string {
  return family.replace(/ Variable$/, "").toLowerCase().replace(/ /g, "-");
}

export function fontCss(font: FontRef): string {
  return `${font.weight} 100px "${font.family}"`;
}

const loading = new Map<string, Promise<void>>();
/** Fonts whose files loaded. `document.fonts.check` says true for a family it has never heard of, so it cannot be trusted alone. */
const loaded = new Set<string>();
/** Fonts whose loading finished, with success or not. */
const settled = new Set<string>();

/**
 * Loads the font file and resolves once the canvas can draw with it. A family that is not installed
 * (or any failure) resolves quietly and the browser falls back: `fontFailed` tells callers afterwards.
 */
export function ensureFont(font: FontRef): Promise<void> {
  const key = `${font.family}@${font.weight}`;
  const existing = loading.get(key);
  if (existing) return existing;
  const task = (async () => {
    if (typeof document === "undefined") return;
    try {
      if (font.family !== "Plus Jakarta Sans Variable") {
        const loader = FONT_CSS[`${packageName(font.family)}-${font.weight}`];
        if (loader) await loader();
      }
      // `load` resolves with an empty list, not an error, when no @font-face matches.
      const faces = await document.fonts.load(fontCss(font), "0123456789:APMapm");
      if (faces.length > 0) loaded.add(key);
    } catch {
      // Stays out of `loaded`.
    } finally {
      settled.add(key);
    }
  })();
  loading.set(key, task);
  return task;
}

/** True once the canvas can render this font without the fallback. */
export function fontReady(font: FontRef): boolean {
  if (typeof document === "undefined") return true;
  return loaded.has(`${font.family}@${font.weight}`) && document.fonts.check(fontCss(font), "0123456789");
}

/**
 * True once loading has finished, whether the font arrived or not. Sprites drawn after that are final (a failed font always
 * draws the same fallback), so they may be cached; sprites drawn while the font is still loading may not be.
 */
export function fontSettled(font: FontRef): boolean {
  return typeof document === "undefined" || settled.has(`${font.family}@${font.weight}`);
}

/** True when the font could not be loaded: its digits are drawn in the browser's fallback font. */
export function fontFailed(font: FontRef): boolean {
  return fontSettled(font) && !fontReady(font);
}
