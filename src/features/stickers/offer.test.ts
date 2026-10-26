import { describe, expect, test } from 'bun:test';

import { parseTemplate } from './core/parse';
import type { Template } from './core/schema';
import { availableFilters, canvasOf, filterGroups, hasCanvasChoice, initialGroup, offerGroups, pickVariant } from './offer';
import type { StickerSubject } from './subject';
import { kit, template } from './templates/dsl';

function make(id: string, kind: string, aspect: 'story' | 'square' | 'free', extra: { requires?: string[]; meta?: object; style?: string } = {}): Template {
  const k = kit('x');
  const input = template({
    id,
    name: id,
    titleKey: `stickers:tpl.${id}`,
    kind,
    style: extra.style ?? 'bold',
    aspect,
    height: aspect === 'free' ? 800 : undefined,
    background: aspect === 'free' ? { kind: 'transparent' } : { kind: 'color', color: '$bg' },
    dark: {},
    light: {},
    layers: [k.text({ x: 72, y: 300, w: 400 }, 'x')],
    requires: extra.requires,
    meta: extra.meta,
  });
  const parsed = parseTemplate(input);
  expect(parsed.degraded).toBe(false);
  return parsed.template;
}

const TEMPLATES: Template[] = [
  make('run.bold.story', 'run', 'story'),
  make('run.bold.square', 'run', 'square'),
  make('run.route.sticker', 'run', 'free', { requires: ['run.route'], meta: { transparent: true, needsRoute: true }, style: 'sticker' }),
  make('run.photo.story', 'run', 'story', { meta: { needsPhoto: true }, style: 'photo' }),
  make('badge.medal.sticker', 'badge', 'free', { meta: { transparent: true }, style: 'badge' }),
  make('sleep.ring.story', 'sleep', 'story'),
];

function subject(kinds: StickerSubject['kinds'], data: StickerSubject['data']): StickerSubject {
  return { id: 'x', kinds, heading: '', caption: '', date: 0, data };
}

describe('offerGroups', () => {
  test('groups the canvases of a style and keeps kind order', () => {
    const groups = offerGroups(subject(['run', 'badge'], { run: { route: [[0, 0], [1, 1]] } }), TEMPLATES);
    expect(groups.map((g) => g.key)).toEqual(['run.bold', 'run.route', 'run.photo', 'badge.medal']);
    expect(Object.keys(groups[0]!.variants).sort()).toEqual(['square', 'story']);
    expect(groups[0]!.name).toBe('bold');
    expect(groups[0]!.titleKey).toBe('stickers:tpl.run.bold.story');
  });

  test('drops a template whose required data is missing (no route, null route)', () => {
    expect(offerGroups(subject(['run'], { run: { sport: 'Lari' } }), TEMPLATES).map((g) => g.key)).toEqual(['run.bold', 'run.photo']);
    expect(offerGroups(subject(['run'], { run: { route: null } }), TEMPLATES).map((g) => g.key)).toEqual(['run.bold', 'run.photo']);
  });

  test('only the kinds of the subject', () => {
    expect(offerGroups(subject(['sleep'], {}), TEMPLATES).map((g) => g.key)).toEqual(['sleep.ring']);
    expect(offerGroups(subject([], {}), TEMPLATES)).toEqual([]);
  });
});

describe('pickVariant and canvas choice', () => {
  const groups = offerGroups(subject(['run'], { run: { route: [[0, 0], [1, 1]] } }), TEMPLATES);
  const bold = groups.find((g) => g.key === 'run.bold')!;
  const route = groups.find((g) => g.key === 'run.route')!;
  const photo = groups.find((g) => g.key === 'run.photo')!;

  test('picks the wanted canvas, else what the style has', () => {
    expect(pickVariant(bold, 'square').id).toBe('run.bold.square');
    expect(pickVariant(bold, 'story').id).toBe('run.bold.story');
    expect(pickVariant(route, 'square').id).toBe('run.route.sticker');
    expect(pickVariant(photo, 'square').id).toBe('run.photo.story');
  });

  test('the Story / Square switch only matters for styles with both', () => {
    expect(hasCanvasChoice(bold)).toBe(true);
    expect(hasCanvasChoice(route)).toBe(false);
    expect(hasCanvasChoice(photo)).toBe(false);
  });

  test('canvasOf follows the aspect', () => {
    expect(canvasOf(TEMPLATES[0]!)).toBe('story');
    expect(canvasOf(TEMPLATES[1]!)).toBe('square');
    expect(canvasOf(TEMPLATES[2]!)).toBe('sticker');
  });
});

describe('initialGroup', () => {
  const groups = offerGroups(subject(['run', 'badge'], { run: {} }), TEMPLATES);

  test('opens on the default group of the subject when it is offered', () => {
    expect(initialGroup(groups, { defaultGroup: 'badge.medal' })?.key).toBe('badge.medal');
  });

  test('falls back to the first group without a default, or with one the subject cannot show', () => {
    expect(initialGroup(groups, {})?.key).toBe('run.bold');
    // A route sticker needs a route; this subject has none.
    expect(initialGroup(groups, { defaultGroup: 'run.route' })?.key).toBe('run.bold');
    expect(initialGroup([], { defaultGroup: 'run.bold' })).toBeNull();
  });
});

describe('filters', () => {
  const groups = offerGroups(subject(['run', 'badge'], { run: { route: [[0, 0], [1, 1]] } }), TEMPLATES);

  test('card, sticker, photo and badge pick the right groups', () => {
    expect(filterGroups(groups, 'card').map((g) => g.key)).toEqual(['run.bold']);
    expect(filterGroups(groups, 'sticker').map((g) => g.key)).toEqual(['run.route', 'badge.medal']);
    expect(filterGroups(groups, 'photo').map((g) => g.key)).toEqual(['run.photo']);
    expect(filterGroups(groups, 'badge').map((g) => g.key)).toEqual(['badge.medal']);
    expect(filterGroups(groups, 'all')).toHaveLength(4);
  });

  test('filters with nothing behind them are not shown; a single kind of template shows no filters', () => {
    expect(availableFilters(groups)).toEqual(['all', 'card', 'sticker', 'photo', 'badge']);
    const sleepOnly = offerGroups(subject(['sleep'], {}), TEMPLATES);
    expect(availableFilters(sleepOnly)).toEqual([]);
  });
});
