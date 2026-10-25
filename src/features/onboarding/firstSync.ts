/**
 * The first history pull of the setup guide is no step of its own: it starts once the watch is linked and runs while the person goes on
 * (see `firstSyncStarts` in `flow.ts`), and the steps show one line about it. This is what that line says.
 *
 * `hidden`: nothing started yet (no link, or the run has not reached pairing). `running`: the pull asked by the guide is out, or the
 * link is syncing. `done`: finished; the counts come with the summary when the watch sent one. `failed`: it stopped with an error,
 * and the line offers a retry.
 */
export type FirstSyncStatus = 'hidden' | 'running' | 'done' | 'failed';

export interface FirstSyncFacts {
  /** The guide asked for the pull. */
  started: boolean;
  /** That request has not returned yet. */
  pending: boolean;
  linkState: string;
  /** The watch's error, from `useWatch().error`; a sync clears it when it starts. */
  error: string | null;
  /**
   * How the pull ended, kept once known, so a later disconnect (which sets an error of its own) does not turn a finished sync into a
   * failed one. Null until then, and again after a retry.
   */
  outcome: 'done' | 'failed' | null;
}

export function firstSyncStatus({ started, pending, linkState, error, outcome }: FirstSyncFacts): FirstSyncStatus {
  if (!started) return 'hidden';
  if (pending || linkState === 'syncing') return 'running';
  return outcome ?? (error ? 'failed' : 'done');
}
