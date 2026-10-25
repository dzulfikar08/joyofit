import { describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';

import {
  advance,
  back,
  chooseNoWatch,
  currentStep,
  dismiss,
  firstSyncStarts,
  footerFor,
  navigationLocked,
  openSteps,
  parseState,
  progress,
  resolveLaunch,
  serializeState,
  skip,
  startState,
  visibleSteps,
  type OnboardingState,
  type StepContext,
  type StepId,
} from './flow';

const ANDROID: StepContext = { platform: 'android', cloudConfigured: true };
const IOS: StepContext = { platform: 'ios', cloudConfigured: true };

/** Presses Continue until `target` is on screen. */
function walkTo(target: StepId, ctx: StepContext, state = startState({ hasPairedWatch: false })): OnboardingState {
  let current = state;
  while (currentStep(current, ctx) !== target) current = advance(current, ctx);
  return current;
}

describe('platform filtering', () => {
  test('Android runs every step in the planned order, keep-alive straight after pairing', () => {
    expect(visibleSteps(startState({ hasPairedWatch: false }), ANDROID)).toEqual([
      'welcome',
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
    ]);
  });

  test('iOS hides the Android-only background step and keeps the rest', () => {
    const steps = visibleSteps(startState({ hasPairedWatch: false }), IOS);
    expect(steps).not.toContain('background');
    expect(steps).toContain('notifications');
    expect(steps).toHaveLength(10);
  });

  test('a build without the cloud server hides the Pro and cloud steps', () => {
    const steps = visibleSteps(startState({ hasPairedWatch: false }), { platform: 'android', cloudConfigured: false });
    expect(steps).not.toContain('pro');
    expect(steps).not.toContain('cloud');
    expect(steps).toContain('account');
  });

  test('progress counts only the visible steps', () => {
    const state = walkTo('account', IOS);
    expect(progress(state, IOS)).toEqual({ index: 7, total: 10 });
    expect(progress(walkTo('account', ANDROID), ANDROID)).toEqual({ index: 8, total: 11 });
  });

  test('walking forward on iOS never lands on a hidden step', () => {
    let state = startState({ hasPairedWatch: false });
    const seen: StepId[] = [];
    while (state.status === 'active') {
      seen.push(currentStep(state, IOS));
      state = advance(state, IOS);
    }
    expect(seen).toEqual(visibleSteps(state, IOS));
  });
});

describe('the no-watch route', () => {
  const none = (ctx: StepContext) => chooseNoWatch(startState({ hasPairedWatch: false }), ctx);

  test('choosing no watch from the welcome step skips pairing and lands on the phone step', () => {
    const state = none(ANDROID);
    expect(state.route).toBe('none');
    expect(state.step).toBe('phone');
    expect(state.done).toEqual(['welcome']);
  });

  test('the phone-only path is welcome, phone, account, pro, cloud, done, on both platforms', () => {
    for (const ctx of [ANDROID, IOS]) {
      expect(visibleSteps(none(ctx), ctx)).toEqual(['welcome', 'phone', 'account', 'pro', 'cloud', 'done']);
    }
  });

  test('every watch-only step is hidden, and the watch route never shows the phone step', () => {
    const hidden: StepId[] = ['unbind', 'pair', 'notifications', 'health', 'weather', 'background'];
    for (const id of hidden) expect(visibleSteps(none(ANDROID), ANDROID)).not.toContain(id);
    expect(visibleSteps(startState({ hasPairedWatch: false }), ANDROID)).not.toContain('phone');
  });

  test('walking the phone route ends with a completed guide, never touching a watch step', () => {
    let state = none(ANDROID);
    const seen: StepId[] = [];
    while (state.status === 'active') {
      seen.push(currentStep(state, ANDROID));
      state = advance(state, ANDROID);
    }
    expect(seen).toEqual(['phone', 'account', 'pro', 'cloud', 'done']);
    expect(state.status).toBe('completed');
  });

  test('without the cloud server the phone route is welcome, phone, account, done', () => {
    const ctx: StepContext = { platform: 'android', cloudConfigured: false };
    expect(visibleSteps(none(ctx), ctx)).toEqual(['welcome', 'phone', 'account', 'done']);
  });

  test('Back from the phone step returns to welcome, and Continue there is the watch route again', () => {
    const welcome = back(none(ANDROID), ANDROID);
    expect(welcome.step).toBe('welcome');
    const watchRoute = advance(welcome, ANDROID);
    expect(watchRoute.route).toBe('watch');
    expect(watchRoute.step).toBe('unbind');
  });

  test('the phone step has Continue and Back, and no Later', () => {
    const footer = footerFor('phone', { linkState: 'disconnected', signedIn: false });
    expect(footer.primary).not.toBeNull();
    expect(footer.skip).toBeNull();
    expect(footer.back).toBe(true);
  });

  test('the route survives storage, and a record from before it existed is the watch route', () => {
    const state = none(ANDROID);
    expect(parseState(serializeState(state))?.route).toBe('none');
    expect(parseState(JSON.stringify({ status: 'active', step: 'pair' }))?.route).toBe('watch');
  });

  test('a finished run does not switch route', () => {
    const finished = advance(walkTo('done', ANDROID), ANDROID);
    expect(chooseNoWatch(finished, ANDROID)).toEqual(finished);
  });
});

describe('moving through the steps', () => {
  test('Continue marks the step done and the last Continue completes the guide', () => {
    let state = startState({ hasPairedWatch: false });
    state = advance(state, ANDROID);
    expect(state.step).toBe('unbind');
    expect(state.done).toEqual(['welcome']);
    state = walkTo('done', ANDROID, state);
    expect(state.status).toBe('active');
    state = advance(state, ANDROID);
    expect(state.status).toBe('completed');
    expect(state.step).toBe('done');
  });

  test('Skip moves on and remembers the step as skipped, not done', () => {
    const state = skip(walkTo('notifications', ANDROID), ANDROID);
    expect(state.step).toBe('health');
    expect(state.skipped).toEqual(['notifications']);
    expect(state.done).not.toContain('notifications');
  });

  test('Back returns to the previous visible step and marks nothing', () => {
    const state = walkTo('account', IOS);
    const previous = back(state, IOS);
    expect(previous.step).toBe('weather');
    expect(previous.done).toEqual(state.done);
    expect(previous.skipped).toEqual(state.skipped);
  });

  test('Back on the first step stays put', () => {
    const state = startState({ hasPairedWatch: false });
    expect(back(state, ANDROID)).toEqual(state);
  });

  test('doing a skipped step on the way back clears the skip', () => {
    let state = skip(walkTo('weather', ANDROID), ANDROID);
    expect(state.skipped).toEqual(['weather']);
    state = advance(back(state, ANDROID), ANDROID);
    expect(state.skipped).toEqual([]);
    expect(state.done).toContain('weather');
  });

  test('the last step lists what was skipped, in guide order', () => {
    let state = walkTo('notifications', ANDROID);
    state = skip(state, ANDROID);
    state = advance(state, ANDROID);
    state = skip(state, ANDROID);
    state = skip(walkTo('account', ANDROID, state), ANDROID);
    expect(openSteps(state, ANDROID)).toEqual(['notifications', 'weather', 'account']);
  });

  test('a finished or dismissed run does not move', () => {
    const finished = advance(walkTo('done', ANDROID), ANDROID);
    expect(advance(finished, ANDROID)).toEqual(finished);
    expect(skip(finished, ANDROID)).toEqual(finished);
    expect(back(finished, ANDROID)).toEqual(finished);
    const dismissed = dismiss(startState({ hasPairedWatch: false }));
    expect(dismissed.status).toBe('dismissed');
    expect(advance(dismissed, ANDROID)).toEqual(dismissed);
  });

  test('dismiss keeps the step it was left on', () => {
    expect(dismiss(walkTo('pair', ANDROID)).step).toBe('pair');
  });
});

describe('the pairing step', () => {
  test('is locked while a connect is running, free otherwise', () => {
    for (const link of ['connecting', 'authenticating', 'initializing']) {
      expect(navigationLocked('pair', link)).toBe(true);
    }
    for (const link of ['disconnected', 'connected', 'syncing']) {
      expect(navigationLocked('pair', link)).toBe(false);
    }
  });

  test('no other step is ever locked', () => {
    expect(navigationLocked('background', 'connecting')).toBe(false);
    expect(navigationLocked('unbind', 'connecting')).toBe(false);
  });

  test('Continue after pairing lands on the keep-alive step on Android and on notifications on iOS', () => {
    expect(advance(walkTo('pair', ANDROID), ANDROID).step).toBe('background');
    expect(currentStep(advance(walkTo('pair', IOS), IOS), IOS)).toBe('notifications');
  });
});

describe('the first sync', () => {
  test('is not a step: it starts in the background from the pairing step on', () => {
    expect(visibleSteps(startState({ hasPairedWatch: false }), ANDROID) as string[]).not.toContain('sync');
    expect(firstSyncStarts(walkTo('unbind', ANDROID), ANDROID)).toBe(false);
    for (const step of ['pair', 'background', 'notifications', 'account', 'done'] as const) {
      expect(firstSyncStarts(walkTo(step, ANDROID), ANDROID)).toBe(true);
    }
  });

  test('a run reopened from Settings with a connected watch does not sync on the welcome step', () => {
    expect(firstSyncStarts(startState({ hasPairedWatch: true }), ANDROID)).toBe(false);
    expect(firstSyncStarts(advance(startState({ hasPairedWatch: true }), ANDROID), ANDROID)).toBe(true);
  });

  test('the phone-only route and a closed run never start it', () => {
    const none = chooseNoWatch(startState({ hasPairedWatch: false }), ANDROID);
    expect(firstSyncStarts(none, ANDROID)).toBe(false);
    expect(firstSyncStarts(advance(walkTo('done', ANDROID), ANDROID), ANDROID)).toBe(false);
    expect(firstSyncStarts(dismiss(walkTo('pair', ANDROID)), ANDROID)).toBe(false);
  });

  test('a run stored on the old sync step resumes on what now follows pairing', () => {
    const raw = JSON.stringify({ status: 'active', step: 'sync', route: 'watch', done: ['welcome', 'unbind', 'pair'], skipped: ['sync'] });
    const restored = parseState(raw) as OnboardingState;
    expect(restored.step).toBe('background');
    expect(restored.skipped).toEqual([]);
    expect(currentStep(restored, ANDROID)).toBe('background');
    expect(currentStep(restored, IOS)).toBe('notifications');
  });
});

describe('resume', () => {
  test('an active stored run opens where it was left', () => {
    const stored = walkTo('background', ANDROID);
    const decision = resolveLaunch({ stored, hasPairedWatch: false });
    expect(decision.show).toEqual(stored);
    expect(decision.persist).toBeNull();
  });

  test('a run closed mid-way survives a round trip through storage', () => {
    const state = skip(walkTo('health', IOS), IOS);
    const restored = parseState(serializeState(state));
    expect(restored).toEqual(state);
    expect(currentStep(restored as OnboardingState, IOS)).toBe('weather');
  });

  test('a hidden last step falls back to the final visible step', () => {
    const stored: OnboardingState = { ...startState({ hasPairedWatch: false }), step: 'pro' };
    expect(currentStep(stored, { platform: 'ios', cloudConfigured: false })).toBe('done');
  });

  test('a stored step that is hidden on this build moves forward to the next visible one', () => {
    const stored: OnboardingState = { ...startState({ hasPairedWatch: false }), step: 'background' };
    expect(currentStep(stored, IOS)).toBe('notifications');
    expect(currentStep(stored, ANDROID)).toBe('background');
  });

  test('corrupt or foreign storage reads as nothing, which starts fresh', () => {
    expect(parseState(null)).toBeNull();
    expect(parseState('')).toBeNull();
    expect(parseState('{not json')).toBeNull();
    expect(parseState('42')).toBeNull();
    expect(parseState(JSON.stringify({ status: 'active', step: 'nope' }))).toBeNull();
    expect(parseState(JSON.stringify({ status: 'paused', step: 'pair' }))).toBeNull();
  });

  test('unknown step ids in the lists are dropped', () => {
    const parsed = parseState(JSON.stringify({ status: 'active', step: 'pair', done: ['welcome', 'zzz'], skipped: 'x' }));
    expect(parsed).toEqual({ status: 'active', step: 'pair', route: 'watch', done: ['welcome'], skipped: [], without: [] });
  });
});

describe('launch decision', () => {
  test('a new user with no paired watch gets the guide and it is written down', () => {
    const decision = resolveLaunch({ stored: null, hasPairedWatch: false });
    expect(decision.show?.step).toBe('welcome');
    expect(decision.show?.without).toEqual([]);
    expect(decision.persist).toEqual(decision.show);
  });

  test('an existing user with a paired watch is not blocked, and the bypass is recorded', () => {
    const decision = resolveLaunch({ stored: null, hasPairedWatch: true });
    expect(decision.show).toBeNull();
    expect(decision.persist?.status).toBe('bypassed');
  });

  test('a recorded bypass stays closed even after the watch is forgotten', () => {
    const bypassed = resolveLaunch({ stored: null, hasPairedWatch: true }).persist as OnboardingState;
    expect(resolveLaunch({ stored: bypassed, hasPairedWatch: false })).toEqual({ show: null, persist: null });
  });

  test('completed and dismissed runs do not come back on their own', () => {
    const completed = advance(walkTo('done', ANDROID), ANDROID);
    expect(resolveLaunch({ stored: completed, hasPairedWatch: false }).show).toBeNull();
    const dismissed = dismiss(startState({ hasPairedWatch: false }));
    expect(resolveLaunch({ stored: dismissed, hasPairedWatch: false }).show).toBeNull();
  });

  test('a paired watch does not cancel a run that is already in progress (the pairing step itself pairs it)', () => {
    const stored = walkTo('background', ANDROID);
    expect(resolveLaunch({ stored, hasPairedWatch: true }).show).toEqual(stored);
  });
});

describe('reopening from Settings', () => {
  test('starts from the first step, and leaves out unbinding when a watch is already paired', () => {
    const state = startState({ hasPairedWatch: true });
    expect(state.status).toBe('active');
    expect(state.step).toBe('welcome');
    expect(visibleSteps(state, ANDROID)).not.toContain('unbind');
    expect(currentStep(advance(state, ANDROID), ANDROID)).toBe('pair');
  });

  test('the left-out step stays out through a stored round trip, so progress does not shift after pairing', () => {
    const state = walkTo('background', ANDROID, startState({ hasPairedWatch: true }));
    const restored = parseState(serializeState(state)) as OnboardingState;
    expect(progress(restored, ANDROID)).toEqual(progress(state, ANDROID));
    expect(progress(restored, ANDROID).total).toBe(10);
  });
});

describe('footer buttons', () => {
  const idle = { linkState: 'disconnected', signedIn: false };

  test('every step offers Back and a way on, except the first Back and mid-pairing', () => {
    for (const step of visibleSteps(startState({ hasPairedWatch: false }), ANDROID)) {
      const footer = footerFor(step, idle);
      expect(footer.back).toBe(step !== 'welcome');
      expect(footer.primary !== null || footer.skip !== null).toBe(true);
    }
  });

  test('mid-pairing there is no Back, no Skip and no Continue', () => {
    for (const linkState of ['connecting', 'authenticating', 'initializing']) {
      expect(footerFor('pair', { linkState, signedIn: false })).toEqual({ primary: null, primaryDisabled: false, skip: null, back: false });
    }
  });

  test('pairing offers Continue only once the watch is linked, Nanti until then', () => {
    expect(footerFor('pair', idle)).toMatchObject({ primary: null, skip: 'Nanti', back: true });
    expect(footerFor('pair', { linkState: 'connected', signedIn: false })).toMatchObject({ primary: 'Lanjut', skip: null });
  });

  test('the account step continues only when signed in, otherwise Later', () => {
    expect(footerFor('account', idle)).toMatchObject({ primary: null, skip: 'Nanti' });
    expect(footerFor('account', { linkState: 'disconnected', signedIn: true })).toMatchObject({ primary: 'Lanjut', skip: null });
  });

  test('the cloud step is Lanjut or Lewati, and with nobody signed in only Lewati', () => {
    expect(footerFor('cloud', idle)).toMatchObject({ primary: null, skip: 'Lewati', back: true });
    expect(footerFor('cloud', { linkState: 'disconnected', signedIn: true })).toMatchObject({ primary: 'Lanjut', skip: 'Lewati', back: true });
  });

  test('the first step can end the whole guide and the last one finishes it', () => {
    expect(footerFor('welcome', idle)).toMatchObject({ primary: 'Mulai', skip: 'Lewati penyiapan' });
    expect(footerFor('done', idle)).toMatchObject({ primary: 'Selesai', skip: null, back: true });
  });

  test('permission steps are skippable with Nanti', () => {
    for (const step of ['notifications', 'health', 'weather', 'background'] as const) {
      expect(footerFor(step, idle)).toMatchObject({ primary: 'Lanjut', skip: 'Nanti' });
    }
  });

  test('labels follow the language', async () => {
    await applyLocale('en');
    try {
      expect(footerFor('welcome', idle)).toMatchObject({ primary: 'Get started', skip: 'Skip setup' });
      expect(footerFor('pair', idle)).toMatchObject({ skip: 'Later' });
      expect(footerFor('cloud', { linkState: 'disconnected', signedIn: true })).toMatchObject({ primary: 'Continue', skip: 'Skip' });
      expect(footerFor('done', idle).primary).toBe('Finish');
    } finally {
      await applyLocale('id');
    }
  });
});
