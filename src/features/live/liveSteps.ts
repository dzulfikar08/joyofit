/**
 * When the phone's step counter of a watch-started workout runs (`liveExtras.ts` wires it to `BleSensors.startLiveSteps` and the
 * permissions): only while a session on foot is open, only when the permission is already given, and asked for only on a tap. The native
 * module, the permissions and the foreground signal are passed in, so this runs under bun test without React Native.
 */
import type { StepsEvent, StepCounterPermission } from '@/ble';
import type { Granted } from '@/features/sensors/permissions';

/**
 * The phone's step counter for this session. `on`: counting. `ask`: not allowed yet (Android cannot tell "never asked" from "refused";
 * the screen offers to ask). `unavailable`: no step counter in this phone, or a binary without `startLiveSteps`. `off`: not a session on
 * foot, or none.
 */
export type LiveStepsState = 'off' | 'on' | 'ask' | 'unavailable';

export interface LiveStepsDeps {
  /** The native counter; null on a binary without `startLiveSteps`. */
  native: {
    start(): Promise<boolean>;
    stop(): Promise<void>;
    listen(listener: (e: StepsEvent) => void): { remove(): void };
  } | null;
  /** The permission without asking. */
  permission(): Promise<StepCounterPermission>;
  /** Asks for the permission (the system prompt, when the system still shows one). */
  ask(): Promise<Granted>;
  /** Calls `listener` each time the app comes back to the foreground. */
  onForeground(listener: () => void): { remove(): void };
  onReading(e: StepsEvent): void;
}

export interface LiveSteps {
  state(): LiveStepsState;
  subscribe(listener: () => void): () => void;
  /** Runs the counter until the returned stop. While it waits for the permission, every return to the foreground checks again. */
  run(): () => void;
  /**
   * The screen's button: asks, and starts counting when it was given. Returns the answer: after a refusal the system asks no more (iOS
   * answers `denied` at once, Android `blocked` after "don't ask again"), so the screen then offers the phone's settings.
   */
  allow(): Promise<Granted>;
}

export function createLiveSteps(deps: LiveStepsDeps): LiveSteps {
  let state: LiveStepsState = 'off';
  let subscription: { remove(): void } | null = null;
  /** Bumped by every start and stop: a start that finishes after a later stop undoes itself. */
  let generation = 0;
  const listeners = new Set<() => void>();

  const set = (next: LiveStepsState) => {
    if (next === state) return;
    state = next;
    for (const l of listeners) l();
  };

  /** Starts the counter when it is allowed; `ask` when it is not (nothing is asked here: the screen does, on a tap). */
  async function start(): Promise<void> {
    const mine = ++generation;
    const native = deps.native;
    if (native === null) return set('unavailable');
    const permission = await deps.permission().catch(() => 'unavailable' as const);
    if (mine !== generation) return;
    if (permission === 'unavailable') return set('unavailable');
    if (permission !== 'granted') return set('ask');
    subscription ??= native.listen(deps.onReading);
    const running = await native.start().catch(() => false);
    if (mine !== generation) {
      // Stopped while starting: the stop found the counter not yet running.
      if (running) void native.stop().catch(() => undefined);
      return;
    }
    set(running ? 'on' : 'unavailable');
  }

  function stop(): void {
    generation += 1;
    subscription?.remove();
    subscription = null;
    if (deps.native !== null && state === 'on') void deps.native.stop().catch(() => undefined);
    set('off');
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run() {
      void start();
      const foreground = deps.onForeground(() => {
        if (state === 'ask') void start();
      });
      return () => {
        foreground.remove();
        stop();
      };
    },
    async allow() {
      const answer = await deps.ask();
      if (answer === 'granted' && state === 'ask') await start();
      return answer;
    },
  };
}
