import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { tokenMatches } from "./auth";
import { readJson } from "./body";
import type { AppContext } from "./env";
import { entrySchema, isMapId, MAPS_CATALOG_KEY } from "./maps";

/**
 * Publishing the offline watch maps through the Worker (server/README.md "Offline maps publishing", docs/offline-maps.md "Automatic
 * refresh"): the monthly GitHub workflow runs tools/offline-maps/publish.py --via-worker, which writes the R2 bucket `MAPS` here instead of
 * with a Cloudflare API token. Every request needs `X-Maps-Publish-Key` equal to the Worker secret `MAPS_PUBLISH_KEY` (401 otherwise, 503
 * while it is unset). Only `watch/catalog.json`, `watch/<id>.bin` and this module's staging keys `watch/.chunks/<id>/<sha256>/<n>` can be
 * written; nothing else in the bucket (the bike computer's PMTiles) is reachable.
 *
 * - `GET  /watch/catalog.json`: the stored catalog as is, with its `ETag`; 404 when there is none.
 * - `PUT  /watch/catalog.json`: `{ maps: [entry, …] }`, every entry valid for `GET /v1/maps` and every id once (400 otherwise); one R2 PUT
 *   replaces the object, so readers see the old catalog or the new one. `If-Match: <etag>` → 412 when it changed since that read.
 * - `GET  /watch/<id>.bin/meta`: `{ exists, sizeBytes, sha256, uploaded }`; `sha256` is null for files uploaded without one (by wrangler).
 * - `PUT  /watch/<id>.bin`: the file (at most 95 MiB, `Content-Length` required) with `X-Sha256`; R2 checks the bytes against it and stores
 *   nothing on a mismatch (422), so the previous file stays.
 * - Larger files in chunks: `PUT /watch/<id>.bin/chunks/<sha256 of the file>/<n>` (n = 1, 2, …; each at most 95 MiB, `X-Sha256` of the
 *   chunk), then `POST /watch/<id>.bin/chunks/<sha256 of the file>/commit` with `{ chunks, sizeBytes }`: the Worker streams the chunks in
 *   order into `watch/<id>.bin`, R2 checks the whole file's SHA-256 before it stores it (422 on a mismatch), then deletes the id's chunks.
 * - `DELETE /watch/<id>.bin`: a file the current catalog does not list (409 when it does).
 */
export const mapsPublish = new Hono<AppContext>();

/** Largest request body: under Cloudflare's 100 MB limit (Free and Pro plans). */
export const MAPS_MAX_BODY_BYTES = 95 * 1024 * 1024;
export const MAPS_MAX_CHUNKS = 64;
export const MAPS_MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const CHUNKS_PREFIX = "watch/.chunks/";
const SHA256 = /^[0-9A-Fa-f]{64}$/;
/** What R2 throws when the bytes do not match the `sha256` given to `put` (BadDigest). */
const DIGEST_MISMATCH = /checksum|digest|did not match/i;

const catalogSchema = z.object({
  generatedAt: z.string().optional(),
  attribution: z.string().optional(),
  maps: z.array(entrySchema).max(10_000),
});

const commitSchema = z.object({
  chunks: z.number().int().min(1).max(MAPS_MAX_CHUNKS),
  sizeBytes: z.number().int().positive(),
});

mapsPublish.use(
  "*",
  createMiddleware<AppContext>(async (c, next) => {
    const expected = c.env.MAPS_PUBLISH_KEY?.trim();
    if (!expected) return c.json({ error: "maps_publish_not_configured" }, 503);
    const given = c.req.header("x-maps-publish-key");
    if (!given || !(await tokenMatches(given, expected))) return c.json({ error: "unauthorized" }, 401);
    await next();
  }),
);

/** The map id of `<id>.bin`, or null. */
function binId(file: string): string | null {
  const id = file.endsWith(".bin") ? file.slice(0, -4) : "";
  return isMapId(id) ? id : null;
}

function parseSha(value: string | undefined): string | null {
  return value !== undefined && SHA256.test(value) ? value.toUpperCase() : null;
}

/** The request body as a known-length stream (R2 needs the length), or an error response's status and code. */
function sizedBody(request: Request): { body: ReadableStream; length: number } | { status: 400 | 411 | 413; error: string } {
  const header = request.headers.get("content-length");
  if (header === null || !/^\d+$/.test(header)) return { status: 411, error: "length_required" };
  const length = Number(header);
  if (length > MAPS_MAX_BODY_BYTES) return { status: 413, error: "too_large" };
  if (length === 0 || !request.body) return { status: 400, error: "empty_body" };
  return { body: request.body.pipeThrough(new FixedLengthStream(length)), length };
}

/** `put` with R2's own SHA-256 check: "mismatch" when the bytes differ (nothing is stored then). */
async function putChecked(bucket: R2Bucket, key: string, value: ReadableStream, sha256: string): Promise<R2Object | "mismatch"> {
  try {
    const object = await bucket.put(key, value, {
      sha256: sha256.toLowerCase(),
      customMetadata: { sha256 },
      httpMetadata: { contentType: "application/octet-stream" },
    });
    if (!object) throw new Error(`put ${key} returned nothing`);
    return object;
  } catch (error) {
    if (error instanceof Error && DIGEST_MISMATCH.test(error.message)) return "mismatch";
    throw error;
  }
}

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  for (;;) {
    const listed = await bucket.list({ prefix, limit: 1000 });
    if (listed.objects.length) await bucket.delete(listed.objects.map((o) => o.key));
    if (!listed.truncated) return;
  }
}

mapsPublish.get("/watch/:file", async (c) => {
  if (c.req.param("file") !== "catalog.json") return c.json({ error: "not_found" }, 404);
  const object = await c.env.MAPS.get(MAPS_CATALOG_KEY);
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, {
    headers: { "content-type": "application/json; charset=UTF-8", etag: object.httpEtag, "cache-control": "no-store" },
  });
});

mapsPublish.put("/watch/:file", async (c) => {
  const file = c.req.param("file");
  if (file === "catalog.json") {
    const raw = await readJson(c.req.raw, MAPS_MAX_CATALOG_BYTES);
    const parsed = catalogSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
      return c.json({ error: "invalid_catalog", issues }, 400);
    }
    const ids = parsed.data.maps.map((entry) => entry.id);
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    if (duplicate !== undefined) return c.json({ error: "duplicate_id", id: duplicate }, 400);
    const ifMatch = c.req.header("if-match")?.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
    const object = await c.env.MAPS.put(MAPS_CATALOG_KEY, JSON.stringify(raw), {
      httpMetadata: { contentType: "application/json" },
      ...(ifMatch ? { onlyIf: { etagMatches: ifMatch } } : {}),
    });
    if (!object) return c.json({ error: "catalog_changed" }, 412);
    return c.json({ ok: true, maps: ids.length, etag: object.httpEtag });
  }
  const id = binId(file);
  if (!id) return c.json({ error: "not_found" }, 404);
  const sha256 = parseSha(c.req.header("x-sha256"));
  if (!sha256) return c.json({ error: "invalid_sha256" }, 400);
  const sized = sizedBody(c.req.raw);
  if ("error" in sized) return c.json({ error: sized.error }, sized.status);
  const object = await putChecked(c.env.MAPS, `watch/${id}.bin`, sized.body, sha256);
  if (object === "mismatch") return c.json({ error: "sha256_mismatch" }, 422);
  return c.json({ ok: true, sizeBytes: object.size, sha256 }, 201);
});

mapsPublish.get("/watch/:file/meta", async (c) => {
  const id = binId(c.req.param("file"));
  if (!id) return c.json({ error: "not_found" }, 404);
  const object = await c.env.MAPS.head(`watch/${id}.bin`);
  if (!object) return c.json({ exists: false });
  const checksum = object.checksums.sha256;
  return c.json({
    exists: true,
    sizeBytes: object.size,
    sha256: object.customMetadata?.sha256 ?? (checksum ? Array.from(new Uint8Array(checksum), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase() : null),
    uploaded: object.uploaded.toISOString(),
  });
});

mapsPublish.delete("/watch/:file", async (c) => {
  const id = binId(c.req.param("file"));
  if (!id) return c.json({ error: "not_found" }, 404);
  const catalog = await c.env.MAPS.get(MAPS_CATALOG_KEY);
  if (catalog) {
    let listed: boolean;
    try {
      const maps = z.object({ maps: z.array(z.unknown()) }).parse(await catalog.json()).maps;
      listed = maps.some((entry) => typeof entry === "object" && entry !== null && "id" in entry && entry.id === id);
    } catch {
      return c.json({ error: "catalog_unreadable" }, 409);
    }
    if (listed) return c.json({ error: "listed_in_catalog" }, 409);
  }
  const existed = (await c.env.MAPS.head(`watch/${id}.bin`)) !== null;
  await c.env.MAPS.delete(`watch/${id}.bin`);
  return c.json({ ok: true, existed });
});

/** The chunks of one upload: `?file` is `<id>.bin`, `sha` the whole file's SHA-256. */
function chunkUpload(file: string, sha: string): { id: string; sha256: string; prefix: string } | null {
  const id = binId(file);
  const sha256 = parseSha(sha);
  return id && sha256 ? { id, sha256, prefix: `${CHUNKS_PREFIX}${id}/${sha256}/` } : null;
}

mapsPublish.put("/watch/:file/chunks/:sha/:n", async (c) => {
  const upload = chunkUpload(c.req.param("file"), c.req.param("sha"));
  const n = c.req.param("n");
  if (!upload || !/^[1-9]\d{0,2}$/.test(n) || Number(n) > MAPS_MAX_CHUNKS) return c.json({ error: "not_found" }, 404);
  const sha256 = parseSha(c.req.header("x-sha256"));
  if (!sha256) return c.json({ error: "invalid_sha256" }, 400);
  const sized = sizedBody(c.req.raw);
  if ("error" in sized) return c.json({ error: sized.error }, sized.status);
  const object = await putChecked(c.env.MAPS, `${upload.prefix}${n}`, sized.body, sha256);
  if (object === "mismatch") return c.json({ error: "sha256_mismatch" }, 422);
  return c.json({ ok: true, chunk: Number(n), sizeBytes: object.size }, 201);
});

mapsPublish.post("/watch/:file/chunks/:sha/commit", async (c) => {
  const upload = chunkUpload(c.req.param("file"), c.req.param("sha"));
  if (!upload) return c.json({ error: "not_found" }, 404);
  const { chunks, sizeBytes } = commitSchema.parse(await readJson(c.req.raw, 1024));
  const bucket = c.env.MAPS;
  const keys = Array.from({ length: chunks }, (_, i) => `${upload.prefix}${i + 1}`);
  const heads = await Promise.all(keys.map((key) => bucket.head(key)));
  const missing = heads.findIndex((head) => head === null);
  if (missing >= 0) return c.json({ error: "missing_chunk", chunk: missing + 1 }, 409);
  const total = heads.reduce((sum, head) => sum + (head?.size ?? 0), 0);
  if (total !== sizeBytes) return c.json({ error: "size_mismatch", chunksBytes: total }, 422);

  // The chunks, in order, as one stream of known length; R2 checks the whole file's SHA-256 before it stores anything.
  const { readable, writable } = new FixedLengthStream(total);
  const writer = writable.getWriter();
  const copying = (async () => {
    for (const key of keys) {
      const chunk = await bucket.get(key);
      if (!chunk) throw new Error(`${key} vanished`);
      const reader = chunk.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    }
    await writer.close();
  })().catch(async (error: unknown) => {
    await writer.abort(error).catch(() => {});
    throw error;
  });
  let object: R2Object | "mismatch";
  try {
    object = await putChecked(bucket, `watch/${upload.id}.bin`, readable, upload.sha256);
  } finally {
    // After a stored file every byte was copied; otherwise this stops the copy.
    await writer.abort(new Error("put finished")).catch(() => {});
    await copying.catch(() => {});
  }
  if (object === "mismatch") {
    await deletePrefix(bucket, upload.prefix);
    return c.json({ error: "sha256_mismatch" }, 422);
  }
  // This upload's chunks and any left by an earlier, abandoned one of the same id.
  await deletePrefix(bucket, `${CHUNKS_PREFIX}${upload.id}/`);
  return c.json({ ok: true, sizeBytes: object.size, sha256: upload.sha256 }, 201);
});
