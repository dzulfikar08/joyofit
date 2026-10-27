import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { MAPS_CATALOG_KEY } from "../src/maps";
import { MAPS_MAX_BODY_BYTES } from "../src/mapsPublish";
import { call } from "./helpers";

const KEY = "k".repeat(64);
const ID = "2000000000000007571";
const ENTRY = {
  id: ID,
  name: "Kota Gorontalo",
  code: "7571",
  province: "Gorontalo",
  kind: "kota",
  bbox: [122.98, 0.48, 123.11, 0.6],
  sizeBytes: 70_000,
  sha256: "A".repeat(64),
  version: 26102522,
  builtAt: "2026-10-25T15:04:00Z",
  osmDate: "2026-10-24T20:20:51Z",
};
const BYTES = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31 + 7) & 0xff);

async function sha(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function send(path: string, init: RequestInit & { key?: string | null; env?: { MAPS_PUBLISH_KEY?: string } } = {}): Promise<Response> {
  const { key = KEY, env: overrides = { MAPS_PUBLISH_KEY: KEY }, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (key !== null) headers.set("x-maps-publish-key", key);
  if (rest.body instanceof Uint8Array && !headers.has("content-length")) headers.set("content-length", String(rest.body.byteLength));
  return call(`/internal/maps${path}`, { ...rest, headers, env: overrides });
}

const putBin = async (id: string, bytes: Uint8Array, sha256?: string) =>
  send(`/watch/${id}.bin`, { method: "PUT", body: bytes, headers: { "x-sha256": sha256 ?? (await sha(bytes)) } });

beforeEach(async () => {
  const listed = await env.MAPS.list();
  if (listed.objects.length) await env.MAPS.delete(listed.objects.map((o) => o.key));
});

describe("internal maps publishing: auth", () => {
  const routes: [string, string][] = [
    ["GET", "/watch/catalog.json"],
    ["PUT", "/watch/catalog.json"],
    ["GET", `/watch/${ID}.bin/meta`],
    ["PUT", `/watch/${ID}.bin`],
    ["DELETE", `/watch/${ID}.bin`],
    ["PUT", `/watch/${ID}.bin/chunks/${"A".repeat(64)}/1`],
    ["POST", `/watch/${ID}.bin/chunks/${"A".repeat(64)}/commit`],
  ];

  it("answers 503 on every route while MAPS_PUBLISH_KEY is unset", async () => {
    for (const [method, path] of routes) {
      const res = await send(path, { method, env: { MAPS_PUBLISH_KEY: "" } });
      expect(res.status, `${method} ${path}`).toBe(503);
    }
  });

  it("answers 401 without the key or with a wrong one, and writes nothing", async () => {
    for (const [method, path] of routes) {
      for (const key of [null, "", "wrong", KEY.slice(1), `${KEY}x`]) {
        const res = await send(path, { method, key, ...(method === "PUT" ? { body: BYTES } : {}) });
        expect(res.status, `${method} ${path} key=${key}`).toBe(401);
      }
    }
    expect((await env.MAPS.list()).objects).toEqual([]);
  });

  it("accepts the key", async () => {
    const res = await send(`/watch/${ID}.bin/meta`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: false });
  });
});

describe("internal maps publishing: paths", () => {
  it("only knows watch/<id>.bin and watch/catalog.json", async () => {
    await env.MAPS.put("bike/indonesia.pmtiles", "tiles");
    const bad = [
      "/watch/12abc.bin",
      "/watch/99999999999999999999.bin",
      "/watch/0123.bin",
      `/watch/${ID}.pmtiles`,
      `/watch/${ID}`,
      "/watch/other.json",
      "/watch/.chunks",
      "/bike/indonesia.pmtiles",
      `/watch/sub/${ID}.bin`,
      `/watch/..%2Fbike%2Findonesia.pmtiles`,
      `/watch/%2E%2E%2Fbike%2F${ID}.bin`,
    ];
    for (const path of bad) {
      for (const method of ["PUT", "DELETE"]) {
        const res = await send(path, { method, body: BYTES, headers: { "x-sha256": await sha(BYTES) } });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
    for (const path of [`/watch/12abc.bin/meta`, `/watch/catalog.json/meta`, `/watch/${ID}.bin`]) {
      expect((await send(path)).status, path).toBe(404);
    }
    expect((await env.MAPS.list()).objects.map((o) => o.key)).toEqual(["bike/indonesia.pmtiles"]);
  });

  it("refuses chunk numbers outside 1..64 and bad upload hashes", async () => {
    for (const path of [`/chunks/${"A".repeat(64)}/0`, `/chunks/${"A".repeat(64)}/65`, `/chunks/${"A".repeat(63)}/1`, `/chunks/x/1`]) {
      const res = await send(`/watch/${ID}.bin${path}`, { method: "PUT", body: BYTES, headers: { "x-sha256": await sha(BYTES) } });
      expect(res.status, path).toBe(404);
    }
  });
});

describe("internal maps publishing: files", () => {
  it("stores a file whose SHA-256 matches, with the hash as metadata, and serves it", async () => {
    const res = await putBin(ID, BYTES, (await sha(BYTES)).toLowerCase());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, sizeBytes: BYTES.byteLength, sha256: await sha(BYTES) });
    const meta = await send(`/watch/${ID}.bin/meta`);
    expect(await meta.json()).toMatchObject({ exists: true, sizeBytes: BYTES.byteLength, sha256: await sha(BYTES) });
    const served = await call(`/v1/maps/${ID}.bin`);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(BYTES);
  });

  it("stores nothing on a SHA-256 mismatch and keeps the previous file", async () => {
    const previous = BYTES.slice(0, 1000);
    expect((await putBin(ID, previous)).status).toBe(201);
    const res = await putBin(ID, BYTES, "B".repeat(64));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "sha256_mismatch" });
    const meta = await (await send(`/watch/${ID}.bin/meta`)).json();
    expect(meta).toMatchObject({ exists: true, sizeBytes: 1000, sha256: await sha(previous) });
  });

  it("needs X-Sha256, Content-Length and a body of at most 95 MiB", async () => {
    expect((await send(`/watch/${ID}.bin`, { method: "PUT", body: BYTES })).status).toBe(400);
    expect((await send(`/watch/${ID}.bin`, { method: "PUT", body: BYTES, headers: { "x-sha256": "abc" } })).status).toBe(400);
    const tooLarge = await send(`/watch/${ID}.bin`, {
      method: "PUT",
      body: BYTES,
      headers: { "x-sha256": await sha(BYTES), "content-length": String(MAPS_MAX_BODY_BYTES + 1) },
    });
    expect(tooLarge.status).toBe(413);
    expect((await env.MAPS.list()).objects).toEqual([]);
  });

  it("does not delete a file the catalog lists", async () => {
    await putBin(ID, BYTES);
    await env.MAPS.put(MAPS_CATALOG_KEY, JSON.stringify({ maps: [ENTRY] }));
    const res = await send(`/watch/${ID}.bin`, { method: "DELETE" });
    expect(res.status).toBe(409);
    expect(await env.MAPS.head(`watch/${ID}.bin`)).not.toBeNull();
  });

  it("deletes a file the catalog no longer lists", async () => {
    const other = "2000000000000017571";
    await putBin(other, BYTES);
    await env.MAPS.put(MAPS_CATALOG_KEY, JSON.stringify({ maps: [ENTRY] }));
    const res = await send(`/watch/${other}.bin`, { method: "DELETE" });
    expect(await res.json()).toEqual({ ok: true, existed: true });
    expect(await env.MAPS.head(`watch/${other}.bin`)).toBeNull();
  });
});

describe("internal maps publishing: chunked upload", () => {
  const parts = [BYTES.slice(0, 30_000), BYTES.slice(30_000, 60_000), BYTES.slice(60_000)];
  const putChunk = async (whole: string, n: number, bytes: Uint8Array, sha256?: string) =>
    send(`/watch/${ID}.bin/chunks/${whole}/${n}`, { method: "PUT", body: bytes, headers: { "x-sha256": sha256 ?? (await sha(bytes)) } });
  const commit = (whole: string, body: unknown) =>
    send(`/watch/${ID}.bin/chunks/${whole}/commit`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  it("joins the chunks into the file, checks the whole SHA-256 and removes the chunks", async () => {
    const whole = await sha(BYTES);
    await env.MAPS.put(`watch/.chunks/${ID}/${"C".repeat(64)}/1`, "stale chunk of an abandoned upload");
    for (const [i, part] of parts.entries()) expect((await putChunk(whole, i + 1, part)).status).toBe(201);
    const res = await commit(whole, { chunks: 3, sizeBytes: BYTES.byteLength });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, sizeBytes: BYTES.byteLength, sha256: whole });
    const stored = await env.MAPS.get(`watch/${ID}.bin`);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(BYTES);
    expect(stored!.customMetadata).toEqual({ sha256: whole });
    expect((await env.MAPS.list({ prefix: "watch/.chunks/" })).objects).toEqual([]);
  });

  it("stores nothing when the joined chunks do not match the file's SHA-256", async () => {
    const previous = BYTES.slice(0, 1000);
    await putBin(ID, previous);
    const claimed = "D".repeat(64);
    for (const [i, part] of parts.entries()) await putChunk(claimed, i + 1, part);
    const res = await commit(claimed, { chunks: 3, sizeBytes: BYTES.byteLength });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "sha256_mismatch" });
    expect(await (await send(`/watch/${ID}.bin/meta`)).json()).toMatchObject({ sizeBytes: 1000, sha256: await sha(previous) });
    expect((await env.MAPS.list({ prefix: "watch/.chunks/" })).objects).toEqual([]);
  });

  it("refuses a chunk whose own SHA-256 does not match", async () => {
    const res = await putChunk(await sha(BYTES), 1, parts[0]!, "E".repeat(64));
    expect(res.status).toBe(422);
    expect((await env.MAPS.list()).objects).toEqual([]);
  });

  it("reports a missing chunk and a size that does not add up, and stores nothing", async () => {
    const whole = await sha(BYTES);
    await putChunk(whole, 1, parts[0]!);
    await putChunk(whole, 3, parts[2]!);
    const missing = await commit(whole, { chunks: 3, sizeBytes: BYTES.byteLength });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({ error: "missing_chunk", chunk: 2 });
    await putChunk(whole, 2, parts[1]!);
    const size = await commit(whole, { chunks: 3, sizeBytes: BYTES.byteLength + 1 });
    expect(size.status).toBe(422);
    expect(await env.MAPS.head(`watch/${ID}.bin`)).toBeNull();
  });
});

describe("internal maps publishing: catalog", () => {
  const document = { generatedAt: "2026-10-27T00:00:00Z", attribution: "© OpenStreetMap contributors, ODbL 1.0", maps: [ENTRY] };
  const putCatalog = (body: unknown, headers: Record<string, string> = {}) =>
    send("/watch/catalog.json", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

  it("is 404 before there is one", async () => {
    expect((await send("/watch/catalog.json")).status).toBe(404);
  });

  it("writes a valid catalog that GET /v1/maps then serves, and reads it back with its ETag", async () => {
    const res = await putCatalog(document);
    expect(res.status).toBe(200);
    const { etag } = (await res.json()) as { etag: string };
    expect(await (await call("/v1/maps")).json()).toEqual([{ ...ENTRY, attribution: document.attribution }]);
    const read = await send("/watch/catalog.json");
    expect(read.headers.get("etag")).toBe(etag);
    expect(await read.json()).toEqual(document);
  });

  it("refuses an invalid catalog and keeps the stored one", async () => {
    await putCatalog(document);
    const bad = [
      [ENTRY],
      {},
      { maps: [{ ...ENTRY, sha256: "a".repeat(64) }] },
      { maps: [{ id: ENTRY.id, sizeBytes: 1 }] },
      { maps: [{ ...ENTRY, sizeBytes: 0 }] },
      { maps: [{ ...ENTRY, id: "12abc" }] },
      { maps: [ENTRY, "junk"] },
    ];
    for (const body of bad) expect((await putCatalog(body)).status, JSON.stringify(body)).toBe(400);
    const duplicate = await putCatalog({ maps: [ENTRY, { ...ENTRY, name: "again" }] });
    expect(await duplicate.json()).toEqual({ error: "duplicate_id", id: ENTRY.id });
    const notJson = await send("/watch/catalog.json", { method: "PUT", body: "{nope" });
    expect(notJson.status).toBe(400);
    expect(await (await send("/watch/catalog.json")).json()).toEqual(document);
  });

  it("answers 412 when If-Match names an older catalog", async () => {
    const first = (await (await putCatalog(document)).json()) as { etag: string };
    const second = await putCatalog({ ...document, generatedAt: "2026-10-28T00:00:00Z" }, { "if-match": first.etag });
    expect(second.status).toBe(200);
    const stale = await putCatalog({ ...document, generatedAt: "2026-10-29T00:00:00Z" }, { "if-match": first.etag });
    expect(stale.status).toBe(412);
    expect(((await (await send("/watch/catalog.json")).json()) as { generatedAt: string }).generatedAt).toBe("2026-10-28T00:00:00Z");
  });
});
