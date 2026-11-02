import { describe, expect, it } from 'bun:test';

import { isTabRoot, MORE_ROUTE } from './tabBarRoutes';

describe('isTabRoot', () => {
  it('shows the bar on the root of Today, Workouts, Social and More', () => {
    expect(isTabRoot('index', undefined)).toBe(true);
    expect(isTabRoot('workouts', 'index')).toBe(true);
    expect(isTabRoot('social', 'index')).toBe(true);
    expect(isTabRoot(MORE_ROUTE, 'index')).toBe(true);
    expect(isTabRoot('workouts', undefined)).toBe(true);
  });
  it('hides it on anything pushed on those stacks', () => {
    expect(isTabRoot('workouts', '[id]')).toBe(false);
    expect(isTabRoot('workouts', 'manual')).toBe(false);
    expect(isTabRoot('social', 'post')).toBe(false);
    expect(isTabRoot('social', 'group')).toBe(false);
    expect(isTabRoot(MORE_ROUTE, 'appearance')).toBe(false);
  });
  it('hides it on the hidden tabs, even on their own index', () => {
    for (const tab of ['watch', 'routes', 'family', 'coach', 'strength', 'sleep', 'heart', 'hrv', 'hrv-day', 'stress', 'home-cards', 'ride']) {
      expect(isTabRoot(tab, undefined)).toBe(false);
      expect(isTabRoot(tab, 'index')).toBe(false);
    }
  });
  it('is not fooled by names on the object prototype', () => {
    expect(isTabRoot('constructor', undefined)).toBe(false);
  });
});
