import { fontsOf } from "@/editor/useFonts";
import { blobToDataUrl } from "@/model/assets";
import type { ScreenSize } from "@/model/screens";
import type { Project, Sim } from "@/model/types";
import { context2d, createSurface, type Surface } from "@/render/canvas";
import { ensureFont } from "@/render/fonts";
import { drawProject } from "@/render/scene";
import { shownSim } from "@/render/values";

/** Longest thumbnail data URL we send, in characters; the server takes 16 KiB, this leaves room. */
export const THUMB_LIMIT = 12 * 1024;

export interface ThumbStep {
  width: number;
  height: number;
  quality: number;
}

/** Long side of each step, px, with the JPEG quality: from the nicest picture to the smallest one that still shows the face. */
const THUMB_LONG_SIDES: ReadonlyArray<readonly [number, number]> = [
  [120, 0.6],
  [120, 0.4],
  [100, 0.4],
  [80, 0.35],
  [60, 0.3],
];

/** The steps for a screen: every one keeps the screen's aspect ratio (a Watch Fit 4 face gives 102 x 120 down to 51 x 60). */
export function thumbSteps(screen: ScreenSize): ThumbStep[] {
  const long = Math.max(screen.width, screen.height);
  return THUMB_LONG_SIDES.map(([side, quality]) => ({
    width: Math.max(1, Math.round((side * screen.width) / long)),
    height: Math.max(1, Math.round((side * screen.height) / long)),
    quality,
  }));
}

/** The first step for `screen` whose encoding fits `limit`, or null when none does. */
export async function fitThumbnail(screen: ScreenSize, encode: (step: ThumbStep) => Promise<string>, limit: number = THUMB_LIMIT): Promise<string | null> {
  for (const step of thumbSteps(screen)) {
    const dataUrl = await encode(step);
    if (dataUrl.length <= limit) return dataUrl;
  }
  return null;
}

interface BlobSurface {
  convertToBlob(options: { type: string; quality: number }): Promise<Blob>;
}

/**
 * A small JPEG of the whole face as the stage shows it (live layers included, drawn at the simulated time). Null when the browser
 * cannot draw or encode it: the project is saved without a thumbnail then.
 */
export async function makeThumbnail(project: Project, stageSim: Sim): Promise<string | null> {
  try {
    // Digits drawn before their font arrived would be in the fallback font.
    await Promise.all(fontsOf(project.elements).map(ensureFont));
    const { width: fullW, height: fullH } = project.screen;
    const full = createSurface(fullW, fullH);
    const fullCtx = context2d(full);
    fullCtx.fillStyle = "#000000";
    fullCtx.fillRect(0, 0, fullW, fullH);
    drawProject(fullCtx, project, shownSim(stageSim));
    return await fitThumbnail(project.screen, async ({ width, height, quality }) => {
      const small: Surface = createSurface(width, height);
      const ctx = context2d(small);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(full as unknown as CanvasImageSource, 0, 0, width, height);
      const blob = await (small as unknown as BlobSurface).convertToBlob({ type: "image/jpeg", quality });
      return blobToDataUrl(blob);
    });
  } catch {
    return null;
  }
}
