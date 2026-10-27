import { blobToDataUrl, getAssetRecord } from "@/model/assets";
import { assetIdsOf, type ProjectFile } from "@/model/projectFile";
import type { Project } from "@/model/types";
import { MAX_BODY_BYTES, bodyBytes } from "./api";

/** Room left in the request body for the name, the thumbnail and the JSON envelope. */
export const BODY_SLACK = 64 * 1024;

/** Assets at or below this many bytes of data URL are never worth re-encoding. */
const KEEP_BELOW = 48 * 1024;

export interface ShrinkLevel {
  /** Longest side of a PNG (stickers, hands: transparency kept, so the file stays a PNG). */
  pngSide: number;
  /** Longest side of a JPEG (photos). */
  jpegSide: number;
  jpegQuality: number;
}

/**
 * Applied in order, only while the document is over the limit. A face is at most 600 px on a side (408 x 480 on a Watch Fit 4): a photo
 * at 2x of that still covers it with detail to spare, and a sticker rarely shows above 1x. The local project and the local `.json`
 * export are never touched; only the copy sent to the cloud is lighter.
 */
export const SHRINK_LEVELS: readonly ShrinkLevel[] = [
  { pngSide: 512, jpegSide: 1000, jpegQuality: 0.85 },
  { pngSide: 384, jpegSide: 816, jpegQuality: 0.8 },
  { pngSide: 256, jpegSide: 640, jpegQuality: 0.7 },
];

export interface RawAsset {
  name: string;
  type: string;
  blob: Blob;
}

export interface DocumentDeps {
  readAsset(id: string): RawAsset | null;
  toDataUrl(blob: Blob): Promise<string>;
  /** `blob` scaled to the level (never enlarged) and encoded again as `type` (PNG or JPEG). */
  reencode(blob: Blob, type: "image/png" | "image/jpeg", level: ShrinkLevel): Promise<Blob>;
}

async function browserReencode(blob: Blob, type: "image/png" | "image/jpeg", level: ShrinkLevel): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const side = type === "image/png" ? level.pngSide : level.jpegSide;
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is not available");
    if (type === "image/jpeg") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await canvas.convertToBlob({ type, quality: level.jpegQuality });
  } finally {
    bitmap.close();
  }
}

const browserDeps: DocumentDeps = {
  readAsset: (id) => getAssetRecord(id),
  toDataUrl: blobToDataUrl,
  reencode: browserReencode,
};

/** Encoded assets are immutable per id, so a save every few seconds reuses them; bounded so a long session does not pile up. */
const CACHE_CHARS = 32 * 1024 * 1024;
const cache = new Map<string, string>();
let cached = 0;

/** Test seam: forgets every encoded asset. */
export function clearDocumentCache(): void {
  cache.clear();
  cached = 0;
}

function remember(key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  cached += value.length;
  for (const [oldest, text] of cache) {
    if (cached <= CACHE_CHARS || oldest === key) break;
    cache.delete(oldest);
    cached -= text.length;
  }
}

async function cachedDataUrl(key: string, make: () => Promise<string>): Promise<string> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await make();
  remember(key, value);
  return value;
}

export interface CloudDocument {
  document: ProjectFile;
  /** Bytes of the document as JSON. */
  bytes: number;
  /** Some images were scaled down to fit the limit. */
  shrunk: boolean;
}

/**
 * The `.project.json` document of `project` as the cloud stores it. Identical to the local export while it fits `budget`;
 * above it, the biggest images are re-encoded smaller, level by level, until it does (or the last level is reached and the
 * API reports `too_large`).
 */
export async function buildCloudDocument(project: Project, budget: number = MAX_BODY_BYTES - BODY_SLACK, deps: DocumentDeps = browserDeps): Promise<CloudDocument> {
  const ids = assetIdsOf(project);
  const raw = new Map<string, RawAsset>();
  for (const id of ids) {
    const asset = deps.readAsset(id);
    if (asset) raw.set(id, asset);
  }

  const assemble = async (level: ShrinkLevel | null, levelIndex: number): Promise<CloudDocument> => {
    const assets: ProjectFile["assets"] = {};
    let shrunk = false;
    for (const [id, asset] of raw) {
      const original = await cachedDataUrl(`${id}|orig`, () => deps.toDataUrl(asset.blob));
      let dataUrl = original;
      const reencodable = asset.type === "image/png" || asset.type === "image/jpeg";
      if (level && reencodable && original.length > KEEP_BELOW) {
        const smaller = await cachedDataUrl(`${id}|${levelIndex}`, async () => {
          const blob = await deps.reencode(asset.blob, asset.type as "image/png" | "image/jpeg", level);
          return blob.size < asset.blob.size ? deps.toDataUrl(blob) : original;
        });
        if (smaller.length < original.length) {
          dataUrl = smaller;
          shrunk = true;
        }
      }
      assets[id] = { name: asset.name, dataUrl };
    }
    const document: ProjectFile = { format: "joyofit-studio-project", project, assets };
    return { document, bytes: bodyBytes(JSON.stringify(document)), shrunk };
  };

  let best = await assemble(null, -1);
  for (let i = 0; i < SHRINK_LEVELS.length && best.bytes > budget; i++) best = await assemble(SHRINK_LEVELS[i]!, i);
  return best;
}
