/**
 * `.hwt` package: a zip with `description.xml`, `com.huawei.watchface` (the layout/image binary, either stored directly or
 * as a nested zip that holds `watchface.bin` next to the Theme Studio project), `preview/*.jpg` and optionally more.
 *
 * Round trip: zip framing is preserved per entry (see zip.ts), so `writeHwt(readHwt(b))` is byte-identical to `b` for
 * every sample. Entries whose content changed are re-deflated with fflate; the rest are copied verbatim.
 */
import { HwtError, bytesEqual, utf8Decode, utf8Encode } from "./bytes";
import { FIT4_SCREEN, RESOLUTIONS, parseDescription, patchDescription, renderDescription, type HwtDescription } from "./description";
import { encodeImage, type RgbaImage } from "./image";
import { encodePb } from "./protobuf";
import { isZip, readZip, writeZip, type ZipArchive, type ZipEntry } from "./zip";
import { parseWatchface, writeWatchface, SIGNATURE_SIZE, type WatchfaceBinary } from "./watchface";

export const DESCRIPTION_ENTRY = "description.xml";
export const HUAWEI_WATCHFACE_ENTRY = "com.huawei.watchface";
export const HONOR_WATCHFACE_ENTRY = "com.honor.watchface";
export const NESTED_BINARY_ENTRY = "watchface.bin";

export interface HwtPackage {
  /** Outer zip. `description.xml` and the watchface entry are kept in sync with `description` / `watchface` by `writeHwt`. */
  archive: ZipArchive;
  /** Parsed `description.xml`. Edit the fields; `writeHwt` patches only what changed. */
  description: HwtDescription;
  /** Name of the entry that holds the binary: `com.huawei.watchface`, or `com.honor.watchface` for `HnTheme`. */
  watchfaceEntry: string;
  /** `flat`: the entry is the binary itself. `nested`: the entry is a zip containing `watchface.bin` (and the Theme Studio project). */
  container: "flat" | "nested";
  /** The inner zip when `container === "nested"`. */
  nested?: ZipArchive;
  /** Parsed binary, or undefined when the package has none that parses (see `watchfaceError`). Mutate in place, then `writeHwt`. */
  watchface?: WatchfaceBinary;
  watchfaceError?: string;
}

function find(archive: ZipArchive, name: string): ZipEntry | undefined {
  return archive.entries.find((e) => e.name === name);
}

export function readHwt(bytes: Uint8Array): HwtPackage {
  const archive = readZip(bytes);
  const descEntry = find(archive, DESCRIPTION_ENTRY);
  if (!descEntry) throw new HwtError("not a watch face package: no description.xml");
  const description = parseDescription(utf8Decode(descEntry.data));
  const watchfaceEntry = description.root === "HnTheme" ? HONOR_WATCHFACE_ENTRY : HUAWEI_WATCHFACE_ENTRY;
  const entry = find(archive, watchfaceEntry);
  if (!entry) throw new HwtError(`not a watch face package: no ${watchfaceEntry}`);

  const pkg: HwtPackage = { archive, description, watchfaceEntry, container: "flat" };
  let binary = entry.data;
  if (isZip(entry.data)) {
    pkg.container = "nested";
    pkg.nested = readZip(entry.data);
    const inner = find(pkg.nested, NESTED_BINARY_ENTRY);
    if (!inner) {
      pkg.watchfaceError = `${watchfaceEntry} is a zip without ${NESTED_BINARY_ENTRY}`;
      return pkg;
    }
    binary = inner.data;
  }
  try {
    pkg.watchface = parseWatchface(binary);
  } catch (e) {
    pkg.watchfaceError = e instanceof Error ? e.message : String(e);
  }
  return pkg;
}

/** Serialises the package. The outer/inner zip entries are updated from `description` and `watchface` first. */
export function writeHwt(pkg: HwtPackage): Uint8Array {
  const descEntry = find(pkg.archive, DESCRIPTION_ENTRY);
  if (!descEntry) throw new HwtError("package has no description.xml entry");
  const nextXml = patchDescription(utf8Decode(descEntry.data), pkg.description);
  if (nextXml !== utf8Decode(descEntry.data)) descEntry.data = utf8Encode(nextXml);

  const entry = find(pkg.archive, pkg.watchfaceEntry);
  if (!entry) throw new HwtError(`package has no ${pkg.watchfaceEntry} entry`);
  if (pkg.watchface) {
    const binary = writeWatchface(pkg.watchface);
    if (pkg.container === "nested") {
      const inner = pkg.nested && find(pkg.nested, NESTED_BINARY_ENTRY);
      if (!pkg.nested || !inner) throw new HwtError(`nested package lost its ${NESTED_BINARY_ENTRY}`);
      if (!bytesEqual(inner.data, binary)) inner.data = binary;
      const zipped = writeZip(pkg.nested);
      if (!bytesEqual(entry.data, zipped)) entry.data = zipped;
    } else if (!bytesEqual(entry.data, binary)) {
      entry.data = binary;
    }
  }
  return writeZip(pkg.archive);
}

/** Gets the first entry called `name`, or undefined. */
export function getEntry(pkg: HwtPackage, name: string): Uint8Array | undefined {
  return find(pkg.archive, name)?.data;
}

/** Adds or replaces a top-level entry (e.g. `preview/cover.jpg`). */
export function setEntry(pkg: HwtPackage, name: string, data: Uint8Array): void {
  const existing = find(pkg.archive, name);
  if (existing) existing.data = data;
  else pkg.archive.entries.push({ name, data });
}

// ---------------------------------------------------------------------------------------------------------------------
// Creation from scratch

/** Pixel size of one of the preview images. */
export interface PreviewSize {
  width: number;
  height: number;
}

/** Sizes of the three preview JPEGs and of the in-binary thumbnail (image slot 0) for a screen. */
export interface PreviewSizes {
  cover: PreviewSize;
  aod: PreviewSize;
  iconSmall: PreviewSize;
  thumbnail: PreviewSize;
}

/**
 * Sizes of the previews for a face of `width` x `height` pixels. Measured on the 10 Fit 4 Pro samples (408 x 480, all
 * identical): cover/aod 816 x 960, icon_small 331 x 390, thumbnail 228 x 269. Other screens scale by the same ratios (cover and
 * aod 2x, icon_small 331/408 and 390/480, thumbnail 228/408 and 269/480, rounded); only the 408 x 480 numbers are measured here.
 * Other samples show different thumbnails (250 x 250 on round faces, 126 x 238 on the Band 9), so for those screens the
 * thumbnail is an approximation.
 */
export function previewSizes(width: number, height: number): PreviewSizes {
  const scaled = (w: number, h: number): PreviewSize => ({
    width: Math.max(1, Math.round((width * w) / 408)),
    height: Math.max(1, Math.round((height * h) / 480)),
  });
  return {
    cover: { width: width * 2, height: height * 2 },
    aod: { width: width * 2, height: height * 2 },
    iconSmall: scaled(331, 390),
    thumbnail: scaled(228, 269),
  };
}

export interface CreateHwtOptions {
  title: string;
  /** Defaults to `title`. The samples keep it short (<= 8 chars in all of them). */
  titleCn?: string;
  author?: string;
  designer?: string;
  /** Default `HWHD13` (Watch Fit 3/4/4 Pro/5, 408 x 480). Must be a code in `RESOLUTIONS`. */
  screen?: string;
  /** `x.y.z`, default `2.1.1` (HWHD13 "2.1.z" per Huawei's version table). */
  version?: string;
  briefinfo?: string;
  /** Preview JPEG bytes. Required by Huawei's own validator; sideloading with Gadgetbridge only reads cover.jpg. */
  cover: Uint8Array;
  aod?: Uint8Array;
  iconSmall?: Uint8Array;
  /**
   * Image slot 0: the thumbnail the watch shows in its face picker (never referenced by the layout). Default: opaque black,
   * `previewSizes` of the screen's size (228 x 269 for HWHD13). Pass your own render for a useful picker preview.
   */
  thumbnail?: RgbaImage;
  /** The 8 byte signature at the start of the bin area. Default `55 55 55 55 01 00 00 01` (all but one sample). */
  signature?: Uint8Array;
}

const DEFAULT_SIGNATURE = Uint8Array.from([0x55, 0x55, 0x55, 0x55, 0x01, 0x00, 0x00, 0x01]);

function solid(width: number, height: number, rgba: readonly [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

/**
 * Creates an empty flat (non-nested) package: description.xml, `com.huawei.watchface` (version 2, layout holding only the two
 * title strings, one image slot = thumbnail) and the `preview/` entries. Add elements with `FaceBuilder`.
 */
export function createHwt(options: CreateHwtOptions): HwtPackage {
  const screen = options.screen ?? FIT4_SCREEN;
  if (!RESOLUTIONS[screen]) throw new HwtError(`unknown screen code ${screen}`);
  const description: HwtDescription = {
    root: "HwTheme",
    title: options.title,
    titleCn: options.titleCn ?? options.title,
    author: options.author ?? "",
    designer: options.designer ?? options.author ?? "",
    screen,
    version: options.version ?? "2.1.1",
    font: "Default",
    fontCn: "默认",
    briefinfo: options.briefinfo ?? "{}",
  };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(description.title)) throw new HwtError("title contains control characters");
  const screenSize = RESOLUTIONS[screen]!;
  const thumbSize = previewSizes(screenSize.width, screenSize.height).thumbnail;
  const thumb = options.thumbnail ?? solid(thumbSize.width, thumbSize.height, [0, 0, 0, 255]);
  const signature = options.signature ?? DEFAULT_SIGNATURE;
  if (signature.length !== SIGNATURE_SIZE) throw new HwtError(`signature must be ${SIGNATURE_SIZE} bytes`);

  const layout = encodePb({
    fields: [
      { field: 2, wire: 2, bytes: utf8Encode(description.title) },
      { field: 3, wire: 2, bytes: utf8Encode(description.titleCn) },
    ],
  });
  const watchface: WatchfaceBinary = { version: 2, reserved: 0, layout, signature: signature.slice(), images: [encodeImage(thumb)] };
  const entries: ZipEntry[] = [
    { name: HUAWEI_WATCHFACE_ENTRY, data: writeWatchface(watchface) },
    { name: DESCRIPTION_ENTRY, data: utf8Encode(renderDescription(description)) },
    { name: "preview/", data: new Uint8Array(0) },
  ];
  if (options.aod) entries.push({ name: "preview/aod.jpg", data: options.aod });
  entries.push({ name: "preview/cover.jpg", data: options.cover });
  if (options.iconSmall) entries.push({ name: "preview/icon_small.jpg", data: options.iconSmall });
  return {
    archive: { entries, comment: new Uint8Array(0), prefix: new Uint8Array(0) },
    description,
    watchfaceEntry: HUAWEI_WATCHFACE_ENTRY,
    container: "flat",
    watchface,
  };
}
