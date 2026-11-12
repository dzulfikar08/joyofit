import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { identitySignature, meMessage } from "../src/feedback";
import { aturApi, call, postJson, signUp } from "./helpers";

const SECRET = "test-atur-identify-secret";

describe("GET /v1/feedback/identity", () => {
  it("requires a session", async () => {
    expect((await call("/v1/feedback/identity", { env: { ATUR_IDENTIFY_SECRET: SECRET } })).status).toBe(401);
  });

  it("answers 503 when the board secret is not set", async () => {
    const { cookie } = signUp("nosecret");
    const response = await call("/v1/feedback/identity", { cookie, env: { ATUR_IDENTIFY_SECRET: undefined } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "feedback_not_configured" });
  });

  it("signs id and lowercased email the way Atur checks them", async () => {
    const { user, cookie } = signUp("Ana");
    const response = await call("/v1/feedback/identity", { cookie, env: { ATUR_IDENTIFY_SECRET: SECRET } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as { id: string; email: string; name: string | null; signature: string };
    const email = user.email.toLowerCase();
    expect(body).toEqual({
      id: user.id,
      email,
      name: user.name,
      signature: createHmac("sha256", SECRET).update(`${user.id}:${email}`).digest("hex"),
    });
  });

  it("lowercases the email before signing", async () => {
    expect(await identitySignature(SECRET, "u1", "Ana@Example.COM")).toBe(
      createHmac("sha256", SECRET).update("u1:ana@example.com").digest("hex"),
    );
  });
});

describe("/v1/feedback relay to Atur's signed-in API", () => {
  const ITEM = "0b6f3c2e-1a2b-4c3d-8e9f-0123456789ab";

  it("requires a session", async () => {
    expect((await call("/v1/feedback/board")).status).toBe(401);
  });

  it("signs each call as the account (me:id:email:expires, 2 minutes) and returns Atur's answer", async () => {
    const { user, cookie } = signUp("Rina");
    aturApi.handler = () => Response.json({ board: { title: "JoyoFit" }, items: [] });
    const before = Math.floor(Date.now() / 1000);
    const res = await call("/v1/feedback/board", { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ board: { title: "JoyoFit" }, items: [] });
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const sent = aturApi.calls[0]!;
    expect(sent.url).toBe("https://atur.test/api/feedback/pk_fb_test/me/board");
    expect(sent.method).toBe("GET");
    const email = user.email.toLowerCase();
    const expires = Number(sent.headers.get("x-atur-expires"));
    expect(expires).toBeGreaterThanOrEqual(before + 110);
    expect(expires).toBeLessThanOrEqual(before + 130);
    expect(sent.headers.get("x-atur-user-id")).toBe(user.id);
    expect(sent.headers.get("x-atur-user-email")).toBe(email);
    expect(decodeURIComponent(sent.headers.get("x-atur-user-name")!)).toBe("Rina");
    expect(sent.headers.get("x-atur-signature")).toBe(
      createHmac("sha256", SECRET).update(meMessage(user.id, email, expires)).digest("hex"),
    );
    // The session cookie never goes to Atur.
    expect(sent.headers.get("cookie")).toBeNull();
  });

  it("relays votes, comments, reports, tickets and the changelog, with the ticket's project", async () => {
    const { cookie } = signUp("Dewi");
    aturApi.handler = (url, method) => Response.json({ path: url.pathname, method, project: url.searchParams.get("project") }, { status: method === "POST" ? 201 : 200 });
    expect((await call(`/v1/feedback/items/${ITEM}`, { cookie })).status).toBe(200);
    expect((await call(`/v1/feedback/items/${ITEM}/votes`, { method: "POST", cookie })).status).toBe(201);
    expect((await postJson(`/v1/feedback/items/${ITEM}/comments`, { body: "Setuju", extra: "dropped" }, cookie)).status).toBe(201);
    expect((await call("/v1/feedback/reports", { cookie })).status).toBe(200);
    const project = "a10d50f0-4920-47d1-9a61-c0c0ff504f0c";
    expect(await (await call(`/v1/feedback/tickets/12?project=${project}`, { cookie })).json()).toMatchObject({ path: "/api/feedback/pk_fb_test/me/tickets/12", project });
    expect((await postJson("/v1/feedback/tickets/12/comments", { body: "Ini file FIT-nya" }, cookie)).status).toBe(201);
    expect((await call("/v1/feedback/changelog", { cookie })).status).toBe(200);
    expect(aturApi.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      `GET /api/feedback/pk_fb_test/me/items/${ITEM}`,
      `POST /api/feedback/pk_fb_test/me/items/${ITEM}/votes`,
      `POST /api/feedback/pk_fb_test/me/items/${ITEM}/comments`,
      "GET /api/feedback/pk_fb_test/me/reports",
      "GET /api/feedback/pk_fb_test/me/tickets/12",
      "POST /api/feedback/pk_fb_test/me/tickets/12/comments",
      "GET /api/feedback/pk_fb_test/me/changelog",
    ]);
    // Only `{ body }` is forwarded.
    expect(JSON.parse(aturApi.calls[2]!.body!)).toEqual({ body: "Setuju" });
  });

  it("relays nothing outside the list, and checks comment bodies first", async () => {
    const { cookie } = signUp("Budi");
    aturApi.handler = () => Response.json({});
    for (const [method, path] of [
      ["GET", "/v1/feedback/items"],
      ["GET", "/v1/feedback/items/not-a-uuid"],
      ["POST", "/v1/feedback/board"],
      ["GET", "/v1/feedback/tickets/0"],
      ["GET", "/v1/feedback/tickets/1/../../items"],
      ["GET", "/v1/feedback/me/board"],
      ["POST", "/v1/feedback/identity"],
    ] as const) {
      expect((await call(path, { method, cookie })).status, `${method} ${path}`).toBe(404);
    }
    expect((await postJson(`/v1/feedback/items/${ITEM}/comments`, { body: "  " }, cookie)).status).toBe(400);
    expect((await postJson(`/v1/feedback/items/${ITEM}/comments`, { body: "x".repeat(4001) }, cookie)).status).toBe(400);
    expect(aturApi.calls).toHaveLength(0);
  });

  it("passes Atur's 4xx through and turns its 5xx or a network error into 502", async () => {
    const { cookie } = signUp("Sari");
    aturApi.handler = () => Response.json({ error: "Ticket not found", message: "Ticket not found" }, { status: 404 });
    const notFound = await call("/v1/feedback/tickets/9", { cookie });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toMatchObject({ error: "Ticket not found" });
    aturApi.handler = () => new Response("boom", { status: 500 });
    expect((await call("/v1/feedback/board", { cookie })).status).toBe(502);
    aturApi.handler = () => {
      throw new TypeError("network");
    };
    expect(await (await call("/v1/feedback/board", { cookie })).json()).toEqual({ error: "feedback_unavailable" });
  });

  it("answers 503 when Atur is not configured", async () => {
    const { cookie } = signUp("Nina");
    expect((await call("/v1/feedback/board", { cookie, env: { ATUR_BOARD_TOKEN: undefined } })).status).toBe(503);
  });
});
