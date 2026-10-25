import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decodeBundle, gpsSecondsAt, validatePgnssBundle } from "../../packages/agps-pgnss/src/bundle";
import { bkgBrdmUrls, buildPgnss, CODE_ULTRA_URL, codePredictionUrls, parseNavHeader, sp3Window } from "../../packages/agps-pgnss/src/pgnss";
import { parseSp3 } from "../../packages/agps-pgnss/src/sp3";
import { BRDC_NAV, BRDM_HEADER, NOW, ULTRA_SP3 } from "../../packages/agps-pgnss/test/fixture";
import { bkgBrdcUrls, parseRinexNav } from "../../packages/agps-rtcm/src/rtcm";
import { HW_PGNSS_CACHE_KEY, HW_PGNSS_FAILURE_KEY, secondsUntilRebuild } from "../src/agpsPgnss";
import { call } from "./helpers";

// The fixture is real data trimmed to 20 satellites (CODE ultra-rapid orbit, BKG broadcast records); its build time is 2026-10-25 05:30 UTC.
const [BRDC_TODAY] = bkgBrdcUrls(NOW);
const [BRDM_YESTERDAY, BRDM_BEFORE] = bkgBrdmUrls(NOW);
const [PREDICTION_TODAY, PREDICTION_BEFORE] = codePredictionUrls(NOW);

async function gzip(text: string): Promise<ArrayBuffer> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

/** What the fake servers hold, by URL (`gz`: served gzipped, like BKG's files); anything else is a 404. */
let files: Record<string, { text: string; gz: boolean }> = {};
let calls: string[] = [];

function expectedBundle(orbit = ULTRA_SP3, withHeader = true): Uint8Array {
  const [from, to] = sp3Window(gpsSecondsAt(NOW));
  const header = parseNavHeader(withHeader ? BRDM_HEADER : "");
  const result = buildPgnss({ nowMs: NOW, orbits: [parseSp3(orbit, from, to)], nav: parseRinexNav(BRDC_NAV), ion: header.ion, utc: header.utc });
  if ("problem" in result) throw new Error(result.problem);
  return result.build.bundle;
}

beforeEach(async () => {
  await caches.default.delete(HW_PGNSS_CACHE_KEY);
  await caches.default.delete(HW_PGNSS_FAILURE_KEY);
  files = {
    [CODE_ULTRA_URL]: { text: ULTRA_SP3, gz: false },
    [BRDC_TODAY as string]: { text: BRDC_NAV, gz: true },
    [BRDM_YESTERDAY as string]: { text: BRDM_HEADER, gz: true },
  };
  calls = [];
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://igs.bkg.bund.de/") && !url.startsWith("https://download.aiub.unibe.ch/")) throw new Error(`unexpected call: ${url}`);
    calls.push(url);
    expect(new Headers(init?.headers).get("cookie")).toBeNull();
    const file = files[url];
    if (!file) return new Response("not found", { status: 404 });
    return new Response(file.gz ? await gzip(file.text) : file.text, { status: 200 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /v1/agps/hw-pgnss", () => {
  it("builds the bundle from CODE and BKG data without a session, checks it and serves it until the next full hour", async () => {
    const res = await call("/v1/agps/hw-pgnss");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("public, max-age=1800");
    expect(res.headers.get("last-modified")).toBe(new Date(NOW).toUTCString());
    expect(res.headers.get("x-pgnss-records")).toBe("G56 J0 E42 C0 R402");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(validatePgnssBundle(body, NOW)).toBeNull();
    const decoded = decodeBundle(body);
    expect(Array.isArray(decoded) && decoded.map((f) => [f.name, f.bytes.length])).toEqual([
      ["HW_PGNSS_GPS", 93312],
      ["HW_PGNSS_BDS", 209808],
      ["HW_PGNSS_GLONASS", 361584],
      ["HW_PGNSS_GALILEO", 99648],
      ["HW_PGNSS_QZS", 28512],
      ["HW_PGNSS_EXTRA", 6248],
    ]);
    expect([...body]).toEqual([...expectedBundle()]);
    expect(calls.sort()).toEqual([CODE_ULTRA_URL, PREDICTION_TODAY, PREDICTION_BEFORE, BRDM_YESTERDAY, BRDC_TODAY].sort());
  });

  it("serves the cached build to the next caller with the time left until the rebuild, without fetching again", async () => {
    const first = new Uint8Array(await (await call("/v1/agps/hw-pgnss")).arrayBuffer());
    vi.spyOn(Date, "now").mockReturnValue(NOW + 600_000);
    const again = await call("/v1/agps/hw-pgnss");
    expect(again.status).toBe(200);
    expect(again.headers.get("cache-control")).toBe("public, max-age=1200");
    expect(again.headers.get("last-modified")).toBe(new Date(NOW).toUTCString());
    expect([...new Uint8Array(await again.arrayBuffer())]).toEqual([...first]);
    expect(calls).toHaveLength(5);
  });

  it("uses the 5-day prediction (the day before's name) when the ultra-rapid file is missing", async () => {
    delete files[CODE_ULTRA_URL];
    files[PREDICTION_BEFORE as string] = { text: ULTRA_SP3, gz: false };
    const res = await call("/v1/agps/hw-pgnss");
    expect(res.status).toBe(200);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...expectedBundle()]);
  });

  it("serves EXTRA without the ionosphere and UTC sections when no BRDM header can be read", async () => {
    delete files[BRDM_YESTERDAY as string];
    const res = await call("/v1/agps/hw-pgnss");
    expect(res.status).toBe(200);
    const body = new Uint8Array(await res.arrayBuffer());
    expect([...body]).toEqual([...expectedBundle(ULTRA_SP3, false)]);
    expect(calls).toContain(BRDM_BEFORE);
  });

  it("answers 503 without any orbit product, and remembers the failure for a minute instead of fetching again", async () => {
    delete files[CODE_ULTRA_URL];
    const res = await call("/v1/agps/hw-pgnss");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toEqual({ error: "agps_unavailable" });
    expect((await caches.default.match(HW_PGNSS_FAILURE_KEY))?.headers.get("cache-control")).toBe("public, max-age=60");
    const fetched = calls.length;

    // The source is back, but within the minute the next caller gets the remembered 503 and nothing is fetched.
    files[CODE_ULTRA_URL] = { text: ULTRA_SP3, gz: false };
    const again = await call("/v1/agps/hw-pgnss");
    expect(again.status).toBe(503);
    expect(calls).toHaveLength(fetched);

    // Once the memory has expired (removed here), the next caller builds and gets the bundle.
    await caches.default.delete(HW_PGNSS_FAILURE_KEY);
    expect((await call("/v1/agps/hw-pgnss")).status).toBe(200);
  });

  it("answers 503 when the broadcast records are too old for a build (no healthy satellites to fit)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW + 8 * 3_600_000);
    expect((await call("/v1/agps/hw-pgnss")).status).toBe(503);
  });

  it("answers 503 when the orbit file is not SP3", async () => {
    files[CODE_ULTRA_URL] = { text: "<html>maintenance</html>", gz: false };
    expect((await call("/v1/agps/hw-pgnss")).status).toBe(503);
  });
});

describe("rebuild schedule", () => {
  it("is the full hour after the build, never more than an hour", () => {
    const at = (iso: string) => Date.parse(iso);
    expect(secondsUntilRebuild(at("2026-10-25T05:30:00Z"), at("2026-10-25T05:30:00Z"))).toBe(1800);
    expect(secondsUntilRebuild(at("2026-10-25T05:00:00Z"), at("2026-10-25T05:00:00Z"))).toBe(3600);
    expect(secondsUntilRebuild(at("2026-10-25T05:59:59Z"), at("2026-10-25T05:59:59Z"))).toBe(1);
    expect(secondsUntilRebuild(at("2026-10-25T05:30:00Z"), at("2026-10-25T06:10:00Z"))).toBe(0);
  });
});
