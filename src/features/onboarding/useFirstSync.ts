import { useEventListener } from 'expo';
import { useCallback, useEffect, useRef, useState } from 'react';

import { firstSyncStatus, type FirstSyncStatus } from '@/features/onboarding/firstSync';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type SyncSummary } from '@/wear';

export interface FirstSync {
  status: FirstSyncStatus;
  /** What the watch sent, once a sync finished after the guide asked for one; null before (or when it sent nothing). */
  summary: SyncSummary | null;
  /** Why it stopped, as it was when it stopped; null when it did not stop with an error, or the error had no text. */
  error: string | null;
  retry: () => void;
}

/** One ask of the guide: for which watch, and a number that changes with every ask (the first one and each retry). */
interface Request {
  address: string;
  id: number;
}

interface Ended {
  id: number;
  outcome: 'done' | 'failed';
  error: string | null;
}

/**
 * The guide's first history pull, in the background: the same `sync` the Today tab uses, asked once while `enabled` (the run has
 * reached pairing, `firstSyncStarts`) and the watch is connected. It lives on the guide screen, not on a step, so it keeps running
 * and keeps its result while the person moves through the steps.
 *
 * Everything is kept per ask, and an ask belongs to one watch address: a watch that is forgotten and paired again, or another watch,
 * gets an ask of its own instead of showing how the earlier one ended (device run 2026-10-25: a failure of the old pairing stayed on
 * the line after the new pairing synced).
 */
export function useFirstSync(enabled: boolean): FirstSync {
  const { device, linkState, sync, error } = useWatch();
  const address = device?.address ?? null;
  const [request, setRequest] = useState<Request | null>(null);
  const [settledId, setSettledId] = useState(0);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [summary, setSummary] = useState<{ address: string; summary: SyncSummary } | null>(null);
  const askedFor = useRef<string | null>(null);
  const syncRef = useRef(sync);

  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  useEventListener(HuaweiWear, 'onSyncComplete', (next) => {
    if (askedFor.current !== null) setSummary({ address: askedFor.current, summary: next });
  });

  // Ask once per watch, as soon as it is connected and known. Decided during render (the "adjust state when inputs change" pattern);
  // the effect below only performs the request.
  if (enabled && address !== null && linkState === 'connected' && (request === null || request.address !== address)) {
    setRequest({ address, id: (request?.id ?? 0) + 1 });
  }

  useEffect(() => {
    if (request === null) return;
    askedFor.current = request.address;
    const { id } = request;
    void syncRef.current().finally(() => setSettledId(id));
  }, [request]);

  const retry = useCallback(() => {
    if (address !== null) setRequest((last) => ({ address, id: (last?.id ?? 0) + 1 }));
  }, [address]);

  const started = request !== null && request.address === address;
  const pending = started && settledId !== request.id;
  const mine = started && ended !== null && ended.id === request.id ? ended : null;
  // Latch how it ended once the request returned and the link stopped syncing, so a later disconnect does not rewrite it. Set during
  // render, like the ask above, so the settled render is not followed by a second one.
  if (started && !pending && linkState !== 'syncing' && mine === null) {
    setEnded({ id: request.id, outcome: error ? 'failed' : 'done', error: error || null });
  }

  return {
    status: firstSyncStatus({ started, pending, linkState, error, outcome: mine?.outcome ?? null }),
    summary: summary !== null && summary.address === address ? summary.summary : null,
    error: mine !== null ? mine.error : error || null,
    retry,
  };
}
