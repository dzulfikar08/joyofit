/**
 * Body-composition ESTIMATES from bioimpedance, ported from openScale's formula libraries.
 *
 * Ported from openScale (https://github.com/oliexdev/openScale), files under
 * android_app/app/src/main/java/com/health/openscale/core/bluetooth/libs/:
 *   MiScaleLib.kt, BodyMiScaleLib.kt, OneByoneLib.kt, OneByoneNewLib.kt, YunmaiLib.kt,
 *   StandardImpedanceLib.kt, TrisaBodyAnalyzeLib.kt, OkOkV2Lib.kt
 * Copyright (C) olie.xdev, GPL-3.0-or-later.
 * Test vectors: the matching *LibTest.kt files in openScale's android_app/app/src/test/.../libs/
 * (OkOkV2Lib has no upstream test; see bodyComposition.test.ts).
 *
 * HONEST NOTE: these are population-regression estimates computed on the phone from weight +
 * impedance + the profile (height, age, sex). They are NOT the vendor app's proprietary numbers and
 * will differ from what the scale's own app shows. Treat them as rough trends, not measurements.
 *
 * Not ported: SoehnleLib.kt (needs two impedances at 50 kHz and 5 kHz, which this API does not carry).
 *
 * Differences from openScale on purpose:
 *  - estimateBody returns null on out-of-domain input instead of computing garbage.
 *  - Values that are physically impossible for the formula output (percentages outside 0..100,
 *    non-positive visceral fat/bone, lean mass above body weight) are omitted rather than reported.
 *    The `raw*` functions keep the exact openScale arithmetic and clamps for testing.
 *  - Results are rounded to 0.01 here; openScale rounds only when displaying/storing.
 *  - openScale computes in 32-bit floats; this uses doubles (differences are ~1e-5).
 */

export type BodyFormula = 'miscale' | 'bodyMiScale' | 'oneByone' | 'oneByoneNew' | 'yunmai' | 'standard' | 'trisa' | 'okokV2' | string;

export interface BodyEstimate {
  formula: BodyFormula;
  /** openScale file(s) the formula comes from. */
  source: string;
  bodyFatPct?: number;
  waterPct?: number;
  musclePct?: number;
  muscleKg?: number;
  boneKg?: number;
  visceralFat?: number;
  bmrKcal?: number;
  leanKg?: number;
  proteinPct?: number;
  bmi?: number;
}

export interface BodyInput {
  weightKg: number;
  impedanceOhm: number;
  user: { heightCm: number; ageYears: number; male: boolean };
  /**
   * openScale activity bucket used by OneByone ("peopleType") and Yunmai: 0 = low/normal (default),
   * 1 = medium, 2 = high/athlete. Omit unless the profile has it.
   */
  activity?: 0 | 1 | 2;
}

export const BODY_FORMULAS: { id: BodyFormula; source: string }[] = [
  {
    id: 'miscale',
    source: 'libs/MiScaleLib.kt',
  },
  {
    id: 'bodyMiScale',
    source: 'libs/BodyMiScaleLib.kt',
  },
  {
    id: 'oneByone',
    source: 'libs/OneByoneLib.kt',
  },
  {
    id: 'oneByoneNew',
    source: 'libs/OneByoneNewLib.kt',
  },
  {
    id: 'yunmai',
    source: 'libs/YunmaiLib.kt',
  },
  {
    id: 'standard',
    source: 'libs/StandardImpedanceLib.kt',
  },
  {
    id: 'trisa',
    source: 'libs/TrisaBodyAnalyzeLib.kt',
  },
  {
    id: 'okokV2',
    source: 'libs/OkOkV2Lib.kt',
  },
];

// Input guards. openScale's libs do not validate; these only keep the formulas out of nonsense territory.
const MIN_HEIGHT_CM = 50;
const MAX_HEIGHT_CM = 250;
const MIN_AGE = 3;
const MAX_AGE = 120;
const MAX_WEIGHT_KG = 300;

export function bmi(weightKg: number, heightCm: number): number {
  return weightKg / (((heightCm * heightCm) / 100) / 100);
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Unrounded, unfiltered library output: exact openScale arithmetic. */
export type RawBody = Omit<BodyEstimate, 'formula' | 'source'>;

// ---------------------------------------------------------------------------------------------
// MiScaleLib.kt
// ---------------------------------------------------------------------------------------------

export function rawMiScale(weight: number, impedance: number, height: number, age: number, male: boolean): RawBody {
  const sex = male ? 1 : 0;
  const lbmCoeff = (() => {
    let lbm = ((height * 9.058) / 100) * (height / 100);
    lbm += weight * 0.32 + 12.226;
    lbm -= impedance * 0.0068;
    lbm -= age * 0.0542;
    return lbm;
  })();

  const bodyFat = (() => {
    let lbmSub = 0.8;
    if (sex === 0 && age <= 49) lbmSub = 9.25;
    else if (sex === 0 && age > 49) lbmSub = 7.25;
    let coeff = 1;
    if (sex === 1 && weight < 61) coeff = 0.98;
    else if (sex === 0 && weight > 60) {
      coeff = 0.96;
      if (height > 160) coeff *= 1.03;
    } else if (sex === 0 && weight < 50) {
      coeff = 1.02;
      if (height > 160) coeff *= 1.03;
    }
    let fat = (1 - ((lbmCoeff - lbmSub) * coeff) / weight) * 100;
    if (fat > 63) fat = 75;
    return fat;
  })();

  const boneKg = (() => {
    const base = sex === 0 ? 0.245691014 : 0.18016894;
    let bone = (base - lbmCoeff * 0.05158) * -1;
    bone = bone > 2.2 ? bone + 0.1 : bone - 0.1;
    if (sex === 0 && bone > 5.1) bone = 8;
    else if (sex === 1 && bone > 5.2) bone = 8;
    return bone;
  })();

  let leanKg = weight - bodyFat * 0.01 * weight - boneKg;
  if (sex === 0 && leanKg >= 84) leanKg = 120;
  else if (sex === 1 && leanKg >= 93.5) leanKg = 120;

  const smmKg = 0.401 * ((height * height) / impedance) + 3.825 * sex - 0.071 * age + 5.102;
  const musclePct = clamp((smmKg / weight) * 100, 10, 60);

  const rawWater = (100 - bodyFat) * 0.7;
  const waterPct = (rawWater < 50 ? 1.02 : 0.98) * rawWater;

  let visceralFat: number;
  if (sex === 0) {
    if (weight > (13 - height * 0.5) * -1) {
      const subsub = height * 1.45 + height * 0.1158 * height - 120;
      const sub = (weight * 500) / subsub;
      visceralFat = sub - 6 + age * 0.07;
    } else {
      const sub = 0.691 + height * -0.0024 + height * -0.0024;
      visceralFat = (height * 0.027 - sub * weight) * -1 + age * 0.07 - age;
    }
  } else if (height < weight * 1.6) {
    const sub = (height * 0.4 - height * (height * 0.0826)) * -1;
    visceralFat = (weight * 305) / (sub + 48) - 2.9 + age * 0.15;
  } else {
    const sub = 0.765 + height * -0.0015;
    visceralFat = (height * 0.143 - weight * sub) * -1 + age * 0.15 - 5;
  }

  return { bodyFatPct: bodyFat, waterPct, musclePct, boneKg, visceralFat, leanKg, bmi: bmi(weight, height) };
}

// ---------------------------------------------------------------------------------------------
// BodyMiScaleLib.kt
// ---------------------------------------------------------------------------------------------

const MALE_SCHOFIELD: [number, number][] = [
  [59.512, -30.4], [22.706, 504.3], [17.686, 658.2], [15.057, 692.2], [11.472, 873.1], [11.711, 587.7],
];
const FEMALE_SCHOFIELD: [number, number][] = [
  [58.317, -31.1], [20.315, 485.9], [13.384, 692.6], [14.818, 486.6], [8.126, 845.6], [9.082, 658.5],
];

export function rawBodyMiScale(weight: number, impedance: number, height: number, age: number, male: boolean): RawBody {
  let lbm = ((height * 9.058) / 100) * (height / 100) + weight * 0.32 + 12.226 - impedance * 0.0068 - age * 0.0542;
  if (!male) lbm *= 0.84;
  lbm = Math.min(lbm, weight * 0.98);

  const fat = clamp(((weight - lbm) / weight) * 100, male ? 5 : 10, 75);
  const waterPct = clamp((100 - fat) * 0.73, 35, 73);
  const proteinPct = clamp(((lbm * 0.195) / weight) * 100, 5, 32);

  const base = male ? 0.18016894 : 0.245691014;
  let bone = (base - lbm * 0.05158) * -1;
  bone = bone > 2.2 ? bone + 0.1 : bone - 0.1;
  if ((male && bone > 5.2) || (!male && bone > 5.1)) bone = 8;
  const boneKg = clamp(bone, 0.5, 8);

  const muscleKg = clamp(weight - fat * 0.01 * weight - boneKg, 10, 120);

  const co = male ? MALE_SCHOFIELD : FEMALE_SCHOFIELD;
  const [slope, constant] = age < 3 ? co[0] : age < 10 ? co[1] : age < 18 ? co[2] : age < 30 ? co[3] : age < 60 ? co[4] : co[5];
  const bmrKcal = clamp(slope * weight + constant, 500, 5000);

  const h = height;
  const w = weight;
  let vfal: number;
  if (male) {
    vfal =
      h < w * 1.6 + 63
        ? age * 0.15 + ((w * 305) / (h * 0.0826 * h - h * 0.4 + 48) - 2.9)
        : age * 0.15 + (w * (h * -0.0015 + 0.765) - h * 0.143) - 5;
  } else {
    vfal =
      w <= h * 0.5 - 13
        ? age * 0.07 + (w * (h * -0.0024 + 0.691) - h * 0.027) - 10.5
        : age * 0.07 + ((w * 500) / (h * 1.45 + h * 0.1158 * h - 120) - 6);
  }
  const visceralFat = clamp(vfal, 1, 50);

  return { bodyFatPct: fat, waterPct, proteinPct, boneKg, muscleKg, leanKg: lbm, bmrKcal, visceralFat, bmi: bmi(weight, height) };
}

// ---------------------------------------------------------------------------------------------
// OneByoneLib.kt
// ---------------------------------------------------------------------------------------------

export function rawOneByone(
  weight: number, impedance: number, height: number, age: number, male: boolean, peopleType: number,
): RawBody {
  const sex = male ? 1 : 0;
  const peopleCoeff = peopleType === 0 ? 1 : peopleType === 1 ? 1.0427 : peopleType === 2 ? 1.0958 : 0;

  // getBodyFat
  let bodyFatConst = 0;
  if (impedance >= 1200) bodyFatConst = 8.16;
  else if (impedance >= 200) bodyFatConst = 0.0068 * impedance;
  else if (impedance >= 50) bodyFatConst = 1.36;
  const typeCoeff = peopleType === 0 ? 1 : peopleType === 1 ? 1.0427 : 1.0958;
  let bodyVar = (9.058 * height) / 100;
  bodyVar = bodyVar * height;
  bodyVar = bodyVar / 100 + 12.226;
  bodyVar = bodyVar + 0.32 * weight;
  bodyVar = bodyVar - bodyFatConst;
  bodyFatConst = age > 0x31 ? (sex === 1 ? 0.8 : 7.25) : sex === 1 ? 0.8 : 9.25;
  bodyVar = bodyVar - bodyFatConst;
  bodyVar = bodyVar - age * 0.0542;
  bodyVar = bodyVar * typeCoeff;
  if (sex !== 0) {
    if (61 > weight) bodyVar *= 0.98;
  } else {
    if (50 > weight) bodyVar *= 1.02;
    if (weight > 60) bodyVar *= 0.96;
    if (height > 160) bodyVar *= 1.03;
  }
  bodyVar = bodyVar / weight;
  const bodyFat = clamp(100 * (1 - bodyVar), 1, 45);

  const leanKg = weight - (bodyFat / 100) * weight;
  const musclePct = ((height * height) / impedance * 0.401 + sex * 3.825 - age * 0.071 + 5.102) / weight * 100;

  const rawWater = (100 - bodyFat) * 0.7;
  const waterPct = (rawWater < 50 ? 1.02 : 0.98) * rawWater;

  // getBoneMass
  let bone = 9.058 * (height / 100) * (height / 100) + 12.226 + 0.32 * weight - 0.0068 * impedance;
  const sexConst = sex === 1 ? 3.49305 : 4.76325;
  bone = bone - sexConst - age * 0.0542 * peopleCoeff;
  bone = bone <= 2.2 ? bone - 0.1 : bone + 0.1;
  bone = bone * 0.05158;
  const boneKg = clamp(bone, 0.5, 8);

  return { bodyFatPct: bodyFat, leanKg, musclePct, waterPct, boneKg, visceralFat: oneByoneVisceral(weight, height, age, sex, peopleType), bmi: bmi(weight, height) };
}

function oneByoneVisceral(weight: number, height: number, age: number, sex: number, peopleType: number): number {
  const subB = (v: number) => (v < 10 ? v * 0.85 : 20 < v ? v * 0.85 : v * 0.8);
  const subA = (v: number) => {
    if (peopleType !== 0) return 10 <= v ? subB(v) : v - 4;
    return 10 > v ? v - 2 : subB(v);
  };
  let vf: number;
  if (sex === 1) {
    vf =
      height < 1.6 * weight + 63
        ? (weight * 305) / (0.0826 * height * height - 0.4 * height + 48) - 2.9 + age * 0.15
        : age * 0.15 + (weight * (-0.0015 * height + 0.765) - height * 0.143) - 5;
  } else {
    vf =
      0.5 * height - 13 > weight
        ? age * 0.07 + (weight * (-0.0024 * height + 0.691) - height * 0.027) - 10.5
        : (weight * 500) / (1.45 * height + 0.1158 * height * height - 120) - 6 + age * 0.07;
  }
  return peopleType === 0 ? vf : subA(vf);
}

// ---------------------------------------------------------------------------------------------
// OneByoneNewLib.kt
// ---------------------------------------------------------------------------------------------

export function rawOneByoneNew(weight: number, impedance: number, height: number, age: number, male: boolean): RawBody {
  const sex = male ? 1 : 0;
  const lbmCoeff = (height / 100) * (height / 100) * 9.058 + 12.226 + weight * 0.32 - impedance * 0.0068 - age * 0.0542;

  const fatConst = sex === 0 ? (age < 0x32 ? 9.25 : 7.25) : 0.8;
  let fatVar = lbmCoeff - fatConst;
  if (sex === 0) {
    if (weight < 50) fatVar *= 1.02;
    else if (weight > 60) fatVar *= 0.96;
    if (height > 160) fatVar *= 1.03;
  } else if (weight < 61) fatVar *= 0.98;
  const bodyFatPct = 100 * (1 - fatVar / weight);

  const boneConst = lbmCoeff * 0.05158 - (sex === 1 ? 0.18016894 : 0.245691014);
  const boneKg = clamp(boneConst <= 2.2 ? boneConst - 0.1 : boneConst + 0.1, 0.5, 8);

  const muscleKg = clamp(weight - bodyFatPct * 0.01 * weight - boneKg, 10, 120);

  let water = (100 - bodyFatPct) * 0.7;
  water *= water > 50 ? 0.98 : 1.02;
  const waterPct = clamp(water, 35, 75);

  const skeletonPct = ((waterPct * weight * (0.8422 * 0.01) - 2.9903) / weight) * 100;

  let vf: number;
  if (sex === 1) {
    vf =
      height < weight * 1.6 + 63
        ? age * 0.15 + ((weight * 305) / (height * 0.0826 * height - height * 0.4 + 48) - 2.9)
        : age * 0.15 + (weight * (height * -0.0015 + 0.765) - height * 0.143) - 5;
  } else {
    vf =
      weight <= height * 0.5 - 13
        ? age * 0.07 + (weight * (height * -0.0024 + 0.691) - height * 0.027) - 10.5
        : age * 0.07 + ((weight * 500) / (height * 1.45 + height * 0.1158 * height - 120) - 6);
  }
  const visceralFat = clamp(vf, 1, 50);

  const proteinPct = 100 - bodyFatPct - waterPct * 1.08 - (boneKg / weight) * 100;

  let bmmr =
    sex === 1
      ? weight * 14.916 + 877.8 - height * 0.726 - age * 8.976
      : weight * 10.2036 + 864.6 - height * 0.39336 - age * 6.204;
  bmmr = clamp(bmmr, 500, 1000);

  return {
    bodyFatPct, boneKg, muscleKg, musclePct: skeletonPct, visceralFat, waterPct, proteinPct, bmrKcal: bmmr,
    leanKg: lbmCoeff, bmi: clamp(bmi(weight, height), 10, 90),
  };
}

// ---------------------------------------------------------------------------------------------
// YunmaiLib.kt
// ---------------------------------------------------------------------------------------------

/** Yunmai body fat %; openScale returns 0 for implausible results, mirrored here. */
export function yunmaiFat(weight: number, resistance: number, height: number, age: number, male: boolean): number {
  let r = (resistance - 100) / 100;
  const h = height / 100;
  if (r >= 1) r = Math.sqrt(r);
  let fat = (weight * 1.5) / h / h + age * 0.08;
  if (male) fat -= 10.8;
  fat = fat - 7.4 + r;
  if (fat < 5 || fat > 75) fat = 0;
  return fat;
}

/** Everything Yunmai derives from a body-fat percentage. `fitness` = openScale HEAVY/EXTREME activity. */
export function yunmaiDerived(bodyFat: number, weight: number, height: number, age: number, male: boolean, fitness: boolean) {
  const waterPct = ((100 - bodyFat) * 0.726 * 100 + 0.5) / 100;
  let muscle = (100 - bodyFat) * (fitness ? 0.7 : 0.67);
  muscle = (muscle * 100 + 0.5) / 100;
  let skeletal = (100 - bodyFat) * (fitness ? 0.6 : 0.53);
  skeletal = (skeletal * 100 + 0.5) / 100;
  const h = height - 170;
  let bone = male
    ? ((weight * (muscle / 100) * 4) / 7) * 0.22 * 0.6 + h / 100
    : ((weight * (muscle / 100) * 4) / 7) * 0.34 * 0.45 + h / 100;
  bone = (bone * 10 + 0.5) / 10;
  const leanKg = (weight * (100 - bodyFat)) / 100;

  let f = bodyFat;
  const a = age < 18 || age > 120 ? 18 : age;
  let vf: number;
  if (!fitness) {
    f -= male ? (a < 40 ? 21 : a < 60 ? 22 : 24) : a < 40 ? 34 : a < 60 ? 35 : 36;
    let d = male ? 1.4 : 1.8;
    if (f > 0) d = 1.1;
    vf = clamp(f / d + 9.5, 1, 30);
  } else {
    vf = bodyFat > 15 ? (bodyFat - 15) / 1.1 + 12 : (-1 * (15 - bodyFat)) / 1.4 + 12;
    vf = clamp(vf, 1, 9);
  }
  return { waterPct, musclePct: muscle, skeletalPct: skeletal, boneKg: bone, leanKg, visceralFat: vf };
}

// ---------------------------------------------------------------------------------------------
// StandardImpedanceLib.kt
// ---------------------------------------------------------------------------------------------

export function rawStandard(weight: number, impedance: number, height: number, age: number, male: boolean): RawBody {
  const h2r = (height * height) / impedance;
  const ffm = male
    ? -10.68 + 0.65 * h2r + 0.26 * weight + 0.02 * impedance
    : -9.53 + 0.69 * h2r + 0.17 * weight + 0.02 * impedance;
  const liters = male ? 1.2 + 0.45 * h2r + 0.18 * weight : 3.75 + 0.45 * h2r + 0.11 * weight;
  const smm = 0.401 * h2r + 3.825 * (male ? 1 : 0) - 0.071 * age + 5.102;
  return {
    bodyFatPct: (1 - ffm / weight) * 100,
    waterPct: ((0.99513 * liters) / weight) * 100,
    musclePct: (smm / weight) * 100,
    boneKg: (male ? 0.057 : 0.05) * ffm,
    bmrKcal: ffm * 21.6 + 370,
    leanKg: ffm,
    bmi: weight / ((height / 100) * (height / 100)),
  };
}

// ---------------------------------------------------------------------------------------------
// TrisaBodyAnalyzeLib.kt (applied by openScale to QN-family scales in QNHandler.kt)
// ---------------------------------------------------------------------------------------------

export function rawTrisa(weight: number, impedance: number, height: number, age: number, male: boolean): RawBody {
  const b = (weight * 1e4) / (height * height);
  return {
    waterPct: male ? 87.51 + (-1.162 * b - 0.00813 * impedance + 0.07594 * age) : 77.721 + (-1.148 * b - 0.00573 * impedance + 0.06448 * age),
    bodyFatPct: male ? b * (1.479 + 4.4e-4 * impedance) + 0.1 * age - 21.764 : b * (1.506 + 3.908e-4 * impedance) + 0.1 * age - 12.834,
    musclePct: male ? 74.627 + (-0.811 * b - 0.00565 * impedance - 0.367 * age) : 57.0 + (-0.694 * b - 0.00344 * impedance - 0.255 * age),
    boneKg: male ? 7.829 + (-0.0855 * b - 5.92e-4 * impedance - 0.0389 * age) : 7.98 + (-0.0973 * b - 4.84e-4 * impedance - 0.036 * age),
    bmi: b,
  };
}

// ---------------------------------------------------------------------------------------------
// OkOkV2Lib.kt (based upstream on https://github.com/Alchives/reverse-engineering, okok-c0)
// ---------------------------------------------------------------------------------------------

export function rawOkokV2(weight: number, impedance: number, height: number, age: number, male: boolean): RawBody {
  const fatMass = male
    ? height * -0.3315 + weight * 0.6216 + age * 0.0183 + impedance * 0.0085 + 22.554
    : height * -0.3332 + weight * 0.7509 + age * 0.0196 + impedance * 0.0072 + 22.7193;
  const bodyFatPct = clamp((fatMass / weight) * 100, 5, 45);

  const musclePct = (clamp(height * 0.2573 + weight * 0.1745 - age * 0.0161 + (male ? 1 : 0) * 2.4269 - impedance * 0.017 - 20.2165, 20, 70) * 100) / weight;

  // getMuscleMass (private upstream) judges by the clamped body fat.
  let muscleKg: number;
  if (bodyFatPct > 45) muscleKg = weight - weight * 0.05 - 4;
  else if (bodyFatPct < 5) muscleKg = weight - weight * 0.05 - 1;
  else {
    const raw = male
      ? height * 0.2867 + weight * 0.3894 - age * 0.0408 - impedance * 0.01235 - 15.7665
      : height * 0.3186 + weight * 0.1934 - age * 0.0206 - impedance * 0.0132 - 16.4556;
    muscleKg = clamp(raw, 20, 70);
  }

  const adult = age > 17;
  const waterKg = male
    ? height * 0.0939 + weight * 0.3758 - age * 0.0032 - impedance * 6.925e-3 + 0.097
    : height * 0.0877 + weight * 0.2973 - age * 0.0128 - impedance * 0.00603 + 0.5175;
  const waterPct = adult ? clamp((waterKg / weight) * 100, 20, 85) : 0;
  const waterMass = adult ? (waterPct / 100) * weight : 0;

  const visceral = male
    ? height * -0.2675 + weight * 0.42 + age * 0.1462 + impedance * 0.0123 + 13.9871
    : height * -0.1651 + weight * 0.2628 + age * 0.0649 + impedance * 0.0024 + 12.3445;

  return {
    bodyFatPct,
    musclePct,
    muscleKg,
    waterPct,
    leanKg: weight - fatMass,
    boneKg: clamp(weight - fatMass - muscleKg, 1, 4),
    visceralFat: adult ? clamp(visceral, 1, 60) : 0,
    bmrKcal: male ? 66 + weight * 13.7 + height * 5 - age * 6.8 : 655 + weight * 9.6 + height * 1.8 - age * 4.7,
    proteinPct: adult ? ((muscleKg - waterMass) / weight) * 100 : 0,
    bmi: bmi(weight, height),
  };
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** Drops values that are impossible for the quantity, then rounds to 0.01. */
function finish(formula: BodyFormula, raw: RawBody, weight: number): BodyEstimate {
  const out: BodyEstimate = { formula, source: BODY_FORMULAS.find((f) => f.id === formula)?.source ?? '' };
  const pct = (v: number | undefined) => (v !== undefined && Number.isFinite(v) && v > 0 && v < 100 ? r2(v) : undefined);
  const pos = (v: number | undefined) => (v !== undefined && Number.isFinite(v) && v > 0 ? r2(v) : undefined);
  const set = <K extends keyof RawBody>(k: K, v: number | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('bodyFatPct', pct(raw.bodyFatPct));
  set('waterPct', pct(raw.waterPct));
  set('musclePct', pct(raw.musclePct));
  set('proteinPct', pct(raw.proteinPct));
  set('muscleKg', raw.muscleKg !== undefined && raw.muscleKg > 0 && raw.muscleKg <= weight ? r2(raw.muscleKg) : undefined);
  set('boneKg', raw.boneKg !== undefined && raw.boneKg > 0 && raw.boneKg < weight ? pos(raw.boneKg) : undefined);
  set('visceralFat', pos(raw.visceralFat));
  set('bmrKcal', pos(raw.bmrKcal));
  set('leanKg', raw.leanKg !== undefined && raw.leanKg > 0 && raw.leanKg <= weight ? r2(raw.leanKg) : undefined);
  set('bmi', pos(raw.bmi));
  return out;
}

export function estimateBody(formula: BodyFormula, input: BodyInput): BodyEstimate | null {
  const { weightKg: w, impedanceOhm: z, user } = input;
  const { heightCm: h, ageYears: a, male } = user;
  if (![w, z, h, a].every(Number.isFinite)) return null;
  if (w <= 0 || w > MAX_WEIGHT_KG || z <= 0) return null;
  if (h < MIN_HEIGHT_CM || h > MAX_HEIGHT_CM || a < MIN_AGE || a > MAX_AGE) return null;
  const activity = input.activity ?? 0;

  switch (formula) {
    case 'miscale':
      return finish(formula, rawMiScale(w, z, h, a, male), w);
    case 'bodyMiScale':
      return finish(formula, rawBodyMiScale(w, z, h, a, male), w);
    case 'oneByone':
      return finish(formula, rawOneByone(w, z, h, a, male, activity), w);
    case 'oneByoneNew':
      return finish(formula, rawOneByoneNew(w, z, h, a, male), w);
    case 'yunmai': {
      const fat = yunmaiFat(w, Math.round(z), h, a, male);
      if (fat <= 0) return null;
      const d = yunmaiDerived(fat, w, h, a, male, activity === 2);
      return finish(formula, { bodyFatPct: fat, waterPct: d.waterPct, musclePct: d.musclePct, boneKg: d.boneKg, leanKg: d.leanKg, visceralFat: d.visceralFat, bmi: bmi(w, h) }, w);
    }
    case 'standard':
      return finish(formula, rawStandard(w, z, h, a, male), w);
    case 'trisa':
      return finish(formula, rawTrisa(w, z, h, a, male), w);
    case 'okokV2':
      return finish(formula, rawOkokV2(w, z, h, a, male), w);
    default:
      return null;
  }
}
