import { describe, expect, it } from "vitest";

import { call, env, signUp } from "./helpers";

interface ImportJson {
  id: string;
  status: string;
  size: number;
  filename: string | null;
}

describe("POST /v1/imports", () => {
  it("streams the file into R2 and records a row", async () => {
    const { user, cookie } = signUp("alice");
    const payload = new Uint8Array(5000).map((_, i) => i % 251);
    const response = await call("/v1/imports?filename=huawei-export.zip", {
      method: "POST",
      body: payload,
      headers: { "content-type": "application/zip", "content-length": String(payload.byteLength) },
      cookie,
    });
    expect(response.status).toBe(201);
    const json = (await response.json()) as ImportJson;
    expect(json).toMatchObject({ status: "uploaded", size: 5000, filename: "huawei-export.zip" });

    const row = await env.DB.prepare("SELECT user_id, r2_key, status, size FROM imports WHERE id = ?1")
      .bind(json.id)
      .first<{ user_id: string; r2_key: string; status: string; size: number }>();
    expect(row).toMatchObject({ user_id: user.id, status: "uploaded", size: 5000 });
    expect(row?.r2_key).toBe(`imports/${user.id}/${json.id}`);
    const object = await env.IMPORTS.get(row?.r2_key ?? "");
    expect(object?.httpMetadata?.contentType).toBe("application/zip");
    expect(new Uint8Array((await object?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(payload);
  });

  it("requires a Content-Length and enforces the size limit", async () => {
    const { cookie } = signUp("alice");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const noLength = await call("/v1/imports", { method: "POST", body: stream, duplex: "half", cookie } as RequestInit & { cookie: string });
    expect(noLength.status).toBe(411);

    const tooLarge = await call("/v1/imports", {
      method: "POST",
      body: new Uint8Array(20),
      headers: { "content-length": "20" },
      cookie,
      env: { MAX_IMPORT_BYTES: "10" },
    });
    expect(tooLarge.status).toBe(413);

    const empty = await call("/v1/imports", { method: "POST", headers: { "content-length": "0" }, cookie });
    expect(empty.status).toBe(400);
  });

  it("lists only the caller's imports", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    const upload = (cookie: string, name: string) =>
      call(`/v1/imports?filename=${name}`, { method: "POST", body: new Uint8Array(4), headers: { "content-length": "4" }, cookie });
    await upload(alice.cookie, "a.zip");
    await upload(bob.cookie, "b.zip");
    const list = (await (await call("/v1/imports", { cookie: alice.cookie })).json()) as { imports: ImportJson[] };
    expect(list.imports.map((i) => i.filename)).toEqual(["a.zip"]);
  });
});

describe("GET /v1/imports/:id/file and DELETE /v1/imports/:id", () => {
  const upload = async (cookie: string, body: Uint8Array, contentType: string) => {
    const response = await call("/v1/imports?filename=joyofit-import.ndjson.gz", {
      method: "POST",
      body,
      headers: { "content-type": contentType, "content-length": String(body.byteLength) },
      cookie,
    });
    return ((await response.json()) as ImportJson).id;
  };

  it("streams the caller's file with its content type and length", async () => {
    const { cookie } = signUp("alice");
    const payload = new Uint8Array(3000).map((_, i) => (i * 7) % 251);
    const id = await upload(cookie, payload, "application/x-joyofit-import+gzip");
    const response = await call(`/v1/imports/${id}/file`, { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-joyofit-import+gzip");
    expect(response.headers.get("content-length")).toBe("3000");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload);
  });

  it("answers 404 for a missing id and for another user's import, for both routes", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    const id = await upload(alice.cookie, new Uint8Array(8), "application/x-joyofit-import+gzip");
    expect((await call("/v1/imports/nope/file", { cookie: alice.cookie })).status).toBe(404);
    expect((await call(`/v1/imports/${id}/file`, { cookie: bob.cookie })).status).toBe(404);
    expect((await call(`/v1/imports/${id}`, { method: "DELETE", cookie: bob.cookie })).status).toBe(404);
    expect((await call("/v1/imports/nope", { method: "DELETE", cookie: alice.cookie })).status).toBe(404);
    // Bob's attempts left Alice's file alone.
    expect((await call(`/v1/imports/${id}/file`, { cookie: alice.cookie })).status).toBe(200);
  });

  it("deletes the R2 object and the row", async () => {
    const { user, cookie } = signUp("alice");
    const id = await upload(cookie, new Uint8Array(8), "application/x-joyofit-import+gzip");
    const response = await call(`/v1/imports/${id}`, { method: "DELETE", cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(await env.IMPORTS.get(`imports/${user.id}/${id}`)).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM imports WHERE id = ?1").bind(id).first()).toBeNull();
    expect((await call(`/v1/imports/${id}/file`, { cookie })).status).toBe(404);
    expect((await call(`/v1/imports/${id}`, { method: "DELETE", cookie })).status).toBe(404);
  });

  it("needs a session", async () => {
    expect((await call("/v1/imports/x/file")).status).toBe(401);
    expect((await call("/v1/imports/x", { method: "DELETE" })).status).toBe(401);
  });
});
