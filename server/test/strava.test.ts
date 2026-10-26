import { describe, expect, it } from "vitest";

import { signState, verifyState } from "../src/strava";
import { call, grantApi, postJson, signUp } from "./helpers";

const SECRET = "test-client-secret";
const BASIC = `Basic ${btoa(`287873:${SECRET}`)}`;
const nowS = () => Math.floor(Date.now() / 1000);

/** JoyoRogo's grant API as it answers for a user who is not connected yet. */
function notConnected(requestedScope = "activity:write"): (action: string) => Response {
  return (action) => {
    if (action === "status") return Response.json({ connected: false, requestedScope });
    if (action === "exchange") return Response.json({ athleteId: 4242, scope: "activity:write" });
    return Response.json({});
  };
}

/** Runs the authorize + callback round trip for a user and returns the app deep link the callback redirected to. */
async function connect(cookie: string, query = "scope=read,activity:write") {
  const auth = await call("/v1/strava/authorize", { cookie });
  const { url } = (await auth.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  const callback = await call(`/strava/callback?code=abc&${query}&state=${state}`);
  return { callback, location: callback.headers.get("location") ?? "" };
}

describe("Strava OAuth state", () => {
  it("round-trips a signed state and rejects tampering, another key and expiry", async () => {
    const state = await signState(SECRET, "user-1", 1_000);
    expect(await verifyState(SECRET, state, 1_001)).toBe("user-1");
    expect(await verifyState("other-secret", state, 1_001)).toBeNull();
    expect(await verifyState(SECRET, state, 1_000 + 601)).toBeNull();
    const [payload, signature] = state.split(".");
    const forged = `${btoa(JSON.stringify({ u: "user-2", exp: 9_999_999_999 })).replace(/=+$/, "")}.${signature}`;
    expect(await verifyState(SECRET, forged, 1_001)).toBeNull();
    expect(await verifyState(SECRET, `${payload}`, 1_001)).toBeNull();
    expect(await verifyState(SECRET, "garbage", 1_001)).toBeNull();
  });
});

describe("Strava connect", () => {
  it("needs a JoyoRogo session, and is free: a non-Founder account can connect", async () => {
    expect((await call("/v1/strava")).status).toBe(401);
    expect((await call("/v1/strava/authorize")).status).toBe(401);
    expect((await postJson("/v1/strava/token", {})).status).toBe(401);
    expect((await postJson("/v1/strava/disconnect", {})).status).toBe(401);
    expect(grantApi.calls).toHaveLength(0);

    grantApi.handler = notConnected();
    const { cookie } = signUp("free", { founder: false });
    const { location } = await connect(cookie);
    expect(location).toBe("joyofit://settings/strava?status=connected");
  });

  it("builds an authorize URL with the scope JoyoRogo asks for, the client id and a callback on the Worker's own origin", async () => {
    grantApi.handler = notConnected("activity:write");
    const { user, cookie } = signUp("alice");
    const response = await call("/v1/strava/authorize", { cookie });
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://www.strava.com/oauth/mobile/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("287873");
    expect(parsed.searchParams.get("scope")).toBe("activity:write");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://api.test/strava/callback");
    expect(url).not.toContain(SECRET);
    expect(grantApi.calls.map((c) => [c.action, c.body])).toEqual([["status", { userId: user.id }]]);
  });

  it("keeps the scope an athlete already granted JoyoRogo in the authorize URL, so connecting here never narrows it", async () => {
    grantApi.handler = notConnected("activity:write,read,activity:read_all");
    const { cookie } = signUp("rogo-user");
    const { url } = (await (await call("/v1/strava/authorize", { cookie })).json()) as { url: string };
    expect(new URL(url).searchParams.get("scope")).toBe("activity:write,read,activity:read_all");
  });

  it("hands the code to JoyoRogo for the user that began the flow, with the Strava credentials as Basic auth", async () => {
    grantApi.handler = notConnected();
    const { user, cookie } = signUp("bob");
    const { location } = await connect(cookie);
    expect(location).toBe("joyofit://settings/strava?status=connected");

    const exchange = grantApi.calls.find((c) => c.action === "exchange");
    expect(exchange?.body).toEqual({ userId: user.id, code: "abc", callbackScope: "read,activity:write" });
    expect(exchange?.headers.get("authorization")).toBe(BASIC);
  });

  it("words the fallback page in the browser's language (Indonesian when it names none we ship)", async () => {
    const page = async (acceptLanguage?: string) => (await call("/strava/callback?code=abc", { headers: acceptLanguage ? { "accept-language": acceptLanguage } : {} })).text();
    expect(await page("en-US,en;q=0.9")).toContain("Return to JoyoFit to finish.");
    expect(await page("id-ID,id;q=0.9,en;q=0.5")).toContain("Kembali ke JoyoFit untuk menyelesaikan.");
    expect(await page("fr")).toContain("Kembali ke JoyoFit untuk menyelesaikan.");
    expect(await page()).toContain("Buka JoyoFit");
  });

  it("refuses a callback with a forged, missing or expired state and asks JoyoRogo for nothing", async () => {
    grantApi.handler = notConnected();
    const forged = await call("/strava/callback?code=abc&scope=activity:write&state=forged.sig");
    expect(forged.headers.get("location")).toBe("joyofit://settings/strava?status=error&reason=invalid_state");
    const none = await call("/strava/callback?code=abc");
    expect(none.headers.get("location")).toBe("joyofit://settings/strava?status=error&reason=invalid_state");
    const expired = await signState(SECRET, "user-x", nowS() - 10_000);
    const late = await call(`/strava/callback?code=abc&state=${expired}`);
    expect(late.headers.get("location")).toBe("joyofit://settings/strava?status=error&reason=invalid_state");
    expect(grantApi.calls).toHaveLength(0);
  });

  it("reports access_denied without asking JoyoRogo", async () => {
    const state = await signState(SECRET, "user-y", nowS());
    const response = await call(`/strava/callback?error=access_denied&state=${state}`);
    expect(response.headers.get("location")).toBe("joyofit://settings/strava?status=error&reason=access_denied");
    expect(grantApi.calls).toHaveLength(0);
  });

  it.each([
    [422, { error: "scope_missing" }, "scope_missing"],
    [422, { error: "rejected" }, "exchange_failed"],
    [502, { error: "unavailable" }, "strava_unreachable"],
    [409, { error: "slots_full", reason: "reserved_for_paid" }, "slots_full"],
    [500, { error: "boom" }, "exchange_failed"],
  ])("maps JoyoRogo's %i %j answer to the app reason %s", async (status, body, reason) => {
    const state = await signState(SECRET, "user-z", nowS());
    grantApi.handler = () => Response.json(body, { status });
    const response = await call(`/strava/callback?code=abc&scope=read&state=${state}`);
    expect(response.headers.get("location")).toBe(`joyofit://settings/strava?status=error&reason=${reason}`);
  });

  it("reports strava_unreachable when JoyoRogo cannot be reached at all", async () => {
    const state = await signState(SECRET, "user-w", nowS());
    grantApi.handler = () => {
      throw new Error("network down");
    };
    const response = await call(`/strava/callback?code=abc&state=${state}`);
    expect(response.headers.get("location")).toBe("joyofit://settings/strava?status=error&reason=strava_unreachable");
  });

  it("answers 503 when the Strava secret is not set", async () => {
    const { cookie } = signUp("dave");
    const status = await call("/v1/strava", { cookie, env: { STRAVA_CLIENT_SECRET: "" } });
    expect(await status.json()).toEqual({ configured: false, connected: false });
    expect((await call("/v1/strava/authorize", { cookie, env: { STRAVA_CLIENT_SECRET: "" } })).status).toBe(503);
    const token = await call("/v1/strava/token", { method: "POST", cookie, env: { STRAVA_CLIENT_SECRET: "" } });
    expect(token.status).toBe(503);
    expect(grantApi.calls).toHaveLength(0);
  });
});

describe("Strava status", () => {
  it("reports what JoyoRogo knows, and nothing secret", async () => {
    grantApi.handler = () => Response.json({ connected: true, athleteId: 4242, connectedAt: 1_700_000_000, requestedScope: "activity:write" });
    const { user, cookie } = signUp("sam");
    const status = (await (await call("/v1/strava", { cookie })).json()) as Record<string, unknown>;
    expect(status).toEqual({ configured: true, connected: true, athleteId: 4242, connectedAt: 1_700_000_000, gearScope: false });
    expect(grantApi.calls[0]?.body).toEqual({ userId: user.id });
  });

  it("says the gear scope is granted when JoyoRogo's requested scope carries it", async () => {
    grantApi.handler = () => Response.json({ connected: true, athleteId: 4242, connectedAt: 1, requestedScope: "activity:write,profile:read_all" });
    const { cookie } = signUp("gina");
    expect(await (await call("/v1/strava", { cookie })).json()).toMatchObject({ connected: true, gearScope: true });
  });

  it("asks for profile:read_all on top of the granted scope only with ?gear=1", async () => {
    grantApi.handler = notConnected("activity:write,read,activity:read_all");
    const { cookie } = signUp("hana");
    const plain = (await (await call("/v1/strava/authorize", { cookie })).json()) as { url: string };
    expect(new URL(plain.url).searchParams.get("scope")).toBe("activity:write,read,activity:read_all");
    const gear = (await (await call("/v1/strava/authorize?gear=1", { cookie })).json()) as { url: string };
    expect(new URL(gear.url).searchParams.get("scope")).toBe("activity:write,read,activity:read_all,profile:read_all");
    grantApi.handler = notConnected("activity:write,profile:read_all");
    const again = (await (await call("/v1/strava/authorize?gear=1", { cookie })).json()) as { url: string };
    expect(new URL(again.url).searchParams.get("scope")).toBe("activity:write,profile:read_all");
  });

  it("is not connected when JoyoRogo says so, including a JoyoRogo-only grant without the upload scope", async () => {
    grantApi.handler = notConnected();
    const { cookie } = signUp("tess");
    expect(await (await call("/v1/strava", { cookie })).json()).toEqual({ configured: true, connected: false });
  });

  it("answers 502 when JoyoRogo's grant API fails, instead of claiming a disconnect", async () => {
    grantApi.handler = () => new Response("down", { status: 500 });
    const { cookie } = signUp("uma");
    expect((await call("/v1/strava", { cookie })).status).toBe(502);
  });

  it("passes JoyoRogo's slot fields through while not connected", async () => {
    const released = { at: 1_790_000_000, reason: "released_for_pro" };
    grantApi.handler = () => Response.json({ connected: false, requestedScope: "activity:write", slotsFull: true, slotsReason: "reserved_for_paid", released });
    const { cookie } = signUp("vera");
    expect(await (await call("/v1/strava", { cookie })).json()).toEqual({ configured: true, connected: false, slotsFull: true, slotsReason: "reserved_for_paid", released });
  });

  it("refuses to start an authorization when JoyoRogo says no slot is open, but not a connected user's re-authorization", async () => {
    grantApi.handler = () => Response.json({ connected: false, requestedScope: "activity:write", slotsFull: true, slotsReason: "full" });
    const { cookie } = signUp("wade");
    const refused = await call("/v1/strava/authorize", { cookie });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "slots_full", reason: "full" });
    grantApi.handler = () => Response.json({ connected: true, athleteId: 1, connectedAt: 1, requestedScope: "activity:write", slotsFull: true, slotsReason: "full" });
    expect((await call("/v1/strava/authorize?gear=1", { cookie })).status).toBe(200);
    grantApi.handler = () => Response.json({ connected: false, requestedScope: "activity:write", slotsFull: false });
    expect((await call("/v1/strava/authorize", { cookie })).status).toBe(200);
  });
});

describe("Strava access token for the phone", () => {
  it("is 409 while not connected", async () => {
    grantApi.handler = () => Response.json({ error: "strava_not_connected" }, { status: 409 });
    const { cookie } = signUp("erin");
    const response = await postJson("/v1/strava/token", {}, cookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "strava_not_connected" });
  });

  it("returns JoyoRogo's access token for the caller only, and nothing else it might have sent", async () => {
    grantApi.handler = () => Response.json({ accessToken: "acc-1", expiresAt: nowS() + 21_600, athleteId: 4242, refreshToken: "ref-1" });
    const { user, cookie } = signUp("frank");
    const response = await postJson("/v1/strava/token", {}, cookie);
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ accessToken: "acc-1", athleteId: 4242 });
    expect(JSON.stringify(json)).not.toContain("ref-1");
    expect(grantApi.calls).toHaveLength(1);
    expect(grantApi.calls[0]).toMatchObject({ action: "token", body: { userId: user.id } });
  });

  it("answers 502 when Strava or JoyoRogo is down", async () => {
    grantApi.handler = () => Response.json({ error: "strava_unavailable" }, { status: 502 });
    const { cookie } = signUp("ivan");
    expect((await postJson("/v1/strava/token", {}, cookie)).status).toBe(502);
  });
});

describe("Strava disconnect", () => {
  it("unlinks JoyoFit and says whether the grant was revoked at Strava", async () => {
    const { user, cookie } = signUp("lena");
    grantApi.handler = () => Response.json({ revoked: true });
    expect(await (await postJson("/v1/strava/disconnect", {}, cookie)).json()).toEqual({ connected: false, revoked: true });
    expect(grantApi.calls[0]).toMatchObject({ action: "disconnect", body: { userId: user.id } });

    // JoyoRogo still uses the grant: it stays, and the app is told nothing was revoked.
    grantApi.handler = () => Response.json({ revoked: false });
    expect(await (await postJson("/v1/strava/disconnect", {}, cookie)).json()).toEqual({ connected: false, revoked: false });
  });

  it("fails loudly instead of pretending when JoyoRogo cannot unlink", async () => {
    const { cookie } = signUp("milo");
    grantApi.handler = () => new Response("down", { status: 503 });
    expect((await postJson("/v1/strava/disconnect", {}, cookie)).status).toBe(502);
  });
});

describe("Strava webhook", () => {
  const query = "hub.mode=subscribe&hub.challenge=15f7d1a9&hub.verify_token=test-verify-token";
  const deauthorization = (athleteId: number) => ({
    aspect_type: "update",
    event_time: nowS(),
    object_id: athleteId,
    object_type: "athlete",
    owner_id: athleteId,
    subscription_id: 1,
    updates: { authorized: "false" },
  });

  it("echoes hub.challenge for the right verify token only", async () => {
    const ok = await call(`/strava/webhook?${query}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ "hub.challenge": "15f7d1a9" });
    expect((await call("/strava/webhook?hub.mode=subscribe&hub.challenge=x&hub.verify_token=nope")).status).toBe(403);
    expect((await call(`/strava/webhook?${query}`, { env: { STRAVA_WEBHOOK_VERIFY_TOKEN: "" } })).status).toBe(403);
  });

  it("forwards a deauthorization to JoyoRogo, which owns the tokens of every product", async () => {
    grantApi.handler = () => Response.json({ dropped: 1 });
    const response = await postJson("/strava/webhook", deauthorization(111));
    expect(response.status).toBe(200);
    expect(grantApi.calls).toHaveLength(1);
    expect(grantApi.calls[0]).toMatchObject({ action: "deauthorized", body: { athleteId: 111 } });
    expect(grantApi.calls[0]?.headers.get("authorization")).toBe(BASIC);
  });

  it("answers 503 when the forward fails, so Strava retries the event", async () => {
    grantApi.handler = () => new Response("down", { status: 500 });
    expect((await postJson("/strava/webhook", deauthorization(111))).status).toBe(503);
    grantApi.handler = () => {
      throw new Error("network down");
    };
    expect((await postJson("/strava/webhook", deauthorization(111))).status).toBe(503);
  });

  it("acknowledges and ignores activity events, other athlete updates and garbage", async () => {
    const activity = await postJson("/strava/webhook", { aspect_type: "update", object_id: 9, object_type: "activity", owner_id: 333, updates: { title: "x" } });
    expect(activity.status).toBe(200);
    const profile = await postJson("/strava/webhook", { aspect_type: "update", object_id: 333, object_type: "athlete", owner_id: 333, updates: { authorized: "true" } });
    expect(profile.status).toBe(200);
    const garbage = await call("/strava/webhook", { method: "POST", body: "not json" });
    expect(garbage.status).toBe(200);
    expect(grantApi.calls).toHaveLength(0);
  });
});
