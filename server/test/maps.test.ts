import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { MAPS_CATALOG_KEY } from "../src/maps";
import { call } from "./helpers";

const ENTRY = {
  id: "2000000000000003573",
  name: "Malang (lab)",
  bbox: [112.5, -8.05, 112.72, -7.88],
  sizeBytes: 9616061,
  sha256: "A".repeat(64),
  version: 26102522,
  builtAt: "2026-10-25T15:04:00Z",
  osmDate: "2026-10-24T20:20:51Z",
};
const ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0";
const BYTES = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31 + 7) & 0xff);

beforeEach(async () => {
  const listed = await env.MAPS.list();
  if (listed.objects.length) await env.MAPS.delete(listed.objects.map((o) => o.key));
});

describe("GET /v1/maps", () => {
  it("serves the catalog with attribution and a 5-minute cache, without a session", async () => {
    await env.MAPS.put(MAPS_CATALOG_KEY, JSON.stringify({ maps: [ENTRY] }));
    const res = await call("/v1/maps");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual([{ ...ENTRY, attribution: ATTRIBUTION }]);
  });

  it("is an empty list when there is no catalog", async () => {
    const res = await call("/v1/maps");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("is an empty list when the catalog is not JSON", async () => {
    await env.MAPS.put(MAPS_CATALOG_KEY, "{nope");
    const res = await call("/v1/maps");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("drops bad entries and keeps the good ones", async () => {
    const bad = [
      { ...ENTRY, id: "12abc" },
      { ...ENTRY, id: "99999999999999999999" },
      { ...ENTRY, sha256: "a".repeat(64) },
      { ...ENTRY, bbox: [112.72, -8.05, 112.5, -7.88] },
      { ...ENTRY, sizeBytes: -1 },
      "junk",
    ];
    await env.MAPS.put(MAPS_CATALOG_KEY, JSON.stringify({ maps: [...bad, ENTRY] }));
    const res = await call("/v1/maps");
    expect(await res.json()).toEqual([{ ...ENTRY, attribution: ATTRIBUTION }]);
  });
});

describe("GET /v1/maps/:id.bin", () => {
  it("streams the file with its headers and exact bytes, without a session", async () => {
    await env.MAPS.put(`watch/${ENTRY.id}.bin`, BYTES);
    const res = await call(`/v1/maps/${ENTRY.id}.bin`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-length")).toBe(String(BYTES.length));
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("etag")).toMatch(/^".+"$/);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...BYTES]);
  });

  it("answers 304 to a matching If-None-Match and 200 to a stale one", async () => {
    await env.MAPS.put(`watch/${ENTRY.id}.bin`, BYTES);
    const etag = (await call(`/v1/maps/${ENTRY.id}.bin`)).headers.get("etag")!;
    const same = await call(`/v1/maps/${ENTRY.id}.bin`, { headers: { "if-none-match": etag } });
    expect(same.status).toBe(304);
    expect(same.headers.get("etag")).toBe(etag);
    expect(same.body).toBeNull();
    const stale = await call(`/v1/maps/${ENTRY.id}.bin`, { headers: { "if-none-match": '"other"' } });
    expect(stale.status).toBe(200);
    expect((await stale.arrayBuffer()).byteLength).toBe(BYTES.length);
  });

  it("is 404 for an unknown id", async () => {
    const res = await call("/v1/maps/1.bin");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it.each(["abc.bin", "1", "1.txt", "-1.bin", "01.bin", "99999999999999999999.bin", "catalog.json"])("is 404 for the malformed %s", async (file) => {
    const res = await call(`/v1/maps/${file}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
