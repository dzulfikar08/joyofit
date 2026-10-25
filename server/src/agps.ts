import { Hono } from "hono";

import {
  bkgBrdcUrls,
  buildHwAgnss,
  HW_AGNSS_FILE,
  OLDEST_USABLE_MS,
  parseRinexNav,
  validateHwAgnss,
  type Built,
  type NavRecord,
} from "../../packages/agps-rtcm/src/rtcm";
import type { AppContext } from "./env";

/**
 * Satellite data for the watch's `HW_AGNSS` request (docs/agps.md, "Lab path"): the phone's experimental switch fetches the file here, and only
 * then. The Worker reads BKG's open broadcast ephemeris, builds the RTCM 3 file with the shared encoder (packages/agps-rtcm), checks it and
 * serves the same bytes to everyone for 15 minutes. The request carries nothing about the user: no session, no parameters.
 */
export const agps = new Hono<AppContext>();

/** BKG rebuilds its merged file every 15 minutes, so a build is served (and cached at the edge) that long. */
export const HW_AGNSS_CACHE_SECONDS = 900;

/** The Cache API key of the built file; versioned so a change of the encoder can drop old copies. */
export const HW_AGNSS_CACHE_KEY = "https://api.fit.joyorogo.com/v1/agps/hw-agnss?build=1";

/** BKG's compressed daily file is under 1 MB; anything far larger is not that file. */
const MAX_GZ_BYTES = 8 * 1024 * 1024;
/** A full day unpacks to about 8 MB. */
const MAX_TEXT_BYTES = 48 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

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

/** One BKG file as text, or why it could not be read. A missing file (today's, just after midnight) is a normal answer, not an error. */
async function fetchRinex(url: string): Promise<{ text: string } | { problem: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok || !res.body) return { problem: `${url}: HTTP ${res.status}` };
    if (Number(res.headers.get("content-length") ?? "0") > MAX_GZ_BYTES) return { problem: `${url}: larger than ${MAX_GZ_BYTES} bytes` };
    const gz = await readCapped(res.body, MAX_GZ_BYTES);
    const unpacked = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
    return { text: new TextDecoder().decode(await readCapped(unpacked, MAX_TEXT_BYTES)) };
  } catch (error) {
    return { problem: `${url}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Builds and checks the file for `nowMs` from today's BKG file (and yesterday's after midnight UTC); `problem` says why there is none. */
export async function buildFromBkg(nowMs: number): Promise<{ built: Built } | { problem: string }> {
  const records: NavRecord[] = [];
  const problems: string[] = [];
  for (const url of bkgBrdcUrls(nowMs)) {
    const got = await fetchRinex(url);
    if ("problem" in got) problems.push(got.problem);
    else records.push(...parseRinexNav(got.text, nowMs - OLDEST_USABLE_MS));
  }
  const built = buildHwAgnss(records, nowMs);
  const invalid = validateHwAgnss(built.bytes);
  if (invalid) return { problem: [invalid, ...problems].join("; ") };
  return { built };
}

/** `GET /v1/agps/hw-agnss`: the `HW_AGNSS_RTCM_33` bytes, `Last-Modified` = when they were built; 503 when no valid file can be built now. */
agps.get("/hw-agnss", async (c) => {
  const cache = caches.default;
  const hit = await cache.match(HW_AGNSS_CACHE_KEY);
  if (hit) return hit;
  const nowMs = Date.now();
  const result = await buildFromBkg(nowMs);
  if ("problem" in result) {
    console.error(JSON.stringify({ event: "agps_build_failed", problem: result.problem }));
    c.header("cache-control", "no-store");
    return c.json({ error: "agps_unavailable" }, 503);
  }
  const { bytes, counts, skipped } = result.built;
  console.log(JSON.stringify({ event: "agps_built", bytes: bytes.length, counts, skipped }));
  const response = new Response(bytes, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${HW_AGNSS_FILE}"`,
      "cache-control": `public, max-age=${HW_AGNSS_CACHE_SECONDS}`,
      "last-modified": new Date(nowMs).toUTCString(),
      "x-satellites": String(counts.G + counts.R + counts.E + counts.C),
    },
  });
  c.executionCtx.waitUntil(cache.put(HW_AGNSS_CACHE_KEY, response.clone()));
  return response;
});
