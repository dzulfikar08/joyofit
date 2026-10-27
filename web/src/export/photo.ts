import { i18n } from "@/i18n";
import { getAsset } from "@/model/assets";
import { hwtFileName } from "@/model/defaults";
import type { Element, Project, Sim } from "@/model/types";
import { context2d, createSurface, surfaceToPng } from "@/render/canvas";
import { drawElement } from "@/render/scene";
import { shownSim } from "@/render/values";
import { isStaticElement } from "./support";

/**
 * Photo-face export: the static layers of the project flattened into one picture the size of the project's screen (408 x 480 on
 * the Watch Fit 4 / 4 Pro), the file JoyoFit's Watch → Photo face uploads. The watch's photo-face image is RGB24 without alpha
 * (`protocol/README.md`, photo faces: option 1), so the picture is opaque: layers are composited onto black. The watch masks the
 * screen's rounded corners itself and draws its own clock and data over the photo, so neither is part of the picture. JoyoFit
 * sends photo faces to the Fit 4 / 4 Pro only (`canSendPhotoFace`); for any other screen the PNG is a plain download.
 */
export interface PhotoLayer {
  id: string;
  name: string;
  type: Element["type"];
  /** In the picture. */
  included: boolean;
  /** Why it is left out, or what is wrong with it. */
  detail: string;
}

export interface PhotoFaceResult {
  fileName: string;
  png: Uint8Array;
  width: number;
  height: number;
  layers: PhotoLayer[];
  /** Layers a photo face cannot carry, because the watch draws its own live data over the photo. */
  liveLeftOut: string[];
}

/** Whether a static layer has what it needs drawn: an image element needs its bitmap, a photo background may fall back to black. */
function imageMissing(el: Element): boolean {
  if (el.type === "image") return !getAsset(el.assetId);
  return el.type === "background" && el.fill.kind === "image" && !getAsset(el.fill.assetId);
}

export async function buildPhotoFace(project: Project, stageSim: Sim): Promise<PhotoFaceResult> {
  const sim = shownSim(stageSim);
  const { width, height } = project.screen;
  const surface = createSurface(width, height);
  const ctx = context2d(surface);
  // Opaque black first: whatever the layers leave transparent ends up black, never undefined.
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";

  const layers: PhotoLayer[] = [];
  const liveLeftOut: string[] = [];
  for (const el of project.elements) {
    const base = { id: el.id, name: el.name, type: el.type };
    if (!el.visible) {
      layers.push({ ...base, included: false, detail: i18n.t("export:photo.hidden") });
    } else if (!isStaticElement(el)) {
      liveLeftOut.push(el.name);
      layers.push({ ...base, included: false, detail: i18n.t("export:photo.liveReason") });
    } else if (el.type === "image" && !getAsset(el.assetId)) {
      // No dashed placeholder in the picture: the layer is left out instead.
      layers.push({ ...base, included: false, detail: el.assetId ? i18n.t("export:photo.imageNotLoaded") : i18n.t("export:photo.noImage") });
    } else {
      drawElement(ctx, el, sim, project.screen);
      layers.push({
        ...base,
        included: true,
        detail: imageMissing(el) ? i18n.t("export:photo.photoMissing") : "",
      });
    }
  }

  return {
    fileName: `${hwtFileName(project.name)}.photo.png`,
    png: await surfaceToPng(surface),
    width,
    height,
    layers,
    liveLeftOut,
  };
}
