import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_HOME_CARDS,
  HOME_CARD_IDS,
  isDefaultHomeCards,
  moveHomeCard,
  normalizeHomeCards,
  parseHomeCards,
  serializeHomeCards,
  setHomeCardHidden,
  visibleHomeCards,
} from './homeCards';

describe('default order', () => {
  it('lists every card once, the daily report before the secondary cards', () => {
    expect(new Set(HOME_CARD_IDS).size).toBe(HOME_CARD_IDS.length);
    const at = (id: (typeof HOME_CARD_IDS)[number]) => HOME_CARD_IDS.indexOf(id);
    for (const report of ['insight', 'glance', 'scores', 'activity', 'heart', 'steps', 'sleep', 'energy'] as const) {
      for (const secondary of ['fitness', 'coach', 'family', 'loop'] as const) expect(at(report)).toBeLessThan(at(secondary));
    }
  });

  it('shows everything when nothing is stored', () => {
    expect(parseHomeCards(null)).toBe(DEFAULT_HOME_CARDS);
    expect(visibleHomeCards(DEFAULT_HOME_CARDS)).toEqual([...HOME_CARD_IDS]);
    expect(isDefaultHomeCards(DEFAULT_HOME_CARDS)).toBe(true);
  });
});

describe('normalising what was stored', () => {
  it('keeps the chosen order and drops unknown and repeated ids', () => {
    const prefs = normalizeHomeCards(['loop', 'nope', 'heart', 'loop', 7], ['nope', 'heart', 'heart']);
    expect(prefs.order.slice(0, 2)).toEqual(['loop', 'heart']);
    expect(prefs.hidden).toEqual(['heart']);
    expect(new Set(prefs.order).size).toBe(HOME_CARD_IDS.length);
  });

  it('puts cards a later release adds at the end, shown', () => {
    // Stored by a build that only knew the first three cards, with one hidden.
    const prefs = normalizeHomeCards(['heart', 'scores', 'activity'], ['scores']);
    expect(prefs.order.slice(0, 3)).toEqual(['heart', 'scores', 'activity']);
    expect(prefs.order.slice(3)).toEqual(HOME_CARD_IDS.filter((id) => !['heart', 'scores', 'activity'].includes(id)));
    expect(prefs.hidden).toEqual(['scores']);
    expect(visibleHomeCards(prefs)).not.toContain('scores');
    expect(visibleHomeCards(prefs).at(-1)).toBe(HOME_CARD_IDS.at(-1));
  });

  it('treats a missing or non-list value as unset', () => {
    expect(normalizeHomeCards(undefined, 'x')).toEqual({ order: [...HOME_CARD_IDS], hidden: [] });
  });

  it('falls back to the defaults for damaged or foreign text', () => {
    for (const raw of ['', '{', 'null', '[]', '"x"', '12']) expect(parseHomeCards(raw)).toBe(DEFAULT_HOME_CARDS);
  });
});

describe('persistence round trip', () => {
  it('reads back what it wrote', () => {
    const moved = moveHomeCard(setHomeCardHidden(DEFAULT_HOME_CARDS, 'family', true), 'loop', -3);
    expect(parseHomeCards(serializeHomeCards(moved))).toEqual(moved);
    expect(isDefaultHomeCards(moved)).toBe(false);
  });
});

describe('hiding', () => {
  it('hides and shows one card, keeping its place', () => {
    const hidden = setHomeCardHidden(DEFAULT_HOME_CARDS, 'sleep', true);
    expect(visibleHomeCards(hidden)).not.toContain('sleep');
    expect(hidden.order).toEqual(DEFAULT_HOME_CARDS.order);
    expect(setHomeCardHidden(hidden, 'sleep', false)).toEqual(DEFAULT_HOME_CARDS);
  });

  it('returns the same object when nothing changes', () => {
    expect(setHomeCardHidden(DEFAULT_HOME_CARDS, 'sleep', false)).toBe(DEFAULT_HOME_CARDS);
  });
});

describe('moving', () => {
  it('swaps a card with its neighbour', () => {
    const next = moveHomeCard(DEFAULT_HOME_CARDS, 'heart', -1);
    expect(next.order.slice(2, 5)).toEqual(['scores', 'heart', 'activity']);
    expect(moveHomeCard(next, 'heart', 1)).toEqual(DEFAULT_HOME_CARDS);
  });

  it('stops at both ends without changing anything', () => {
    expect(moveHomeCard(DEFAULT_HOME_CARDS, HOME_CARD_IDS[0], -1)).toBe(DEFAULT_HOME_CARDS);
    expect(moveHomeCard(DEFAULT_HOME_CARDS, HOME_CARD_IDS.at(-1)!, 1)).toBe(DEFAULT_HOME_CARDS);
  });

  it('moves in the full list, so a hidden card between two shown ones keeps the order the settings list shows', () => {
    const hidden = setHomeCardHidden(DEFAULT_HOME_CARDS, 'activity', true);
    const next = moveHomeCard(hidden, 'heart', -1);
    expect(next.order.slice(2, 5)).toEqual(['scores', 'heart', 'activity']);
    expect(next.hidden).toEqual(['activity']);
  });

  it('never leaves a card out or twice', () => {
    let prefs = DEFAULT_HOME_CARDS;
    for (const id of HOME_CARD_IDS) prefs = moveHomeCard(prefs, id, -2);
    expect([...prefs.order].sort()).toEqual([...HOME_CARD_IDS].sort());
  });
});
