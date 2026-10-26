import { Hono } from "hono";
import { z } from "zod";

import type { AppContext } from "./env";

/**
 * Offline watch maps for the lab (docs/offline-maps.md "Lab"): `offvmp` `.bin` files built from OpenStreetMap, kept in the public R2 bucket
 * `MAPS` (`watch/catalog.json` plus `watch/<id>.bin`; the bucket also holds the bike computer's PMTiles, docs/bike-computer.md). The phone's experimental switch asks for them, and only then; the request carries nothing about
 * the user: no session, no parameters.
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

/** The catalog's valid entries; a missing or broken catalog is an empty list (logged), never an error for the caller. */
async function readCatalog(bucket: R2Bucket): Promise<MapEntry[]> {
  const object = await bucket.get(MAPS_CATALOG_KEY);
  if (!object) return [];
  let raw: unknown;
  try {
    raw = await object.json();
  } catch (error) {
    console.error(JSON.stringify({ event: "maps_catalog_invalid", problem: error instanceof Error ? error.message : String(error) }));
    return [];
  }
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

/** `GET /v1/maps`: the catalog entries, each with the OSM attribution. */
maps.get("/", async (c) => {
  const entries = await readCatalog(c.env.MAPS);
  c.header("cache-control", `public, max-age=${MAPS_CATALOG_CACHE_SECONDS}`);
  return c.json(entries.map((entry) => ({ ...entry, attribution: MAPS_ATTRIBUTION })));
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
