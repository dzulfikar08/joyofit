import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { AppContext, AppEnv } from "./env";
import { matchAcceptLanguage, serverT } from "./i18n";
import { STRAVA_BROKER_TIMEOUT_MS, STRAVA_STATE_TTL_S, STRAVA_WEBHOOK_BROKER_TIMEOUT_MS } from "./limits";

/**
 * Strava for JoyoFit: the phone uploads workouts straight to Strava. The Strava application is shared with JoyoRogo
 * and Strava keeps one token per athlete and application, so the tokens do not live here: JoyoRogo's Worker owns the
 * grant (`apps/server/src/strava.ts` in the joyorogo repo, `/internal/joyofit/strava/*`), and this Worker keeps what
 * has to stay on JoyoFit's host: the signed OAuth state, the callback that returns to the app, and Strava's
 * webhook (one subscription per application, so it points here and the deauthorization is forwarded). Strava sync is
 * free while slots are spare: the shared application has a fixed athlete capacity, and JoyoRogo manages it the same
 * way for every user (a slot opens again when an account stops using Strava for a while). This Worker only passes
 * JoyoRogo's `slotsFull` and `released` through and refuses to start an authorization it knows would be refused.
 * Strava data is never read, stored or forwarded; only the athlete id travels.
 *
 * - `GET  /v1/strava`             status (signed-in user)
 * - `GET  /v1/strava/authorize`   `{ url }` to open in a browser (signed-in user); `?gear=1` adds `profile:read_all`;
 *                                 409 `{ error: "slots_full" }` when not connected and every slot is taken
 *   (`GET /v1/strava` also carries `manualUpload`, from the `STRAVA_MANUAL_UPLOAD` var: the app offers the manual upload)
 * - `POST /v1/strava/token`       `{ accessToken, expiresAt, athleteId }`, refreshed by JoyoRogo (signed-in user)
 * - `POST /v1/strava/disconnect`  unlink JoyoFit; JoyoRogo revokes at Strava when nothing else uses the grant
 * - `GET  /strava/callback`       Strava's redirect; hands the code to JoyoRogo, redirects to the app (`joyofit://settings/strava`)
 * - `GET|POST /strava/webhook`    subscription validation / deauthorization events
 */

const STRAVA_OAUTH = "https://www.strava.com/oauth";
/** Strava scope that lets the app list the athlete's shoes and bikes (`GET /athlete`), to link them to JoyoFit's gear. */
const GEAR_SCOPE = "profile:read_all";

const scopeList = (scope: string) => scope.split(/[\s,]+/).filter(Boolean);
const APP_DEEP_LINK = "joyofit://settings/strava";

/** A callback request failed in a way the user can act on; `reason` ends up in the app deep link. */
class StravaFlowError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function configured(env: AppEnv): env is AppEnv & { STRAVA_CLIENT_SECRET: string } {
  return Boolean(env.STRAVA_CLIENT_ID) && Boolean(env.STRAVA_CLIENT_SECRET);
}

function requireConfigured(env: AppEnv): asserts env is AppEnv & { STRAVA_CLIENT_SECRET: string } {
  if (!configured(env)) throw new HTTPException(503, { message: "strava_not_configured" });
}

// ---------------------------------------------------------------------------------------------------------------------
// Signed OAuth state: `<base64url(json)>.<base64url(hmac)>`, so the callback (which carries no session cookie) knows
// which JoyoRogo user began the flow. The client secret is the HMAC key; nothing is stored.
// ---------------------------------------------------------------------------------------------------------------------

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signState(secret: string, userId: string, nowS: number): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: userId, exp: nowS + STRAVA_STATE_TTL_S })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), new TextEncoder().encode(payload));
  return `${payload}.${b64url(new Uint8Array(signature))}`;
}

/** The user id inside a state this Worker signed and that has not expired; null for anything else. */
export async function verifyState(secret: string, state: string, nowS: number): Promise<string | null> {
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), fromB64url(signature), new TextEncoder().encode(payload));
    if (!valid) return null;
    const parsed = z.object({ u: z.string().min(1), exp: z.number() }).safeParse(JSON.parse(new TextDecoder().decode(fromB64url(payload))));
    return parsed.success && parsed.data.exp > nowS ? parsed.data.u : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// JoyoRogo's grant API
// ---------------------------------------------------------------------------------------------------------------------

/**
 * One call to JoyoRogo's `/internal/joyofit/strava/<action>`, authenticated with the Strava application's own
 * credentials (HTTP Basic), through the `AUTH_SERVICE` binding when present. An unreachable JoyoRogo is a 502 here.
 */
async function brokerCall(
  env: AppEnv & { STRAVA_CLIENT_SECRET: string },
  action: string,
  body: unknown,
  timeoutMs: number = STRAVA_BROKER_TIMEOUT_MS,
): Promise<Response> {
  const url = `${env.JOYOROGO_AUTH_URL.replace(/\/+$/, "")}/internal/joyofit/strava/${action}`;
  const request: RequestInit = {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${env.STRAVA_CLIENT_ID}:${env.STRAVA_CLIENT_SECRET}`)}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  };
  try {
    return await (env.AUTH_SERVICE ? env.AUTH_SERVICE.fetch(url, request) : fetch(url, request));
  } catch (error) {
    throw new HTTPException(502, { message: `strava_unreachable: ${error instanceof Error ? error.message : String(error)}` });
  }
}

const statusSchema = z.object({
  connected: z.boolean(),
  athleteId: z.number().optional(),
  connectedAt: z.number().optional(),
  requestedScope: z.string().min(1),
  /** Not connected and may not connect now (capacity). Absent from an older JoyoRogo. */
  slotsFull: z.boolean().optional(),
  /** The last grant was released because the account had not used Strava for a while. */
  released: z.object({ at: z.number() }).optional(),
});

/** The capacity fields of a not-connected status, as the app reads them; absent fields stay absent. */
const slotFields = (status: z.infer<typeof statusSchema>) => ({
  ...(status.slotsFull === undefined ? {} : { slotsFull: status.slotsFull }),
  ...(status.released === undefined ? {} : { released: status.released }),
});

async function grantStatus(env: AppEnv & { STRAVA_CLIENT_SECRET: string }, userId: string): Promise<z.infer<typeof statusSchema>> {
  const response = await brokerCall(env, "status", { userId });
  if (!response.ok) {
    await response.body?.cancel();
    throw new HTTPException(502, { message: `strava_error_${response.status}` });
  }
  const parsed = statusSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(502, { message: "strava_bad_response" });
  return parsed.data;
}

const tokenSchema = z.object({ accessToken: z.string().min(1), expiresAt: z.number(), athleteId: z.number() });

/** Unlinks JoyoFit from the user's Strava grant. JoyoRogo revokes at Strava only when JoyoRogo is not using it too. */
async function unlink(env: AppEnv & { STRAVA_CLIENT_SECRET: string }, userId: string): Promise<{ revoked: boolean }> {
  const response = await brokerCall(env, "disconnect", { userId });
  if (!response.ok) {
    await response.body?.cancel();
    throw new HTTPException(502, { message: `strava_error_${response.status}` });
  }
  const parsed = z.object({ revoked: z.boolean() }).safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(502, { message: "strava_bad_response" });
  return parsed.data;
}

// ---------------------------------------------------------------------------------------------------------------------
// Signed-in routes (mounted under /v1/strava, after requireUser)
// ---------------------------------------------------------------------------------------------------------------------

export const strava = new Hono<AppContext>();

/**
 * Whether the app offers the manual Strava upload (a file the user uploads on strava.com themselves), the workaround for
 * everyone while Strava capacity is limited. Var `STRAVA_MANUAL_UPLOAD`: on unless it is exactly "off".
 */
const manualUpload = (env: AppEnv) => env.STRAVA_MANUAL_UPLOAD !== "off";

strava.get("/", async (c) => {
  if (!configured(c.env)) return c.json({ configured: false, connected: false, manualUpload: manualUpload(c.env) });
  const status = await grantStatus(c.env, c.get("user").id);
  if (!status.connected) return c.json({ configured: true, connected: false, ...slotFields(status), manualUpload: manualUpload(c.env) });
  // JoyoRogo's `requestedScope` is JoyoFit's own scope plus everything already granted, and JoyoFit's own never includes the
  // gear scope, so the gear scope is in it exactly when the athlete granted it.
  const gearScope = scopeList(status.requestedScope).includes(GEAR_SCOPE);
  return c.json({
    configured: true,
    connected: true,
    athleteId: status.athleteId,
    connectedAt: status.connectedAt,
    gearScope,
    manualUpload: manualUpload(c.env),
  });
});

strava.get("/authorize", async (c) => {
  requireConfigured(c.env);
  const userId = c.get("user").id;
  const state = await signState(c.env.STRAVA_CLIENT_SECRET, userId, nowSeconds());
  const redirectUri = `${new URL(c.req.url).origin}/strava/callback`;
  // JoyoRogo answers with JoyoFit's scope plus what the athlete already granted JoyoRogo, so connecting here never
  // narrows the grant JoyoRogo reads activities with.
  const { requestedScope, connected, slotsFull } = await grantStatus(c.env, userId);
  // JoyoRogo would refuse the exchange (and revoke the fresh grant), so do not send the user through Strava's page.
  // A connected user's re-authorization (`?gear=1`) holds a slot already.
  if (!connected && slotsFull) return c.json({ error: "slots_full" }, 409);
  // `?gear=1`: also ask for `profile:read_all` (the athlete's shoes and bikes), a second consent for an existing connection.
  const scope = c.req.query("gear") === "1" ? [...new Set([...scopeList(requestedScope), GEAR_SCOPE])].join(",") : requestedScope;
  const query = new URLSearchParams({
    client_id: c.env.STRAVA_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope,
    state,
  });
  // The mobile endpoint opens the Strava app when it is installed and falls back to the web page otherwise.
  return c.json({ url: `${STRAVA_OAUTH}/mobile/authorize?${query}` });
});

strava.post("/token", async (c) => {
  requireConfigured(c.env);
  const response = await brokerCall(c.env, "token", { userId: c.get("user").id });
  if (response.status === 409) {
    await response.body?.cancel();
    return c.json({ error: "strava_not_connected" }, 409);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HTTPException(502, { message: `strava_error_${response.status}` });
  }
  const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(502, { message: "strava_bad_response" });
  return c.json(parsed.data);
});

/** Account deletion: unlink JoyoFit from the Strava grant (revoking it when JoyoRogo does not use it). */
export async function dropStravaConnection(env: AppEnv, userId: string): Promise<void> {
  if (configured(env)) await unlink(env, userId);
}

strava.post("/disconnect", async (c) => {
  requireConfigured(c.env);
  const { revoked } = await unlink(c.env, c.get("user").id);
  return c.json({ connected: false, revoked });
});

// ---------------------------------------------------------------------------------------------------------------------
// Public routes (Strava calls these; no JoyoRogo session)
// ---------------------------------------------------------------------------------------------------------------------

export const stravaPublic = new Hono<AppContext>();

/** `request` only supplies the browser's language for the fallback page; the deep link is what the app reads. */
function appRedirect(request: Request, params: Record<string, string>): Response {
  const t = serverT(matchAcceptLanguage(request.headers.get("accept-language")));
  const location = `${APP_DEEP_LINK}?${new URLSearchParams(params)}`;
  const body =
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>JoyoFit</title><body style="font-family:system-ui;padding:2rem;text-align:center">` +
    `<p>${t("errors:strava.redirect.finish")}</p><p><a href="${location.replace(/&/g, "&amp;")}">${t("errors:strava.redirect.open")}</a></p>`;
  return new Response(body, { status: 302, headers: { location, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** How JoyoRogo's refusal of a code exchange reads in the app deep link. */
const EXCHANGE_FAILURE_REASON: Record<string, string> = {
  scope_missing: "scope_missing",
  unavailable: "strava_unreachable",
  slots_full: "slots_full",
};

stravaPublic.get("/callback", async (c) => {
  if (!configured(c.env)) return appRedirect(c.req.raw, { status: "error", reason: "not_configured" });
  const env = c.env;
  const q = c.req.query();
  try {
    const userId = q.state ? await verifyState(env.STRAVA_CLIENT_SECRET, q.state, nowSeconds()) : null;
    if (!userId) throw new StravaFlowError("invalid_state");
    if (q.error) throw new StravaFlowError(q.error === "access_denied" ? "access_denied" : "strava_error");
    if (!q.code) throw new StravaFlowError("no_code");

    // JoyoRogo exchanges the code and refuses a grant without `activity:write` (the athlete may uncheck "upload
    // activities" on Strava's page; then nothing works, and a grant nobody else uses is revoked there).
    let response: Response;
    try {
      response = await brokerCall(env, "exchange", { userId, code: q.code, callbackScope: q.scope });
    } catch {
      throw new StravaFlowError("strava_unreachable");
    }
    if (!response.ok) {
      const failure = z.object({ error: z.string() }).safeParse(await response.json().catch(() => null));
      throw new StravaFlowError((failure.success && EXCHANGE_FAILURE_REASON[failure.data.error]) || "exchange_failed");
    }
    await response.body?.cancel();
    return appRedirect(c.req.raw, { status: "connected" });
  } catch (error) {
    if (error instanceof StravaFlowError) return appRedirect(c.req.raw, { status: "error", reason: error.reason });
    throw error;
  }
});

/** Strava's subscription validation: echo `hub.challenge` when the verify token is the one the owner chose. */
stravaPublic.get("/webhook", (c) => {
  const expected = c.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  const q = c.req.query();
  if (!expected || q["hub.mode"] !== "subscribe" || q["hub.verify_token"] !== expected || !q["hub.challenge"]) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ "hub.challenge": q["hub.challenge"] });
});

const webhookEventSchema = z.object({
  object_type: z.string(),
  object_id: z.number(),
  aspect_type: z.string(),
  owner_id: z.number().optional(),
  updates: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Strava events. Only the deauthorization (`athlete` update with `authorized: "false"`) matters: it is forwarded to
 * JoyoRogo, which owns the tokens and deletes them for every product at once (and what JoyoRogo imported from
 * Strava). Activity events are acknowledged and ignored; JoyoFit never reads Strava activities. Strava wants a 200
 * within two seconds and retries otherwise, so anything unparseable is acknowledged, and a forward that fails is
 * answered with a 503 on purpose: the event is retried and the delete is idempotent.
 */
stravaPublic.post("/webhook", async (c) => {
  const parsed = webhookEventSchema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success && configured(c.env)) {
    const event = parsed.data;
    if (event.object_type === "athlete" && event.aspect_type === "update" && String(event.updates?.authorized) === "false") {
      const athleteId = event.owner_id ?? event.object_id;
      try {
        const response = await brokerCall(c.env, "deauthorized", { athleteId }, STRAVA_WEBHOOK_BROKER_TIMEOUT_MS);
        await response.body?.cancel();
        if (!response.ok) throw new Error(`JoyoRogo answered ${response.status}`);
      } catch (error) {
        console.error(JSON.stringify({ event: "strava_deauth_forward_failed", athleteId, message: error instanceof Error ? error.message : String(error) }));
        return c.json({ ok: false }, 503);
      }
    }
  }
  return c.json({ ok: true });
});
