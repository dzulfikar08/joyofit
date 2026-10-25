import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bkgBrdcUrl, buildHwAgnss, parseRinexNav, validateHwAgnss } from "../../packages/agps-rtcm/src/rtcm";
import { C13, E10, gpsSet, HEADER, R23 } from "../../packages/agps-rtcm/test/fixture";
import { HW_AGNSS_CACHE_KEY } from "../src/agps";
import { call } from "./helpers";

// Ten minutes after the fixture's GPS epoch (2026-10-21 01:59:44); the GLONASS record is moved to 02:00 so it is fresh too.
const NOW = Date.UTC(2026, 9, 21, 2, 10, 0);
const TODAY = bkgBrdcUrl(NOW);
const YESTERDAY = bkgBrdcUrl(NOW - 86_400_000);
const R_AT_0200 = R23.replace("2026 10 21 00 15 00", "2026 10 21 02 00 00");
const FULL = HEADER + gpsSet(24) + E10 + C13 + R_AT_0200;

async function gzip(text: string): Promise<ArrayBuffer> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

/** What the fake BKG server holds, by URL; anything else is a 404. */
let files: Record<string, string> = {};
let bkgCalls: string[] = [];

beforeEach(async () => {
  await caches.default.delete(HW_AGNSS_CACHE_KEY);
  files = {};
  bkgCalls = [];
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://igs.bkg.bund.de/")) throw new Error(`unexpected call: ${url}`);
    bkgCalls.push(url);
    expect(new Headers(init?.headers).get("cookie")).toBeNull();
    const text = files[url];
    return text === undefined ? new Response("not found", { status: 404 }) : new Response(await gzip(text), { status: 200 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /v1/agps/hw-agnss", () => {
  it("builds the file from today's BKG data without a session, checks it and serves it for 15 minutes", async () => {
    files[TODAY] = FULL;
    const res = await call("/v1/agps/hw-agnss");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("public, max-age=900");
    expect(res.headers.get("last-modified")).toBe(new Date(NOW).toUTCString());
    expect(res.headers.get("x-satellites")).toBe("27");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(validateHwAgnss(body)).toBeNull();
    expect([...body]).toEqual([...buildHwAgnss(parseRinexNav(FULL), NOW).bytes]);
    // Just after midnight UTC yesterday's file is read as well; it is missing here and that is fine.
    expect(bkgCalls).toEqual([TODAY, YESTERDAY]);
  });

  it("serves the cached build to the next caller without asking BKG again", async () => {
    files[TODAY] = FULL;
    const first = new Uint8Array(await (await call("/v1/agps/hw-agnss")).arrayBuffer());
    const again = await call("/v1/agps/hw-agnss");
    expect(again.status).toBe(200);
    expect([...new Uint8Array(await again.arrayBuffer())]).toEqual([...first]);
    expect(bkgCalls).toHaveLength(2);
  });

  it("uses yesterday's file when today's does not exist yet", async () => {
    files[YESTERDAY] = FULL;
    const res = await call("/v1/agps/hw-agnss");
    expect(res.status).toBe(200);
    expect(validateHwAgnss(new Uint8Array(await res.arrayBuffer()))).toBeNull();
  });

  it("answers 503, uncached, when the build has too few satellites", async () => {
    files[TODAY] = HEADER + gpsSet(19);
    const res = await call("/v1/agps/hw-agnss");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "agps_unavailable" });
    files[TODAY] = FULL;
    expect((await call("/v1/agps/hw-agnss")).status).toBe(200);
    expect(bkgCalls).toHaveLength(4);
  });

  it("answers 503 when BKG has nothing", async () => {
    const res = await call("/v1/agps/hw-agnss");
    expect(res.status).toBe(503);
    expect(bkgCalls).toEqual([TODAY, YESTERDAY]);
  });

  it("answers 503 when the records are too old to use", async () => {
    files[TODAY] = FULL;
    vi.spyOn(Date, "now").mockReturnValue(NOW + 5 * 3_600_000);
    expect((await call("/v1/agps/hw-agnss")).status).toBe(503);
  });
});

describe("the check before serving", () => {
  it("refuses a file with a broken frame", () => {
    const bytes = buildHwAgnss(parseRinexNav(FULL), NOW).bytes;
    expect(validateHwAgnss(bytes)).toBeNull();
    bytes[20] = (bytes[20] ?? 0) ^ 0xff;
    expect(validateHwAgnss(bytes)).toBe("RTCM frame at byte 0 fails its CRC");
  });
});
