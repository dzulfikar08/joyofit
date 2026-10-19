import { afterEach, describe, expect, it, vi } from 'bun:test';

import { BUSY_RECHECK_MS, type AutoOutcome } from './autoReconnect';
import { createAutoReconnect, type AutoReconnectControl, type ObservedFacts } from './autoReconnectControl';

afterEach(() => vi.useRealTimers());

const WATCH = 'AA:BB:CC:DD:EE:01';

const OBSERVED: ObservedFacts = {
  address: WATCH,
  linkState: 'disconnected',
  backgroundEnabled: false,
  disconnectedByUser: false,
  permitted: true,
  appActive: true,
  pairingAllows: true,
};

/** The control with fake timers and a scripted environment; `attempts` lists the addresses it connected, in order. */
function setup(outcomes: AutoOutcome[] = [], observed: Partial<ObservedFacts> = {}) {
  vi.useFakeTimers();
  const control: AutoReconnectControl = createAutoReconnect();
  const state = { busy: false, observed: { ...OBSERVED, ...observed }, attempts: [] as string[], observes: 0 };
  control.bind({
    observe: async () => {
      state.observes += 1;
      return state.observed;
    },
    isBusy: () => state.busy,
    attempt: async (address) => {
      state.attempts.push(address);
      return outcomes[state.attempts.length - 1] ?? 'failed';
    },
  });
  return { control, state };
}

/** Moves the fake clock and lets the promises the control awaits settle. */
async function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe('the automatic reconnect timer', () => {
  it('connects the remembered watch once, soon after the app opens, and stops when it is connected', async () => {
    const { control, state } = setup(['connected']);
    control.foreground();
    await advance(1_499);
    expect(state.attempts).toEqual([]);
    await advance(1);
    expect(state.attempts).toEqual([WATCH]);
    await advance(10 * 60_000);
    expect(state.attempts).toEqual([WATCH]);
  });

  it('retries a failed attempt further apart (30 s, then 2 min) and then waits for the app to come forward', async () => {
    const { control, state } = setup();
    control.foreground();
    await advance(1_500);
    expect(state.attempts).toHaveLength(1);
    await advance(29_999);
    expect(state.attempts).toHaveLength(1);
    await advance(1);
    expect(state.attempts).toHaveLength(2);
    await advance(119_999);
    expect(state.attempts).toHaveLength(2);
    await advance(1);
    expect(state.attempts).toHaveLength(3);
    await advance(60 * 60_000);
    expect(state.attempts).toHaveLength(3);

    control.foreground();
    await advance(1_500);
    expect(state.attempts).toHaveLength(4);
  });

  it('gives up on an outcome that needs the person, until they connect themselves', async () => {
    const { control, state } = setup(['blocked']);
    control.foreground();
    await advance(1_500);
    expect(state.attempts).toHaveLength(1);
    await advance(60 * 60_000);
    control.foreground();
    await advance(60 * 60_000);
    expect(state.attempts).toHaveLength(1);

    control.reset();
    control.foreground();
    await advance(1_500);
    expect(state.attempts).toHaveLength(2);
  });

  it('looks again while a connect, a sync or the first-bind question is open, and connects when that ends', async () => {
    const { control, state } = setup(['connected']);
    state.busy = true;
    control.foreground();
    await advance(1_500);
    expect(state.attempts).toEqual([]);
    await advance(BUSY_RECHECK_MS);
    await advance(BUSY_RECHECK_MS);
    expect(state.attempts).toEqual([]);
    expect(state.observes).toBeGreaterThan(2);

    state.busy = false;
    await advance(BUSY_RECHECK_MS);
    expect(state.attempts).toEqual([WATCH]);
  });

  it('does not keep looking when something other than busy stops it', async () => {
    const { control, state } = setup([], { disconnectedByUser: true });
    control.foreground();
    await advance(1_500);
    const reads = state.observes;
    await advance(60 * 60_000);
    expect(state.attempts).toEqual([]);
    expect(state.observes).toBe(reads);
  });

  it('never connects without the pairing check, with background mode on, with the app in the background or without a remembered watch', async () => {
    for (const observed of [{ pairingAllows: false }, { backgroundEnabled: true }, { appActive: false }, { address: null }]) {
      const { control, state } = setup([], observed);
      control.foreground();
      await advance(60_000);
      expect(state.attempts).toEqual([]);
      vi.useRealTimers();
    }
  });

  it('leaves the error of a failed connect the person started alone, until the app comes forward', async () => {
    const { control, state } = setup();
    control.reset();
    control.settle();
    control.schedule();
    await advance(60 * 60_000);
    expect(state.attempts).toEqual([]);

    control.foreground();
    await advance(1_500);
    expect(state.attempts).toHaveLength(1);
  });

  it('starts from the soonest attempt again after the link was up', async () => {
    const { control, state } = setup();
    control.foreground();
    await advance(1_500);
    await advance(30_000);
    expect(state.attempts).toHaveLength(2);
    // The next one is 2 min away; a link that came up and dropped makes it 1.5 s away.
    control.cancel();
    control.linked();
    control.schedule();
    await advance(1_500);
    expect(state.attempts).toHaveLength(3);
  });

  it('is one attempt at a time: repeated schedule calls and a pending attempt do not stack', async () => {
    const { control, state } = setup(['connected']);
    control.schedule();
    control.schedule();
    control.foreground();
    control.foreground();
    await advance(1_500);
    expect(state.attempts).toEqual([WATCH]);
  });

  it('cancel drops the pending attempt', async () => {
    const { control, state } = setup();
    control.foreground();
    control.cancel();
    await advance(60 * 60_000);
    expect(state.attempts).toEqual([]);
  });

  it('survives an environment that cannot be read', async () => {
    vi.useFakeTimers();
    const control = createAutoReconnect();
    let attempted = false;
    control.bind({
      observe: async () => {
        throw new Error('native module gone');
      },
      isBusy: () => false,
      attempt: async () => {
        attempted = true;
        return 'connected';
      },
    });
    control.foreground();
    await advance(60_000);
    expect(attempted).toBe(false);
  });
});
