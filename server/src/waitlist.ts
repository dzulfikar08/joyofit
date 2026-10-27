import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { tokenMatches } from "./auth";
import type { AppContext } from "./env";
import { WAITLIST_MAX_BODY_BYTES, WAITLIST_MAX_ENTRIES, WAITLIST_MAX_PER_HOUR } from "./limits";

export const WAITLIST_ORIGIN = "https://fit.joyorogo.com";
const HOUR_MS = 3_600_000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const bodySchema = z.object({
  kind: z.enum(["strava", "iphone"]),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email()),
  stravaProfile: optionalText(200),
  watchModel: optionalText(100),
  note: optionalText(500),
  /** Honeypot: hidden from people in the form; bots fill it. */
  website: z.string().max(500).nullish(),
});

/** SHA-256 hex of the client IP and the hour, so a stored hash is useless once its hour has passed. */
async function ipHash(ip: string, hour: number): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`joyofit-waitlist|${hour}|${ip}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Counts this request against the caller's hour; true when it is within the limit. */
async function withinRateLimit(db: D1Database, ip: string, now: number): Promise<boolean> {
  const hour = Math.floor(now / HOUR_MS);
  const hash = await ipHash(ip, hour);
  const [, counted] = await db.batch([
    db.prepare("DELETE FROM waitlist_rate WHERE hour < ?1").bind(hour - 2),
    db
      .prepare(
        "INSERT INTO waitlist_rate (ip_hash, hour, hits) VALUES (?1, ?2, 1) ON CONFLICT (ip_hash, hour) DO UPDATE SET hits = hits + 1 RETURNING hits",
      )
      .bind(hash, hour),
  ]);
  const hits = (counted?.results[0] as { hits: number } | undefined)?.hits ?? 1;
  return hits <= WAITLIST_MAX_PER_HOUR;
}

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > WAITLIST_MAX_BODY_BYTES) throw new HTTPException(413, { message: "too_large" });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > WAITLIST_MAX_BODY_BYTES) throw new HTTPException(413, { message: "too_large" });
  try {
    return JSON.parse(text);
  } catch {
    throw new HTTPException(400, { message: "invalid_json" });
  }
}

export const waitlist = new Hono<AppContext>();

waitlist.use(
  "*",
  cors({ origin: WAITLIST_ORIGIN, allowMethods: ["POST", "OPTIONS"], allowHeaders: ["content-type"], maxAge: 86_400 }),
);

waitlist.post("/", async (c) => {
  const body = bodySchema.safeParse(await readBody(c.req.raw));
  const now = Date.now();
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await withinRateLimit(c.env.DB, ip, now))) {
    c.header("retry-after", String(Math.ceil((HOUR_MS - (now % HOUR_MS)) / 1000)));
    return c.json({ error: "rate_limited" }, 429);
  }
  if (!body.success) return c.json({ error: "invalid_body", fields: body.error.issues.map((i) => i.path.join(".")) }, 400);
  const entry = body.data;
  // A bot that filled the hidden field gets the normal answer and nothing is stored.
  if (entry.website) return c.json({ ok: true });
  const stored = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM waitlist").first<{ n: number }>();
  if ((stored?.n ?? 0) >= WAITLIST_MAX_ENTRIES) return c.json({ error: "waitlist_full" }, 503);
  await c.env.DB.prepare(
    `INSERT INTO waitlist (kind, email, strava_profile, watch_model, note, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?6)
     ON CONFLICT (kind, email) DO UPDATE SET
       strava_profile = COALESCE(excluded.strava_profile, strava_profile),
       watch_model = COALESCE(excluded.watch_model, watch_model),
       note = COALESCE(excluded.note, note),
       updated_at = excluded.updated_at`,
  )
    .bind(entry.kind, entry.email, entry.stravaProfile, entry.watchModel, entry.note, now)
    .run();
  return c.json({ ok: true });
});

/** Owner only: `Authorization: Bearer <WAITLIST_ADMIN_TOKEN>`. Optional `?kind=strava|iphone` and `?status=`. */
waitlist.get("/", async (c) => {
  const expected = c.env.WAITLIST_ADMIN_TOKEN;
  if (!expected) return c.json({ error: "waitlist_not_configured" }, 503);
  const given = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
  if (!given || !(await tokenMatches(given, expected))) return c.json({ error: "unauthorized" }, 401);
  const kind = c.req.query("kind");
  if (kind !== undefined && kind !== "strava" && kind !== "iphone") return c.json({ error: "invalid_kind" }, 400);
  const status = c.req.query("status") ?? null;
  const { results } = await c.env.DB.prepare(
    `SELECT kind, email, strava_profile AS stravaProfile, watch_model AS watchModel, note, status,
            created_at AS createdAt, updated_at AS updatedAt
       FROM waitlist
      WHERE (?1 IS NULL OR kind = ?1) AND (?2 IS NULL OR status = ?2)
      ORDER BY created_at`,
  )
    .bind(kind ?? null, status)
    .all();
  return c.json({ count: results.length, entries: results });
});
