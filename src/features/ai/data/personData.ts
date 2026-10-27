import { rogo, type RogoMyProfile } from '@/cloud/rogo';
import { HuaweiWear } from '@/wear';
import { NotSignedInError } from '@/cloud/api';
import type { KvStore } from '../kv';
import { readJson } from '../kv';
import { ageFromBirthYear, EMPTY_PERSON, lowestAge, PERSON_CACHE_KEY as KEY, PROFILE_REFRESH_MS, profileIsFresh, type Person } from '../person';

/** What the last JoyoRogo profile read said; kept so the age gate still works offline. Cleared on sign-out. */
interface CachedProfile {
  /** Unix seconds of the JoyoRogo read. */
  at: number;
  birthYear: number | null;
  goal: Person['goal'];
  weightGoalKg: number | null;
  weightGoalDate: string | null;
  eatKcal: number | null;
  sex: Person['sex'];
  heightCm: number | null;
  /** JoyoRogo's `targets.bmr` (kcal/day) at that read; absent in caches written before it was kept. Today's total calories read it. */
  bmrKcal?: number | null;
}

const valid = (v: unknown): v is CachedProfile => typeof v === 'object' && v !== null && typeof (v as CachedProfile).at === 'number';

function fromRogo(p: RogoMyProfile, at: number): CachedProfile {
  const row = p.profile;
  const sex = row?.gender === 'male' ? 'm' : row?.gender === 'female' ? 'f' : null;
  const eat = p.targets?.eatKcal;
  return {
    at,
    birthYear: typeof row?.birthYear === 'number' ? row.birthYear : null,
    goal: row?.goal ?? null,
    weightGoalKg: typeof row?.targetWeightKg === 'number' ? row.targetWeightKg : null,
    weightGoalDate: typeof row?.targetDate === 'string' ? row.targetDate : null,
    eatKcal: typeof eat === 'number' && Number.isFinite(eat) ? Math.round(eat) : null,
    sex,
    heightCm: typeof row?.heightCm === 'number' ? row.heightCm : null,
    bmrKcal: typeof p.targets?.bmr === 'number' && Number.isFinite(p.targets.bmr) ? p.targets.bmr : null,
  };
}

/** A cached BMR older than this is ignored (weight and age move it): Today then falls back to the profile formula. */
const BMR_MAX_AGE_SEC = 14 * 86400;

/** JoyoRogo's BMR from the last cached profile read (no network), or null when there is none or it is old. */
export function readCachedBmr(kv: KvStore, nowSec: number): number | null {
  const cached = readJson<CachedProfile | null>(kv, KEY, null, (v): v is CachedProfile | null => v === null || valid(v));
  if (!cached || cached.at > nowSec || nowSec - cached.at > BMR_MAX_AGE_SEC) return null;
  return typeof cached.bmrKcal === 'number' ? cached.bmrKcal : null;
}

/**
 * Who is asking: height, sex and birth year from Settings, Profile on the phone (works signed out), and from the JoyoRogo profile
 * when signed in: goal and targets. The Hamil / Menyusui mode is not read. The age is the lowest the two
 * sources give, so one of them saying under 18 keeps the own-key chat off.
 */
export async function readPerson(kv: KvStore, signedIn: boolean, nowYear: number = new Date().getFullYear()): Promise<Person> {
  const local = HuaweiWear.getUserProfile();
  let cached: CachedProfile | null = signedIn ? readJson<CachedProfile | null>(kv, KEY, null, (v): v is CachedProfile | null => v === null || valid(v)) : null;
  if (!signedIn) kv.removeItem(KEY);
  const nowSec = Math.floor(Date.now() / 1000);
  if (signedIn && !(cached && profileIsFresh(cached.at, nowSec))) {
    try {
      // A slow JoyoRogo must not hold a question back: after 5 s the last answer is used.
      const fresh = await Promise.race([rogo.myProfile(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('slow')), PROFILE_REFRESH_MS))]);
      cached = fromRogo(fresh, nowSec);
      kv.setItem(KEY, JSON.stringify(cached));
    } catch (error) {
      // Offline, slow or a server error: the last answer stays in use. A person who is no longer signed in has none.
      if (error instanceof NotSignedInError) cached = null;
    }
  }
  const localSex = local?.sex === 'male' ? 'm' : local?.sex === 'female' ? 'f' : null;
  const localHeight = local && local.heightCm > 50 && local.heightCm < 260 ? local.heightCm : null;
  return {
    ...EMPTY_PERSON,
    ageYears: lowestAge(ageFromBirthYear(local?.birthYear, nowYear), ageFromBirthYear(cached?.birthYear, nowYear)),
    sex: cached?.sex ?? localSex,
    heightCm: localHeight ?? cached?.heightCm ?? null,
    goal: cached?.goal ?? null,
    weightGoalKg: cached?.weightGoalKg ?? null,
    weightGoalDate: cached?.weightGoalDate ?? null,
    eatKcal: cached?.eatKcal ?? null,
  };
}
