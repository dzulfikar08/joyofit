import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { AppContext, AppEnv } from "./env";
import { matchAcceptLanguage, serverT } from "./i18n";
import { HUAWEI_HEALTH_TIMEOUT_MS } from "./limits";
import { signState, verifyState } from "./strava";

/**
 * Huawei Health Service Kit (cloud REST API) for JoyoFit, lab feature (docs/huawei-health-kit.md "Sync from the cloud API").
 * The user signs in with HUAWEI ID on Huawei's web page; this Worker exchanges the code with the client secret, keeps the
 * refresh token (AES-GCM encrypted, key `HUAWEI_HEALTH_TOKEN_KEY`) and hands the phone a one-hour access token. The phone
 * reads the user's workouts and steps from Health Kit itself; no Huawei Health data passes through or is stored here.
 *
 * Same split as Strava (docs/strava.md): the client secret and the long-lived grant stay on the server, the phone only
 * ever holds a short-lived access token. Huawei's refresh call needs the client secret, so a refresh token kept on the
 * phone would have to travel to the server on every refresh anyway.
 *
 * - `GET  /v1/huawei-health`             status (signed-in user)
 * - `GET  /v1/huawei-health/authorize`   `{ url }` of HUAWEI ID's authorization page
 * - `POST /v1/huawei-health/token`       `{ accessToken, expiresAt, clientId, scope }`; 409 when there is no (valid) grant
 * - `POST /v1/huawei-health/disconnect`  revokes the grant at Huawei (best effort) and deletes it here
 * - `GET  /huawei-health/callback`       HUAWEI ID's redirect; exchanges the code, redirects to `joyofit://settings/huawei-health`
 *
 * Unconfigured (no `HUAWEI_HEALTH_CLIENT_ID` var or no `HUAWEI_HEALTH_CLIENT_SECRET` / `HUAWEI_HEALTH_TOKEN_KEY` secret):
 * status says `configured: false` and the other routes answer 503.
 */

/** Huawei's OAuth 2.0 server (Health Kit "Authentication" guide). */
const OAUTH = "https://oauth-login.cloud.huawei.com/oauth2/v3";
/** Default Health Kit host; a user of another site is answered 403 / 121001 with the right host in `Location`. */
const HEALTH_API = "https://health-api.cloud.huawei.com";
const APP_DEEP_LINK = "joyofit://settings/huawei-health";

/**
 * Scopes asked for. `openid` is required by HUAWEI ID. The rest is what the sync reads and nothing more (Huawei's review
 * refuses scopes the app does not use): workout summaries, the workout details (heart rate, speed, cadence, altitude),
 * the workout route, step details, and one year of history before the authorization.
 */
export const HUAWEI_HEALTH_SCOPES = [
  "openid",
  "https://www.huawei.com/healthkit/activityrecord.read",
  "https://www.huawei.com/healthkit/activity.read",
  "https://www.huawei.com/healthkit/location.read",
  "https://www.huawei.com/healthkit/step.read",
  "https://www.huawei.com/healthkit/historydata.open.year",
] as const;

type Configured = AppEnv & { HUAWEI_HEALTH_CLIENT_ID: string; HUAWEI_HEALTH_CLIENT_SECRET: string; HUAWEI_HEALTH_TOKEN_KEY: string };

function configured(env: AppEnv): env is Configured {
  return Boolean(env.HUAWEI_HEALTH_CLIENT_ID) && Boolean(env.HUAWEI_HEALTH_CLIENT_SECRET) && Boolean(env.HUAWEI_HEALTH_TOKEN_KEY);
}

function requireConfigured(env: AppEnv): asserts env is Configured {
  if (!configured(env)) throw new HTTPException(503, { message: "huawei_health_not_configured" });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------------------------------------------------
// Refresh tokens at rest: AES-GCM with a key derived (SHA-256) from the HUAWEI_HEALTH_TOKEN_KEY secret.
// Stored as `<base64url(iv)>.<base64url(ciphertext)>`.
// ---------------------------------------------------------------------------------------------------------------------

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealToken(secret: string, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(token));
  return `${b64url(iv)}.${b64url(new Uint8Array(sealed))}`;
}

/** The token inside `sealed`, or null when it was sealed with another key or is damaged. */
export async function openToken(secret: string, sealed: string): Promise<string | null> {
  const [iv, data, extra] = sealed.split(".");
  if (!iv || !data || extra !== undefined) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await aesKey(secret), fromB64url(data));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Huawei calls
// ---------------------------------------------------------------------------------------------------------------------

const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  scope: z.string().optional(),
  refresh_token: z.string().min(1).optional(),
});
const tokenError = z.object({ error: z.union([z.number(), z.string()]).optional(), sub_error: z.union([z.number(), z.string()]).optional() });

/** Huawei refused the refresh token for good (1203 / 11205 or 31204: expired, password changed, signed out): the user must authorize again. */
class GrantGoneError extends Error {}

async function oauthToken(env: Configured, form: Record<string, string>): Promise<z.infer<typeof tokenResponse>> {
  let response: Response;
  try {
    response = await fetch(`${OAUTH}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ ...form, client_id: env.HUAWEI_HEALTH_CLIENT_ID, client_secret: env.HUAWEI_HEALTH_CLIENT_SECRET }),
      signal: AbortSignal.timeout(HUAWEI_HEALTH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new HTTPException(502, { message: `huawei_unreachable: ${error instanceof Error ? error.message : String(error)}` });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = tokenError.safeParse(body);
    const code = failure.success ? `${failure.data.error ?? ""}/${failure.data.sub_error ?? ""}` : String(response.status);
    console.error(JSON.stringify({ event: "huawei_health_token_failed", grant: form.grant_type, status: response.status, code }));
    // Errors and Troubleshooting (Account Kit): 1203 is an expired or unparseable refresh token; 1101/1103 a bad or used code.
    if (failure.success && String(failure.data.error) === "1203") throw new GrantGoneError(code);
    throw new HTTPException(502, { message: `huawei_token_${code}` });
  }
  const parsed = tokenResponse.safeParse(body);
  if (!parsed.success) throw new HTTPException(502, { message: "huawei_bad_response" });
  return parsed.data;
}

/**
 * `DELETE /healthkit/v2/consents/{appId}?deleteData=false` (Canceling Authorization Granted to an App), following one
 * cross-site 403 / 121001 to the host in `Location`. True when Huawei accepted it.
 */
async function revokeAtHuawei(env: Configured, accessToken: string): Promise<boolean> {
  const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "x-client-id": env.HUAWEI_HEALTH_CLIENT_ID };
  let url = `${HEALTH_API}/healthkit/v2/consents/${encodeURIComponent(env.HUAWEI_HEALTH_CLIENT_ID)}?deleteData=false`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, { method: "DELETE", headers, redirect: "manual", signal: AbortSignal.timeout(HUAWEI_HEALTH_TIMEOUT_MS) });
    const location = crossSiteLocation(response.status, response.headers.get("location"), await response.json().catch(() => null));
    if (location && attempt === 0) {
      url = location;
      continue;
    }
    return response.ok;
  }
  return false;
}

/** The Health Kit URL to repeat a request at when Huawei answered 403 / 121001 ("request forbidden due to site cross"); null otherwise. */
export function crossSiteLocation(status: number, location: string | null, body: unknown): string | null {
  if (status !== 403 || !location) return null;
  const code = z.object({ error: z.object({ code: z.coerce.number() }) }).safeParse(body);
  if (!code.success || code.data.error.code !== 121001) return null;
  try {
    const url = new URL(location);
    // Only ever send the user's access token to a Health Kit host.
    // Same list as the app (src/features/huaweihealth/api.ts): `com` default, `eu` in Huawei's FAQ, `asia` and `ru` Huawei's other sites.
    return url.protocol === "https:" && url.port === "" && /^health-api\.cloud\.huawei\.(com|eu|asia|ru)$/.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------------------------------

interface ConnectionRow {
  refresh_token: string;
  scope: string;
  connected_at: number;
}

const readConnection = (env: AppEnv, userId: string) =>
  env.DB.prepare("SELECT refresh_token, scope, connected_at FROM huawei_health_connection WHERE user_id = ?1").bind(userId).first<ConnectionRow>();

const deleteConnection = (env: AppEnv, userId: string) => env.DB.prepare("DELETE FROM huawei_health_connection WHERE user_id = ?1").bind(userId).run();

/** A fresh access token for the user's grant, storing the new refresh token when Huawei rotates it; null when there is no usable grant. */
async function accessTokenFor(env: Configured, userId: string): Promise<{ accessToken: string; expiresAt: number; scope: string } | null> {
  const row = await readConnection(env, userId);
  if (!row) return null;
  const refreshToken = await openToken(env.HUAWEI_HEALTH_TOKEN_KEY, row.refresh_token);
  if (!refreshToken) {
    // Sealed with a key that is no longer set: unusable, so the user connects again.
    await deleteConnection(env, userId);
    return null;
  }
  let fresh: z.infer<typeof tokenResponse>;
  try {
    fresh = await oauthToken(env, { grant_type: "refresh_token", refresh_token: refreshToken });
  } catch (error) {
    if (error instanceof GrantGoneError) {
      await deleteConnection(env, userId);
      return null;
    }
    throw error;
  }
  const scope = fresh.scope ?? row.scope;
  if (fresh.refresh_token || scope !== row.scope) {
    const sealed = fresh.refresh_token ? await sealToken(env.HUAWEI_HEALTH_TOKEN_KEY, fresh.refresh_token) : row.refresh_token;
    await env.DB.prepare("UPDATE huawei_health_connection SET refresh_token = ?2, scope = ?3, updated_at = ?4 WHERE user_id = ?1")
      .bind(userId, sealed, scope, nowSeconds())
      .run();
  }
  return { accessToken: fresh.access_token, expiresAt: nowSeconds() + fresh.expires_in, scope };
}

/** Account deletion: revoke at Huawei when possible and forget the grant. Never fails the deletion over Huawei. */
export async function dropHuaweiHealthConnection(env: AppEnv, userId: string): Promise<void> {
  if (configured(env)) {
    try {
      const token = await accessTokenFor(env, userId);
      if (token) await revokeAtHuawei(env, token.accessToken);
    } catch (error) {
      console.error(JSON.stringify({ event: "huawei_health_revoke_failed", message: error instanceof Error ? error.message : String(error) }));
    }
  }
  await deleteConnection(env, userId);
}

const scopeList = (scope: string) => scope.split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------------------------------------------------------------
// Signed-in routes (mounted under /v1/huawei-health, after requireUser)
// ---------------------------------------------------------------------------------------------------------------------

export const huaweiHealth = new Hono<AppContext>();

huaweiHealth.get("/", async (c) => {
  if (!configured(c.env)) return c.json({ configured: false, connected: false });
  const row = await readConnection(c.env, c.get("user").id);
  if (!row) return c.json({ configured: true, connected: false });
  return c.json({ configured: true, connected: true, connectedAt: row.connected_at, scope: scopeList(row.scope) });
});

huaweiHealth.get("/authorize", async (c) => {
  requireConfigured(c.env);
  const state = await signState(c.env.HUAWEI_HEALTH_CLIENT_SECRET, c.get("user").id, nowSeconds());
  const query = new URLSearchParams({
    response_type: "code",
    client_id: c.env.HUAWEI_HEALTH_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/huawei-health/callback`,
    scope: HUAWEI_HEALTH_SCOPES.join(" "),
    state,
    // offline: the token answer carries a refresh token, so the user signs in once.
    access_type: "offline",
    display: "touch",
  });
  return c.json({ url: `${OAUTH}/authorize?${query}` });
});

huaweiHealth.post("/token", async (c) => {
  requireConfigured(c.env);
  const token = await accessTokenFor(c.env, c.get("user").id);
  if (!token) return c.json({ error: "huawei_health_not_connected" }, 409);
  return c.json({ accessToken: token.accessToken, expiresAt: token.expiresAt, clientId: c.env.HUAWEI_HEALTH_CLIENT_ID, scope: scopeList(token.scope) });
});

huaweiHealth.post("/disconnect", async (c) => {
  requireConfigured(c.env);
  const userId = c.get("user").id;
  let revoked = false;
  try {
    const token = await accessTokenFor(c.env, userId);
    if (token) revoked = await revokeAtHuawei(c.env, token.accessToken);
  } catch (error) {
    console.error(JSON.stringify({ event: "huawei_health_revoke_failed", message: error instanceof Error ? error.message : String(error) }));
  }
  await deleteConnection(c.env, userId);
  return c.json({ connected: false, revoked });
});

// ---------------------------------------------------------------------------------------------------------------------
// Public route (HUAWEI ID redirects the browser here; no JoyoRogo session)
// ---------------------------------------------------------------------------------------------------------------------

export const huaweiHealthPublic = new Hono<AppContext>();

function appRedirect(request: Request, params: Record<string, string>): Response {
  const t = serverT(matchAcceptLanguage(request.headers.get("accept-language")));
  const location = `${APP_DEEP_LINK}?${new URLSearchParams(params)}`;
  const body =
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>JoyoFit</title><body style="font-family:system-ui;padding:2rem;text-align:center">` +
    `<p>${t("errors:strava.redirect.finish")}</p><p><a href="${location.replace(/&/g, "&amp;")}">${t("errors:strava.redirect.open")}</a></p>`;
  return new Response(body, { status: 302, headers: { location, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

huaweiHealthPublic.get("/callback", async (c) => {
  if (!configured(c.env)) return appRedirect(c.req.raw, { status: "error", reason: "not_configured" });
  const env = c.env;
  const q = c.req.query();
  const userId = q.state ? await verifyState(env.HUAWEI_HEALTH_CLIENT_SECRET, q.state, nowSeconds()) : null;
  if (!userId) return appRedirect(c.req.raw, { status: "error", reason: "invalid_state" });
  if (q.error) return appRedirect(c.req.raw, { status: "error", reason: q.error === "access_denied" ? "access_denied" : "huawei_error" });
  if (!q.code) return appRedirect(c.req.raw, { status: "error", reason: "no_code" });

  let token: z.infer<typeof tokenResponse>;
  try {
    token = await oauthToken(env, { grant_type: "authorization_code", code: q.code, redirect_uri: `${new URL(c.req.url).origin}/huawei-health/callback` });
  } catch {
    return appRedirect(c.req.raw, { status: "error", reason: "exchange_failed" });
  }
  // access_type=offline was asked for; without a refresh token the connection would end within the hour.
  if (!token.refresh_token) return appRedirect(c.req.raw, { status: "error", reason: "exchange_failed" });
  const now = nowSeconds();
  await env.DB.prepare(
    `INSERT INTO huawei_health_connection (user_id, refresh_token, scope, connected_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(user_id) DO UPDATE SET refresh_token = excluded.refresh_token, scope = excluded.scope, updated_at = excluded.updated_at`,
  )
    .bind(userId, await sealToken(env.HUAWEI_HEALTH_TOKEN_KEY, token.refresh_token), token.scope ?? "", now)
    .run();
  return appRedirect(c.req.raw, { status: "connected" });
});
