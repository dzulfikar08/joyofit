/**
 * Vectors from openScale (https://github.com/oliexdev/openScale), GPL-3.0-or-later, Copyright (C) olie.xdev:
 * android_app/app/src/test/java/com/health/openscale/core/bluetooth/libs/
 *   MiScaleLibTest, BodyMiScaleLibTest, OneByoneLibTest, OneByoneNewLibTest, YunmaiLibTest,
 *   StandardImpedanceLibTest, TrisaBodyAnalyzeLibTest.
 * OkOkV2Lib has no upstream test: its case is hand-evaluated from the formula in the source.
 */
import { describe, expect, it } from 'bun:test';
import {
  BODY_FORMULAS,
  bmi,
  estimateBody,
  rawBodyMiScale,
  rawMiScale,
  rawOkokV2,
  rawOneByone,
  rawOneByoneNew,
  rawStandard,
  rawTrisa,
  yunmaiDerived,
  yunmaiFat,
} from './bodyComposition';

const near = (actual: number | undefined, expected: number, eps = 1e-3) => {
  expect(actual).toBeDefined();
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(eps);
};

describe('MiScaleLib vectors', () => {
  const cases = [
    { m: true, age: 30, h: 180, w: 80, z: 500, bmi: 24.691359, fat: 23.315107, bone: 3.1254203, lbm: 58.222496, muscle: 40.977253, water: 52.605835, vf: 13.359997 },
    { m: false, age: 28, h: 165, w: 60, z: 520, bmi: 22.038567, fat: 30.361998, bone: 2.4865808, lbm: 39.29622, muscle: 40.181103, water: 49.72153, vf: -36.555004 },
    { m: true, age: 45, h: 175, w: 95, z: 430, bmi: 31.020409, fat: 32.41778, bone: 3.2726917, lbm: 60.93042, muscle: 36.096416, water: 48.2537, vf: 24.462498 },
  ];
  for (const c of cases) {
    it(`${c.m ? 'male' : 'female'} ${c.age}y ${c.h}cm ${c.w}kg imp${c.z}`, () => {
      const r = rawMiScale(c.w, c.z, c.h, c.age, c.m);
      near(r.bmi, c.bmi);
      near(r.bodyFatPct, c.fat);
      near(r.boneKg, c.bone);
      near(r.leanKg, c.lbm);
      near(r.musclePct, c.muscle);
      near(r.waterPct, c.water);
      near(r.visceralFat, c.vf);
    });
  }

  it('clamps muscle at 60 for extreme impedance', () => {
    near(rawMiScale(40, 50, 190, 20, true).musclePct, 60);
  });

  it('estimate drops the impossible negative visceral fat but keeps the rest', () => {
    const e = estimateBody('miscale', { weightKg: 60, impedanceOhm: 520, user: { heightCm: 165, ageYears: 28, male: false } });
    expect(e?.visceralFat).toBeUndefined();
    expect(e?.bodyFatPct).toBe(30.36);
    expect(e?.leanKg).toBe(39.3);
    expect(e?.source).toBe('libs/MiScaleLib.kt');
  });
});

describe('BodyMiScaleLib vectors', () => {
  it('matches the bodymiscale reference (male 46y 168cm 86.1kg imp421)', () => {
    const r = rawBodyMiScale(86.1, 421, 168, 46, true);
    near(r.leanKg, 60.0, 0.05);
    near(r.bodyFatPct, 30.33, 0.05);
    near(r.waterPct, 50.86, 0.05);
    near(r.proteinPct, 13.59, 0.05);
    near(r.boneKg, 3.01, 0.05);
    near(r.muscleKg, 56.97, 0.05);
    near(r.bmrKcal, 1861, 1);
    near(r.visceralFat, 15.36, 0.05);
  });

  it('applies the female LBM correction', () => {
    const r = rawBodyMiScale(86.1, 421, 168, 46, false);
    near(r.leanKg, 50.4, 0.05);
    near(r.bodyFatPct, 41.46, 0.05);
  });
});

describe('OneByoneLib vectors', () => {
  const cases = [
    { name: 'male_mid', m: true, age: 30, h: 180, w: 80, z: 500, pt: 0, bmi: 24.691359, bf: 23.315102, lbm: 61.34792, muscle: 40.97725, water: 52.60584, bone: 3.030576, vf: 10.79977 },
    { name: 'female_mid', m: false, age: 28, h: 165, w: 60, z: 520, pt: 1, bmi: 22.038567, bf: 25.210106, lbm: 44.873936, muscle: 40.181107, water: 51.305866, bone: 2.3883991, vf: 0.70499706 },
    { name: 'male_high', m: true, age: 52, h: 175, w: 95, z: 430, pt: 2, bmi: 31.020409, bf: 26.381027, lbm: 69.93803, muscle: 35.573257, water: 50.502613, bone: 3.1443515, vf: 13.163806 },
    { name: 'imp_low', m: true, age: 25, h: 178, w: 72, z: 80, pt: 0, bmi: 22.724403, bf: 16.04116, lbm: 60.450363, muscle: 230.51118, water: 57.595764, bone: 3.0263696, vf: 9.316022 },
    { name: 'imp_mid', m: false, age: 35, h: 170, w: 68, z: 300, pt: 2, bmi: 23.529411, bf: 25.14642, lbm: 50.900436, muscle: 60.656864, water: 51.349552, bone: 2.650265, vf: 2.6039982 },
    { name: 'imp_high', m: true, age: 45, h: 182, w: 90, z: 1300, pt: 1, bmi: 27.170633, bf: 30.914497, lbm: 62.176952, muscle: 17.721643, water: 49.32705, bone: 2.901557, vf: 11.179609 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = rawOneByone(c.w, c.z, c.h, c.age, c.m, c.pt);
      near(r.bmi, c.bmi);
      near(r.bodyFatPct, c.bf);
      near(r.leanKg, c.lbm);
      near(r.musclePct, c.muscle);
      near(r.waterPct, c.water);
      near(r.boneKg, c.bone);
      near(r.visceralFat, c.vf);
    });
  }

  it('estimate omits the >100% muscle value produced by implausible impedance 80', () => {
    const e = estimateBody('oneByone', { weightKg: 72, impedanceOhm: 80, user: { heightCm: 178, ageYears: 25, male: true } });
    expect(e?.musclePct).toBeUndefined();
    expect(e?.bodyFatPct).toBe(16.04);
  });

  it('activity input selects the people type', () => {
    const e = estimateBody('oneByone', { weightKg: 60, impedanceOhm: 520, activity: 1, user: { heightCm: 165, ageYears: 28, male: false } });
    expect(e?.bodyFatPct).toBe(25.21);
    expect(e?.visceralFat).toBe(0.71);
  });
});

describe('OneByoneNewLib vectors', () => {
  const cases = [
    { name: 'male_mid', m: true, age: 30, h: 180, w: 80, z: 500, bmi: 24.691359, lbm: 62.14792, bmmr: 1000, bf: 23.315102, bone: 3.1254208, mm: 58.2225, skm: 40.566765, vf: 10.79977, water: 52.60584, prot: 15.963814 },
    { name: 'female_mid', m: false, age: 28, h: 165, w: 60, z: 520, bmi: 22.038567, lbm: 51.032806, bmmr: 1000, bf: 28.27285, bone: 2.486581, mm: 40.549713, skm: 36.45647, vf: 4.704997, water: 49.204823, prot: 14.44164 },
    { name: 'imp_low', m: true, age: 25, h: 178, w: 72, z: 80, bmi: 22.724403, lbm: 62.06637, bmmr: 1000, bf: 14.907819, bone: 3.1212144, mm: 58.145157, skm: 45.008743, vf: 9.316022, water: 58.373234, prot: 17.714064 },
    { name: 'imp_mid', m: false, age: 35, h: 170, w: 68, z: 300, bmi: 23.529411, lbm: 56.22662, bmmr: 1000, bf: 31.690466, bone: 2.754478, mm: 43.696007, skm: 36.679123, vf: 6.603998, water: 48.773006, prot: 11.583979 },
    { name: 'imp_high', m: true, age: 45, h: 182, w: 90, z: 1300, bmi: 27.170633, lbm: 59.750725, bmmr: 1000, bf: 34.49919, bone: 3.0017734, mm: 55.948956, skm: 36.065098, vf: 13.974511, water: 46.76758, prot: 11.656517 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = rawOneByoneNew(c.w, c.z, c.h, c.age, c.m);
      near(r.bmi, c.bmi);
      near(r.leanKg, c.lbm);
      near(r.bmrKcal, c.bmmr);
      near(r.bodyFatPct, c.bf);
      near(r.boneKg, c.bone);
      near(r.muscleKg, c.mm);
      near(r.musclePct, c.skm);
      near(r.visceralFat, c.vf);
      near(r.waterPct, c.water);
      near(r.proteinPct, c.prot);
    });
  }

  it('estimate rounds to 0.01', () => {
    const e = estimateBody('oneByoneNew', { weightKg: 60, impedanceOhm: 520, user: { heightCm: 165, ageYears: 28, male: false } });
    expect(e?.leanKg).toBe(51.03);
    expect(e?.bodyFatPct).toBe(28.27);
  });
});

describe('YunmaiLib vectors', () => {
  const cases = [
    { m: true, h: 180, fit: false, age: 30, w: 80, z: 500, bf: 23, water: 55.907001, fat: 23.237043, muscle: 51.595001, skeletal: 40.814999, bone: 3.26339, lbm: 61.599998, vf: 11.318182 },
    { m: false, h: 165, fit: false, age: 28, w: 60, z: 520, bf: 28, water: 52.276997, fat: 29.947247, muscle: 48.244999, skeletal: 38.164993, bone: 2.530795, lbm: 43.200001, vf: 6.166667 },
    { m: true, h: 175, fit: false, age: 55, w: 95, z: 430, bf: 32, water: 49.372997, fat: 34.547203, muscle: 45.564999, skeletal: 36.044998, bone: 3.365057, lbm: 64.599998, vf: 18.590908 },
    { m: false, h: 160, fit: false, age: 55, w: 50, z: 600, bf: 27, water: 53.003002, fat: 28.532946, muscle: 48.915001, skeletal: 38.694996, bone: 2.088284, lbm: 36.5, vf: 5.055555 },
    { m: true, h: 190, fit: true, age: 20, w: 72, z: 480, bf: 14, water: 62.441002, fat: 15.266259, muscle: 60.205002, skeletal: 51.605, bone: 3.519648, lbm: 61.919998, vf: 9 },
    { m: false, h: 155, fit: false, age: 22, w: 55, z: 510, bf: 29, water: 51.551003, fat: 30.724077, muscle: 47.575001, skeletal: 37.634998, bone: 2.187678, lbm: 39.049999, vf: 6.722222 },
    { m: true, h: 175, fit: false, age: 35, w: 85, z: 200, bf: 25, water: 54.455002, fat: 27.232653, muscle: 50.255001, skeletal: 39.754993, bone: 3.322063, lbm: 63.75, vf: 13.136364 },
    { m: false, h: 170, fit: false, age: 40, w: 70, z: 800, bf: 36, water: 46.468998, fat: 34.777931, muscle: 42.884998, skeletal: 33.924999, bone: 2.674562, lbm: 44.799999, vf: 10.409091 },
  ];
  cases.forEach((c, i) => {
    it(`vector ${i + 1}`, () => {
      near(yunmaiFat(c.w, c.z, c.h, c.age, c.m), c.fat);
      const d = yunmaiDerived(c.bf, c.w, c.h, c.age, c.m, c.fit);
      near(d.waterPct, c.water);
      near(d.musclePct, c.muscle);
      near(d.skeletalPct, c.skeletal);
      near(d.boneKg, c.bone);
      near(d.leanKg, c.lbm);
      near(d.visceralFat, c.vf);
    });
  });

  it('returns null when the fat estimate is implausible (openScale yields 0)', () => {
    expect(estimateBody('yunmai', { weightKg: 20, impedanceOhm: 100, user: { heightCm: 190, ageYears: 20, male: true } })).toBeNull();
  });

  it('estimate end-to-end uses computed fat', () => {
    const e = estimateBody('yunmai', { weightKg: 80, impedanceOhm: 500, user: { heightCm: 180, ageYears: 30, male: true } });
    expect(e?.bodyFatPct).toBe(23.24);
  });
});

describe('StandardImpedanceLib vector', () => {
  it('male 30y 180cm 80kg imp527', () => {
    const r = rawStandard(80, 527, 180, 30, true);
    near(r.bmi, 24.69136);
    near(r.leanKg, 60.622);
    near(r.bodyFatPct, 24.222);
    near(r.waterPct, 53.819);
    near(r.bmrKcal, 1679.436);
    near(r.musclePct, 39.313);
    near(r.boneKg, 3.455);
  });
});

describe('TrisaBodyAnalyzeLib vectors (QN family)', () => {
  const cases = [
    { m: true, age: 30, h: 180, w: 80, z: 500, bmi: 24.691359, water: 57.031845, fat: 23.186619, muscle: 40.767307, bone: 4.254889 },
    { m: false, age: 28, h: 165, w: 60, z: 520, bmi: 22.038567, water: 51.246567, fat: 27.63467, muscle: 32.776436, bone: 4.575968 },
    { m: true, age: 45, h: 175, w: 95, z: 430, bmi: 31.020409, water: 51.385693, fat: 34.484245, muscle: 30.524948, bone: 3.1716952 },
  ];
  for (const c of cases) {
    it(`${c.m ? 'male' : 'female'} ${c.age}y ${c.h}cm ${c.w}kg imp${c.z}`, () => {
      const r = rawTrisa(c.w, c.z, c.h, c.age, c.m);
      near(r.bmi, c.bmi);
      near(r.waterPct, c.water);
      near(r.bodyFatPct, c.fat);
      near(r.musclePct, c.muscle);
      near(r.boneKg, c.bone);
    });
  }
});

describe('OkOkV2Lib (no upstream vector; hand-evaluated)', () => {
  it('male 30y 180cm 80kg imp500 body fat', () => {
    // fat mass = 180*-0.3315 + 80*0.6216 + 30*0.0183 + 500*0.0085 + 22.554 = 17.4112 kg -> 21.764 %
    near(rawOkokV2(80, 500, 180, 30, true).bodyFatPct, 21.764, 1e-3);
  });

  it('female 30y 165cm 60kg imp500 water kg/percent and bmr', () => {
    // water kg = 165*0.0877 + 60*0.2973 - 30*0.0128 - 500*0.00603 + 0.5175 = 26.7215 ... evaluate: 14.4705+17.838-0.384-3.015+0.5175 = 29.427
    near(rawOkokV2(60, 500, 165, 30, false).waterPct, (29.427 / 60) * 100, 1e-3);
    // BMR: 655 + 60*9.6 + 165*1.8 - 30*4.7 = 1387
    near(rawOkokV2(60, 500, 165, 30, false).bmrKcal, 1387, 1e-6);
  });

  it('minors get no water, visceral, protein', () => {
    const e = estimateBody('okokV2', { weightKg: 55, impedanceOhm: 500, user: { heightCm: 165, ageYears: 15, male: true } });
    expect(e).not.toBeNull();
    expect(e?.waterPct).toBeUndefined();
    expect(e?.visceralFat).toBeUndefined();
    expect(e?.proteinPct).toBeUndefined();
  });
});

describe('domain checks', () => {
  const user = { heightCm: 175, ageYears: 35, male: true };
  const ids = BODY_FORMULAS.map((f) => f.id);

  it('registry lists every implemented formula with a source', () => {
    expect(ids).toEqual(['miscale', 'bodyMiScale', 'oneByone', 'oneByoneNew', 'yunmai', 'standard', 'trisa', 'okokV2']);
    for (const f of BODY_FORMULAS) expect(f.source.startsWith('libs/')).toBe(true);
  });

  it('typical adult input yields finite, rounded, in-range estimates for every formula', () => {
    for (const id of ids) {
      const e = estimateBody(id, { weightKg: 78, impedanceOhm: 480, user });
      expect(e).not.toBeNull();
      expect(e?.formula).toBe(id);
      for (const [k, v] of Object.entries(e!)) {
        if (typeof v !== 'number') continue;
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
        if (k.endsWith('Pct')) {
          expect(v).toBeGreaterThan(0);
          expect(v).toBeLessThan(100);
        }
      }
      expect(e?.bodyFatPct).toBeDefined();
    }
  });

  it('returns null for impedance, weight, height, age out of domain and unknown formulas', () => {
    for (const id of ids) {
      expect(estimateBody(id, { weightKg: 78, impedanceOhm: 0, user })).toBeNull();
      expect(estimateBody(id, { weightKg: 78, impedanceOhm: -5, user })).toBeNull();
      expect(estimateBody(id, { weightKg: 0, impedanceOhm: 480, user })).toBeNull();
      expect(estimateBody(id, { weightKg: 500, impedanceOhm: 480, user })).toBeNull();
      expect(estimateBody(id, { weightKg: 78, impedanceOhm: 480, user: { ...user, heightCm: 20 } })).toBeNull();
      expect(estimateBody(id, { weightKg: 78, impedanceOhm: 480, user: { ...user, ageYears: 0 } })).toBeNull();
      expect(estimateBody(id, { weightKg: NaN, impedanceOhm: 480, user })).toBeNull();
    }
    expect(estimateBody('nope', { weightKg: 78, impedanceOhm: 480, user })).toBeNull();
  });

  it('bmi matches openScale', () => {
    near(bmi(80, 180), 24.691358);
  });
});
