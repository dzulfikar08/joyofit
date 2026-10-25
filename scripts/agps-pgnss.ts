#!/usr/bin/env bun
// Builds the six `HW_PGNSS_PRED` files and their bundle from public data (CODE orbit predictions, BKG broadcast ephemeris) and checks them
// like the Worker does before serving. The generator lives in packages/agps-pgnss (shared with `GET /v1/agps/hw-pgnss` in
// server/src/agpsPgnss.ts); this is the command-line front.
//
//   bun scripts/agps-pgnss.ts --out /tmp/pgnss                     # fetch today's inputs, write the six files and bundle.jfpg there
//   bun scripts/agps-pgnss.ts --out /tmp/pgnss --ultra COD0OPSULT.SP3 --prediction COD0OPSPRD_05D.SP3 --nav BRDC.rnx.gz \
//       --header BRDM.rnx.gz --now 2026-10-25T05:30:00Z         # offline
//
// LAB TOOL. The watch does not validate what it is sent; do not send the output to a watch that cannot be factory-reset. Data source terms
// and the full reasoning: docs/agps.md "PGNSS lab path".
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { bkgBrdcUrls, OLDEST_USABLE_MS, parseRinexNav, type NavRecord } from '../packages/agps-rtcm/src/rtcm';
import { gpsSecondsAt, validatePgnssBundle } from '../packages/agps-pgnss/src/bundle';
import { bkgBrdmUrls, buildPgnss, CODE_ULTRA_URL, codePredictionUrls, parseNavHeader, sp3Window } from '../packages/agps-pgnss/src/pgnss';
import { parseSp3, type Sp3 } from '../packages/agps-pgnss/src/sp3';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const unpack = (raw: Uint8Array): string => new TextDecoder().decode(raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw);

/** The local file, or the URLs' contents (with `firstOnly`, the first one that answers). */
async function load(file: string | undefined, urls: string[], firstOnly = false): Promise<string[]> {
  if (file) return [unpack(readFileSync(file))];
  const texts: string[] = [];
  for (const url of urls) {
    const res = await fetch(url).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    if (res instanceof Error || !res.ok) {
      console.warn(`${url}: ${res instanceof Error ? res.message : `HTTP ${res.status}`}`);
      continue;
    }
    texts.push(unpack(new Uint8Array(await res.arrayBuffer())));
    if (firstOnly) break;
  }
  return texts;
}

async function main(): Promise<void> {
  const out = arg('out');
  if (!out) throw new Error('usage: bun scripts/agps-pgnss.ts --out <dir> [--ultra f] [--prediction f] [--nav f] [--header f] [--now <ISO time>]');
  const nowArg = arg('now');
  const now = nowArg ? Date.parse(nowArg) : Date.now();
  const t0 = performance.now();
  const [ultra, prediction, navTexts, headerTexts] = await Promise.all([
    load(arg('ultra'), [CODE_ULTRA_URL]),
    load(arg('prediction'), codePredictionUrls(now), true),
    load(arg('nav'), bkgBrdcUrls(now)),
    load(arg('header'), bkgBrdmUrls(now), true),
  ]);
  const t1 = performance.now();
  const [from, to] = sp3Window(gpsSecondsAt(now));
  const orbits: Sp3[] = [...ultra, ...prediction].map((text) => parseSp3(text, from, to));
  const nav: NavRecord[] = navTexts.flatMap((text) => parseRinexNav(text, now - OLDEST_USABLE_MS));
  const header = headerTexts.map(parseNavHeader)[0] ?? { ion: null, utc: null, leap: null };
  const t2 = performance.now();
  const result = buildPgnss({ nowMs: now, orbits, nav, ion: header.ion, utc: header.utc });
  const t3 = performance.now();
  console.log(`fetch ${(t1 - t0).toFixed(0)} ms, parse ${(t2 - t1).toFixed(0)} ms, build+gate ${(t3 - t2).toFixed(0)} ms`);
  orbits.forEach((o, i) => console.log(`orbit ${i}: ${o.comments.slice(0, 3).join(' | ')} (${o.sats.size} satellites, ${o.count} epochs)`));
  if ('problem' in result) {
    console.error(`no build: ${result.problem}`);
    process.exitCode = 1;
    return;
  }
  const { build } = result;
  mkdirSync(out, { recursive: true });
  for (const f of build.files) writeFileSync(join(out, f.name), f.bytes);
  writeFileSync(join(out, 'bundle.jfpg'), build.bundle);
  for (const f of build.files) console.log(`${f.name}: ${f.bytes.length} bytes`);
  console.log(`bundle ${build.bundle.length} bytes; base ${build.base}, GPS slots covered until ${build.coveredUntil} (${(build.coveredUntil - build.builtGps) / 3600} h ahead)`);
  for (const [k, r] of Object.entries(build.report)) {
    const f = (s: { rms: number; max: number }) => `${s.rms.toFixed(2)}/${s.max.toFixed(2)}`;
    console.log(`${k}: ${r.slots} slots, ${r.records} records (sources ${r.bySource.join('/')}), dropped ${r.dropped}; error rms/max m: centre ${f(r.centre)} edge ${f(r.edge)} all ${f(r.all)}`);
  }
  const problem = validatePgnssBundle(build.bundle, now);
  if (problem) {
    console.error(`not fit to serve: ${problem}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
