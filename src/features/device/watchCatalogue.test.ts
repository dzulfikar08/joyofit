import { describe, expect, test } from 'bun:test';

import { catalogueModelOf, familyOfModel, pairingModeOf, searchCatalogue, WATCH_CATALOGUE } from './watchCatalogue';
import { WATCH_MODEL_PREFIXES } from './watchName';

const allModels = () => WATCH_CATALOGUE.flatMap((g) => g.models);

describe('WATCH_CATALOGUE', () => {
  test('holds every known model exactly once', () => {
    const known = new Set(WATCH_MODEL_PREFIXES.map(([model]) => model));
    expect(new Set(allModels())).toEqual(known);
    expect(allModels()).toHaveLength(known.size);
  });

  test('puts the tested Fit 4 Pro alone in the first group', () => {
    expect(WATCH_CATALOGUE[0]?.family.id).toBe('fit4pro');
    expect(WATCH_CATALOGUE[0]?.models).toEqual(['Huawei Watch Fit 4 Pro']);
  });

  test('sorts numbers by value inside a group', () => {
    const band = WATCH_CATALOGUE.find((g) => g.family.id === 'band')?.models ?? [];
    expect(band.indexOf('Huawei Band 9')).toBeLessThan(band.indexOf('Huawei Band 10'));
  });
});

describe('familyOfModel and pairingModeOf', () => {
  test('sort models into the onboarding families', () => {
    expect(familyOfModel('Huawei Watch Fit 3')).toBe('fit');
    expect(familyOfModel('Huawei Watch GT Runner 2')).toBe('gt');
    expect(familyOfModel('Huawei Watch Ultimate')).toBe('watch');
    expect(familyOfModel('Huawei TalkBand B6')).toBe('watch');
    expect(familyOfModel('Huawei Band 11 Pro')).toBe('band');
    expect(familyOfModel('Honor Band 9')).toBe('honor');
    expect(familyOfModel('Honor Watch 5 Pro')).toBe('honorNew');
  });

  test('a band, a Huawei watch and an Honor get their own pairing help', () => {
    expect(pairingModeOf('Huawei Band 9')).toBe('huaweiBand');
    expect(pairingModeOf('Huawei Watch GT 5')).toBe('huaweiWatch');
    expect(pairingModeOf('Honor MagicWatch 2')).toBe('honor');
  });
});

describe('searchCatalogue', () => {
  test('an empty query is the whole catalogue', () => {
    expect(searchCatalogue('  ')).toEqual([...WATCH_CATALOGUE]);
  });

  test('every word has to match, in any case and order', () => {
    const models = searchCatalogue('PRO fit 4').flatMap((g) => g.models);
    expect(models).toEqual(['Huawei Watch Fit 4 Pro']);
  });

  test('groups with no match are dropped', () => {
    const groups = searchCatalogue('band 9');
    expect(groups.map((g) => g.family.id)).toEqual(['band', 'honor']);
  });

  test('nothing matches nonsense', () => {
    expect(searchCatalogue('zzz')).toEqual([]);
  });
});

describe('catalogueModelOf', () => {
  test('takes the native match, else looks up the Bluetooth name', () => {
    expect(catalogueModelOf({ name: 'x', model: 'Huawei Watch GT 4' })).toBe('Huawei Watch GT 4');
    expect(catalogueModelOf({ name: 'Seiya-B29F', model: null })).toBe('Huawei Watch Fit 4 Pro');
    expect(catalogueModelOf({ name: 'Mystery-1' })).toBeNull();
  });
});
