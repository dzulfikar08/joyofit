import { describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';

import { TEMPLATES } from '../catalog';
import type { SceneNode } from '../core/scene';
import { applyCustomMetrics } from '../data/customMetrics';
import { offerGroups } from '../offer';
import type { JsonObject, StickerSubject } from '../subject';
import { FIXTURES, FIXTURE_PHOTOS } from '../testing/fixtures';
import { renderTemplate } from '../testing/render';

const STARTED = new Date(2026, 9, 17, 8, 48).getTime();
const PHOTO = { photo: FIXTURE_PHOTOS.dusk };

function textsOf(nodes: readonly SceneNode[]): string[] {
  return nodes.flatMap((node) => (node.k === 'text' ? [node.text] : node.k === 'group' ? textsOf(node.children) : []));
}

/** Every text the card draws, in paint order. */
function texts(run: JsonObject, canvas: 'story' | 'square' = 'story', locale: 'id' | 'en' = 'en'): string[] {
  const template = TEMPLATES.find((t) => t.id === `run.classic.${canvas}`)!;
  const { scene, issues } = renderTemplate(template, { run }, { locale, mode: 'dark', assets: PHOTO });
  expect(issues).toEqual([]);
  return textsOf(scene.nodes);
}

const SWIM: JsonObject = { sport: 'Pool Swimming', kind: 'swim', category: 'swim', startedAt: STARTED, movingSec: 3336, distanceM: 1030, pace100Sec: 325, hrAvg: 108, kcal: 838 };

describe('run.classic', () => {
  test('the old share card for a swim: sport, date, metres hero, time, pace per 100 m, heart rate, calories, brand', async () => {
    await applyLocale('en');
    try {
      const out = texts(SWIM);
      for (const expected of ['Pool Swimming', 'Distance', '1,030', 'm', 'Time', '55:36', 'Avg pace', '5:25', '/100 m', 'Avg HR', '108', 'bpm', 'Calories', '838', 'kcal', 'JoyoFit', 'fit.joyorogo.com']) {
        expect(out).toContain(expected);
      }
      expect(out.some((text) => text.includes('2026') && text.includes('·'))).toBe(true);
    } finally {
      await applyLocale('id');
    }
  });

  test('the labels follow the card language: Indonesian words on an Indonesian card, English on an English one', async () => {
    const RUN: JsonObject = { sport: 'Lari', kind: 'run', category: 'run', startedAt: STARTED, movingSec: 1992, distanceM: 5240, paceSecKm: 380, hrAvg: 154, kcal: 402, elevGainM: 38 };
    try {
      for (const canvas of ['story', 'square'] as const) {
        // The card language is the one passed to the render, not the language the app is in at that moment.
        await applyLocale('en');
        const id = texts(RUN, canvas, 'id');
        for (const word of ['Jarak', 'Waktu', 'Pace rata-rata', 'Detak rata-rata', 'Kalori', 'Elevasi']) expect(id).toContain(word);
        for (const word of ['Distance', 'Time', 'Avg pace', 'Avg HR', 'Calories', 'Elevation']) expect(id).not.toContain(word);
        await applyLocale('id');
        const en = texts(RUN, canvas, 'en');
        for (const word of ['Distance', 'Time', 'Avg pace', 'Avg HR', 'Calories', 'Elevation']) expect(en).toContain(word);
        for (const word of ['Jarak', 'Waktu', 'Pace rata-rata', 'Detak rata-rata', 'Kalori', 'Elevasi']) expect(en).not.toContain(word);
      }
    } finally {
      await applyLocale('id');
    }
  });

  test('pace follows the sport family: per km for a run, per 100 m for a swim, km/h for a ride', async () => {
    await applyLocale('en');
    try {
      const run = texts({ sport: 'Run', kind: 'run', category: 'run', startedAt: STARTED, movingSec: 1992, distanceM: 5240, paceSecKm: 380, hrAvg: 154, kcal: 402 });
      expect(run).toContain('6:20');
      expect(run).toContain('/km');
      expect(run).not.toContain('/100 m');
      const ride = texts({ sport: 'Ride', kind: 'ride', category: 'ride', startedAt: STARTED, movingSec: 5410, distanceM: 38_700, speedKmh: 25.8, hrAvg: 141, kcal: 960 });
      expect(ride).toContain('Avg speed');
      expect(ride).toContain('25.8');
      expect(ride).toContain('km/h');
      expect(ride).not.toContain('Avg pace');
      const swim = texts(SWIM);
      expect(swim).toContain('/100 m');
      expect(swim).not.toContain('/km');
    } finally {
      await applyLocale('id');
    }
  });

  test('the distance reads in km, in metres for a swim; no distance puts the time in the hero', async () => {
    await applyLocale('en');
    try {
      const swim = texts({ ...SWIM, distanceM: 750 });
      expect(swim).toContain('750');
      expect(swim).toContain('m');
      expect(swim).not.toContain('km');
      const run = texts({ sport: 'Run', kind: 'run', category: 'run', startedAt: STARTED, movingSec: 300, distanceM: 750, paceSecKm: 400 });
      expect(run).toContain('0.75');
      expect(run).toContain('km');
      const gym = texts({ sport: 'Strength', kind: 'other', category: 'gym', startedAt: STARTED, movingSec: 3120, hrAvg: 118, kcal: 318 });
      expect(gym).toContain('Time');
      expect(gym).toContain('52:00');
      expect(gym.filter((text) => text === 'Time')).toHaveLength(1);
      expect(gym).not.toContain('Distance');
      expect(gym).not.toContain('Avg pace');
    } finally {
      await applyLocale('id');
    }
  });

  test('numbers the workout does not have are left out, never shown as a dash', async () => {
    await applyLocale('en');
    try {
      const out = texts({ sport: 'Walk', kind: 'walk', category: 'walk', startedAt: STARTED, movingSec: 1500, distanceM: 1820, paceSecKm: 824 });
      expect(out).not.toContain('Avg HR');
      expect(out).not.toContain('Calories');
      expect(out).not.toContain('Elevation');
      expect(out.some((text) => text.includes('-'))).toBe(false);
    } finally {
      await applyLocale('id');
    }
  });

  test('both canvases are one picker entry, offered for every run family, after the family cards', () => {
    for (const fixture of FIXTURES.filter((f) => f.kind === 'run' || f.kind === 'swim' || f.kind === 'ride')) {
      const subject = { kinds: fixture.kind === 'run' ? ['run'] : [fixture.kind, 'run'], data: fixture.data } as unknown as StickerSubject;
      const group = offerGroups(subject).find((g) => g.key === 'run.classic');
      expect({ fixture: fixture.key, story: group?.variants.story?.id, square: group?.variants.square?.id }).toEqual({
        fixture: fixture.key,
        story: 'run.classic.story',
        square: 'run.classic.square',
      });
      expect(group?.needsPhoto).toBe(true);
    }
  });

  test('without a photo the card falls back to the dark wash instead of failing', () => {
    const template = TEMPLATES.find((t) => t.id === 'run.classic.story')!;
    const { scene, issues } = renderTemplate(template, { run: SWIM }, { locale: 'en', mode: 'dark' });
    expect(issues).toEqual([]);
    expect(scene.needsImages).toEqual([]);
  });

  test('it shows no third-party brand', async () => {
    await applyLocale('en');
    try {
      const out = texts(SWIM).join(' ');
      expect(/huawei|honor|strava|health connect|apple health/i.test(out)).toBe(false);
    } finally {
      await applyLocale('id');
    }
  });

  test('custom metrics: hero and secondary metrics render correctly on both story and square', async () => {
    await applyLocale('en');
    try {
      const RUN: JsonObject = {
        sport: 'Run',
        kind: 'run',
        category: 'run',
        startedAt: STARTED,
        movingSec: 1992,
        distanceM: 5240,
        paceSecKm: 380,
        hrAvg: 154,
        kcal: 402,
        elevGainM: 38,
        cadence: 172,
      };
      const customData = applyCustomMetrics(
        { run: RUN },
        {
          heroId: 'pace',
          secondaryIds: ['hr', 'cadence', 'elevation', 'kcal'],
        },
        { locale: 'en' },
      );

      for (const canvas of ['story', 'square'] as const) {
        const out = texts(customData.run as JsonObject, canvas, 'en');
        expect(out).toContain('6:20');
        expect(out).toContain('/km');
        expect(out).toContain('Pace');

        expect(out).toContain('154');
        expect(out).toContain('bpm');
        expect(out).toContain('Heart rate');
        expect(out).toContain('172');
        expect(out).toContain('spm');
        expect(out).toContain('Cadence');

        expect(out).toContain('38');
        expect(out).toContain('m');
        expect(out).toContain('Elevation');

        expect(out).toContain('402');
        expect(out).toContain('kcal');
        expect(out).toContain('Calories');

        expect(out).not.toContain('5.24');
      }
    } finally {
      await applyLocale('id');
    }
  });

  test('custom metrics: supports time hero and partial secondary slots', async () => {
    await applyLocale('en');
    try {
      const RUN: JsonObject = {
        sport: 'Run',
        kind: 'run',
        category: 'run',
        startedAt: STARTED,
        movingSec: 1992,
        distanceM: 5240,
        paceSecKm: 380,
        hrAvg: 154,
      };
      const customData = applyCustomMetrics(
        { run: RUN },
        {
          heroId: 'time',
          secondaryIds: ['distance', 'pace'],
        },
        { locale: 'en' },
      );

      for (const canvas of ['story', 'square'] as const) {
        const out = texts(customData.run as JsonObject, canvas, 'en');
        expect(out).toContain('33:12');
        expect(out).toContain('Time');

        expect(out).toContain('5.24');
        expect(out).toContain('km');
        expect(out).toContain('Distance');

        expect(out).toContain('6:20');
        expect(out).toContain('/km');
        expect(out).toContain('Pace');
        expect(out).not.toContain('154');
      }
    } finally {
      await applyLocale('id');
    }
  });

  test('custom metrics: Indonesian labels are rendered when locale is id', async () => {
    const RUN: JsonObject = {
      sport: 'Lari',
      kind: 'run',
      category: 'run',
      startedAt: STARTED,
      movingSec: 1992,
      distanceM: 5240,
      paceSecKm: 380,
      hrAvg: 154,
    };
    const customData = applyCustomMetrics(
      { run: RUN },
      {
        heroId: 'time',
        secondaryIds: ['distance', 'pace', 'hr'],
      },
      { locale: 'id' },
    );

    const out = texts(customData.run as JsonObject, 'story', 'id');
    expect(out).toContain('33:12');
    expect(out).toContain('Waktu');
    expect(out).toContain('5,24');
    expect(out).toContain('Jarak');
    expect(out).toContain('6:20');
    expect(out).toContain('Pace');
    expect(out).toContain('154');
    expect(out).toContain('Detak');
  });
});
