import { useEventListener } from 'expo';
import { useCallback, useEffect, useRef, useState } from 'react';

import { firstSyncStatus, type FirstSyncStatus } from '@/features/onboarding/firstSync';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type SyncSummary } from '@/wear';

export interface FirstSync {
  status: FirstSyncStatus;
  /** What the watch sent, once a sync finished after the guide asked for one; null before (or when it sent nothing). */
  summary: SyncSummary | null;
  error: string | null;
  retry: () => void;
}

/**
 * The guide's first history pull, in the background: the same `sync` the Today tab uses, asked once while `enabled` (the run has
 * reached pairing, `firstSyncStarts`) and the watch is connected. It lives on the guide screen, not on a step, so it keeps running
 * and keeps its result while the person moves through the steps.
 */
export function useFirstSync(enabled: boolean): FirstSync {
  const { device, linkState, sync, error } = useWatch();
  const [started, setStarted] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<'done' | 'failed' | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const asked = useRef(false);

  useEventListener(HuaweiWear, 'onSyncComplete', (next) => {
    if (asked.current) setSummary(next);
  });

  const run = useCallback(() => {
    asked.current = true;
    setStarted(true);
    setOutcome(null);
    setPending(true);
    void sync().finally(() => setPending(false));
  }, [sync]);

  // Wait for the device info too: a sync asked before `device` is set does nothing and would not be asked again.
  useEffect(() => {
    if (!enabled || asked.current || !device || linkState !== 'connected') return;
    run();
  }, [enabled, device, linkState, run]);

  // Latch how it ended once the request returned and the link stopped syncing, so a later disconnect does not rewrite it. Set during
  // render (React's "adjust state when inputs change" pattern), not in an effect, so the settled render is not followed by a second one.
  if (started && !pending && linkState !== 'syncing' && outcome === null) setOutcome(error ? 'failed' : 'done');

  return {
    status: firstSyncStatus({ started, pending, linkState, error, outcome }),
    summary,
    error,
    retry: run,
  };
}
