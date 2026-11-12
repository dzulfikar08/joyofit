import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { identitySignature } from "../src/feedback";
import { call, signUp } from "./helpers";

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
