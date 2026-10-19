import type { PendingReport, SendResult } from '@/features/device/aturReport';

/** Reports waiting for a network. Each is the whole log (up to ~200 KB), so only the newest few are kept. */
export const MAX_QUEUED = 3;

export interface QueueStore {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
}

export type Submitted = { state: 'sent'; sequenceId: number } | { state: 'queued' };

/** Atur refused the report for good (bad token, too big, wrong shape): another try would get the same answer. */
export class ReportRefusedError extends Error {}

/**
 * Sends reports and keeps the ones that could not go out. A retryable failure (offline, rate limit, server trouble)
 * parks the report until `flush` runs again, which the app does at launch and whenever it comes to the foreground.
 * A report Atur refuses is thrown to the person on `submit` and dropped on `flush`; it would be refused again.
 */
export function createReportQueue(deps: { store: QueueStore; send: (report: PendingReport) => Promise<SendResult> }) {
  const load = async (): Promise<PendingReport[]> => {
    try {
      const parsed: unknown = JSON.parse((await deps.store.read()) ?? '[]');
      return Array.isArray(parsed) ? (parsed as PendingReport[]) : [];
    } catch {
      return [];
    }
  };
  const save = (reports: PendingReport[]) => deps.store.write(JSON.stringify(reports));
  // One writer at a time: the foreground flush and a send from the form must not overwrite each other's list.
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };

  return {
    pending: load,

    submit: (report: PendingReport): Promise<Submitted> =>
      exclusive(async () => {
        const result = await deps.send(report);
        if (result.ok) return { state: 'sent', sequenceId: result.sequenceId };
        if (!result.retryable) throw new ReportRefusedError(result.message);
        const kept = (await load()).filter((r) => r.id !== report.id);
        await save([...kept, report].slice(-MAX_QUEUED));
        return { state: 'queued' };
      }),

    /** Tries the parked reports oldest first and stops at the first retryable failure. Returns how many went out. */
    flush: (): Promise<number> =>
      exclusive(async () => {
        const queued = await load();
        if (queued.length === 0) return 0;
        let sent = 0;
        let rest = queued;
        for (const report of queued) {
          const result = await deps.send(report);
          if (!result.ok && result.retryable) break;
          rest = rest.filter((r) => r.id !== report.id);
          if (result.ok) sent += 1;
        }
        if (rest.length !== queued.length) await save(rest);
        return sent;
      }),
  };
}
