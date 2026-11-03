import { describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';

import { TEMPLATES } from '../catalog';
import { applyCustomMetrics } from '../data/customMetrics';
import { lookupPath } from '../core/expr';
import type { Scene, SceneNode, TextNode } from '../core/scene';
import { measureText } from '../core/text';
import { FIT_FONTS } from '../fonts';
import { offerGroups } from '../offer';
import type { StickerSubject } from '../subject';
import { FIXTURES } from '../testing/fixtures';
import { renderTemplate } from '../testing/render';

const NAMES = ['tape', 'column', 'track', 'lanes', 'swoosh'] as const;
const OVERLAYS = TEMPLATES.filter((t) => NAMES.some((name) => t.id.startsWith(`run.${name}.`)));
/** Every workout fixture, whatever sport family: they all carry the `run.*` namespace the overlays read. */
const WORKOUTS = FIXTURES.filter((f) => lookupPath(f.data, 'run.movingSec') !== undefined);
const ACCENT = { dark: '#f5b35a', light: '#b45f00' };

function textNodes(nodes: readonly SceneNode[]): TextNode[] {
  return nodes.flatMap((node) => (node.k === 'text' ? [node] : node.k === 'group' ? textNodes(node.children) : []));
}

function render(id: string, key: string, locale: 'id' | 'en' = 'en', mode: 'dark' | 'light' = 'dark', options?: Parameters<typeof renderTemplate>[2]['options']) {
  const template = TEMPLATES.find((t) => t.id === id)!;
  const fixture = FIXTURES.find((f) => f.key === key)!;
  return renderTemplate(template, fixture.data, { locale, mode, options });
}

function texts(id: string, key: string, locale: 'id' | 'en' = 'en'): string[] {
  const { scene, issues } = render(id, key, locale);
  expect({ id, key, issues }).toEqual({ id, key, issues: [] });
  // The soft shadow of a text is two more copies of it in translucent black: not words the person reads.
  return textNodes(scene.nodes)
    .filter((node) => node.fill !== '#00000038' && node.fill !== '#0000004d')
    .map((node) => node.text);
}

async function inLocale<T>(locale: 'id' | 'en', run: () => T): Promise<T> {
  await applyLocale(locale);
  try {
    return run();
  } finally {
    await applyLocale('id');
  }
}

/** Every color a scene paints with, as `#rrggbb` (alpha dropped). */
function colorsOf(nodes: readonly SceneNode[]): string[] {
  const plain = (value: unknown) => (typeof value === 'string' ? [value.slice(0, 7)] : []);
  return nodes.flatMap((node): string[] => {
    if (node.k === 'group') return colorsOf(node.children);
    if (node.k === 'image') return [];
    const fill = 'fill' in node ? plain(node.fill) : [];
    const stroke = 'stroke' in node && node.stroke ? plain(node.stroke.color) : [];
    return [...fill, ...stroke];
  });
}

/** A color is chromatic when its channels spread: white, black and the grays are not. */
function chromatic(color: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return Math.max(r!, g!, b!) - Math.min(r!, g!, b!) > 24;
}

describe('run overlays: the five templates', () => {
  test('story and square of each, transparent, free of issues, with a title in both languages', () => {
    expect(OVERLAYS.map((t) => t.id).sort()).toEqual(NAMES.flatMap((name) => [`run.${name}.square`, `run.${name}.story`]).sort());
    for (const template of OVERLAYS) {
      expect({ id: template.id, transparent: template.meta?.transparent, height: template.canvas.height }).toEqual({
        id: template.id,
        transparent: true,
        height: template.canvas.aspect === 'story' ? 1920 : 1080,
      });
    }
  });

  test('every sport family renders cleanly: id and en, dark and light, both canvases, text inside the canvas and 22 px or more', async () => {
    for (const locale of ['id', 'en'] as const) {
      await applyLocale(locale);
      try {
        for (const template of OVERLAYS) {
          for (const fixture of WORKOUTS) {
            for (const mode of ['dark', 'light'] as const) {
              const where = `${template.id} / ${fixture.key} / ${mode} / ${locale}`;
              const { scene, issues } = renderTemplate(template, fixture.data, { locale, mode });
              expect({ where, issues }).toEqual({ where, issues: [] });
              expect({ where, transparent: scene.transparent }).toEqual({ where, transparent: true });
              for (const node of textNodes(scene.nodes)) {
                const width = measureText(node.text, FIT_FONTS.metrics(node.font, node.weight), node.size) + (node.letterSpacing ?? 0) * node.text.length;
                const left = node.anchor === 'middle' ? node.x - width / 2 : node.anchor === 'end' ? node.x - width : node.x;
                expect({ where, text: node.text, inside: left >= -1 && left + width <= 1081 }).toEqual({ where, text: node.text, inside: true });
                expect({ where, text: node.text, size: node.size >= 22 }).toEqual({ where, text: node.text, size: true });
                expect({ where, text: node.text, leaked: /stickers:|undefined|NaN|\{|\}/.test(node.text) }).toEqual({ where, text: node.text, leaked: false });
              }
            }
          }
        }
      } finally {
        await applyLocale('id');
      }
    }
  });

  test('one accent per template: the only color that is not white, black or gray', () => {
    for (const template of OVERLAYS) {
      for (const fixture of WORKOUTS) {
        const scene = render(template.id, fixture.key).scene;
        const hues = new Set(colorsOf(scene.nodes).filter(chromatic));
        expect({ id: template.id, fixture: fixture.key, hues: [...hues] }).toEqual({ id: template.id, fixture: fixture.key, hues: [...hues].filter((hue) => hue === ACCENT.dark) });
      }
    }
    // The accent is a theme token: the light palette swaps it for the darker amber, nothing else changes color.
    for (const template of OVERLAYS) {
      const light = colorsOf(render(template.id, 'run.full', 'en', 'light').scene.nodes);
      expect({ id: template.id, accent: light.includes(ACCENT.light) }).toEqual({ id: template.id, accent: true });
    }
  });

  test('a run: distance in km, duration, pace per km, in the card language', async () => {
    for (const id of OVERLAYS.map((t) => t.id)) {
      const en = await inLocale('en', () => texts(id, 'run.full', 'en'));
      expect({ id, distance: en.includes('5.24'), duration: en.includes('33:12'), pace: en.includes('6:20') }).toEqual({ id, distance: true, duration: true, pace: true });
      const idn = await inLocale('id', () => texts(id, 'run.full', 'id'));
      expect({ id, distance: idn.includes('5,24'), duration: idn.includes('33:12') }).toEqual({ id, distance: true, duration: true });
    }
  });

  test('labels follow the card locale: Jarak and Durasi in id, Distance and Duration in en', async () => {
    // The tapes and the swoosh set the distance label in capitals; the duration label is plain everywhere.
    const capitals = (id: string) => id.startsWith('run.tape.') || id.startsWith('run.swoosh.');
    for (const id of OVERLAYS.map((t) => t.id)) {
      const idn = await inLocale('id', () => texts(id, 'run.full', 'id'));
      const en = await inLocale('en', () => texts(id, 'run.full', 'en'));
      const distance = (text: string) => (capitals(id) ? text.toUpperCase() : text);
      expect({ id, jarak: idn.includes(distance('Jarak')), durasi: idn.includes('Durasi') }).toEqual({ id, jarak: true, durasi: true });
      expect({ id, distance: en.includes(distance('Distance')), duration: en.includes('Duration') }).toEqual({ id, distance: true, duration: true });
      expect(idn).not.toContain('Distance');
      expect(en).not.toContain('Jarak');
    }
  });

  test('a swim reads metres and a pace per 100 m, a ride a speed, a walk a pace per km', async () => {
    await applyLocale('en');
    try {
      for (const id of OVERLAYS.map((t) => t.id)) {
        const swim = texts(id, 'swim.pool');
        expect({ id, metres: swim.includes('1,500'), per100: swim.some((t) => t.toLowerCase() === '/100 m'), km: swim.some((t) => t.toLowerCase() === 'km') }).toEqual({ id, metres: true, per100: true, km: false });
        const ride = texts(id, 'ride.outdoor');
        expect({ id, speed: ride.includes('25.8'), kmh: ride.some((t) => t.toLowerCase() === 'km/h'), pace: ride.some((t) => /pace/i.test(t)) }).toEqual({ id, speed: true, kmh: true, pace: false });
        const walk = texts(id, 'walk.hike');
        expect({ id, pace: walk.includes('19:33'), perKm: walk.some((t) => t.toLowerCase() === '/km') }).toEqual({ id, pace: true, perKm: true });
      }
    } finally {
      await applyLocale('id');
    }
  });

  test('without a distance the duration is the hero, once, and the heart rate and calories fill the other slots', async () => {
    await applyLocale('en');
    try {
      for (const id of OVERLAYS.map((t) => t.id)) {
        const gym = texts(id, 'gym.watch');
        const where = { id, durations: gym.filter((t) => t === '52:00').length, distance: gym.some((t) => /distance/i.test(t)), pace: gym.some((t) => /pace|speed/i.test(t)) };
        expect(where).toEqual({ id, durations: 1, distance: false, pace: false });
        expect({ id, hr: gym.includes('118'), kcal: gym.includes('318') }).toEqual({ id, hr: true, kcal: true });
      }
    } finally {
      await applyLocale('id');
    }
  });

  test('a workout with only a duration still draws a card: the duration and nothing blank', async () => {
    await applyLocale('en');
    try {
      for (const id of OVERLAYS.map((t) => t.id)) {
        const out = texts(id, 'flow.sparse');
        expect({ id, duration: out.includes('15:00'), blank: out.some((t) => t.trim() === '' || t.includes('-')) }).toEqual({ id, duration: true, blank: false });
      }
    } finally {
      await applyLocale('id');
    }
  });

  test('cadence reads spm on foot and rpm on a bike; the column keeps the order distance, duration, pace, heart rate, cadence', async () => {
    await applyLocale('en');
    try {
      const run = texts('run.column.story', 'run.full');
      const order = ['Distance', 'Duration', 'Avg pace', 'Avg HR', 'Cadence'].map((label) => run.indexOf(label));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(run).toContain('spm');
      const ride = texts('run.column.story', 'ride.outdoor');
      expect(ride).toContain('rpm');
      expect(ride).not.toContain('spm');
    } finally {
      await applyLocale('id');
    }
  });

  test('the tape draws the pace and the distance in capitals on two tapes; without them it falls back to heart rate and calories', async () => {
    await applyLocale('en');
    try {
      const run = texts('run.tape.story', 'run.full');
      for (const word of ['AVG PACE', 'DISTANCE', '/KM', 'KM']) expect(run).toContain(word);
      const gym = texts('run.tape.story', 'gym.watch');
      for (const word of ['AVG HR', 'CALORIES', 'BPM', 'KCAL']) expect(gym).toContain(word);
      const sparse = texts('run.tape.story', 'flow.sparse');
      expect(sparse.some((t) => t === t.toUpperCase() && /[A-Z]{3}/.test(t))).toBe(false);
    } finally {
      await applyLocale('id');
    }
  });

  test('the route follows the privacy trim and is left out when the workout has none', () => {
    const lines = (scene: Scene) => scene.nodes.filter((n) => n.k === 'path').length;
    for (const id of ['run.tape.story', 'run.column.story', 'run.swoosh.story']) {
      const withRoute = render(id, 'run.full', 'en', 'dark', { watermark: true, hideNumbers: false, showName: false, privacy: { routeTrimMeters: 200 } }).scene;
      const indoor = render(id, 'run.indoor').scene;
      expect({ id, drawn: lines(withRoute) > lines(indoor) }).toEqual({ id, drawn: true });
      // A trim longer than the route (a 5 km loop under 3 km trims) leaves the route out, never a stub.
      const trimmedAway = render(id, 'run.full', 'en', 'dark', { watermark: true, hideNumbers: false, showName: false, privacy: { routeTrimMeters: 4000 } }).scene;
      expect({ id, drawn: lines(trimmedAway) === lines(indoor) }).toEqual({ id, drawn: true });
    }
  });

  test('the JoyoFit mark is a watermark: it goes when the person turns it off and nothing else moves', () => {
    for (const id of OVERLAYS.map((t) => t.id)) {
      const on = textNodes(render(id, 'run.full', 'en', 'dark', { watermark: true, hideNumbers: false, showName: false, privacy: { routeTrimMeters: 200 } }).scene.nodes).map((t) => t.text);
      const off = textNodes(render(id, 'run.full', 'en', 'dark', { watermark: false, hideNumbers: false, showName: false, privacy: { routeTrimMeters: 200 } }).scene.nodes).map((t) => t.text);
      expect({ id, brandOn: on.includes('JoyoFit'), brandOff: off.includes('JoyoFit') }).toEqual({ id, brandOn: true, brandOff: false });
      expect(off).toEqual(on.filter((t) => t !== 'JoyoFit'));
    }
  });

  test('they are offered for every sport family as transparent stickers, in both canvases, without a photo', () => {
    for (const fixture of WORKOUTS) {
      const kind = fixture.kind === 'run' ? ['run'] : [fixture.kind, 'run'];
      const subject = { kinds: kind, data: fixture.data } as unknown as StickerSubject;
      const groups = offerGroups(subject);
      for (const name of NAMES) {
        const group = groups.find((g) => g.key === `run.${name}`);
        expect({ fixture: fixture.key, name, story: group?.variants.story?.id, square: group?.variants.square?.id }).toEqual({
          fixture: fixture.key,
          name,
          story: `run.${name}.story`,
          square: `run.${name}.square`,
        });
        expect({ name, transparent: group!.transparent, needsPhoto: group!.needsPhoto }).toEqual({ name, transparent: true, needsPhoto: false });
      }
    }
  });

  test('no third-party brand', async () => {
    await applyLocale('en');
    try {
      for (const id of OVERLAYS.map((t) => t.id)) {
        const out = texts(id, 'run.full').join(' ');
        expect({ id, brand: /huawei|honor|strava|health connect|apple health/i.test(out) }).toEqual({ id, brand: false });
      }
    } finally {
      await applyLocale('id');
    }
  });

  test('custom metrics render into hero and secondary slots across all overlays', () => {
    const fixture = FIXTURES.find((f) => f.key === 'run.full')!;
    const customData = applyCustomMetrics(
      fixture.data,
      {
        heroId: 'hr',
        secondaryIds: ['cadence', 'kcal'],
      },
      { locale: 'en' },
    );

    for (const template of OVERLAYS) {
      const { scene, issues } = renderTemplate(template, customData, { locale: 'en', mode: 'dark' });
      expect({ id: template.id, issues }).toEqual({ id: template.id, issues: [] });
      const allTexts = textNodes(scene.nodes).map((n) => n.text);
      expect(allTexts).toContain('154');
      expect(allTexts).toContain('172');
    }
  });

  test('custom metrics with only 1 secondary metric render without error', () => {
    const fixture = FIXTURES.find((f) => f.key === 'run.full')!;
    const customData = applyCustomMetrics(
      fixture.data,
      {
        heroId: 'hr',
        secondaryIds: ['cadence'],
      },
      { locale: 'en' },
    );

    for (const template of OVERLAYS) {
      const { scene, issues } = renderTemplate(template, customData, { locale: 'en', mode: 'dark' });
      expect({ id: template.id, issues }).toEqual({ id: template.id, issues: [] });
      const allTexts = textNodes(scene.nodes).map((n) => n.text);
      expect(allTexts).toContain('154');
      expect(allTexts).toContain('172');
    }
  });
});
