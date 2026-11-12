import { Hono } from "hono";
import { z } from "zod";

import type { AppContext } from "./env";

/**
 * JoyoFit web's feedback page (`/issues`, docs/feedback.md) as the signed-in account: the FIT project's Atur board (ideas,
 * votes, comments), the account's reports and tickets, the changelog, and filing a report or idea from the page's own form.
 * Every call is relayed to Atur's signed-in API with a short-lived signature made with the board's identify secret
 * (ATUR_IDENTIFY_SECRET, never sent to a browser). No Atur account, code or widget.
 */
export const feedback = new Hono<AppContext>();

/** How long a relayed request's signature is good for (Atur accepts at most 300 s ahead). */
const ME_TTL_SEC = 120;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SEQ = "[1-9][0-9]{0,8}";
/** The Atur `/me` routes the page may reach, and whether they take a `{ body }` comment. Nothing else is relayed. */
const ME_ROUTES: readonly { method: "GET" | "POST"; path: RegExp; comment?: true; item?: true }[] = [
  { method: "GET", path: /^board$/ },
  { method: "POST", path: /^items$/, item: true },
  { method: "GET", path: new RegExp(`^items/${UUID}$`) },
  { method: "POST", path: new RegExp(`^items/${UUID}/votes$`) },
  { method: "POST", path: new RegExp(`^items/${UUID}/comments$`), comment: true },
  { method: "GET", path: /^reports$/ },
  { method: "GET", path: new RegExp(`^tickets/${SEQ}$`) },
  { method: "POST", path: new RegExp(`^tickets/${SEQ}/comments$`), comment: true },
  { method: "GET", path: /^changelog$/ },
];
const MAX_COMMENT_CHARS = 4000;
/** A report or idea from the page's own form; only these fields go to Atur, which checks them again. */
const itemSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().max(4000).optional(),
  kind: z.enum(["idea", "bug", "question"]),
  attachment_ids: z.array(z.string().uuid()).max(5).optional(),
  context: z
    .object({
      url: z.string().max(1000).optional(),
      user_agent: z.string().max(500).optional(),
      viewport: z.string().max(30).optional(),
      app_version: z.string().max(64).optional(),
      platform: z.string().max(32).optional(),
    })
    .optional(),
});
const MAX_COMMENT_BODY_BYTES = 32 * 1024;

export function meMessage(id: string, email: string, expires: number): string {
  return `me:${id}:${email.toLowerCase()}:${expires}`;
}

/**
 * `/v1/feedback/<board|items|items/..|reports|tickets/..|changelog>`: JoyoFit web's feedback page (`/issues`) reads and writes the
 * FIT board as the signed-in account. Each call goes to Atur's signed-in API (`/api/feedback/<token>/me/*`) with a fresh
 * 2-minute signature over `me:<id>:<email>:<expires>`; the browser never holds anything that opens Atur. Atur's answer
 * (status and JSON) comes back as is; Atur unreachable is 502 `feedback_unavailable`.
 */
feedback.on(["GET", "POST"], "/:path{.+}", async (c) => {
  const path = c.req.param("path");
  const method = c.req.method as "GET" | "POST";
  const route = ME_ROUTES.find((r) => r.method === method && r.path.test(path));
  if (!route) return c.json({ error: "not_found" }, 404);
  const { ATUR_IDENTIFY_SECRET: secret, ATUR_ORIGIN: origin, ATUR_BOARD_TOKEN: token } = c.env;
  if (!secret || !origin || !token) return c.json({ error: "feedback_not_configured" }, 503);

  let body: string | undefined;
  if (route.item) {
    const raw = await c.req.text();
    if (raw.length > MAX_COMMENT_BODY_BYTES) return c.json({ error: "too_large" }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    const item = itemSchema.safeParse(parsed);
    if (!item.success) return c.json({ error: "invalid_body" }, 400);
    body = JSON.stringify(item.data);
  } else if (route.comment) {
    const raw = await c.req.text();
    if (raw.length > MAX_COMMENT_BODY_BYTES) return c.json({ error: "too_large" }, 413);
    let text: unknown;
    try {
      text = (JSON.parse(raw) as { body?: unknown }).body;
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof text !== "string" || !text.trim() || text.length > MAX_COMMENT_CHARS) return c.json({ error: "invalid_body" }, 400);
    body = JSON.stringify({ body: text });
  }

  const user = c.get("user");
  const email = user.email.toLowerCase();
  const expires = Math.floor(Date.now() / 1000) + ME_TTL_SEC;
  const signature = await hmacHex(secret, meMessage(user.id, email, expires));
  const url = new URL(`${origin.replace(/\/+$/, "")}/api/feedback/${encodeURIComponent(token)}/me/${path}`);
  const project = c.req.query("project");
  if (project && /^[0-9a-f-]{36}$/.test(project)) url.searchParams.set("project", project);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        "x-atur-user-id": user.id,
        "x-atur-user-email": email,
        ...(user.name ? { "x-atur-user-name": encodeURIComponent(user.name) } : {}),
        "x-atur-expires": String(expires),
        "x-atur-signature": signature,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "feedback_relay_failed", path, message: String(error) }));
    return c.json({ error: "feedback_unavailable" }, 502);
  }
  if (response.status >= 500) {
    console.error(JSON.stringify({ event: "feedback_relay_upstream", path, status: response.status }));
    return c.json({ error: "feedback_unavailable" }, 502);
  }
  const data = await response.json().catch(() => ({}));
  c.header("cache-control", "private, no-store");
  return c.json(data as Record<string, unknown>, response.status as 200);
});

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}
