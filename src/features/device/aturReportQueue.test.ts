import { describe, expect, it } from 'bun:test';

import type { PendingReport, SendResult } from './aturReport';
import { createReportQueue, MAX_QUEUED, ReportRefusedError } from './aturReportQueue';

const report = (id: string): PendingReport => ({
  id,
  createdAt: 0,
  title: id,
  description: '',
  reporter: { email: null, accountId: null, name: null },
  context: { platform: 'android', os: '35', user_agent: 'JoyoFit', extra: {} },
  filename: `${id}.txt`,
  text: id,
});

const OFFLINE: SendResult = { ok: false, retryable: true, message: 'offline' };
const REFUSED: SendResult = { ok: false, retryable: false, message: 'Unknown board' };
const sent = (n: number): SendResult => ({ ok: true, sequenceId: n });

function setup(answers: (id: string) => SendResult) {
  let stored: string | null = null;
  const attempts: string[] = [];
  const queue = createReportQueue({
    store: { read: async () => stored, write: async (v) => void (stored = v) },
    send: async (r) => {
      attempts.push(r.id);
      return answers(r.id);
    },
  });
  const ids = async () => (await queue.pending()).map((r) => r.id);
  return { queue, attempts, ids };
}

describe('submit', () => {
  it('reports a sent report without storing it', async () => {
    const { queue, ids } = setup(() => sent(5));
    expect(await queue.submit(report('a'))).toEqual({ state: 'sent', sequenceId: 5 });
    expect(await ids()).toEqual([]);
  });

  it('parks a report that could not go out and says so', async () => {
    const { queue, ids } = setup(() => OFFLINE);
    expect(await queue.submit(report('a'))).toEqual({ state: 'queued' });
    expect(await ids()).toEqual(['a']);
  });

  it('throws what Atur refused and keeps nothing', async () => {
    const { queue, ids } = setup(() => REFUSED);
    await expect(queue.submit(report('a'))).rejects.toThrow(ReportRefusedError);
    await expect(queue.submit(report('a'))).rejects.toThrow('Unknown board');
    expect(await ids()).toEqual([]);
  });

  it('keeps only the newest few and never the same report twice', async () => {
    const { queue, ids } = setup(() => OFFLINE);
    for (const id of ['a', 'b', 'c', 'd']) await queue.submit(report(id));
    await queue.submit(report('d'));
    expect(await ids()).toEqual(['b', 'c', 'd']);
    expect((await ids()).length).toBe(MAX_QUEUED);
  });
});

describe('flush', () => {
  it('sends parked reports oldest first and empties the queue', async () => {
    let online = false;
    const { queue, attempts, ids } = setup(() => (online ? sent(1) : OFFLINE));
    await queue.submit(report('a'));
    await queue.submit(report('b'));
    online = true;
    attempts.length = 0;

    expect(await queue.flush()).toBe(2);
    expect(attempts).toEqual(['a', 'b']);
    expect(await ids()).toEqual([]);
  });

  it('stops at the first retryable failure and keeps the rest in order', async () => {
    let phase: 'offline' | 'flaky' = 'offline';
    const { queue, attempts, ids } = setup((id) => (phase === 'offline' || id !== 'a' ? OFFLINE : sent(1)));
    for (const id of ['a', 'b', 'c']) await queue.submit(report(id));
    phase = 'flaky';
    attempts.length = 0;

    expect(await queue.flush()).toBe(1);
    expect(attempts).toEqual(['a', 'b']);
    expect(await ids()).toEqual(['b', 'c']);
  });

  it('drops a report Atur now refuses instead of retrying it for ever, and goes on with the next', async () => {
    let phase: 'offline' | 'online' = 'offline';
    const { queue, ids } = setup((id) => (phase === 'offline' ? OFFLINE : id === 'a' ? REFUSED : sent(3)));
    await queue.submit(report('a'));
    await queue.submit(report('b'));
    phase = 'online';
    expect(await queue.flush()).toBe(1);
    expect(await ids()).toEqual([]);
  });

  it('does nothing without parked reports', async () => {
    const { queue, attempts } = setup(() => sent(1));
    expect(await queue.flush()).toBe(0);
    expect(attempts).toEqual([]);
  });

  it('survives a damaged store', async () => {
    const queue = createReportQueue({
      store: { read: async () => '{not json', write: async () => {} },
      send: async () => sent(1),
    });
    expect(await queue.pending()).toEqual([]);
    expect(await queue.flush()).toBe(0);
  });

  it('serialises a flush and a submit so neither overwrites the other\'s list', async () => {
    let online = false;
    const { queue, ids } = setup(() => (online ? sent(1) : OFFLINE));
    await queue.submit(report('a'));
    online = true;
    const [flushed, submitted] = await Promise.all([queue.flush(), queue.submit(report('b'))]);
    expect(flushed).toBe(1);
    expect(submitted).toEqual({ state: 'sent', sequenceId: 1 });
    expect(await ids()).toEqual([]);
  });
});
