import { Hono } from "hono";

import { requireFounder } from "./access";
import type { AppContext } from "./env";
import { DEFAULT_MAX_IMPORT_BYTES, IMPORT_LIST_LIMIT } from "./limits";

/** Raw uploads (the Huawei export's browser-made import file, docs/huawei-web-import.md in the app repo). Stored untouched in R2, never parsed here; the phone downloads it and deletes it. Mounted under `/v1`, behind `requireUser`. */
export const imports = new Hono<AppContext>();

export function cleanFilename(raw: string | undefined): string | null {
  if (!raw) return null;
  const name = raw.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().slice(0, 255);
  return name === "" ? null : name;
}

interface ImportRow {
  id: string;
  status: string;
  filename: string | null;
  content_type: string | null;
  size: number | null;
  created_at: number;
}

const toJson = (row: ImportRow) => ({
  id: row.id,
  status: row.status,
  filename: row.filename,
  contentType: row.content_type,
  size: row.size,
  createdAt: row.created_at,
});

/**
 * POST /v1/imports?filename=export.zip — the body is the file, streamed straight into R2 (never buffered).
 * Founder only (402 otherwise). `Content-Length` is required: R2 needs the size of a stream up front, and it enforces MAX_IMPORT_BYTES.
 */
imports.post("/", requireFounder, async (c) => {
  const user = c.get("user");
  const max = Number(c.env.MAX_IMPORT_BYTES) || DEFAULT_MAX_IMPORT_BYTES;
  const declared = c.req.header("content-length");
  const length = declared === undefined ? NaN : Number(declared);
  if (!Number.isInteger(length)) return c.json({ error: "content_length_required" }, 411);
  if (length <= 0) return c.json({ error: "empty_body" }, 400);
  if (length > max) return c.json({ error: "too_large", maxBytes: max }, 413);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "empty_body" }, 400);

  const id = crypto.randomUUID();
  const key = `imports/${user.id}/${id}`;
  const filename = cleanFilename(c.req.query("filename"));
  const contentType = c.req.header("content-type") ?? "application/octet-stream";
  const createdAt = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO imports (id, user_id, r2_key, status, filename, content_type, size, created_at)
     VALUES (?1, ?2, ?3, 'uploading', ?4, ?5, NULL, ?6)`,
  )
    .bind(id, user.id, key, filename, contentType, createdAt)
    .run();

  try {
    const object = await c.env.IMPORTS.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: { userId: user.id, ...(filename ? { filename } : {}) },
    });
    if (object.size !== length) throw new Error(`stored ${object.size} bytes, expected ${length}`);
    await c.env.DB.prepare("UPDATE imports SET status = 'uploaded', size = ?2 WHERE id = ?1").bind(id, object.size).run();
  } catch (error) {
    console.error(JSON.stringify({ event: "import_failed", id, message: error instanceof Error ? error.message : String(error) }));
    // Best effort: the row stays as the record that the upload failed.
    await c.env.IMPORTS.delete(key).catch(() => undefined);
    await c.env.DB.prepare("UPDATE imports SET status = 'failed' WHERE id = ?1").bind(id).run();
    return c.json({ error: "upload_failed", id }, 500);
  }
  return c.json({ id, status: "uploaded", filename, contentType, size: length, createdAt }, 201);
});

/** The caller's imports, newest first. */
imports.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, status, filename, content_type, size, created_at FROM imports
     WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2`,
  )
    .bind(c.get("user").id, IMPORT_LIST_LIMIT)
    .all<ImportRow>();
  return c.json({ imports: results.map(toJson) });
});

/**
 * The stored file, streamed from R2, for the phone to apply. Signed in only (no Pro gate: data is never locked in).
 * `404` for a missing id, another user's row, or an upload that did not finish.
 */
imports.get("/:id/file", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    `SELECT id, status, filename, content_type, size, created_at, r2_key FROM imports WHERE id = ?1 AND user_id = ?2 AND status = 'uploaded'`,
  )
    .bind(c.req.param("id"), user.id)
    .first<ImportRow & { r2_key: string }>();
  const object = row ? await c.env.IMPORTS.get(row.r2_key) : null;
  if (!row || !object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": row.content_type ?? "application/octet-stream",
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-store",
    },
  });
});

/** Removes the caller's R2 object and row (the phone calls it once it has applied the file); `404` when the id is not the caller's. */
imports.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT r2_key FROM imports WHERE id = ?1 AND user_id = ?2").bind(id, user.id).first<{ r2_key: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  await c.env.IMPORTS.delete(row.r2_key);
  await c.env.DB.prepare("DELETE FROM imports WHERE id = ?1 AND user_id = ?2").bind(id, user.id).run();
  return c.json({ deleted: true });
});
