import { describe, expect, test } from 'bun:test';

import { createLiveSteps } from './liveSteps';

type Answer = 'granted' | 'denied' | 'blocked';

/** A phone: its permission, what a prompt answers, and what the native counter saw. */
function fakePhone(answer: Answer = 'denied') {
  const phone = {
    permission: 'denied' as 'granted' | 'denied' | 'unavailable',
    answer,
    starts: 0,
    stops: 0,
    asked: 0,
    foreground: new Set<() => void>(),
    pending: [] as Promise<unknown>[],
  };
  /** Records every promise the controller is handed, so a test awaits exactly those instead of waiting for time. */
  const track = <T>(p: Promise<T>) => {
    phone.pending.push(p);
    return p;
  };
  const steps = createLiveSteps({
    native: {
      start: () => track(Promise.resolve(++phone.starts > 0)),
      stop: () => track(Promise.resolve(void (phone.stops += 1))),
      listen: () => ({ remove: () => undefined }),
    },
    permission: () => track(Promise.resolve(phone.permission)),
    ask: () => {
      phone.asked += 1;
      if (phone.answer === 'granted') phone.permission = 'granted';
      return track(Promise.resolve(phone.answer));
    },
    onForeground: (listener) => {
      phone.foreground.add(listener);
      return { remove: () => phone.foreground.delete(listener) };
    },
    onReading: () => undefined,
  });
  /** Settles every promise handed out so far, and those they lead to. */
  const settle = async () => {
    for (let seen = -1; seen !== phone.pending.length; ) {
      seen = phone.pending.length;
      await Promise.all(phone.pending);
    }
  };
  return { phone, steps, settle };
}

describe('the phone step counter of the live screen: permission', () => {
  test('without the permission it waits (ask) and starts nothing by itself', async () => {
    const { phone, steps, settle } = fakePhone();
    const stop = steps.run();
    await settle();
    expect(steps.state()).toBe('ask');
    expect(phone.starts).toBe(0);
    expect(phone.asked).toBe(0);
    stop();
    expect(steps.state()).toBe('off');
  });

  test('a tap that gets the permission starts counting; the end stops it', async () => {
    const { phone, steps, settle } = fakePhone('granted');
    const stop = steps.run();
    await settle();
    expect(await steps.allow()).toBe('granted');
    expect(steps.state()).toBe('on');
    expect(phone.starts).toBe(1);
    stop();
    expect(phone.stops).toBe(1);
  });

  test('after a refusal the answer comes back, so the screen can offer the settings, and nothing starts', async () => {
    const { phone, steps, settle } = fakePhone();
    const stop = steps.run();
    await settle();
    for (const answer of ['denied', 'blocked'] as const) {
      phone.answer = answer;
      expect(await steps.allow()).toBe(answer);
      expect(steps.state()).toBe('ask');
    }
    expect(phone.starts).toBe(0);
    stop();
  });

  test('a permission given in the settings starts counting on the return to the app, without another tap', async () => {
    const { phone, steps, settle } = fakePhone();
    const stop = steps.run();
    await settle();
    phone.permission = 'granted';
    for (const listener of phone.foreground) listener();
    await settle();
    expect(steps.state()).toBe('on');
    expect(phone.starts).toBe(1);
    expect(phone.asked).toBe(0);
    stop();
    expect(phone.foreground.size).toBe(0);
  });

  test('a binary without the native counter is unavailable, a granted phone counts at once', async () => {
    const none = createLiveSteps({
      native: null,
      permission: async () => 'granted',
      ask: async () => 'granted',
      onForeground: () => ({ remove: () => undefined }),
      onReading: () => undefined,
    });
    none.run();
    expect(none.state()).toBe('unavailable');

    const { phone, steps, settle } = fakePhone();
    phone.permission = 'granted';
    const stop = steps.run();
    await settle();
    expect(steps.state()).toBe('on');
    stop();
  });
});
