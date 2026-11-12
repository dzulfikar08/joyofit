import { Hono } from "hono";

import type { AppContext } from "./env";

/**
 * `GET /v1/feedback/identity`: who the signed-in person is, signed for Atur's feedback widget (docs/feedback.md).
 *
 * The JoyoFit web app loads Atur's widget (`app.diatur.com/widget.js`, board of the FIT project) and passes this to
 * `Atur.identify()`. Atur trusts the email only when `signature = hex(HMAC-SHA256(secret, id + ":" + lowercased email))`
 * with the board's identify secret, so a JoyoFit account files reports and support tickets under its own email without
 * an Atur sign-in. The secret never leaves this Worker. Unset secret = 503 (the widget then asks for an email instead).
 */
export const feedback = new Hono<AppContext>();

export async function identitySignature(secret: string, id: string, email: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${id}:${email.toLowerCase()}`));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
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
