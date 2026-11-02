// Renders every built-in sticker template with its fixtures to PNG and builds contact sheets.
//   bun scripts/stickers-sheet.ts [--out DIR] [--only <id-prefix>] [--mode dark|light|both] [--locale id|en]
//                                 [--fixtures key,key,...] [--on dusk|day]
// `--only` takes one id prefix or several, comma separated (run.tape.story,run.lanes.story).
// `--fixtures` renders those fixtures (any kind, e.g. run.full,swim.pool,walk.hike,gym.watch) instead of the template kind's own.
// `--on` lays every transparent template over a fixture photo, to judge how an overlay reads on a dusk or a bright day picture.
// Default out: /run/media/dzul/ioswork/stickers/fit. Needs `node` (sharp's SVG text path hangs under Bun).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyLocale, type Locale } from '../src/i18n';
import { lookupPath } from '../src/features/stickers/core/expr';
import { TEMPLATES } from '../src/features/stickers/catalog';
import { FIXTURES, FIXTURE_PHOTOS } from '../src/features/stickers/testing/fixtures';
import { slideData } from '../src/features/stickers/data/threads';
import { offeredSlides } from '../src/features/stickers/threads/slides';
import { THREADS_FIXTURES } from '../src/features/stickers/testing/threadsFixtures';
import { overOnPhoto, rasterize, renderTemplate, type RasterJob, type SheetJob } from '../src/features/stickers/testing/render';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const out = opt('out', '/run/media/dzul/ioswork/stickers/fit');
const only = opt('only', '');
const modes = opt('mode', 'both') === 'both' ? (['dark', 'light'] as const) : ([opt('mode', 'dark')] as ('dark' | 'light')[]);
const locale = opt('locale', 'id') as Locale;
const fixtureKeys = opt('fixtures', '').split(',').filter(Boolean);
const on = opt('on', '');
await applyLocale(locale);

const tmp = join(process.env.TMPDIR ?? '/tmp', 'stickers-sheet');
mkdirSync(tmp, { recursive: true });
mkdirSync(join(out, 'png'), { recursive: true });

// The Threads slides are numbered by their place in the set the workout offers (the fixture data carries a placeholder counter).
const threadsSubjects = new Map(THREADS_FIXTURES.map((f) => [f.key, f.subject()]));

const jobs: RasterJob[] = [];
const sheets: Record<string, SheetJob> = {};
let problems = 0;
const seenOverview = new Set<string>();

const prefixes = only.split(',');
for (const template of TEMPLATES.filter((t) => prefixes.some((prefix) => t.id.startsWith(prefix)))) {
  const fixtures = fixtureKeys.length > 0 ? fixtureKeys.map((key) => FIXTURES.find((f) => f.key === key)!) : FIXTURES.filter((f) => f.kind === template.kind);
  for (const fixture of fixtures) {
    if (template.requires?.some((path) => lookupPath(fixture.data, path) === undefined)) continue;
    // Photo templates are checked on the dusk photo and on the bright day photo in both modes: the worst cases for text.
    const variants: { mode: 'dark' | 'light'; photo?: 'dusk' | 'day' }[] = template.meta?.needsPhoto
      ? modes.flatMap((mode) => (['dusk', 'day'] as const).map((photo) => ({ mode, photo })))
      : modes.map((mode) => ({ mode }));
    for (const { mode, photo } of variants) {
      const name = `${template.id}__${fixture.key}__${mode}${photo ? `-${photo}` : ''}`;
      const threads = template.kind === 'threads' ? threadsSubjects.get(fixture.key) : undefined;
      const offered = threads ? offeredSlides(threads) : [];
      const data = threads ? slideData(threads, { n: offered.findIndex((s) => s.template.id === template.id) + 1, total: offered.length }) : fixture.data;
      const rendered = renderTemplate(template, data, { locale, mode, assets: photo ? { photo: FIXTURE_PHOTOS[photo] } : undefined });
      for (const issue of rendered.issues) {
        problems++;
        console.warn(`[${name}] ${issue.code}: ${issue.message}${issue.layerId ? ` (${issue.layerId})` : ''}`);
      }
      const backdrop = on && rendered.scene.transparent ? on : '';
      const svg = join(tmp, `${name}${backdrop ? `-on-${backdrop}` : ''}.svg`);
      const png = join(out, 'png', `${name}${backdrop ? `-on-${backdrop}` : ''}.png`);
      writeFileSync(svg, backdrop ? overOnPhoto(rendered.svg, backdrop) : rendered.svg);
      jobs.push({ svg, png });
      // The overview shows each template once, on the first fixture that has what it needs (the photo ones on the dusk photo).
      if (!seenOverview.has(`${template.id}-${mode}`) && photo !== 'day') {
        seenOverview.add(`${template.id}-${mode}`);
        (sheets[`overview-${mode}`] ??= { out: join(out, `contact-sheet-${mode}.png`), cols: 12, tileWidth: 210, tiles: [] }).tiles.push({
          png,
          label: template.id,
          transparent: rendered.scene.transparent && !backdrop ? mode : false,
        });
      }
      // The Threads carousel reads as a set: one sheet per workout, its slides in carousel order.
      const sheetKey = template.kind === 'threads' ? `${fixture.key}-${mode}` : `${template.kind}-${mode}${photo ? `-${photo}` : ''}${backdrop ? `-on-${backdrop}` : ''}`;
      (sheets[sheetKey] ??= { out: join(out, `sheet-${sheetKey}.png`), cols: fixtureKeys.length || 6, tileWidth: 300, tiles: [] }).tiles.push({
        png,
        label: `${template.id} / ${fixture.key.split('.')[1]}${photo ? ` / ${photo}` : ''}`,
        transparent: rendered.scene.transparent && !backdrop ? mode : false,
      });
    }
  }
}

await rasterize(tmp, jobs, Object.values(sheets));
writeFileSync(join(out, 'README.txt'), `Generated by scripts/stickers-sheet.ts (${new Date().toISOString()}), locale ${locale}\n`);
console.log(`${jobs.length} renders, ${problems} issues -> ${out}`);
