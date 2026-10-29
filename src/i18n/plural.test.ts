import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import i18next from 'i18next';

import { resources } from './resources';

// Hermes ships no Intl.PluralRules; core.ts imports the polyfill. Re-run that import with the
// native implementation removed.
const original = Intl.PluralRules;

beforeAll(async () => {
  // @ts-expect-error simulate Hermes
  delete Intl.PluralRules;
  expect(Intl.PluralRules).toBeUndefined();
  // The ?hermes query makes bun load the polyfill again; import/no-unresolved cannot resolve a query string.
  // eslint-disable-next-line import/no-unresolved
  await import('intl-pluralrules/polyfill.js?hermes');
});

afterAll(() => {
  Intl.PluralRules = original;
});

describe('Intl.PluralRules polyfill (Hermes)', () => {
  test('installs PluralRules', () => {
    expect(typeof Intl.PluralRules).toBe('function');
  });

  test.each([
    ['id', 1, '1 mnt lalu'],
    ['id', 2, '2 mnt lalu'],
    ['en', 1, '1 min ago'],
    ['en', 2, '2 min ago'],
  ] as const)('%s count %i', async (lng, count, expected) => {
    const instance = i18next.createInstance();
    await instance.init({ resources, lng, fallbackLng: 'en', initAsync: false });
    expect(instance.t('time.minutesAgo', { ns: 'common', count })).toBe(expected);
  });
});
