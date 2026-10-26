import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { MAPS_CATALOG_KEY } from "../src/maps";
import { call } from "./helpers";

const ENTRY = {
  id: "2000000000000003573",
  name: "Kota Malang",
  code: "3573",
  province: "Jawa Timur",
  kind: "kota",
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
      { ...ENTRY, code: "35730" },
      { ...ENTRY, province: "" },
      { ...ENTRY, kind: "kecamatan" },
      { ...ENTRY, part: { index: 3, count: 2 } },
      "junk",
    ];
    await env.MAPS.put(MAPS_CATALOG_KEY, JSON.stringify({ maps: [...bad, ENTRY] }));
    const res = await call("/v1/maps");
    expect(await res.json()).toEqual([{ ...ENTRY, attribution: ATTRIBUTION }]);
  });
});

const BOGOR_1 = {
  ...ENTRY,
  id: "2000000000000013201",
  name: "Kabupaten Bogor 1/2",
  code: "3201",
  province: "Jawa Barat",
  kind: "kabupaten",
  part: { index: 1, count: 2 },
  bbox: [106.39, -6.8, 106.82, -6.29],
};
const SURABAYA = { ...ENTRY, id: "2000000000000003578", name: "Kota Surabaya", code: "3578", bbox: [112.58, -7.36, 112.86, -7.17] };
const BATU = { ...ENTRY, id: "2000000000000003579", name: "Kota Batu", code: "3579", bbox: [112.46, -7.95, 112.6, -7.71] };

describe("GET /v1/maps filters", () => {
  beforeEach(async () => {
    await env.MAPS.put(MAPS_CATALOG_KEY, JSON.stringify({ maps: [ENTRY, BOGOR_1, SURABAYA, BATU] }));
  });
  const ids = async (path: string) => ((await (await call(path)).json()) as { id: string }[]).map((m) => m.id);

  it("keeps a split region's part", async () => {
    const res = await call("/v1/maps?province=jawa%20barat");
    expect(await res.json()).toEqual([{ ...BOGOR_1, attribution: ATTRIBUTION }]);
  });

  it("filters by province, any case", async () => {
    expect(await ids("/v1/maps?province=JAWA%20TIMUR")).toEqual([ENTRY.id, SURABAYA.id, BATU.id]);
    expect(await ids("/v1/maps?province=Bali")).toEqual([]);
  });

  it("searches the name, the province and the BPS code", async () => {
    expect(await ids("/v1/maps?q=surabaya")).toEqual([SURABAYA.id]);
    expect(await ids("/v1/maps?q=%20BOGOR%20")).toEqual([BOGOR_1.id]);
    expect(await ids("/v1/maps?q=3579")).toEqual([BATU.id]);
    expect(await ids("/v1/maps?q=barat")).toEqual([BOGOR_1.id]);
    expect(await ids("/v1/maps?q=kota&province=jawa%20timur")).toEqual([ENTRY.id, SURABAYA.id, BATU.id]);
  });

  it("limits, and ignores a position: there is no near filter", async () => {
    expect(await ids("/v1/maps?limit=2")).toEqual([ENTRY.id, BOGOR_1.id]);
    const res = await call("/v1/maps?near=-7.9826,112.6308");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body.map((m) => m.id)).toEqual([ENTRY.id, BOGOR_1.id, SURABAYA.id, BATU.id]);
    expect(body.every((m) => !("distanceKm" in m))).toBe(true);
  });

  it.each(["limit=0", "limit=abc", "limit=1001", "q=", "province="])("is 400 for %s", async (query) => {
    const res = await call(`/v1/maps?${query}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_query" });
  });

  it("answers 304 to its ETag and sees a new catalog at once", async () => {
    const first = await call("/v1/maps");
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const again = await call("/v1/maps", { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
    await env.MAPS.put(MAPS_CATALOG_KEY, JSON.stringify({ maps: [ENTRY] }));
    const changed = await call("/v1/maps", { headers: { "if-none-match": etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
    expect(await changed.json()).toEqual([{ ...ENTRY, attribution: ATTRIBUTION }]);
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
