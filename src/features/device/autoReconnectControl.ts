import {
  autoReconnectDelayMs,
  autoReconnectVerdict,
  BUSY_RECHECK_MS,
  type AutoOutcome,
  type AutoReconnectFacts,
} from '@/features/device/autoReconnect';

/** The facts that live outside the control (the native module, storage, the OS), read each time an attempt is due. */
export type ObservedFacts = Omit<AutoReconnectFacts, 'busy' | 'failures' | 'blocked'>;

/** What the control needs from the component that owns the connect. */
export interface AutoReconnectEnv {
  observe: () => Promise<ObservedFacts>;
  /** A connect, a sync or the first-bind question is open. */
  isBusy: () => boolean;
  /** One connect to `address` that asks nothing and shows no error. */
  attempt: (address: string) => Promise<AutoOutcome>;
}

/** What the provider and the hook drive. */
export interface AutoReconnectControl {
  /** Hands over what the attempts need from the component. Called after every render. */
  bind: (env: AutoReconnectEnv) => void;
  schedule: () => void;
  cancel: () => void;
  /** The app came forward (or started): a fresh budget. */
  foreground: () => void;
  /** The link is up: the next drop starts from the first, soonest attempt. */
  linked: () => void;
  /** The person starts a connect themselves: whatever blocked the attempts is theirs to have settled. */
  reset: () => void;
  /**
   * The person's own connect failed and showed its error: no automatic retry behind it (it would replace the error they are reading with
   * another connecting state) until the app comes forward again or the link has been up.
   */
  settle: () => void;
}

type TimeoutHandle = ReturnType<typeof setTimeout>;

/**
 * The timer behind the rules of `autoReconnect.ts`: one attempt waiting or running at a time, further apart after each failure, a fresh
 * budget whenever the app comes forward or the link was up. When only a connect, a sync or the first-bind question stands in the way it
 * looks again every `BUSY_RECHECK_MS`, since nothing else would wake it when that ends. A plain closure so the component can hold one for
 * its whole life.
 */
export function createAutoReconnect(): AutoReconnectControl {
  let env: AutoReconnectEnv | undefined;
  let failures = 0;
  let blocked = false;
  let inFlight = false;
  let timer: TimeoutHandle | undefined;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const arm = (delay: number) => {
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, delay);
  };

  const schedule = () => {
    if (timer !== undefined || inFlight || blocked) return;
    const delay = autoReconnectDelayMs(failures);
    if (delay !== null) arm(delay);
  };

  const run = async () => {
    if (inFlight || env === undefined) return;
    inFlight = true;
    let outcome: AutoOutcome = 'failed';
    try {
      const observed = await env.observe().catch((): ObservedFacts | null => null);
      if (observed === null) return;
      const verdict = autoReconnectVerdict({ ...observed, busy: env.isBusy(), failures, blocked });
      if (verdict === 'wait' && timer === undefined) arm(BUSY_RECHECK_MS);
      if (verdict !== 'go' || observed.address === null) return;
      outcome = await env.attempt(observed.address).catch((): AutoOutcome => 'failed');
    } finally {
      inFlight = false;
    }
    if (outcome === 'connected') {
      failures = 0;
      return;
    }
    if (outcome === 'blocked') blocked = true;
    else failures += 1;
    schedule();
  };

  return {
    bind: (next) => {
      env = next;
    },
    schedule,
    cancel,
    foreground: () => {
      failures = 0;
      schedule();
    },
    linked: () => {
      failures = 0;
    },
    reset: () => {
      failures = 0;
      blocked = false;
    },
    settle: () => {
      failures = Number.POSITIVE_INFINITY;
    },
  };
}
