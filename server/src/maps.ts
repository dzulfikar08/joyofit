import { Hono } from "hono";
import { z } from "zod";

import { sha256Hex } from "./auth";
import type { AppContext } from "./env";

/**
 * Offline watch maps (docs/offline-maps.md): `offvmp` `.bin` files built from OpenStreetMap for every Indonesian Kabupaten/Kota, kept in
 * the public R2 bucket `MAPS` (`watch/catalog.json` plus `watch/<id>.bin`, written by tools/offline-maps/publish.py; the bucket also holds
 * the bike computer's PMTiles, docs/bike-computer.md). The phone's experimental switch asks for them, and only then; no session.
 *
 * `GET /v1/maps` takes optional filters: `province` (exact, any case), `q` (part of the name, province or BPS code), `near=lat,lon`
 * (sorted by the distance to each map's bbox, 0 inside, with `distanceKm`) and `limit`. The app filters on the phone and never sends
 * `near`; this code never logs a query.
 */
export const maps = new Hono<AppContext>();

export const MAPS_CATALOG_KEY = "watch/catalog.json";
export const MAPS_ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0";
export const MAPS_CATALOG_CACHE_SECONDS = 300;
export const MAPS_FILE_CACHE_SECONDS = 3600;

/** A map id is a decimal u64. */
const ID = /^(0|[1-9]\d{0,19})$/;
const U64_MAX = 18446744073709551615n;

function isMapId(id: string): boolean {
  return ID.test(id) && BigInt(id) <= U64_MAX;
}

const entrySchema = z.object({
  id: z.string().refine(isMapId),
  name: z.string().min(1),
  /** BPS kode wilayah of the Kabupaten/Kota. */
  code: z.string().regex(/^\d{4}$/),
  province: z.string().min(1),
  kind: z.enum(["kota", "kabupaten"]),
  /** Only on the parts of a region split to stay under the app's size cap. */
  part: z
    .object({ index: z.number().int().positive(), count: z.number().int().min(2) })
    .refine((p) => p.index <= p.count)
    .optional(),
  bbox: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .refine(([w, s, e, n]) => w >= -180 && e <= 180 && s >= -90 && n <= 90 && w < e && s < n),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9A-F]{64}$/),
  version: z.number().int().nonnegative(),
  builtAt: z.string(),
  osmDate: z.string(),
});

export type MapEntry = z.infer<typeof entrySchema>;

/** The parsed catalog of this isolate, keyed by the R2 object's etag: a request re-reads the object only when it changed. */
let cached: { etag: string; entries: MapEntry[] } | null = null;

function parseCatalog(raw: unknown): MapEntry[] {
  const list = z.object({ maps: z.array(z.unknown()) }).safeParse(raw);
  if (!list.success) {
    console.error(JSON.stringify({ event: "maps_catalog_invalid", problem: "no maps array" }));
    return [];
  }
  const entries: MapEntry[] = [];
  list.data.maps.forEach((item, index) => {
    const parsed = entrySchema.safeParse(item);
    if (parsed.success) entries.push(parsed.data);
    else console.error(JSON.stringify({ event: "maps_catalog_entry_dropped", index, problem: parsed.error.message }));
  });
  return entries;
}

/** The catalog's valid entries; a missing or broken catalog is an empty list (logged), never an error for the caller. */
async function readCatalog(bucket: R2Bucket): Promise<MapEntry[]> {
  const object = await bucket.get(MAPS_CATALOG_KEY, cached ? { onlyIf: { etagDoesNotMatch: cached.etag } } : undefined);
  if (!object) {
    cached = null;
    return [];
  }
  if (!("body" in object)) return cached?.entries ?? [];
  let entries: MapEntry[];
  try {
    entries = parseCatalog(await object.json());
  } catch (error) {
    console.error(JSON.stringify({ event: "maps_catalog_invalid", problem: error instanceof Error ? error.message : String(error) }));
    entries = [];
  }
  cached = { etag: object.etag, entries };
  return entries;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (degrees: number) => (degrees * Math.PI) / 180;

/** Kilometres from a point to a bbox: 0 inside, else the great-circle distance to the nearest point of the box. */
export function distanceKmToBbox(lat: number, lon: number, [w, s, e, n]: MapEntry["bbox"]): number {
  const nearestLat = Math.min(Math.max(lat, s), n);
  const nearestLon = Math.min(Math.max(lon, w), e);
  if (nearestLat === lat && nearestLon === lon) return 0;
  const dLat = toRad(nearestLat - lat);
  const dLon = toRad(nearestLon - lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(nearestLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

const querySchema = z.object({
  province: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  near: z
    .string()
    .regex(/^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/)
    .transform((value) => value.split(",").map(Number) as [number, number])
    .refine(([lat, lon]) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
    .optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

/** `GET /v1/maps`: the catalog entries (filtered, see above), each with the OSM attribution; `ETag` and `If-None-Match` → 304. */
maps.get("/", async (c) => {
  const query = querySchema.safeParse(c.req.query());
  if (!query.success) return c.json({ error: "invalid_query" }, 400);
  const { province, q, near, limit } = query.data;
  let entries: (MapEntry & { distanceKm?: number })[] = await readCatalog(c.env.MAPS);
  if (province) {
    const wanted = fold(province);
    entries = entries.filter((entry) => fold(entry.province) === wanted);
  }
  if (q) {
    const needle = fold(q);
    entries = entries.filter((entry) => fold(entry.name).includes(needle) || fold(entry.province).includes(needle) || entry.code === needle);
  }
  if (near) {
    const [lat, lon] = near;
    entries = entries
      .map((entry) => ({ ...entry, distanceKm: Math.round(distanceKmToBbox(lat, lon, entry.bbox) * 10) / 10 }))
      .sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name));
  }
  if (limit) entries = entries.slice(0, limit);
  const body = JSON.stringify(entries.map((entry) => ({ ...entry, attribution: MAPS_ATTRIBUTION })));
  const etag = `"${(await sha256Hex(body)).slice(0, 32)}"`;
  const headers = { "cache-control": `public, max-age=${MAPS_CATALOG_CACHE_SECONDS}`, etag };
  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch !== undefined && ifNoneMatch.split(",").some((tag) => tag.trim() === etag || tag.trim() === "*")) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { headers: { ...headers, "content-type": "application/json; charset=UTF-8" } });
});

/** `GET /v1/maps/:id.bin`: the map file streamed from R2, with `ETag` and `If-None-Match` → 304. */
maps.get("/:file", async (c) => {
  const file = c.req.param("file");
  const id = file.endsWith(".bin") ? file.slice(0, -4) : "";
  if (!isMapId(id)) return c.json({ error: "not_found" }, 404);
  const object = await c.env.MAPS.get(`watch/${id}.bin`, { onlyIf: c.req.raw.headers });
  if (!object) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", `public, max-age=${MAPS_FILE_CACHE_SECONDS}`);
  const ifNoneMatch = c.req.header("if-none-match");
  const matched = ifNoneMatch !== undefined && ifNoneMatch.split(",").some((tag) => tag.trim() === object.httpEtag || tag.trim() === "*");
  if (!("body" in object) || matched) return new Response(null, { status: 304, headers });
  headers.set("content-type", "application/octet-stream");
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
});
