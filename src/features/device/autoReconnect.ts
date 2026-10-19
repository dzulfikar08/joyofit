import { BIND_CONFIRMATION } from '@/features/device/connectFailure';
import type { BondedDevice, LinkState } from '@/wear';

/**
 * When JoyoFit reconnects the remembered watch by itself while the app is open and background mode is off (with it on, the native
 * service already owns the link and reconnects). The watch is connected by its stored address, with no scan: a watch that is linked to a
 * phone does not advertise, so a scan cannot be what the reconnect waits for. An automatic attempt never asks anything and never
 * changes the watch: a watch that needs a first bind stops it (`blocked`), and only a tap on Connect goes on from there.
 */
export interface AutoReconnectFacts {
  /** `getBackgroundStatus().address`: the watch connected to last; null when there is none. */
  address: string | null;
  linkState: LinkState;
  /** `getBackgroundStatus().enabled`: the background service keeps the link, so it also does the reconnecting. */
  backgroundEnabled: boolean;
  /** The person tapped Disconnect and has not connected since; kept across launches so closing the app does not take it back. */
  disconnectedByUser: boolean;
  /** A connect or a sync is running, or the first-bind question is open. */
  busy: boolean;
  /** Android 12+: BLUETOOTH_CONNECT is granted already. Never asked for here. */
  permitted: boolean;
  appActive: boolean;
  /** Automatic attempts that failed in a row since the app came forward, the link was last up or the person last connected. */
  failures: number;
  /** An attempt needs the person (a first bind, a refused permission): no more attempts until they connect themselves. */
  blocked: boolean;
  /** Android: Android's pairing leaves a connect harmless (`androidPairingAllowsAutoReconnect`); always true on iOS, which has none. */
  pairingAllows: boolean;
}

/** Waits before the next automatic attempt, by failures so far: the first soon after the app opens or the link drops, then further apart. */
const DELAYS_MS = [1_500, 30_000, 120_000] as const;

/** Milliseconds to wait before the next attempt, or null when the attempts are used up until the app comes forward again. */
export function autoReconnectDelayMs(failures: number): number | null {
  return DELAYS_MS[failures] ?? null;
}

export function shouldAutoReconnect(facts: AutoReconnectFacts): boolean {
  return (
    facts.address !== null &&
    facts.linkState === 'disconnected' &&
    !facts.backgroundEnabled &&
    !facts.disconnectedByUser &&
    !facts.busy &&
    facts.permitted &&
    facts.appActive &&
    !facts.blocked &&
    facts.pairingAllows &&
    autoReconnectDelayMs(facts.failures) !== null
  );
}

/** What an automatic attempt reports back. */
export type AutoOutcome = 'connected' | 'failed' | 'blocked';

/** The outcome for a rejected connect, by its error code: only the codes that need the person stop the attempts for good. */
export function outcomeOfFailure(code: string | null): AutoOutcome {
  return code === BIND_CONFIRMATION || code === 'ERR_BLUETOOTH_PERMISSION' || code === 'ERR_UNSUPPORTED' ? 'blocked' : 'failed';
}

/** `go`: attempt now. `wait`: everything allows it but a connect, a sync or the first-bind question is open, so look again soon. `stop`: no. */
export type AutoReconnectVerdict = 'go' | 'wait' | 'stop';

/** How long a `wait` lasts before the facts are read again. */
export const BUSY_RECHECK_MS = 5_000;

export function autoReconnectVerdict(facts: AutoReconnectFacts): AutoReconnectVerdict {
  if (!shouldAutoReconnect({ ...facts, busy: false })) return 'stop';
  return facts.busy ? 'wait' : 'go';
}

/**
 * Android: whether Android's own pairing leaves an automatic connect harmless. A connect to a Classic watch that Android has no pairing
 * with makes Android start one (a system dialog the watch has to accept), so only a tap on Connect may. The answer has to come from the
 * list itself: a watch the list does not carry, or a row without `paired` (a build from before the list said so, which also leaves an
 * unpaired remembered watch out), is not known to be safe, so an older build simply does not reconnect by itself. Paired is safe; so is a
 * band (`classic` false), which Android never pairs.
 */
export function androidPairingAllowsAutoReconnect(rows: BondedDevice[], address: string): boolean {
  const row = rows.find((d) => d.address.toUpperCase() === address.toUpperCase());
  if (row === undefined || row.paired === undefined) return false;
  return row.paired || row.classic === false;
}
