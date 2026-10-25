/**
 * The step state machine of the first-run setup guide. Pure: no React, no storage, no native calls, so every rule
 * (resume, skip, platform filtering, existing-user bypass) is a plain function with a test.
 *
 * Order, and why it is not just the order of the Settings screens:
 * 1. `welcome`: what the guide covers, the one place to leave it altogether, and the fork: "Aku belum punya jam / jamku belum didukung"
 *    switches the run to the phone-only route (`route: 'none'`). Continue keeps the watch route, unchanged for watch owners.
 *    The phone-only route hides every watch step and adds `phone`: what works without a watch, the body weight the energy estimate
 *    uses, and the supported watches with the way to ask for yours. Its path is welcome, phone, account, pro, cloud, done.
 * 2. `unbind`: before pairing. The watch holds one phone pairing, so it has to be released in Huawei Health first. This is also the
 *    last point where Huawei Health can still sync once more and where its data export can be requested (the export takes days, so it is
 *    asked for now and imported whenever it arrives).
 * 3. `pair`: scanning starts on arrival (the Bluetooth prompt first), one card per watch found, "Add manually" by model when the scan
 *    finds nothing, then a full-width "confirm on your watch" panel while the link is set up. The first history pull starts by itself
 *    once the link is up and runs in the background (`firstSyncStarts`): the steps after this one show its progress on one line instead
 *    of making the person wait on a step of its own, as Huawei Health does.
 * 4. `background`: straight after pairing, while the person is still paying attention to the watch link, as Huawei Health shows its
 *    keep-alive tips. It needs the remembered watch from step 3 and is Android only.
 * 5. `notifications`, `health`, `weather`: the optional permissions, most useful first.
 * 6. `account`: JoyoRogo sign-in. After pairing, so the first sync has had time to put scores in the diary.
 * 7. `pro`: after sign-in, because Pro is an account feature. Information only; never blocks.
 * 8. `cloud`: JoyoRogo Cloud for workouts. After `pro`, because what it offers depends on the account being Pro. Never blocks.
 * 9. `done`: tips.
 */

import { t } from '@/i18n';

export type Platform = 'ios' | 'android';

export const STEP_IDS = [
  'welcome',
  'phone',
  'unbind',
  'pair',
  'background',
  'notifications',
  'health',
  'weather',
  'account',
  'pro',
  'cloud',
  'done',
] as const;

export type StepId = (typeof STEP_IDS)[number];

/** What decides which steps apply on this phone and build. */
export interface StepContext {
  platform: Platform;
  /** The cloud server is set in this build; without it the Pro step (cloud backup) is hidden. */
  cloudConfigured: boolean;
}

/** `watch`: the run for someone with a watch to pair. `none`: no watch, or one that is not supported; the phone-only run. */
export type Route = 'watch' | 'none';

interface StepRule {
  platforms?: readonly Platform[];
  needsCloud?: boolean;
  /** Shown on this route only. */
  route?: Route;
}

const RULES: Partial<Record<StepId, StepRule>> = {
  phone: { route: 'none' },
  unbind: { route: 'watch' },
  pair: { route: 'watch' },
  background: { platforms: ['android'], route: 'watch' },
  notifications: { route: 'watch' },
  health: { route: 'watch' },
  weather: { route: 'watch' },
  pro: { needsCloud: true },
  cloud: { needsCloud: true },
};

export type OnboardingStatus = 'active' | 'completed' | 'dismissed' | 'bypassed';

export interface OnboardingState {
  status: OnboardingStatus;
  /** The step on screen (`active`), or the last one reached. */
  step: StepId;
  /** Which run this is; chosen on `welcome` (see `advance` and `chooseNoWatch`). */
  route: Route;
  /** Steps left with Continue. */
  done: StepId[];
  /** Steps left with Skip or Later. */
  skipped: StepId[];
  /** Steps this run does not show whatever the platform says (`unbind` when a watch is already paired at the start). */
  without: StepId[];
}

/** Whether `id` applies on this phone and build. */
function applies(id: StepId, ctx: StepContext, route: Route): boolean {
  const rule = RULES[id];
  if (!rule) return true;
  if (rule.route && rule.route !== route) return false;
  if (rule.platforms && !rule.platforms.includes(ctx.platform)) return false;
  if (rule.needsCloud && !ctx.cloudConfigured) return false;
  return true;
}

/** The steps this run shows, in order. */
export function visibleSteps(state: Pick<OnboardingState, 'without' | 'route'>, ctx: StepContext): StepId[] {
  return STEP_IDS.filter((id) => applies(id, ctx, state.route) && !state.without.includes(id));
}

/** A fresh run from the first step. `hasPairedWatch` (Setup guide reopened from Settings) leaves out the unbind step. */
export function startState(options: { hasPairedWatch: boolean }): OnboardingState {
  return {
    status: 'active',
    step: 'welcome',
    route: 'watch',
    done: [],
    skipped: [],
    without: options.hasPairedWatch ? ['unbind'] : [],
  };
}

/**
 * The step to show. A saved step that no longer applies (the build changed, or the file was edited) falls forward to the next
 * one that does, so a resumed run never lands on a hidden step.
 */
export function currentStep(state: OnboardingState, ctx: StepContext): StepId {
  const steps = visibleSteps(state, ctx);
  if (steps.includes(state.step)) return state.step;
  const from = STEP_IDS.indexOf(state.step);
  return steps.find((id) => STEP_IDS.indexOf(id) > from) ?? steps[steps.length - 1];
}

/** Position for the progress indicator: `index` is 1-based. */
export function progress(state: OnboardingState, ctx: StepContext): { index: number; total: number } {
  const steps = visibleSteps(state, ctx);
  return { index: steps.indexOf(currentStep(state, ctx)) + 1, total: steps.length };
}

/**
 * Whether the first history pull may start: the run is open on the watch route and has reached the pairing step. The pull itself
 * waits for the link (see `useFirstSync`); the steps before pairing never start one, also when a run reopened from Settings finds the
 * watch already connected.
 */
export function firstSyncStarts(state: OnboardingState, ctx: StepContext): boolean {
  if (state.status !== 'active' || state.route !== 'watch') return false;
  const steps = visibleSteps(state, ctx);
  const pair = steps.indexOf('pair');
  return pair >= 0 && steps.indexOf(currentStep(state, ctx)) >= pair;
}

function dropStep(list: readonly StepId[], item: StepId): StepId[] {
  return list.filter((x) => x !== item);
}

function moveForward(state: OnboardingState, ctx: StepContext, how: 'done' | 'skipped'): OnboardingState {
  if (state.status !== 'active') return state;
  const steps = visibleSteps(state, ctx);
  const here = currentStep(state, ctx);
  const marked: OnboardingState = {
    ...state,
    done: how === 'done' ? [...dropStep(state.done, here), here] : dropStep(state.done, here),
    skipped: how === 'skipped' ? [...dropStep(state.skipped, here), here] : dropStep(state.skipped, here),
  };
  const next = steps[steps.indexOf(here) + 1];
  if (!next) return { ...marked, step: here, status: 'completed' };
  return { ...marked, step: next };
}

/** Continue: the step is done, go to the next one; past the last step the guide is completed. Continue on `welcome` is the watch route. */
export function advance(state: OnboardingState, ctx: StepContext): OnboardingState {
  const route: OnboardingState = currentStep(state, ctx) === 'welcome' ? { ...state, route: 'watch' } : state;
  return moveForward(route, ctx, 'done');
}

/**
 * "Aku belum punya jam / jamku belum didukung", from `welcome`: the run switches to the phone-only route and goes on to its first
 * step. Pairing is not lost: the Watch tab (and Settings) pair a watch whenever one turns up.
 */
export function chooseNoWatch(state: OnboardingState, ctx: StepContext): OnboardingState {
  if (state.status !== 'active') return state;
  return moveForward({ ...state, route: 'none' }, ctx, 'done');
}

/** Skip / Later: the same move, remembered as skipped so the last step can say what is still open. */
export function skip(state: OnboardingState, ctx: StepContext): OnboardingState {
  return moveForward(state, ctx, 'skipped');
}

/** Back: the previous step; the first step stays. Marks nothing. */
export function back(state: OnboardingState, ctx: StepContext): OnboardingState {
  if (state.status !== 'active') return state;
  const steps = visibleSteps(state, ctx);
  const previous = steps[steps.indexOf(currentStep(state, ctx)) - 1];
  return previous ? { ...state, step: previous } : state;
}

/** "Skip setup": leave the whole guide. It is not shown again on its own; Settings, Setup guide opens it. */
export function dismiss(state: OnboardingState): OnboardingState {
  return state.status === 'active' ? { ...state, status: 'dismissed' } : state;
}

/** Steps skipped on the way that the last step lists as still open, in guide order. */
export function openSteps(state: OnboardingState, ctx: StepContext): StepId[] {
  return visibleSteps(state, ctx).filter((id) => state.skipped.includes(id) && id !== 'welcome');
}

/**
 * Nothing in the guide leaves the pairing step while the link is being set up: leaving mid-way would drop a connect that may be
 * waiting for the accept on the watch. Every other step, and a pairing step with no connect running, can always go back or skip.
 */
export function navigationLocked(step: StepId, linkState: string): boolean {
  return step === 'pair' && (linkState === 'connecting' || linkState === 'authenticating' || linkState === 'initializing');
}

/** What the buttons under a step do. A null label hides the button. */
export interface Footer {
  primary: string | null;
  primaryDisabled: boolean;
  /** Skip, Later or Skip setup. */
  skip: string | null;
  back: boolean;
}

/** What a step's footer needs to know about the app right now. */
export interface FooterFacts {
  linkState: string;
  signedIn: boolean;
}

/**
 * The buttons under each step. Back and a skip exist everywhere but mid-pairing (see `navigationLocked`). Two steps hold Continue back
 * until it means something: pairing until the watch is linked, and the account step until someone is signed in; until then "Later" is the
 * way on. The cloud step offers sign-in or skip when nobody is signed in. Labels are read in the current language at call time.
 */
export function footerFor(step: StepId, facts: FooterFacts): Footer {
  const label = {
    continue: t('onboarding:footer.continue'),
    later: t('onboarding:footer.later'),
    skip: t('onboarding:footer.skip'),
  };
  const linkUp = facts.linkState === 'connected' || facts.linkState === 'syncing';
  if (navigationLocked(step, facts.linkState)) return { primary: null, primaryDisabled: false, skip: null, back: false };
  switch (step) {
    case 'welcome':
      return { primary: t('onboarding:footer.getStarted'), primaryDisabled: false, skip: t('onboarding:footer.skipSetup'), back: false };
    case 'phone':
      return { primary: label.continue, primaryDisabled: false, skip: null, back: true };
    case 'pair':
      return linkUp
        ? { primary: label.continue, primaryDisabled: false, skip: null, back: true }
        : { primary: null, primaryDisabled: false, skip: label.later, back: true };
    case 'account':
      return facts.signedIn
        ? { primary: label.continue, primaryDisabled: false, skip: null, back: true }
        : { primary: null, primaryDisabled: false, skip: label.later, back: true };
    case 'pro':
      return { primary: label.continue, primaryDisabled: false, skip: t('onboarding:footer.notNow'), back: true };
    case 'cloud':
      return facts.signedIn
        ? { primary: label.continue, primaryDisabled: false, skip: label.skip, back: true }
        : { primary: null, primaryDisabled: false, skip: label.skip, back: true };
    case 'done':
      return { primary: t('onboarding:footer.finish'), primaryDisabled: false, skip: null, back: true };
    default:
      return { primary: label.continue, primaryDisabled: false, skip: label.later, back: true };
  }
}

/** `show` is the run to open the guide with (null: leave the app alone); `persist` is a record to write first (null: nothing to write). */
export interface LaunchDecision {
  show: OnboardingState | null;
  persist: OnboardingState | null;
}

/**
 * What to do at app start. Nothing stored: a person with a paired watch is an existing user and is never blocked (a `bypassed`
 * record is written so a later unpair does not suddenly start the guide); anyone else gets the guide. A stored active run
 * resumes where it was left; a finished, dismissed or bypassed one stays closed.
 */
export function resolveLaunch(options: { stored: OnboardingState | null; hasPairedWatch: boolean }): LaunchDecision {
  const { stored, hasPairedWatch } = options;
  if (stored) return { show: stored.status === 'active' ? stored : null, persist: null };
  if (hasPairedWatch) {
    return { show: null, persist: { ...startState({ hasPairedWatch: true }), status: 'bypassed' } };
  }
  const fresh = startState({ hasPairedWatch: false });
  return { show: fresh, persist: fresh };
}

const STATUSES: readonly OnboardingStatus[] = ['active', 'completed', 'dismissed', 'bypassed'];

/**
 * Steps an older build stored that are no longer steps, and where such a run resumes. `sync` was the first-sync step after pairing;
 * the sync now runs in the background, so the run resumes on what follows pairing (`background`, or the next visible step on iOS).
 */
const RETIRED_STEPS: Readonly<Record<string, StepId>> = { sync: 'background' };

function stepList(value: unknown): StepId[] {
  return Array.isArray(value) ? value.filter((v): v is StepId => STEP_IDS.includes(v as StepId)) : [];
}

/** Reads a stored record; anything that is not one (corrupt file, an older shape) is null, which starts a fresh run. */
export function parseState(raw: string | null): OnboardingState | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (!STATUSES.includes(record.status as OnboardingStatus)) return null;
    const step = typeof record.step === 'string' ? (RETIRED_STEPS[record.step] ?? record.step) : null;
    if (!STEP_IDS.includes(step as StepId)) return null;
    return {
      status: record.status as OnboardingStatus,
      step: step as StepId,
      route: record.route === 'none' ? 'none' : 'watch',
      done: stepList(record.done),
      skipped: stepList(record.skipped),
      without: stepList(record.without),
    };
  } catch {
    return null;
  }
}

export function serializeState(state: OnboardingState): string {
  return JSON.stringify(state);
}
