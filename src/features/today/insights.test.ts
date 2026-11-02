import { describe, expect, it } from 'bun:test';

import { pickInsights, STEPS_CLOSE_SHARE, type InsightInput } from './insights';

const NONE: InsightInput = { steps: null, goal: 8000, headline: null, recoveryPercent: null, sleepTone: null, coach: false };

describe('pickInsights', () => {
  it('has nothing to say without data', () => {
    expect(pickInsights(NONE)).toEqual([]);
    expect(pickInsights({ ...NONE, steps: 0 })).toEqual([]);
  });

  it('celebrates a reached goal, exactly at the goal too', () => {
    expect(pickInsights({ ...NONE, steps: 8000 })).toEqual([{ kind: 'stepsReached', steps: 8000 }]);
    expect(pickInsights({ ...NONE, steps: 12345 })).toEqual([{ kind: 'stepsReached', steps: 12345 }]);
  });

  it('names the steps left from half way, and stays quiet before that', () => {
    expect(pickInsights({ ...NONE, steps: 7000 })).toEqual([{ kind: 'stepsClose', left: 1000 }]);
    expect(pickInsights({ ...NONE, steps: 8000 * STEPS_CLOSE_SHARE })).toEqual([{ kind: 'stepsClose', left: 4000 }]);
    expect(pickInsights({ ...NONE, steps: 3999 })).toEqual([]);
  });

  it('ignores steps when there is no goal', () => {
    expect(pickInsights({ ...NONE, goal: 0, steps: 500 })).toEqual([]);
  });

  it('orders steps, readiness, sleep, coach and keeps what the data allows', () => {
    const all = pickInsights({ steps: 9000, goal: 8000, headline: 'Primed', recoveryPercent: 82, sleepTone: 'good', coach: true });
    expect(all.map((i) => i.kind)).toEqual(['stepsReached', 'readiness', 'sleep', 'coach']);
    expect(all[1]).toEqual({ kind: 'readiness', headline: 'Primed', recoveryPercent: 82 });
    const some = pickInsights({ ...NONE, headline: 'Strained', sleepTone: 'bad' });
    expect(some.map((i) => i.kind)).toEqual(['readiness', 'sleep']);
  });
});
