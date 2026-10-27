import { describe, expect, test } from "bun:test";
import { HwtError, bytesEqual, utf8Decode } from "../src/bytes";
import { RESOLUTIONS, parseDescription, patchDescription, renderDescription } from "../src/description";
import { createHwt, getEntry, previewSizes, readHwt, setEntry, writeHwt } from "../src/hwt";
import { verifyWatchface } from "../src/builder";
import { decodeImage, readImageHeader } from "../src/image";
import { describeLayout, getLayout } from "../src/layout";
import { writeZip } from "../src/zip";
import { VALUE_TYPE, VALUE_TYPES } from "../src/valuetypes";
import { writeWatchface } from "../src/watchface";
import { parsedFixtures } from "./helpers";

const all = parsedFixtures();

describe("description.xml", () => {
  test("renderDescription reproduces the vendor tool's description.xml byte-for-byte (Fit 4 Pro, GT6 and synthetic samples)", () => {
    for (const f of all.filter((x) => x.name.startsWith("fit4pro/") || x.name.startsWith("other/Focus") || x.name.startsWith("synthetic/"))) {
      const xml = utf8Decode(getEntry(f.pkg, "description.xml")!);
      expect(renderDescription(parseDescription(xml))).toBe(xml);
    }
  });

  test("HWHD13 is 408 x 480 (width x height), height first in Gadgetbridge's table", () => {
    expect(RESOLUTIONS.HWHD13).toEqual({ code: "HWHD13", height: 480, width: 408 });
    expect(RESOLUTIONS.HWHD09).toEqual({ code: "HWHD09", height: 466, width: 466 });
  });

  test("patching changes only edited fields, expands <author/>, and leaves formatting alone", () => {
    const xml = utf8Decode(getEntry(all.find((f) => f.name === "other/Unnamed.hwhd02.hwt")!.pkg, "description.xml")!);
    expect(xml).toContain("<author/>");
    const d = parseDescription(xml);
    expect(patchDescription(xml, d)).toBe(xml);
    d.author = "A & B";
    const patched = patchDescription(xml, d);
    expect(patched).toContain("<author>A &amp; B</author>");
    expect(patched.replace("<author>A &amp; B</author>", "<author/>")).toBe(xml);
    expect(parseDescription(patched).author).toBe("A & B");
  });

  test("a missing element is inserted, a BOM is tolerated, bad documents are rejected", () => {
    const minimal = "<HwTheme><screen>HWHD13</screen><title>t</title></HwTheme>";
    const d = parseDescription(minimal);
    d.version = "2.1.1";
    expect(patchDescription(minimal, d)).toContain("<version>2.1.1</version>");
    expect(parseDescription(`\ufeff${minimal}`).screen).toBe("HWHD13");
    expect(() => parseDescription("<Other><screen>x</screen></Other>")).toThrow(HwtError);
    expect(() => parseDescription("<HwTheme><title>t</title></HwTheme>")).toThrow(/screen/);
  });

  test("Honor packages (HnTheme) keep their binary in com.honor.watchface", () => {
    const base = createHwt({ title: "h", cover: Uint8Array.from([1]) });
    const binary = base.archive.entries.find((e) => e.name === "com.huawei.watchface")!;
    binary.name = "com.honor.watchface";
    const desc = base.archive.entries.find((e) => e.name === "description.xml")!;
    desc.data = new TextEncoder().encode(utf8Decode(desc.data).replace(/HwTheme/g, "HnTheme"));
    const pkg = readHwt(writeZip(base.archive));
    expect(pkg.description.root).toBe("HnTheme");
    expect(pkg.watchfaceEntry).toBe("com.honor.watchface");
    expect(pkg.watchface?.version).toBe(2);
    expect(bytesEqual(writeHwt(pkg), writeZip(base.archive))).toBe(true);
  });
});

describe("createHwt", () => {
  test("produces a package that reads back with the same description and an empty v2 layout", () => {
    const cover = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const pkg = createHwt({ title: "Mine", titleCn: "Wo", author: "dzul", cover });
    const out = writeHwt(pkg);
    const back = readHwt(out);
    expect(back.description).toMatchObject({ root: "HwTheme", title: "Mine", titleCn: "Wo", author: "dzul", designer: "dzul", screen: "HWHD13", version: "2.1.1", font: "Default" });
    expect(back.container).toBe("flat");
    expect(back.watchface!.version).toBe(2);
    expect(back.watchface!.images).toHaveLength(1);
    expect(verifyWatchface(writeWatchface(back.watchface!)).problems).toEqual([]);
    expect(getEntry(back, "preview/cover.jpg")).toEqual(cover);
  });

  test("rejects unknown screens and bad signatures", () => {
    const cover = Uint8Array.from([1]);
    expect(() => createHwt({ title: "x", cover, screen: "HWHD99" })).toThrow(/unknown screen/);
    expect(() => createHwt({ title: "x", cover, signature: new Uint8Array(3) })).toThrow(/signature/);
  });

  test("previewSizes keeps the measured Fit 4 Pro numbers and scales other screens by the same ratios", () => {
    expect(previewSizes(408, 480)).toEqual({
      cover: { width: 816, height: 960 },
      aod: { width: 816, height: 960 },
      iconSmall: { width: 331, height: 390 },
      thumbnail: { width: 228, height: 269 },
    });
    expect(previewSizes(466, 466)).toEqual({
      cover: { width: 932, height: 932 },
      aod: { width: 932, height: 932 },
      iconSmall: { width: 378, height: 379 },
      thumbnail: { width: 260, height: 261 },
    });
    expect(previewSizes(194, 368).thumbnail).toEqual({ width: 108, height: 206 });
    expect(previewSizes(120, 120).iconSmall).toEqual({ width: 97, height: 98 });
  });

  test("the default thumbnail follows the screen code's size", () => {
    const cover = Uint8Array.from([1]);
    const thumb = (screen: string) => readImageHeader(createHwt({ title: "x", cover, screen }).watchface!.images[0]!);
    expect(readImageHeader(createHwt({ title: "x", cover }).watchface!.images[0]!)).toMatchObject({ width: 228, height: 269 });
    expect(thumb("HWHD09")).toMatchObject({ width: 260, height: 261 });
    expect(thumb("HWHD07")).toMatchObject({ width: 108, height: 206 });
  });

  test("setEntry adds and replaces entries", () => {
    const pkg = createHwt({ title: "x", cover: Uint8Array.from([1]) });
    setEntry(pkg, "preview/extra.jpg", Uint8Array.from([9]));
    setEntry(pkg, "preview/cover.jpg", Uint8Array.from([7]));
    const back = readHwt(writeHwt(pkg));
    expect(getEntry(back, "preview/extra.jpg")).toEqual(Uint8Array.from([9]));
    expect(getEntry(back, "preview/cover.jpg")).toEqual(Uint8Array.from([7]));
  });
});

describe("value type table", () => {
  test("ids are unique and the name map only holds known ids", () => {
    const ids = VALUE_TYPES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of Object.values(VALUE_TYPE)) expect(ids).toContain(id);
  });

  test("every enum id's image count matches the samples' usage", () => {
    const seen = new Map<number, Set<number>>();
    const walk = (o: unknown) => {
      if (Array.isArray(o)) {
        o.forEach(walk);
        return;
      }
      if (typeof o !== "object" || o === null) return;
      const selected = "selected_res" in o ? o.selected_res : undefined;
      if (typeof selected === "object" && selected !== null && "value_type" in selected && "res_name" in selected) {
        const { value_type, res_name } = selected;
        if (typeof value_type === "number" && Array.isArray(res_name)) {
          const set = seen.get(value_type) ?? new Set<number>();
          set.add(res_name.length);
          seen.set(value_type, set);
        }
      }
      Object.values(o).forEach(walk);
    };
    for (const f of all) if (f.pkg.watchface!.version === 2) walk(describeLayout(getLayout(f.pkg.watchface!)));
    for (const info of VALUE_TYPES) {
      if (info.category !== "enum" || info.imageCount === undefined || info.evidence === "unknown") continue;
      const counts = seen.get(info.id);
      if (counts) expect([...counts]).toContain(info.imageCount);
    }
  });
});

/** Size of a baseline/progressive JPEG from its first SOF marker. */
function jpegSize(b: Uint8Array): [number, number] {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [(b[i + 7]! << 8) | b[i + 8]!, (b[i + 5]! << 8) | b[i + 6]!];
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  }
  throw new Error("no SOF marker");
}

describe("sample facts the README relies on", () => {
  test("Fit 4 Pro previews are 816x960 (cover, aod) and 331x390 (icon_small); thumbnail slot is 228x269", () => {
    const fit4 = all.filter((f) => f.name.startsWith("fit4pro/"));
    expect(fit4).toHaveLength(4);
    for (const f of fit4) {
      expect(jpegSize(getEntry(f.pkg, "preview/cover.jpg")!)).toEqual([816, 960]);
      expect(jpegSize(getEntry(f.pkg, "preview/aod.jpg")!)).toEqual([816, 960]);
      expect(jpegSize(getEntry(f.pkg, "preview/icon_small.jpg")!)).toEqual([331, 390]);
      expect(readImageHeader(f.pkg.watchface!.images[0]!)).toMatchObject({ width: 228, height: 269 });
    }
  });

  test("no sample image contains a pixel equal to the RLE escape colour", () => {
    for (const f of all) {
      for (const blob of f.pkg.watchface!.images) {
        if (!blob.length) continue;
        const d = decodeImage(blob).data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] === 0x45 && d[i + 1] === 0x67 && d[i + 2] === 0x89 && d[i + 3] === 0x23) throw new Error(`${f.name}: escape-coloured pixel`);
        }
      }
    }
  });
});
