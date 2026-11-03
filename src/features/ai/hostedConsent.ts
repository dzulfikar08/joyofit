import type { CoachSnapshot } from '@/features/coach/chat/snapshot';
import type { AiSettings, SettingsStore } from './settings';

/**
 * The version of the consent text and of the list of data the hosted Joyo AI (engine `rogo`: JoyoRogo's server, then Cloudflare Workers
 * AI) receives. Change {@link HOSTED_CONSENT_CATEGORIES} (or what `coach/chat` really carries: `buildSnapshot`, JoyoRogo's
 * `readCoachServerContext`) and this number together: `hostedConsent.test.ts` pins the list to the version, so a changed list without a
 * new version fails the build, and everyone is asked again (Apple 5.1.1(i), 5.1.2(i)).
 */
export const HOSTED_CONSENT_VERSION = 1;

/** The kinds of data one hosted question carries, in the order the consent screen lists them (`ai:hosted.data.<id>`). */
export const HOSTED_CONSENT_CATEGORIES = ['chat', 'profile', 'recovery', 'sleep', 'workouts', 'plan', 'food'] as const;
export type HostedConsentCategory = (typeof HOSTED_CONSENT_CATEGORIES)[number];

/**
 * Which listed kind of data each field of the phone's snapshot belongs to. A `Record` over the snapshot's keys: adding a field to
 * `CoachSnapshot` does not compile until it is placed here, which is the moment to reword the consent text and bump the version.
 * `profile` and `food` are not in the snapshot: JoyoRogo's server adds them from the person's own account.
 */
export const SNAPSHOT_FIELD_CATEGORY: Record<keyof CoachSnapshot, HostedConsentCategory> = {
  generatedAt: 'chat',
  today: 'chat',
  readiness: 'recovery',
  load: 'recovery',
  hrv: 'recovery',
  sleep: 'sleep',
  strain: 'recovery',
  restingHr: 'recovery',
  vo2max: 'recovery',
  suggestion: 'plan',
  plan: 'plan',
  workouts: 'workouts',
};

/** Section of the privacy policy that describes the hosted Joyo AI (`site/src/Privasi.tsx`, ids `joyo-ai-hosted` and `joyo-ai-hosted-en`). */
export const HOSTED_PRIVACY_ANCHOR = { id: 'joyo-ai-hosted', en: 'joyo-ai-hosted-en' } as const;

/** The hosted AI may receive data only after a yes for the current {@link HOSTED_CONSENT_VERSION}. */
export function hasHostedConsent(settings: Pick<AiSettings, 'hostedConsent'>): boolean {
  return settings.hostedConsent?.version === HOSTED_CONSENT_VERSION;
}

/** Records the explicit yes of this phone (a tap on "Agree" after the screen listed the data and the recipients). */
export function grantHostedConsent(store: SettingsStore, nowSec: number): void {
  store.update({ hostedConsent: { version: HOSTED_CONSENT_VERSION, at: nowSec } });
}

/** Withdraws the yes: from the next request on, the hosted engine is closed until the person agrees again. */
export function withdrawHostedConsent(store: SettingsStore): void {
  store.update({ hostedConsent: null });
}

/** Thrown instead of a request when the person has not agreed (or agreed to an older list of data). */
export class HostedConsentError extends Error {
  constructor() {
    super('hosted AI consent missing');
  }
}
