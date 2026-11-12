import { Hono } from "hono";

import type { AppContext } from "./env";

/**
 * `GET /v1/feedback/identity`: who the signed-in person is, signed for Atur's feedback widget (docs/feedback.md).
 *
 * The JoyoFit web app loads Atur's widget (`app.diatur.com/widget.js`, board of the FIT project) and passes this to
 * `Atur.identify()`. Atur trusts the email only when `signature = hex(HMAC-SHA256(secret, id + ":" + lowercased email))`
 * with the board's identify secret, so a JoyoFit account files reports and support tickets under its own email without
 * an Atur sign-in. The secret never leaves this Worker. Unset secret = 503 (the widget then asks for an email instead).
 * The rest of this router relays JoyoFit web's feedback page to Atur (below).
 */
export const feedback = new Hono<AppContext>();

export function identitySignature(secret: string, id: string, email: string): Promise<string> {
  return hmacHex(secret, `${id}:${email.toLowerCase()}`);
}

feedback.get("/identity", async (c) => {
  const secret = c.env.ATUR_IDENTIFY_SECRET;
  if (!secret) return c.json({ error: "feedback_not_configured" }, 503);
  const user = c.get("user");
  const email = user.email.toLowerCase();
  const signature = await identitySignature(secret, user.id, email);
  c.header("cache-control", "private, no-store");
  return c.json({ id: user.id, email, name: user.name, signature });
});

/** How long a relayed request's signature is good for (Atur accepts at most 300 s ahead). */
const ME_TTL_SEC = 120;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SEQ = "[1-9][0-9]{0,8}";
/** The Atur `/me` routes the page may reach, and whether they take a `{ body }` comment. Nothing else is relayed. */
const ME_ROUTES: readonly { method: "GET" | "POST"; path: RegExp; comment?: true }[] = [
  { method: "GET", path: /^board$/ },
  { method: "GET", path: new RegExp(`^items/${UUID}$`) },
  { method: "POST", path: new RegExp(`^items/${UUID}/votes$`) },
  { method: "POST", path: new RegExp(`^items/${UUID}/comments$`), comment: true },
  { method: "GET", path: /^reports$/ },
  { method: "GET", path: new RegExp(`^tickets/${SEQ}$`) },
  { method: "POST", path: new RegExp(`^tickets/${SEQ}/comments$`), comment: true },
  { method: "GET", path: /^changelog$/ },
];
const MAX_COMMENT_CHARS = 4000;
const MAX_COMMENT_BODY_BYTES = 32 * 1024;

export function meMessage(id: string, email: string, expires: number): string {
  return `me:${id}:${email.toLowerCase()}:${expires}`;
}

/**
 * `/v1/feedback/<board|items/..|reports|tickets/..|changelog>`: JoyoFit web's feedback page (`/issues`) reads and writes the
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
  if (route.comment) {
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
