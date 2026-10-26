// Builds src/timbangan.ts, the scale list on /timbangan, from the phone app's protocol registry
// (src/features/scale/registry.ts), so the page lists exactly what the app can read.
//
// The registry knows each protocol's label and brands, whether it was tried on a real scale (`realScaleTested`), whether it needs a
// key from the person (`secret`) and whether it is weight only (`weightOnly`, which must be tagged "berat" below). It does not know
// how a family is grouped on the page or which other body values a scale gives, so that editorial part lives in GROUPS below. build() throws when
// a registry protocol is missing from GROUPS (or GROUPS names an id the registry no longer has): adding a
// protocol to the app forces a decision here instead of silently leaving it off the page.
import { PROTOCOLS } from "../../src/features/scale/registry";

/**
 * What a weigh-in gives, in the words the page uses:
 * - berat: weight only.
 * - timbangan: weight and body values the scale computed and sent.
 * - estimasi: weight and body values JoyoFit estimates from the impedance with openScale's formula.
 * - tergantung: depends on the model, spelled out in the note.
 */
export type Data = "berat" | "timbangan" | "estimasi" | "tergantung";

type Entry = { id: string; data: Data; catatan?: string };
type Group = { nama: string; entries: Entry[] };

export const GROUPS: readonly Group[] = [
  {
    nama: "Xiaomi Mi Scale dan Mi Body Composition",
    entries: [
      {
        id: "xiaomi-mi-scale",
        data: "estimasi",
        catatan: "Mi Smart Scale biasa hanya mengirim berat. Perkiraan komposisi tubuh hanya untuk Mi Body Composition Scale, yang mengirim impedansi.",
      },
    ],
  },
  {
    nama: "Renpho, QN, dan Yolanda",
    entries: [
      { id: "qn-scale", data: "estimasi" },
      { id: "qn-broadcast", data: "berat", catatan: "Komposisi tubuh dari seri ini belum dibaca." },
      { id: "renpho-es-wbe28", data: "berat", catatan: "Komposisi tubuh dari model ini belum dibaca." },
    ],
  },
  {
    nama: "Fitdays dan AiLink",
    entries: [
      { id: "aaax-broadcast", data: "berat", catatan: "Komposisi tubuh dari seri ini belum dibaca." },
      { id: "ailink-broadcast", data: "estimasi" },
    ],
  },
  {
    nama: "OKOK dan Chipsea",
    entries: [{ id: "okok-chipsea-broadcast", data: "estimasi" }],
  },
  {
    nama: "Yunmai",
    entries: [
      {
        id: "yunmai-mini",
        data: "tergantung",
        catatan: "Kadar lemak dari timbangan kalau dikirim, kalau tidak berupa perkiraan dari impedansi.",
      },
      { id: "yunmai-se", data: "estimasi" },
      { id: "yunmai-x", data: "estimasi" },
    ],
  },
  {
    nama: "1byone",
    entries: [
      { id: "one-by-one-health-scale", data: "estimasi" },
      { id: "one-by-one-new", data: "estimasi" },
    ],
  },
  {
    nama: "Eufy",
    entries: [{ id: "eufy-one-by-one", data: "estimasi" }],
  },
  {
    nama: "Etekcity",
    entries: [{ id: "etekcity-fit8s-broadcast", data: "estimasi" }],
  },
  {
    nama: "Inlife",
    entries: [
      {
        id: "inlife",
        data: "tergantung",
        catatan: "Sebagian model mengirim massa tanpa lemak, sebagian hanya impedansi yang belum dihitung jadi komposisi tubuh.",
      },
    ],
  },
  { nama: "Senssun", entries: [{ id: "senssun-fat", data: "timbangan" }] },
  { nama: "Excelvan", entries: [{ id: "excelvan-cf36x", data: "timbangan" }] },
  { nama: "Hesley", entries: [{ id: "hesley-yunchen", data: "timbangan" }] },
  { nama: "Exingtech", entries: [{ id: "exingtech-y1", data: "timbangan" }] },
  {
    nama: "Scale Up",
    entries: [{ id: "scaleup-broadcast", data: "berat", catatan: "Impedansinya belum dibaca." }],
  },
  {
    nama: "Tuya dan HAN RIVER",
    entries: [
      {
        id: "tuya-beacon-broadcast",
        data: "berat",
        catatan:
          "Hanya berat: dalam datanya tidak ada impedansi atau kadar lemak, jadi JoyoFit tidak menampilkannya. Datanya terenkripsi, jadi kamu perlu memasukkan local key timbanganmu, yang diambil dari platform pengembang Tuya (langkah teknis, dijelaskan di aplikasi). Sudah dicoba di satu timbangan HAN RIVER HRTZC01. Timbangan Tuya lain belum diuji.",
      },
    ],
  },
  {
    nama: "HUAWEI dan HONOR",
    entries: [
      {
        id: "huawei-hagrid",
        data: "timbangan",
        catatan:
          "Timbangan ini butuh 3 kunci (CAK, C1, C2) sebelum mau mengirim data. Berat dan kadar lemak dihitung timbangannya sendiri. Belum diuji di timbangan asli.",
      },
    ],
  },
  {
    nama: "Timbangan Bluetooth standar",
    entries: [
      {
        id: "standard-weight-profile",
        data: "tergantung",
        catatan: "Berat selalu terbaca. Lemak, otot, air, dan nilai lain hanya muncul kalau timbangannya mengirim data Body Composition standar.",
      },
    ],
  },
];

export type Item = {
  nama: string;
  merek: string[];
  data: Data;
  /** Tried on a real scale, not only against sample data. */
  teruji?: true;
  /** Needs a key the person gets elsewhere (a Tuya local key, the keys of a Huawei Hagrid scale). */
  butuhKunci?: true;
  catatan?: string;
};
export type Family = { nama: string; items: Item[] };

export function build(): Family[] {
  const byId = new Map(PROTOCOLS.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const families = GROUPS.map((group) => ({
    nama: group.nama,
    items: group.entries.map((entry): Item => {
      const protocol = byId.get(entry.id);
      if (!protocol) throw new Error(`scripts/timbangan.ts: "${entry.id}" is no longer in the scale registry`);
      if (seen.has(entry.id)) throw new Error(`scripts/timbangan.ts: "${entry.id}" is listed twice`);
      seen.add(entry.id);
      if (protocol.weightOnly && entry.data !== "berat") {
        throw new Error(`scripts/timbangan.ts: "${entry.id}" is weight only in the registry, so its data must be "berat"`);
      }
      return {
        // "(broadcast)" is how the app reads the scale, not something a person looks for on the box.
        nama: protocol.label.replace(/ \(broadcast\)$/, ""),
        merek: [...protocol.brands],
        data: entry.data,
        ...(protocol.realScaleTested ? { teruji: true as const } : {}),
        ...(protocol.secret ? { butuhKunci: true as const } : {}),
        ...(entry.catatan ? { catatan: entry.catatan } : {}),
      };
    }),
  }));
  const missing = PROTOCOLS.filter((p) => !seen.has(p.id)).map((p) => p.id);
  if (missing.length > 0) {
    throw new Error(`scripts/timbangan.ts: add ${missing.join(", ")} to GROUPS (the app reads it, the page would not list it)`);
  }
  return families;
}

export function render(): string {
  return [
    "// Generated by scripts/gen-timbangan.ts from the scale protocol registry. Do not edit; run `bun run timbangan`.",
    "",
    'export type TimbanganData = "berat" | "timbangan" | "estimasi" | "tergantung";',
    "export type TimbanganItem = {",
    "  nama: string;",
    "  merek: string[];",
    "  data: TimbanganData;",
    "  teruji?: true;",
    "  butuhKunci?: true;",
    "  catatan?: string;",
    "};",
    "export type TimbanganFamily = { nama: string; items: TimbanganItem[] };",
    "",
    `export const TIMBANGAN_FAMILIES: TimbanganFamily[] = ${JSON.stringify(build(), null, 2)};`,
    "",
    "/** Protocols the app reads: one row each on /timbangan. */",
    "export const TIMBANGAN_PROTOKOL = TIMBANGAN_FAMILIES.reduce((n, family) => n + family.items.length, 0);",
    "",
  ].join("\n");
}
