/**
 * Goldens of the five run overlays (tape, column, track, lanes, swoosh) per sport family. The generic golden test renders each
 * template once, on the GPS run; the overlays read different numbers per family (km or metres, a pace or a speed, no distance
 * at all), so a ride, a pool swim, a hike, a gym session and a stretch each get their own render here, in dark, both canvases.
 * `UPDATE_GOLDENS=1 bun test src/features/stickers/testing/overlayGolden.test.ts` rewrites them.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyLocale } from '@/i18n';

import { TEMPLATES } from '../catalog';
import { FIXTURES } from './fixtures';
import { rasterize, renderTemplate, type RasterJob } from './render';

const GOLDENS = join(import.meta.dir, '__goldens__/overlays');
const UPDATE = process.env.UPDATE_GOLDENS === '1';
const TMP = join(process.env.TMPDIR ?? '/tmp', 'overlay-golden');
const NAMES = ['tape', 'column', 'track', 'lanes', 'swoosh'];
const FAMILIES = ['ride.outdoor', 'swim.pool', 'walk.hike', 'gym.watch', 'flow.sparse'];

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

describe('run overlays, per sport family', () => {
  test('every overlay matches its golden PNG and scene hash on a ride, a swim, a hike, a gym session and a stretch', async () => {
    await applyLocale('id');
    mkdirSync(TMP, { recursive: true });
    mkdirSync(GOLDENS, { recursive: true });
    const jobs: RasterJob[] = [];
    const hashes: Record<string, string> = {};
    for (const template of TEMPLATES.filter((t) => NAMES.some((name) => t.id.startsWith(`run.${name}.`)))) {
      for (const key of FAMILIES) {
        const fixture = FIXTURES.find((f) => f.key === key)!;
        const name = `${template.id}__${key}__dark`;
        const rendered = renderTemplate(template, fixture.data, { locale: 'id', mode: 'dark' });
        expect({ name, issues: rendered.issues }).toEqual({ name, issues: [] });
        hashes[name] = hash(JSON.stringify(rendered.scene));
        const svg = join(TMP, `${name}.svg`);
        writeFileSync(svg, rendered.svg);
        jobs.push({ svg, png: join(TMP, `${name}.png`), width: 300, golden: name });
      }
    }
    const results = join(TMP, 'results.json');
    await rasterize(TMP, jobs, [], { dir: GOLDENS, update: UPDATE, maxDiffRatio: 0.004, channelTolerance: 28, results });
    const outcome = JSON.parse(readFileSync(results, 'utf8')) as { name: string; ok: boolean }[];
    expect(outcome.filter((r) => !r.ok)).toEqual([]);

    const hashFile = join(GOLDENS, 'scene-hashes.json');
    if (UPDATE || !existsSync(hashFile)) writeFileSync(hashFile, `${JSON.stringify(hashes, null, 2)}\n`);
    else {
      const known = JSON.parse(readFileSync(hashFile, 'utf8')) as Record<string, string>;
      expect(Object.keys(hashes).filter((name) => known[name] !== hashes[name])).toEqual([]);
    }
  }, 180_000);
});
