import { Hono } from "hono";

import { gpsSecondsAt, validatePgnssBundle } from "../../packages/agps-pgnss/src/bundle";
import {
  bkgBrdmUrls,
  buildPgnss,
  CODE_ULTRA_URL,
  codePredictionUrls,
  parseNavHeader,
  sp3Window,
  type PgnssBuild,
} from "../../packages/agps-pgnss/src/pgnss";
import { parseSp3, type Sp3 } from "../../packages/agps-pgnss/src/sp3";
import { bkgBrdcUrls, OLDEST_USABLE_MS, parseRinexNav, type NavRecord } from "../../packages/agps-rtcm/src/rtcm";
import type { AppContext } from "./env";

/**
 * Satellite data for the watch's `HW_PGNSS_PRED` request (docs/agps.md, "PGNSS lab path"): the phone's own experimental switch fetches the
 * bundle here, and only then. The Worker reads CODE's public orbit predictions and BKG's broadcast ephemeris, builds the six files with the
 * shared generator (packages/agps-pgnss), runs its quality gate and the bundle check, and serves the same bytes to everyone until the next
 * full hour. The request carries nothing about the user: no session, no parameters.
 */
export const agpsPgnss = new Hono<AppContext>();

/** A build is served until the next full hour (the first slot moves every 2 h, CODE's ultra-rapid orbit every 6 h, BKG's file every 15 min). */
export const HW_PGNSS_REBUILD_SECONDS = 3600;

/** The Cache API key of the built bundle; versioned so a change of the generator can drop old copies. */
export const HW_PGNSS_CACHE_KEY = "https://api.fit.joyorogo.com/v1/agps/hw-pgnss?build=1";

/** A failed build is remembered this long, so callers in that minute get the 503 without each one fetching the sources again. */
export const HW_PGNSS_FAILURE_SECONDS = 60;

/** The Cache API key of that memory: a 200 marker (the Cache API keeps successful answers), turned into the 503 on the way out. */
export const HW_PGNSS_FAILURE_KEY = "https://api.fit.joyorogo.com/v1/agps/hw-pgnss?failed=1";

/** CODE's ultra-rapid SP3 is about 3.4 MB and the 5-day prediction about 9.8 MB, both uncompressed; anything far larger is not that file. */
const MAX_ULTRA_BYTES = 8 * 1024 * 1024;
const MAX_PREDICTION_BYTES = 24 * 1024 * 1024;
/** BKG's compressed daily broadcast file is under 1 MB and unpacks to about 8 MB. */
const MAX_GZ_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 48 * 1024 * 1024;
/** A RINEX header is a few kilobytes; the header read stops at END OF HEADER and never reads past this. */
const MAX_HEADER_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

/** Reads `body` to the end, giving up once it passes `limit` bytes. */
async function readCapped(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`more than ${limit} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

type Fetched = { text: string } | { problem: string };

/** One source file as text (gunzipped when `gzip`), or why it could not be read. */
async function fetchText(url: string, limit: number, gzip: boolean): Promise<Fetched> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok || !res.body) return { problem: `${url}: HTTP ${res.status}` };
    if (Number(res.headers.get("content-length") ?? "0") > limit) return { problem: `${url}: larger than ${limit} bytes` };
    const raw = await readCapped(res.body, limit);
    if (!gzip) return { text: new TextDecoder().decode(raw) };
    const unpacked = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
    return { text: new TextDecoder().decode(await readCapped(unpacked, MAX_TEXT_BYTES)) };
  } catch (error) {
    return { problem: `${url}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The first of `urls` that answers (the newest name first), or every problem. */
async function fetchFirst(urls: string[], limit: number): Promise<Fetched> {
  const problems: string[] = [];
  for (const url of urls) {
    const got = await fetchText(url, limit, false);
    if ("text" in got) return got;
    problems.push(got.problem);
  }
  return { problem: problems.join("; ") };
}

/** The header of a gzipped RINEX navigation file: the stream is unpacked only up to END OF HEADER, then dropped. */
async function fetchNavHeader(urls: string[]): Promise<Fetched> {
  const problems: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok || !res.body) {
        problems.push(`${url}: HTTP ${res.status}`);
        continue;
      }
      const reader = res.body.pipeThrough(new DecompressionStream("gzip")).pipeThrough(new TextDecoderStream()).getReader();
      let text = "";
      while (!text.includes("END OF HEADER") && text.length < MAX_HEADER_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        text += value;
      }
      await reader.cancel();
      if (text.includes("END OF HEADER")) return { text };
      problems.push(`${url}: no END OF HEADER`);
    } catch (error) {
      problems.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { problem: problems.join("; ") };
}

/**
 * Fetches every input for `nowMs` and builds, gates and checks the bundle; `problem` says why there is none. Either orbit product alone is
 * enough (the ultra-rapid one covers about the first day, the 5-day prediction all three); without ionosphere/UTC header the EXTRA file
 * carries those sections as zeros, like Huawei Health does for a section it lacks.
 */
export async function buildFromSources(nowMs: number): Promise<{ build: PgnssBuild } | { problem: string }> {
  const [ultra, prediction, header, ...navFiles] = await Promise.all([
    fetchText(CODE_ULTRA_URL, MAX_ULTRA_BYTES, false),
    fetchFirst(codePredictionUrls(nowMs), MAX_PREDICTION_BYTES),
    fetchNavHeader(bkgBrdmUrls(nowMs)),
    ...bkgBrdcUrls(nowMs).map((url) => fetchText(url, MAX_GZ_BYTES, true)),
  ]);
  const problems: string[] = [];
  const [from, to] = sp3Window(gpsSecondsAt(nowMs));
  const orbits: Sp3[] = [];
  for (const got of [ultra, prediction]) {
    if ("problem" in got) {
      problems.push(got.problem);
      continue;
    }
    try {
      orbits.push(parseSp3(got.text, from, to));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  const nav: NavRecord[] = [];
  for (const got of navFiles) {
    if ("problem" in got) problems.push(got.problem);
    else nav.push(...parseRinexNav(got.text, nowMs - OLDEST_USABLE_MS));
  }
  if ("problem" in header) problems.push(header.problem);
  const { ion, utc } = "text" in header ? parseNavHeader(header.text) : { ion: null, utc: null };
  if (orbits.length === 0) return { problem: ["no orbit product", ...problems].join("; ") };
  const result = buildPgnss({ nowMs, orbits, nav, ion, utc });
  if ("problem" in result) return { problem: [result.problem, ...problems].join("; ") };
  const invalid = validatePgnssBundle(result.build.bundle, nowMs);
  if (invalid) return { problem: [invalid, ...problems].join("; ") };
  if (problems.length) console.warn(JSON.stringify({ event: "agps_pgnss_partial_sources", problems }));
  return result;
}

/** Seconds from `nowMs` until the next rebuild after a build at `builtMs` (the full hour after it). */
export function secondsUntilRebuild(builtMs: number, nowMs: number): number {
  const next = (Math.floor(builtMs / 1000 / HW_PGNSS_REBUILD_SECONDS) + 1) * HW_PGNSS_REBUILD_SECONDS;
  return Math.max(0, Math.min(HW_PGNSS_REBUILD_SECONDS, next - Math.floor(nowMs / 1000)));
}

/**
 * `GET /v1/agps/hw-pgnss`: the bundle (`JFPG`, six files), `Last-Modified` = when it was built, `max-age` = seconds until the next rebuild;
 * 503 (with `Retry-After`) when no bundle that passes the gate and the check can be built now, remembered for [HW_PGNSS_FAILURE_SECONDS].
 */
agpsPgnss.get("/hw-pgnss", async (c) => {
  const cache = caches.default;
  const nowMs = Date.now();
  const hit = await cache.match(HW_PGNSS_CACHE_KEY);
  if (hit) {
    const left = secondsUntilRebuild(Date.parse(hit.headers.get("last-modified") ?? ""), nowMs);
    if (left > 0) {
      const served = new Response(hit.body, hit);
      served.headers.set("cache-control", `public, max-age=${left}`);
      return served;
    }
  }
  const unavailable = () => {
    c.header("cache-control", "no-store");
    c.header("retry-after", String(HW_PGNSS_FAILURE_SECONDS));
    return c.json({ error: "agps_unavailable" }, 503);
  };
  if (await cache.match(HW_PGNSS_FAILURE_KEY)) return unavailable();
  const result = await buildFromSources(nowMs);
  if ("problem" in result) {
    console.error(JSON.stringify({ event: "agps_pgnss_build_failed", problem: result.problem }));
    const marker = new Response(null, { headers: { "cache-control": `public, max-age=${HW_PGNSS_FAILURE_SECONDS}` } });
    c.executionCtx.waitUntil(cache.put(HW_PGNSS_FAILURE_KEY, marker));
    return unavailable();
  }
  const { bundle, report, coveredUntil, builtGps } = result.build;
  const records = Object.entries(report)
    .map(([k, r]) => `${k}${r.records}`)
    .join(" ");
  console.log(JSON.stringify({ event: "agps_pgnss_built", bytes: bundle.length, records, coveredHours: (coveredUntil - builtGps) / 3600 }));
  // Last-Modified has whole seconds; the phone reads it back as the build time, so the age it sees is never less than the real one.
  const builtMs = Math.floor(nowMs / 1000) * 1000;
  const response = new Response(bundle, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": `public, max-age=${secondsUntilRebuild(builtMs, nowMs)}`,
      "last-modified": new Date(builtMs).toUTCString(),
      "x-pgnss-records": records,
    },
  });
  c.executionCtx.waitUntil(cache.put(HW_PGNSS_CACHE_KEY, response.clone()));
  return response;
});
