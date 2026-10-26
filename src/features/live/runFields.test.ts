import { describe, expect, test } from 'bun:test';

import {
  assignMetric,
  averagePace,
  defaultLayout,
  fieldCounts,
  gridPages,
  normalizeLayout,
  rowSizes,
  speedFromPace,
  strideLength,
  withCount,
  type RunLayout,
  type RunMetricId,
} from './runFields';

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
  test('a stored layout of seven is filled to eight, one of fourteen cut to twelve', () => {
    expect(normalizeLayout({ ids: ['hr', 'pace', 'distance', 'duration', 'cadence', 'calories', 'speed'] }, 'run').ids.length).toBe(8);
    const fourteen: RunMetricId[] = ['duration', 'distance', 'pace', 'avgPace', 'speed', 'hr', 'hrZone', 'avgHr', 'maxHr', 'calories', 'cadence', 'steps', 'stride', 'altitude'];
    expect(normalizeLayout({ ids: fourteen }, 'run').ids).toEqual(fourteen.slice(0, 12));
  });
});

describe('a screen that cannot read some metrics (indoor ride, indoor "other")', () => {
  const indoorRide: RunMetricId[] = ['elevationGain', 'altitude', 'steps', 'stride'];
  test('the editor offers no count above the metrics left', () => {
    expect(fieldCounts()).toEqual([4, 6, 8, 10, 12]);
    expect(fieldCounts(indoorRide)).toEqual([4, 6, 8, 10]);
  });
  test('twelve on such a screen never brings an excluded metric back', () => {
    const filled = withCount(defaultLayout('ride'), 12, indoorRide);
    const saved = normalizeLayout(filled, 'ride', indoorRide);
    expect(saved.ids.some((id) => indoorRide.includes(id))).toBe(false);
    expect(saved.ids.length).toBe(10);
    const other = normalizeLayout(withCount(defaultLayout('other'), 12, indoorRide), 'other', indoorRide);
    expect(other.ids).not.toContain('steps');
    expect(other.ids.length).toBe(10);
  });
  test('the fill skips excluded metrics, and a metric the person placed stays', () => {
    const layout = normalizeLayout({ ids: ['duration', 'altitude', 'hr', 'speed', 'distance'] }, 'ride', indoorRide);
    expect(layout.ids).toEqual(['duration', 'altitude', 'hr', 'speed', 'distance', 'calories']);
  });
});

describe('default layout migration (JRG-418)', () => {
  test('run and walk without a saved layout get ten fields on two pages', () => {
    for (const kind of ['run', 'walk'] as const) {
      const layout = defaultLayout(kind);
      expect(layout.ids).toEqual(['duration', 'distance', 'pace', 'avgPace', 'hr', 'hrZone', 'cadence', 'elevationGain', 'calories', 'avgHr']);
      expect(layout.big).toBe(true);
      expect(gridPages(layout)).toEqual([
        { start: 0, rows: [1, 3, 2] },
        { start: 6, rows: [2, 2] },
      ]);
    }
  });
  test('a layout saved by an older build reads back unchanged, the old defaults included', () => {
    const saved: RunLayout[] = [
      { ids: ['duration', 'distance', 'pace', 'hr'], big: true },
      { ids: ['duration', 'distance', 'pace', 'hr', 'elevationGain', 'calories'], big: true },
      { ids: ['hr', 'pace', 'cadence', 'duration', 'altitude', 'speed'], big: false },
    ];
    for (const layout of saved) expect(normalizeLayout(JSON.parse(JSON.stringify(layout)), 'run')).toEqual(layout);
  });
  test('the other kinds keep their four', () => {
    for (const kind of ['ride', 'hike', 'other'] as const) expect(defaultLayout(kind).ids.length).toBe(4);
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

  test('fills from the metrics not shown and not excluded', () => {
    const four: RunLayout = { ids: ['duration', 'distance', 'pace', 'hr'], big: false };
    expect(withCount(four, 6).ids).toEqual(['duration', 'distance', 'pace', 'hr', 'avgPace', 'speed']);
    expect(withCount(four, 6, ['avgPace']).ids).toEqual(['duration', 'distance', 'pace', 'hr', 'speed', 'hrZone']);
    expect(withCount(defaultLayout('run'), 4).ids).toEqual(['duration', 'distance', 'pace', 'avgPace']);
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

describe('gridPages', () => {
  const ids = ['duration', 'distance', 'pace', 'avgPace', 'speed', 'hr', 'hrZone', 'avgHr', 'maxHr', 'calories', 'cadence', 'steps'] as const;
  test('four or six fields are one page, as before pages existed', () => {
    expect(gridPages({ ids: [...ids.slice(0, 4)], big: true })).toEqual([{ start: 0, rows: [1, 3] }]);
    expect(gridPages({ ids: [...ids.slice(0, 6)], big: false })).toEqual([{ start: 0, rows: [2, 2, 2] }]);
  });
  test('from the seventh field on, pages of up to six in pairs', () => {
    expect(gridPages({ ids: [...ids.slice(0, 8)], big: false })).toEqual([
      { start: 0, rows: [2, 2, 2] },
      { start: 6, rows: [2] },
    ]);
    expect(gridPages({ ids: [...ids], big: true })).toEqual([
      { start: 0, rows: [1, 3, 2] },
      { start: 6, rows: [2, 2, 2] },
    ]);
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
  test('stride waits for 20 steps and 10 m', () => {
    expect(strideLength(1000, 800)).toBe(1.25);
    expect(strideLength(1000, 19)).toBeNull();
    expect(strideLength(9, 100)).toBeNull();
    expect(strideLength(null, 100)).toBeNull();
    expect(strideLength(100, null)).toBeNull();
  });
});
