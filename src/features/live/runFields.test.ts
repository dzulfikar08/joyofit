import { describe, expect, test } from 'bun:test';

import { assignMetric, averagePace, defaultLayout, normalizeLayout, rowSizes, speedFromPace, withCount } from './runFields';

describe('normalizeLayout', () => {
  test('garbage is the default of the sport', () => {
    expect(normalizeLayout(null, 'run')).toEqual(defaultLayout('run'));
    expect(normalizeLayout({ ids: 'x' }, 'ride')).toEqual(defaultLayout('ride'));
    expect(normalizeLayout({ ids: ['nope'] }, 'walk')).toEqual(defaultLayout('walk'));
  });
  test('drops repeats and unknown ids, fills up to four', () => {
    const layout = normalizeLayout({ ids: ['hr', 'hr', 'zzz', 'pace'], big: true }, 'run');
    expect(layout.ids.length).toBe(4);
    expect(layout.ids.slice(0, 2)).toEqual(['hr', 'pace']);
    expect(new Set(layout.ids).size).toBe(4);
    expect(layout.big).toBe(true);
  });
  test('five or more ids make six', () => {
    expect(normalizeLayout({ ids: ['hr', 'pace', 'distance', 'duration', 'cadence'] }, 'run').ids.length).toBe(6);
  });
  test('a stored layout of seven is cut to six', () => {
    expect(normalizeLayout({ ids: ['hr', 'pace', 'distance', 'duration', 'cadence', 'calories', 'speed'] }, 'run').ids.length).toBe(6);
  });
});

describe('withCount', () => {
  test('cuts and fills', () => {
    const four = defaultLayout('ride');
    const six = withCount(four, 6);
    expect(six.ids.slice(0, 4)).toEqual(four.ids);
    expect(new Set(six.ids).size).toBe(6);
    expect(withCount(six, 4).ids).toEqual(four.ids);
  });

  test('run and walk start with six fields, elevation gain among them', () => {
    for (const kind of ['run', 'walk'] as const) {
      expect(defaultLayout(kind).ids).toEqual(['duration', 'distance', 'pace', 'hr', 'elevationGain', 'calories']);
      expect(withCount(defaultLayout(kind), 4).ids).toEqual(['duration', 'distance', 'pace', 'hr']);
    }
  });
});

describe('assignMetric', () => {
  test('swaps with the slot that held the metric', () => {
    const layout = { ids: ['duration', 'distance', 'pace', 'hr'] as const, big: false };
    expect(assignMetric({ ...layout, ids: [...layout.ids] }, 0, 'hr').ids).toEqual(['hr', 'distance', 'pace', 'duration']);
  });
  test('a new metric replaces the slot', () => {
    expect(assignMetric({ ids: ['duration', 'distance', 'pace', 'hr'], big: false }, 2, 'cadence').ids).toEqual(['duration', 'distance', 'cadence', 'hr']);
  });
});

describe('rowSizes', () => {
  test('pairs', () => {
    expect(rowSizes({ ids: ['duration', 'distance', 'pace', 'hr'], big: false })).toEqual([2, 2]);
  });
  test('large first field', () => {
    expect(rowSizes({ ids: ['duration', 'distance', 'pace', 'hr'], big: true })).toEqual([1, 3]);
    expect(rowSizes({ ids: ['duration', 'distance', 'pace', 'hr', 'cadence', 'calories'], big: true })).toEqual([1, 3, 2]);
  });
});

describe('derived figures', () => {
  test('speed from pace', () => {
    expect(speedFromPace(360)).toBe(10);
    expect(speedFromPace(null)).toBeNull();
    expect(speedFromPace(0)).toBeNull();
  });
  test('average pace waits for 10 m', () => {
    expect(averagePace(300, 5)).toBeNull();
    expect(averagePace(300, 1000)).toBe(300);
  });
});
