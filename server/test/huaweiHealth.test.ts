import { describe, expect, it } from "vitest";

import { crossSiteLocation, HUAWEI_HEALTH_SCOPES, openToken, sealToken } from "../src/huaweiHealth";
import { call, env, grantApi, huaweiApi, postJson, signUp } from "./helpers";

const SECRET = "test-huawei-secret";
const TOKEN_KEY = "test-huawei-token-key";

/** Huawei answering the code exchange, refreshes and revokes like the documented examples (Health Kit "Authentication"). */
function huaweiOk({ refreshError = false, crossSiteRevoke = false } = {}) {
  return async (url: URL, method: string, body: string | null) => {
    if (url.hostname === "oauth-login.cloud.huawei.com" && url.pathname === "/oauth2/v3/token") {
      const form = new URLSearchParams(body ?? "");
      if (form.get("grant_type") === "authorization_code") {
        return Response.json({
          access_token: "AT-1",
          expires_in: 3600,
          id_token: "jwt",
          refresh_token: "RT-1",
          scope: "openid https://www.huawei.com/healthkit/activityrecord.read https://www.huawei.com/healthkit/step.read",
          token_type: "Bearer",
        });
      }
      if (refreshError) return Response.json({ sub_error: 11205, error_description: "refresh token expired", error: 1203 }, { status: 400 });
      return Response.json({ access_token: "AT-2", expires_in: 3600, scope: "openid https://www.huawei.com/healthkit/step.read", token_type: "Bearer" });
    }
    if (method === "DELETE" && url.pathname === "/healthkit/v2/consents/123456789") {
      if (crossSiteRevoke && url.hostname === "health-api.cloud.huawei.com") {
        return Response.json(
          { error: { code: 121001, message: "request forbidden due to site cross" } },
          { status: 403, headers: { location: "https://health-api.cloud.huawei.eu/healthkit/v2/consents/123456789?deleteData=false" } },
        );
      }
      return new Response(null, { status: 200 });
    }
    throw new Error(`unexpected Huawei call ${method} ${url}`);
  };
}

/** Runs authorize + callback for a user; returns the app deep link the callback redirected to. */
async function connect(cookie: string, query = "code=CODE%2Fwith%2Bslash") {
  const { url } = (await (await call("/v1/huawei-health/authorize", { cookie })).json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  const callback = await call(`/huawei-health/callback?${query}&state=${state}`);
  return { url, location: callback.headers.get("location") ?? "" };
}

describe("token sealing", () => {
  it("round-trips, and another key or a damaged value opens to null", async () => {
    const sealed = await sealToken(TOKEN_KEY, "refresh-token");
    expect(sealed).not.toContain("refresh-token");
    expect(await openToken(TOKEN_KEY, sealed)).toBe("refresh-token");
    expect(await openToken("other-key", sealed)).toBeNull();
    expect(await openToken(TOKEN_KEY, `${sealed}x`)).toBeNull();
    expect(await openToken(TOKEN_KEY, "garbage")).toBeNull();
  });
});

describe("cross-site redirect (403 / 121001)", () => {
  const body = { error: { code: 121001, message: "request forbidden due to site cross" } };
  it("follows the Location of a Health Kit host only", () => {
    expect(crossSiteLocation(403, "https://health-api.cloud.huawei.eu/healthkit/v2/sampleSet:polymerize", body)).toBe(
      "https://health-api.cloud.huawei.eu/healthkit/v2/sampleSet:polymerize",
    );
    expect(crossSiteLocation(403, "https://evil.example/healthkit", body)).toBeNull();
    expect(crossSiteLocation(403, "https://health-api.cloud.huawei.com.evil.example/x", body)).toBeNull();
    expect(crossSiteLocation(403, "http://health-api.cloud.huawei.eu/x", body)).toBeNull();
    expect(crossSiteLocation(403, "https://health-api.cloud.huawei.eu/x", { error: { code: 1 } })).toBeNull();
    expect(crossSiteLocation(401, "https://health-api.cloud.huawei.eu/x", body)).toBeNull();
  });
});

describe("Huawei Health connect", () => {
  it("needs a JoyoRogo session", async () => {
    expect((await call("/v1/huawei-health")).status).toBe(401);
    expect((await call("/v1/huawei-health/authorize")).status).toBe(401);
    expect((await postJson("/v1/huawei-health/token", {})).status).toBe(401);
    expect((await postJson("/v1/huawei-health/disconnect", {})).status).toBe(401);
  });

  it("says not configured and refuses the flow without the client secret", async () => {
    const { cookie } = signUp("noconf");
    const unset = { HUAWEI_HEALTH_CLIENT_SECRET: undefined };
    expect(await (await call("/v1/huawei-health", { cookie, env: unset })).json()).toEqual({ configured: false, connected: false });
    expect((await call("/v1/huawei-health/authorize", { cookie, env: unset })).status).toBe(503);
    expect((await call("/huawei-health/callback?code=x&state=y", { env: unset })).headers.get("location")).toBe(
      "joyofit://settings/huawei-health?status=error&reason=not_configured",
    );
  });

  it("builds the documented authorize URL: openid plus the read scopes, offline, touch, callback on the Worker", async () => {
    const { cookie } = signUp("auth");
    const { url } = (await (await call("/v1/huawei-health/authorize", { cookie })).json()) as { url: string };
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://oauth-login.cloud.huawei.com/oauth2/v3/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("123456789");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://api.test/huawei-health/callback");
    expect(parsed.searchParams.get("scope")).toBe(HUAWEI_HEALTH_SCOPES.join(" "));
    expect(parsed.searchParams.get("scope")?.split(" ")[0]).toBe("openid");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("display")).toBe("touch");
    expect(url).not.toContain(SECRET);
    // Spaces are encoded as `+` exactly like the guide's example.
    expect(url).toContain("scope=openid+https%3A%2F%2Fwww.huawei.com%2Fhealthkit%2Factivityrecord.read+");
  });

  it("exchanges the code on the server, stores only the sealed refresh token, and hands out fresh access tokens", async () => {
    huaweiApi.handler = huaweiOk();
    const { user, cookie } = signUp("ok");
    const { location } = await connect(cookie);
    expect(location).toBe("joyofit://settings/huawei-health?status=connected");

    const exchange = huaweiApi.calls[0]!;
    const form = new URLSearchParams(exchange.body ?? "");
    expect(exchange.url).toBe("https://oauth-login.cloud.huawei.com/oauth2/v3/token");
    expect(exchange.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "authorization_code",
      code: "CODE/with+slash",
      redirect_uri: "https://api.test/huawei-health/callback",
      client_id: "123456789",
      client_secret: SECRET,
    });

    const row = await env.DB.prepare("SELECT refresh_token, scope FROM huawei_health_connection WHERE user_id = ?1").bind(user.id).first<{ refresh_token: string; scope: string }>();
    expect(row?.refresh_token).not.toContain("RT-1");
    expect(await openToken(TOKEN_KEY, row!.refresh_token)).toBe("RT-1");

    const status = (await (await call("/v1/huawei-health", { cookie })).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ configured: true, connected: true, scope: ["openid", "https://www.huawei.com/healthkit/activityrecord.read", "https://www.huawei.com/healthkit/step.read"] });

    const token = await postJson("/v1/huawei-health/token", {}, cookie);
    expect(token.status).toBe(200);
    const body = (await token.json()) as { accessToken: string; expiresAt: number; clientId: string; scope: string[] };
    expect(body.accessToken).toBe("AT-2");
    expect(body.clientId).toBe("123456789");
    expect(body.scope).toEqual(["openid", "https://www.huawei.com/healthkit/step.read"]);
    expect(body.expiresAt).toBeGreaterThan(Date.now() / 1000 + 3000);
    const refresh = new URLSearchParams(huaweiApi.calls.at(-1)!.body ?? "");
    expect(refresh.get("grant_type")).toBe("refresh_token");
    expect(refresh.get("refresh_token")).toBe("RT-1");
    expect(Object.keys(body).sort()).toEqual(["accessToken", "clientId", "expiresAt", "scope"]);
  });

  it("returns refusals and bad states to the app without storing anything", async () => {
    huaweiApi.handler = huaweiOk();
    const { user, cookie } = signUp("refuse");
    expect((await connect(cookie, "error=access_denied")).location).toBe("joyofit://settings/huawei-health?status=error&reason=access_denied");
    expect((await call("/huawei-health/callback?code=x&state=forged")).headers.get("location")).toBe(
      "joyofit://settings/huawei-health?status=error&reason=invalid_state",
    );
    expect(await env.DB.prepare("SELECT 1 FROM huawei_health_connection WHERE user_id = ?1").bind(user.id).first()).toBeNull();
    expect(huaweiApi.calls).toHaveLength(0);
  });

  it("forgets a grant Huawei says expired (1203) and answers 409 so the app asks to connect again", async () => {
    huaweiApi.handler = huaweiOk();
    const { user, cookie } = signUp("expired");
    await connect(cookie);
    huaweiApi.handler = huaweiOk({ refreshError: true });
    const response = await postJson("/v1/huawei-health/token", {}, cookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "huawei_health_not_connected" });
    expect(await env.DB.prepare("SELECT 1 FROM huawei_health_connection WHERE user_id = ?1").bind(user.id).first()).toBeNull();
  });

  it("disconnect revokes at Huawei (following the cross-site Location) and deletes the grant", async () => {
    huaweiApi.handler = huaweiOk({ crossSiteRevoke: true });
    const { user, cookie } = signUp("bye");
    await connect(cookie);
    const response = await postJson("/v1/huawei-health/disconnect", {}, cookie);
    expect(await response.json()).toEqual({ connected: false, revoked: true });
    const deletes = huaweiApi.calls.filter((c) => c.method === "DELETE").map((c) => c.url);
    expect(deletes).toEqual([
      "https://health-api.cloud.huawei.com/healthkit/v2/consents/123456789?deleteData=false",
      "https://health-api.cloud.huawei.eu/healthkit/v2/consents/123456789?deleteData=false",
    ]);
    expect(huaweiApi.calls.filter((c) => c.method === "DELETE").every((c) => c.headers.get("authorization") === "Bearer AT-2")).toBe(true);
    expect(await env.DB.prepare("SELECT 1 FROM huawei_health_connection WHERE user_id = ?1").bind(user.id).first()).toBeNull();
    expect(await (await call("/v1/huawei-health", { cookie })).json()).toEqual({ configured: true, connected: false });
  });

  it("account deletion drops the grant", async () => {
    huaweiApi.handler = huaweiOk();
    grantApi.handler = () => Response.json({ revoked: false });
    const { user, cookie } = signUp("gone");
    await connect(cookie);
    expect((await call("/v1/account", { method: "DELETE", cookie })).status).toBe(200);
    expect(huaweiApi.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(await env.DB.prepare("SELECT 1 FROM huawei_health_connection WHERE user_id = ?1").bind(user.id).first()).toBeNull();
  });
});
