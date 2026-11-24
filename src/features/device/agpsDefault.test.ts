import { describe, expect, it, mock } from 'bun:test';

mock.module('expo-sqlite/kv-store', () => ({ default: { getItemSync: () => null, setItemSync: () => undefined } }));
mock.module('@/wear', () => ({ HuaweiWear: {}, hasNative: () => false }));

const { applyAgpsDefaultOnce } = await import('./agpsDefault');

function fake(over: { supported?: boolean; applied?: boolean; fail?: boolean } = {}) {
  const state = { applied: over.applied ?? false, agnss: false, pgnss: false };
  return {
    state,
    deps: {
      applied: () => state.applied,
      markApplied: () => {
        state.applied = true;
      },
      supported: () => over.supported ?? true,
      setAgnss: async (on: boolean) => {
        if (over.fail) throw new Error('native');
        state.agnss = on;
      },
      setPgnss: async (on: boolean) => {
        state.pgnss = on;
      },
    },
  };
}

describe('applyAgpsDefaultOnce', () => {
  it('turns both switches on once, then leaves the choice alone', async () => {
    const f = fake();
    expect(await applyAgpsDefaultOnce(f.deps)).toBe(true);
    expect(f.state).toEqual({ applied: true, agnss: true, pgnss: true });
    f.state.agnss = false; // the person turns it off later
    expect(await applyAgpsDefaultOnce(f.deps)).toBe(false);
    expect(f.state.agnss).toBe(false);
  });

  it('does nothing on a binary without the switches, and retries after a failure', async () => {
    const old = fake({ supported: false });
    expect(await applyAgpsDefaultOnce(old.deps)).toBe(false);
    expect(old.state.applied).toBe(false);
    const failing = fake({ fail: true });
    expect(await applyAgpsDefaultOnce(failing.deps)).toBe(false);
    expect(failing.state.applied).toBe(false);
  });
});
