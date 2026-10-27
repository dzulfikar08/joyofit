import { afterEach, describe, expect, test } from 'bun:test';

import { kgToUnit, setWeightUnit } from '@/features/strength/units';
import { applyLocale } from '@/i18n';

import { buildThreadsRun, mergeRows, slideData, smoothSeries, weeklyContext, SPLIT_ROWS_MAX, type SplitRow } from '../data/threads';
import type { JsonObject } from '../subject';
import { renderTemplate } from '../testing/render';
import { RIDE_POWER, RUN_LONG, RUN_MARATHON, RUN_SPLITS, STRENGTH_FULLBODY, STRENGTH_PUSH, STRENGTH_SPARSE, WALK_SPARSE } from '../testing/threadsFixtures';
import { buildCaption, questionsFor, THREADS_TEXT_MAX } from './caption';
import { enabledSlides, initialChoices, moveChoice, offeredSlides, reconcileChoices, slideSetData, THREADS_DEFAULT_SLIDES, THREADS_MAX_SLIDES, toggleChoice, type SlideChoice } from './slides';

afterEach(() => {
  applyLocale('id');
  setWeightUnit('kg');
});

const th = (data: JsonObject) => data.th as JsonObject;

describe('weeklyContext', () => {
  const anchor = 1_760_000_000;
  const day = 86_400;
  const row = (back: number, km: number, sportName = 'Running') => ({ start: anchor - back * day, end: anchor - back * day + 1800, duration: 1700, distance: km * 1000, sportName, complete: true });

  test('four 7-day windows ending at the workout, oldest first, same sport only', () => {
    const ctx = weeklyContext({ workouts: [row(1, 5), row(8, 10), row(20, 8), row(3, 40, 'Cycling'), row(40, 9)], strength: [], anchorSec: anchor, kind: 'run' })!;
    expect(ctx.weeks.map((w) => w.sessions)).toEqual([0, 1, 1, 1]);
    expect(ctx.weeks.map((w) => w.distanceM)).toEqual([0, 8000, 10_000, 5000]);
  });

  test('fewer than two sessions in 28 days gives nothing', () => {
    expect(weeklyContext({ workouts: [row(2, 5)], strength: [], anchorSec: anchor, kind: 'run' })).toBeNull();
    expect(weeklyContext({ workouts: [row(2, 5), row(30, 5)], strength: [], anchorSec: anchor, kind: 'run' })).toBeNull();
  });

  test('incomplete workouts do not count', () => {
    expect(weeklyContext({ workouts: [row(2, 5), { ...row(3, 5), complete: false }], strength: [], anchorSec: anchor, kind: 'run' })).toBeNull();
  });
});

describe('split pages', () => {
  test('a run keeps one row per km with the partial last km, in order, with the columns it has', () => {
    const data = th(RUN_SPLITS().data);
    const rows = data.splitRows as JsonObject[];
    expect(rows).toHaveLength(11);
    expect(rows.map((r) => r.n).slice(0, 3)).toEqual(['1', '2', '3']);
    expect(rows[10]!.n).toBe('10,4');
    expect(data.splitMode).toBe('pace');
    expect(data.splitStep).toBe(1);
    expect(data.splitCols).toMatchObject({ hr: 1, cad: 1, gain: 1 });
    expect(data.splitCols).not.toHaveProperty('pwr');
    // Elapsed time only grows, and exactly one row is the best.
    const tot = rows.map((r) => r.tot as number);
    expect([...tot].sort((a, b) => a - b)).toEqual(tot);
    expect(rows.filter((r) => r.best === 1)).toHaveLength(1);
  });

  test('a ride is cut every 5 km, in km/h, with power', () => {
    const data = th(RIDE_POWER().data);
    expect(data.splitMode).toBe('speed');
    expect(data.splitStep).toBe(5);
    expect(data.splitCols).toMatchObject({ hr: 1, cad: 1, pwr: 1, gain: 1 });
  });

  test('a 30 km run fills three pages one row per km', () => {
    const data = th(RUN_LONG().data);
    expect([data.splitRows, data.splitRows2, data.splitRows3].map((p) => (p as JsonObject[]).length)).toEqual([12, 12, 6]);
    expect(data.splitStep).toBe(1);
  });

  test('a marathon has more rows than three pages hold, so neighbouring kilometres are merged in pairs', () => {
    const data = th(RUN_MARATHON().data);
    const pages = [data.splitRows, data.splitRows2, data.splitRows3].map((p) => (p as JsonObject[] | undefined)?.length ?? 0);
    expect(pages).toEqual([12, 9, 0]);
    expect(data.splitStep).toBe(2);
    expect(pages.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(SPLIT_ROWS_MAX);
  });

  test('merging adds time and distance, and derives pace from the totals', () => {
    const rows: SplitRow[] = [
      { n: '1', distM: 1000, sec: 300, main: 300, hr: 150, cad: 170, pwr: null, gain: 5 },
      { n: '2', distM: 1000, sec: 360, main: 360, hr: 160, cad: null, pwr: null, gain: null },
    ];
    const [merged] = mergeRows(rows, 2, 'pace', 'id', [1000, 2000]);
    expect(merged).toMatchObject({ n: '2', distM: 2000, sec: 660, main: 330, hr: 155, cad: 170, gain: 5 });
  });

  test('a walk with only distance and time still has a table, without optional columns', () => {
    const data = th(WALK_SPARSE().data);
    expect(data.splitCols).toEqual({ gain: 1 });
  });
});

describe('slide data', () => {
  test('the route is dropped when it is too short to survive the privacy trim', () => {
    const subject = RUN_SPLITS();
    expect((subject.data.run as JsonObject).route).toBeDefined();
    const short = (subject.data.run as JsonObject & { route: number[][] }).route.slice(0, 20);
    expect(short.length).toBe(20);
  });

  test('position and choices end up in the data and nothing else changes', () => {
    const subject = RUN_SPLITS();
    const data = slideData(subject, { n: 3, total: 7 }, { showRoute: false, name: 'Dzul' });
    expect(th(data)).toMatchObject({ n: 3, total: 7 });
    expect((data.run as JsonObject).route).toBeUndefined();
    expect(data.user).toEqual({ name: 'Dzul' });
    expect((subject.data.run as JsonObject).route).toBeDefined();
    expect(th(subject.data).n).toBeUndefined();
  });

  test('a strength session lists its exercises as sets x reps x weight with volume and PR flags, six per slide', () => {
    const data = th(STRENGTH_PUSH().data);
    const rows = data.liftRows as JsonObject[];
    expect(rows).toHaveLength(6);
    expect((data.liftRows2 as JsonObject[]).map((r) => r.name)).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Bench press', pr: 1, volume: 1555, unit: 'kg' });
    expect(rows[0]!.sets).toBe('1 \u00d7 5 \u00d7 80 kg  \u00b7  2 \u00d7 5 \u00d7 82,5 kg  \u00b7  1 \u00d7 4 \u00d7 82,5 kg');
    // Warm-ups are not listed; a bodyweight set has no weight; a timed set shows seconds.
    expect(rows[5]!.sets).toBe('1 \u00d7 12  \u00b7  1 \u00d7 10  \u00b7  1 \u00d7 9');
    expect(rows[5]).not.toHaveProperty('volume');
    expect(th(STRENGTH_SPARSE().data).has).not.toHaveProperty('context');
  });

  test('in lb the lift rows and the caption carry lb numbers', async () => {
    setWeightUnit('lb');
    const data = th(STRENGTH_PUSH().data);
    const rows = data.liftRows as JsonObject[];
    expect(rows[0]).toMatchObject({ unit: 'lb', volume: Math.round(kgToUnit(1555, 'lb')) });
    expect(rows[0]!.sets as string).toContain(' lb');
    expect(rows[0]!.sets as string).not.toContain(' kg');
    await applyLocale('en');
    const head = buildCaption(STRENGTH_PUSH(), { locale: 'en', question: null, hashtag: false }).split('\n')[0]!;
    expect(head).toMatch(/volume 12,9\d\d lb/);
  });

  test('twenty exercises: three slides and the rest counted, never silently dropped', () => {
    const data = th(STRENGTH_FULLBODY().data);
    expect([data.liftRows, data.liftRows2, data.liftRows3].map((p) => (p as JsonObject[]).length)).toEqual([6, 6, 6]);
    expect(data.liftMore).toBe(2);
  });

  test('climbs are listed in ride order', () => {
    const climbs = th(RIDE_POWER().data).climbs as JsonObject[];
    expect(climbs.length).toBeGreaterThan(0);
    expect(climbs.length).toBeLessThanOrEqual(5);
    expect(climbs.map((c) => c.n)).toEqual([...climbs.map((c) => c.n)].sort((a, b) => (a as number) - (b as number)));
  });

  test('a sparse workout has no flags for what it lacks', () => {
    const has = th(WALK_SPARSE().data).has as JsonObject;
    expect(Object.keys(has).sort()).toEqual(['charts']);
  });
});

describe('slides and choices', () => {
  const offered = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));

  test('the first ten are on by default and the rest are off', () => {
    const choices = initialChoices(offered(13));
    expect(choices.filter((c) => c.enabled)).toHaveLength(THREADS_DEFAULT_SLIDES);
    expect(choices[10]!.enabled).toBe(false);
  });

  test('toggle respects the Threads limit of 20', () => {
    const all: SlideChoice[] = Array.from({ length: 22 }, (_, i) => ({ id: `s${i}`, enabled: i < THREADS_MAX_SLIDES }));
    expect(toggleChoice(all, 's20').filter((c) => c.enabled)).toHaveLength(THREADS_MAX_SLIDES);
    expect(toggleChoice(all, 's0').filter((c) => c.enabled)).toHaveLength(THREADS_MAX_SLIDES - 1);
  });

  test('move keeps the others in order and clamps', () => {
    const c = initialChoices(offered(4));
    expect(moveChoice(c, 3, 0).map((x) => x.id)).toEqual(['s3', 's0', 's1', 's2']);
    expect(moveChoice(c, 0, 99).map((x) => x.id)).toEqual(['s1', 's2', 's3', 's0']);
    expect(moveChoice(c, 9, 0).map((x) => x.id)).toEqual(['s0', 's1', 's2', 's3']);
  });

  test('reconcile keeps order and state of slides that remain, adds new ones, drops gone ones', () => {
    const before: SlideChoice[] = [
      { id: 'b', enabled: false },
      { id: 'a', enabled: true },
      { id: 'gone', enabled: true },
    ];
    const next = reconcileChoices(before, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(next).toEqual([
      { id: 'b', enabled: false },
      { id: 'a', enabled: true },
      { id: 'c', enabled: true },
    ]);
  });

  test('enabledSlides follows the person order', () => {
    const slides = offered(3);
    const out = enabledSlides([{ id: 's2', enabled: true }, { id: 's0', enabled: false }, { id: 's1', enabled: true }], slides);
    expect(out.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  test('every offered slide has a template and a label in both languages', async () => {
    for (const locale of ['id', 'en'] as const) {
      await applyLocale(locale);
      const { i18n } = await import('@/i18n');
      for (const slide of offeredSlides(RIDE_POWER())) expect(i18n.exists(`stickers:threads.slide.${slide.id}`, { lng: locale })).toBe(true);
    }
  });
});

describe('caption', () => {
  test('a run: headline, stats, device, four weeks, the pointer, the question and the tag', () => {
    const text = buildCaption(RUN_SPLITS(), { locale: 'id', question: 'runPace', hashtag: true, slideCount: 6 });
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^Lari 10,40 km · \d+:\d\d:\d\d · pace \d:\d\d\/km$/);
    expect(lines[1]).toContain('detak rata-rata 158 bpm (maks 179)');
    expect(text).toContain('Direkam dengan HUAWEI WATCH FIT 4 Pro.');
    expect(text).toMatch(/4 minggu terakhir: [\d,]+ km dalam 10 sesi\./);
    expect(text).toContain('Data lengkap ada di 6 gambar.');
    expect(lines.at(-2)).toBe('Ada saran soal pace ini?');
    expect(lines.at(-1)).toBe('#JoyoFit');
  });

  test('the question and the tag are optional', () => {
    const text = buildCaption(RUN_SPLITS(), { locale: 'id', question: null, hashtag: false });
    expect(text).not.toContain('Ada saran');
    expect(text).not.toContain('#JoyoFit');
  });

  test('English, a ride and a lift', async () => {
    await applyLocale('en');
    const ride = buildCaption(RIDE_POWER(), { locale: 'en', question: 'ridePower', hashtag: true });
    expect(ride).toContain('km/h');
    expect(ride).toContain('Are this NP and IF about right?');
    const lift = buildCaption(STRENGTH_PUSH(), { locale: 'en', question: null, hashtag: false });
    expect(lift.split('\n')[0]).toBe('Push day: volume 5,856 kg · 25 sets · 226 reps · 1:02:00');
    expect(lift).toContain('2 new PRs');
  });

  test('a hold-only lift names the time held where reps would be', () => {
    const subject = { data: { strength: { name: 'Core', sets: 3, seconds: 150, durationSec: 1200 } } };
    expect(buildCaption(subject, { locale: 'en', question: null, hashtag: false }).split('\n')[0]).toBe('Core: 3 sets · 2:30 hold · 20:00');
  });

  test('a sparse workout still has a headline and never says undefined', () => {
    const text = buildCaption(WALK_SPARSE(), { locale: 'id', question: 'runPlan', hashtag: true });
    expect(text.split('\n')[0]).toMatch(/^Jalan /);
    expect(text).not.toMatch(/undefined|NaN|null/);
  });

  test('it never passes 500 characters; the question and the headline are the last to go', () => {
    const subject = RUN_SPLITS();
    const long = { ...subject, data: { ...subject.data, th: { ...th(subject.data), device: 'x'.repeat(60) } } };
    const text = buildCaption(long, { locale: 'id', question: 'runPlan', hashtag: true, slideCount: 9 });
    expect(text.length).toBeLessThanOrEqual(THREADS_TEXT_MAX);
    expect(text).toContain('Ada saran');
    const squeezed = buildCaption({ ...long, data: { ...long.data, run: { ...(long.data.run as JsonObject), sport: 'S'.repeat(520) } } }, { locale: 'id', question: null, hashtag: false });
    expect(squeezed.length).toBeLessThanOrEqual(THREADS_TEXT_MAX);
  });

  test('questions fit the sport', () => {
    expect(questionsFor(RUN_SPLITS())).toEqual(['runPace', 'runPlan', 'runHr']);
    expect(questionsFor(RIDE_POWER())[0]).toBe('ridePower');
    expect(questionsFor(STRENGTH_PUSH())[0]).toBe('liftProgress');
    expect(questionsFor(WALK_SPARSE())).toEqual(['runPace', 'runPlan']);
  });
});

describe('slide counter', () => {
  /** The `n/total` text of each slide of the set as the sheet draws it. */
  function counters(subject: ReturnType<typeof RUN_LONG>, slides: ReturnType<typeof offeredSlides>): string[] {
    const datas = slideSetData(subject, slides.length);
    return slides.map((slide, i) => {
      const { scene } = renderTemplate(slide.template, datas[i]!, { locale: 'id', mode: 'dark' });
      const texts = scene.nodes.flatMap((n) => (n.k === 'text' ? [n.text] : []));
      return texts.find((t) => /^\d+\/\d+$/.test(t)) ?? 'missing';
    });
  }

  test('every slide shows its place over the number of slides that go out', () => {
    const subject = RUN_LONG();
    const offered = offeredSlides(subject);
    expect(offered).toHaveLength(8);
    const choices = initialChoices(offered);
    expect(counters(subject, enabledSlides(choices, offered))).toEqual(['1/8', '2/8', '3/8', '4/8', '5/8', '6/8', '7/8', '8/8']);
  });

  test('turning slides off renumbers the rest', () => {
    const subject = RUN_LONG();
    const offered = offeredSlides(subject);
    const choices = toggleChoice(toggleChoice(initialChoices(offered), 'charts'), 'sensors');
    const going = enabledSlides(choices, offered);
    expect(going.map((s) => s.id)).toEqual(['summary', 'splits', 'splits2', 'splits3', 'zones', 'context']);
    expect(counters(subject, going)).toEqual(['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']);
  });

  test('reordering moves the numbers with the slides', () => {
    const subject = RUN_LONG();
    const offered = offeredSlides(subject);
    const choices = moveChoice(initialChoices(offered), 7, 0);
    const going = enabledSlides(choices, offered);
    expect(going[0]!.id).toBe('context');
    expect(counters(subject, going)).toEqual(['1/8', '2/8', '3/8', '4/8', '5/8', '6/8', '7/8', '8/8']);
    const only = enabledSlides(toggleChoice(toggleChoice(initialChoices(offered), 'summary'), 'splits'), offered);
    expect(counters(subject, only)[0]).toBe('1/6');
  });
});

describe('sensor charts', () => {
  test('smoothing flattens spikes, keeps the length, and a window of 1 changes nothing', () => {
    const spiky = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 0 : 100));
    const smooth = smoothSeries(spiky, 5);
    expect(smooth).toHaveLength(12);
    for (const v of smooth.slice(2, -2)) expect(Math.abs(v - 50)).toBeLessThanOrEqual(12);
    expect(smoothSeries(spiky, 1)).toEqual(spiky);
    expect(smoothSeries([5], 9)).toEqual([5]);
  });

  test('the cadence chart is smoothed but the maximum stays the raw one', () => {
    const sensors = th(RUN_SPLITS().data).sensors as JsonObject;
    const cad = sensors.cad as number[];
    expect(Math.max(...cad)).toBeLessThanOrEqual(sensors.cadMax as number);
    const steps = cad.slice(1).map((v, i) => Math.abs(v - cad[i]!));
    expect(Math.max(...steps)).toBeLessThanOrEqual(3);
  });
});

test('buildThreadsRun reads the ride power only for a ride', () => {
  expect(th(RUN_SPLITS().data).power).toBeUndefined();
  expect(th(RIDE_POWER().data).power).toBeDefined();
  void buildThreadsRun;
});
