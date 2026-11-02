/**
 * The cards below the watch on Today, their order and which are shown. The watch card on top is not one of them: it holds the
 * connection and the sync button. Pure normalising and updates; `homeCardsStore.ts` does the storage.
 *
 * What is stored is only what the person chose (an order and a hidden list). Reading always runs it through
 * `normalizeHomeCards`: ids this build does not know are dropped and cards it has but the stored order lacks (a card added by a
 * later release) are appended at the end, shown. So an update never reshuffles or hides what someone arranged.
 */

/**
 * Default order. The one-line insight and the steps and heart rate tiles open the day, then the daily report (recovery and
 * strain, activity, heart rate, steps, sleep, energy), the secondary cards after it. Ids are stored: never rename one once released.
 */
export const HOME_CARD_IDS = [
  'insight',
  'glance',
  'scores',
  'activity',
  'heart',
  'steps',
  'sleep',
  'energy',
  'fitness',
  'coach',
  'checkin',
  'family',
  'loop',
  'health',
] as const;

export type HomeCardId = (typeof HOME_CARD_IDS)[number];

export interface HomeCardPrefs {
  /** Every known card exactly once. */
  order: readonly HomeCardId[];
  /** Cards the person turned off; a subset of `order`. */
  hidden: readonly HomeCardId[];
}

export const DEFAULT_HOME_CARDS: HomeCardPrefs = { order: HOME_CARD_IDS, hidden: [] };

const KNOWN: ReadonlySet<string> = new Set(HOME_CARD_IDS);

function knownIds(value: unknown): HomeCardId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: HomeCardId[] = [];
  for (const id of value) {
    if (typeof id === 'string' && KNOWN.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id as HomeCardId);
    }
  }
  return out;
}

/** A stored order and hidden list as the prefs to use now (see the file comment). Anything that is not a list is treated as unset. */
export function normalizeHomeCards(order: unknown, hidden: unknown): HomeCardPrefs {
  const chosen = knownIds(order);
  const have = new Set<string>(chosen);
  return {
    order: [...chosen, ...HOME_CARD_IDS.filter((id) => !have.has(id))],
    hidden: knownIds(hidden),
  };
}

/** The stored text as prefs; null, damaged or foreign text gives the defaults. */
export function parseHomeCards(raw: string | null): HomeCardPrefs {
  if (raw === null) return DEFAULT_HOME_CARDS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_HOME_CARDS;
    const { order, hidden } = parsed as Record<string, unknown>;
    return normalizeHomeCards(order, hidden);
  } catch {
    return DEFAULT_HOME_CARDS;
  }
}

export function serializeHomeCards(prefs: HomeCardPrefs): string {
  return JSON.stringify({ order: prefs.order, hidden: prefs.hidden });
}

/** The cards to draw, top to bottom. */
export function visibleHomeCards(prefs: HomeCardPrefs): HomeCardId[] {
  const hidden = new Set<string>(prefs.hidden);
  return prefs.order.filter((id) => !hidden.has(id));
}

/** Shows or hides one card; the same object when nothing changes. */
export function setHomeCardHidden(prefs: HomeCardPrefs, id: HomeCardId, hide: boolean): HomeCardPrefs {
  const isHidden = prefs.hidden.includes(id);
  if (isHidden === hide) return prefs;
  return { order: prefs.order, hidden: hide ? [...prefs.hidden, id] : prefs.hidden.filter((h) => h !== id) };
}

/** Moves one card `delta` places (negative is up) in the full list, hidden cards included; stops at the ends. Same object when nothing moves. */
export function moveHomeCard(prefs: HomeCardPrefs, id: HomeCardId, delta: number): HomeCardPrefs {
  const from = prefs.order.indexOf(id);
  if (from === -1) return prefs;
  const to = Math.min(prefs.order.length - 1, Math.max(0, from + delta));
  if (to === from) return prefs;
  const order = [...prefs.order];
  order.splice(from, 1);
  order.splice(to, 0, id);
  return { order, hidden: prefs.hidden };
}

export function isDefaultHomeCards(prefs: HomeCardPrefs): boolean {
  return prefs.hidden.length === 0 && prefs.order.every((id, i) => id === HOME_CARD_IDS[i]);
}
