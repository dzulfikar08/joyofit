/**
 * Test and tooling side of the renderer: Scene -> SVG string with installed font names, and a call into the Node script that
 * rasterizes SVGs with sharp (see `scripts/stickers-raster.mjs` for why it is not in-process). Nothing here ships in the app.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Locale } from '@/i18n';

import type { StickerData } from '../core/resolve';
import { toSvg } from '../core/emit-svg';
import type { Scene } from '../core/scene';
import type { Template } from '../core/schema';
import type { FontMap, FontPaint } from '../core/text';
import { sceneFor, type Mode } from '../engine';
import { FIT_FONTS } from '../fonts';
import type { JsonObject } from '../subject';

const ROOT = join(import.meta.dir, '../../../..');

/** The same metrics as the app, but `paint` names the installed families (rsvg picks the face by family + weight). */
export const GOLDEN_FONTS: FontMap = {
  metrics: (role, weight) => FIT_FONTS.metrics(role, weight),
  paint: (role, weight): FontPaint => ({ family: role === 'mono' ? 'IBM Plex Mono' : 'Plus Jakarta Sans', weight }),
};

export interface Rendered {
  template: Template;
  scene: Scene;
  svg: string;
  /** What the resolve reported (`scene.issues`). */
  issues: { code: string; message: string; layerId?: string }[];
}

/** The subject date a fixture stands for: the first of the namespaces' own time fields, else a fixed day. */
export function fixtureDate(data: JsonObject): number {
  for (const ns of Object.values(data)) {
    if (typeof ns !== 'object' || ns === null || Array.isArray(ns)) continue;
    for (const key of ['startedAt', 'wakeTime', 'rangeStart']) {
      const value = ns[key];
      if (typeof value === 'number') return value;
    }
  }
  return Date.UTC(2026, 9, 14, 3, 0);
}

export interface RenderCase {
  locale: Locale;
  /** The sticker's `{date}`; defaults to `fixtureDate(data)`. */
  date?: number;
  mode: Mode;
  options?: StickerData['options'];
  assets?: StickerData['assets'];
}

/** `fixture:photo-dusk` -> the JPEG under `testing/assets` as a data URI; any other URI is left alone. */
function fixtureHref(uri: string): string {
  const match = /^fixture:(photo-[a-z]+)$/.exec(uri);
  if (!match) return uri;
  return `data:image/jpeg;base64,${readFileSync(join(import.meta.dir, 'assets', `${match[1]}.jpg`)).toString('base64')}`;
}

/**
 * A transparent overlay laid over a fixture photo: the SVG with the picture drawn first, cropped to fill the canvas like the
 * photo backgrounds. For the contact sheets, which show how an overlay reads on a dusk and a bright day photo; the PNGs the app
 * exports stay transparent.
 */
export function overOnPhoto(svg: string, photo: string): string {
  const [, width, height] = /^<svg [^>]*width="(\d+)" height="(\d+)"/.exec(svg) ?? [];
  const image = `<image x="0" y="0" width="${width}" height="${height}" href="${fixtureHref(`fixture:photo-${photo}`)}" preserveAspectRatio="xMidYMid slice"/>`;
  return svg.replace(/^(<svg [^>]*>)/, `$1${image}`);
}

/** Renders a parsed template to a Scene and an SVG string. */
export function renderTemplate(template: Template, data: JsonObject, c: RenderCase): Rendered {
  const scene = sceneFor(template, data, { ...c, date: c.date ?? fixtureDate(data), fonts: GOLDEN_FONTS });
  const svg = toSvg(scene, { fonts: GOLDEN_FONTS, imageHref: fixtureHref });
  return { template, scene, svg, issues: scene.issues };
}

/** A fontconfig file that sees only the app's font files, with its cache under `tmp`. */
export function writeFontconfig(tmp: string): string {
  const fonts = ['plus-jakarta-sans', 'ibm-plex-mono'].map((name) => join(ROOT, 'node_modules/@expo-google-fonts', name));
  const path = join(tmp, 'fonts.conf');
  mkdirSync(join(tmp, 'fc-cache'), { recursive: true });
  writeFileSync(
    path,
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n${fonts.map((dir) => `  <dir>${dir}</dir>`).join('\n')}\n  <cachedir>${join(tmp, 'fc-cache')}</cachedir>\n</fontconfig>\n`,
  );
  return path;
}

export interface RasterJob {
  svg: string;
  png: string;
  /** Output width in px (the SVG is 1080 wide); default 1080. */
  width?: number;
  /** Compare the PNG with `<compare.dir>/<golden>.png` (see `GoldenCompare`). */
  golden?: string;
}

export interface GoldenCompare {
  dir: string;
  /** Overwrite the goldens with the new renders. */
  update: boolean;
  maxDiffRatio: number;
  channelTolerance: number;
  /** Where the script writes `[{ name, ok, ratio }]`. */
  results: string;
}

export interface SheetJob {
  out: string;
  cols: number;
  tileWidth: number;
  /** `transparent`: draw a checker behind the tile, dark for `dark` stickers and light for `light` ones. */
  tiles: { png: string; label: string; transparent?: 'dark' | 'light' | false }[];
}

/** Runs the Node rasterizer over the jobs and builds the sheets. Throws with the script's stderr on failure. */
export async function rasterize(tmp: string, jobs: RasterJob[], sheets: SheetJob[] = [], compare?: GoldenCompare): Promise<void> {
  mkdirSync(tmp, { recursive: true });
  const manifest = join(tmp, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({ fontconfig: writeFontconfig(tmp), jobs, sheets, compare }));
  const proc = Bun.spawn(['node', join(ROOT, 'scripts/stickers-raster.mjs'), manifest], { stdout: 'pipe', stderr: 'pipe', cwd: ROOT });
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`stickers-raster failed (${code}): ${err}`);
}
