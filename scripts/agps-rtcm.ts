#!/usr/bin/env bun
// Builds the `HW_AGNSS` file (`HW_AGNSS_RTCM_33`) from public broadcast ephemeris and checks it like the Worker does before serving it. The
// encoder lives in packages/agps-rtcm (shared with `GET /v1/agps/hw-agnss` in server/src/agps.ts); this is the command-line front.
//
//   bun scripts/agps-rtcm.ts --out /tmp/HW_AGNSS_RTCM_33                  # fetch BKG's merged file of today (and yesterday's after midnight)
//   bun scripts/agps-rtcm.ts --in BRDC.rnx --out out.rtcm [--now <ISO>]   # offline
//
// LAB TOOL. The watch does not validate what it is sent; do not send the output to a watch that cannot be factory-reset. Data source terms
// and the full reasoning: docs/agps.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { bkgBrdcUrls, buildHwAgnss, parseRinexNav, validateHwAgnss, type NavRecord } from '../packages/agps-rtcm/src/rtcm';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const unpack = (raw: Uint8Array): string => new TextDecoder().decode(raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw);

async function main(): Promise<void> {
  const out = arg('out');
  if (!out) throw new Error('usage: bun scripts/agps-rtcm.ts --out <file> [--in <rinex nav, .gz ok>] [--now <ISO time>]');
  const nowArg = arg('now');
  const now = nowArg ? Date.parse(nowArg) : Date.now();
  const input = arg('in');
  const records: NavRecord[] = [];
  if (input) {
    records.push(...parseRinexNav(unpack(readFileSync(input))));
  } else {
    for (const url of bkgBrdcUrls(now)) {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`${url}: HTTP ${res.status}`);
        continue;
      }
      records.push(...parseRinexNav(unpack(new Uint8Array(await res.arrayBuffer()))));
    }
  }
  const built = buildHwAgnss(records, now);
  writeFileSync(out, built.bytes);
  console.log(`${out}: ${built.bytes.length} bytes, GPS ${built.counts.G} GLONASS ${built.counts.R} Galileo ${built.counts.E} BeiDou ${built.counts.C}, skipped ${built.skipped}`);
  const problem = validateHwAgnss(built.bytes);
  if (problem) {
    console.error(`not fit to serve: ${problem}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
