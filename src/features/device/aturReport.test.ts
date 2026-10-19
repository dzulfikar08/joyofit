import { describe, expect, it } from 'bun:test';

import type { SupportReport } from '@/wear';

import { buildReport, itemBody, MESSAGE_MAX, sendReport, type ReportEnv, type SendDeps } from './aturReport';

const SUMMARY = [
  'JoyoFit support report',
  'Created: 2026-10-20 09:15:00 +0700',
  'App: com.joyodigitama.joyofit 1.0 (1471837)',
  'Phone: samsung SM-S918B, Android 15 (API 35)',
  'Watch: HUAWEI WATCH FIT 4 Pro-A1B',
  'Model: Watch Fit 4 Pro (tested)',
  'Product: ABC, software 5.0, hardware 1.0, auth 2',
  'Transport: BR/EDR',
  'Link: disconnected',
  'Disconnects: 3',
].join('\n');

const REPORT: SupportReport = {
  summary: SUMMARY,
  log: 'Log, oldest first (2 lines):\n09:14:59.001 connect\n09:15:00.002 LinkParams timeout',
  watch: 'HUAWEI WATCH FIT 4 Pro-A1B',
  model: 'Watch Fit 4 Pro',
  support: 'tested',
};

const ENV: ReportEnv = { appVersion: '1.0', build: '1.0+1471837+embedded', platform: 'android', os: '35', locale: 'id' };
const REPORTER = { email: 'ana@example.com', accountId: 'user-42', name: 'Ana' };
const NOW = Date.UTC(2026, 9, 20, 2, 15, 0);

const build = (message = 'Jam tidak mau tersambung', reporter = REPORTER, report = REPORT) =>
  buildReport(report, { id: 'r-1', now: NOW, message, reporter, env: ENV });

describe('buildReport', () => {
  it('titles the report by model and support level and keeps the whole text as the attachment', () => {
    const r = build();
    expect(r.title).toBe('[Watch report] Watch Fit 4 Pro (tested)');
    expect(r.text).toBe(`${SUMMARY}\n\n${REPORT.log}`);
    expect(r.filename).toBe('joyofit-report-2026-10-20T02-15-00-000Z.txt');
  });

  it('falls back to the Bluetooth name, then to an unknown watch, in the title', () => {
    expect(build('x', REPORTER, { ...REPORT, model: null }).title).toContain('HUAWEI WATCH FIT 4 Pro-A1B');
    expect(build('x', REPORTER, { ...REPORT, model: null, watch: null }).title).toContain('unknown watch');
  });

  it('lifts the device facts out of the summary into structured context', () => {
    const { context } = build();
    expect(context).toMatchObject({ app_version: '1.0', platform: 'android', os: '35' });
    expect(context.extra).toMatchObject({
      report_id: 'r-1',
      watch: 'HUAWEI WATCH FIT 4 Pro-A1B',
      model: 'Watch Fit 4 Pro',
      support: 'tested',
      app: 'com.joyodigitama.joyofit 1.0 (1471837)',
      phone: 'samsung SM-S918B, Android 15 (API 35)',
      transport: 'BR/EDR',
      link: 'disconnected',
      build: '1.0+1471837+embedded',
      locale: 'id',
      log_lines: '3',
    });
  });

  it('puts what the person wrote before the summary in the description', () => {
    const { description } = build('  Jam tidak mau tersambung  ');
    expect(description.startsWith('Jam tidak mau tersambung\n\nJoyoFit support report')).toBe(true);
  });

  it('keeps the description within Atur limits however long the message and summary are', () => {
    const long = build('x'.repeat(5000), REPORTER, { ...REPORT, summary: `${SUMMARY}\n${'cmd '.repeat(3000)}` });
    expect(long.description.length).toBeLessThanOrEqual(4000);
    expect(long.description).toContain('the attachment has the whole report');
    expect(long.description.startsWith('x'.repeat(MESSAGE_MAX - 1))).toBe(true);
    expect(long.description.slice(0, MESSAGE_MAX + 2)).not.toContain('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n\n\n');
  });

  it('keeps every context value within Atur limits', () => {
    const r = build('x', REPORTER, { ...REPORT, summary: `${SUMMARY}\nPhone: ${'p'.repeat(2000)}`, watch: 'w'.repeat(900) });
    for (const value of Object.values(r.context.extra)) expect(String(value).length).toBeLessThanOrEqual(500);
    expect(Object.keys(r.context.extra).length).toBeLessThanOrEqual(30);
    expect(r.title.length).toBeLessThanOrEqual(120);
  });
});

describe('itemBody', () => {
  it('files a native bug that claims the uploaded file and carries the reporter', () => {
    expect(itemBody(build(), 'att-1')).toMatchObject({
      kind: 'bug',
      source: 'native',
      email: 'ana@example.com',
      name: 'Ana',
      attachment_ids: ['att-1'],
      external_user: { id: 'user-42', email: 'ana@example.com', name: 'Ana' },
    });
  });

  it('leaves out the identity of someone who is not signed in or left the email empty', () => {
    const body = itemBody(build('x', { email: null, accountId: null, name: null }), 'att-1');
    expect(body.email).toBeUndefined();
    expect(body.external_user).toBeUndefined();
  });
});

interface Call {
  url: string;
  init: RequestInit;
}

function fakeAtur(answers: (Response | Error)[]) {
  const calls: Call[] = [];
  const removed: string[] = [];
  const deps: SendDeps = {
    baseUrl: 'https://atur.test',
    token: 'pk_fb_test',
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = answers.shift();
      if (!next) throw new Error('unexpected request');
      if (next instanceof Error) throw next;
      return next;
    }) as unknown as typeof fetch,
    writeTempFile: (name) => ({ uri: `file:///cache/${name}`, remove: () => void removed.push(name) }),
  };
  return { calls, removed, deps };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** React Native's FormData keeps a `{ uri, name, type }` part as it is; Bun's turns it into "[object Object]". */
class NativeFormData {
  readonly parts = new Map<string, unknown>();
  append(key: string, value: unknown) {
    this.parts.set(key, value);
  }
  get(key: string) {
    return this.parts.get(key);
  }
}

async function withNativeFormData<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.FormData;
  globalThis.FormData = NativeFormData as unknown as typeof FormData;
  try {
    return await run();
  } finally {
    globalThis.FormData = original;
  }
}

describe('sendReport', () => {
  it('uploads the report as a text file, then files the item that claims it', async () => {
    const { calls, removed, deps } = fakeAtur([json({ id: 'att-9' }, 201), json({ id: 'i', sequence_id: 17 }, 201)]);
    const result = await withNativeFormData(() => sendReport(build(), deps));

    expect(result).toEqual({ ok: true, sequenceId: 17 });
    expect(calls.map((c) => c.url)).toEqual([
      'https://atur.test/api/feedback/pk_fb_test/attachments',
      'https://atur.test/api/feedback/pk_fb_test/items',
    ]);
    const part = (calls[0].init.body as FormData).get('file') as unknown as { uri: string; name: string; type: string };
    expect(part).toEqual({ uri: expect.stringContaining('file:///cache/joyofit-report-'), name: expect.stringMatching(/\.txt$/), type: 'text/plain' });
    expect(JSON.parse(calls[1].init.body as string).attachment_ids).toEqual(['att-9']);
    expect(removed).toHaveLength(1);
  });

  it('calls a lost connection retryable and still removes the temp file', async () => {
    const { removed, deps } = fakeAtur([new TypeError('Network request failed')]);
    expect(await sendReport(build(), deps)).toEqual({ ok: false, retryable: true, message: 'Network request failed' });
    expect(removed).toHaveLength(1);
  });

  it('retries rate limits and server errors, also when the item (not the upload) fails', async () => {
    for (const status of [408, 429, 500, 503]) {
      const { deps } = fakeAtur([json({ id: 'att' }, 201), json({ message: 'busy' }, status)]);
      expect(await sendReport(build(), deps)).toEqual({ ok: false, retryable: true, message: 'busy' });
    }
  });

  it('gives up on answers that will not change: revoked board, bad shape, wrong type', async () => {
    for (const status of [400, 403, 404, 413, 415]) {
      const { deps } = fakeAtur([json({ message: 'Board not found' }, status)]);
      expect(await sendReport(build(), deps)).toEqual({ ok: false, retryable: false, message: 'Board not found' });
    }
  });

  it('names the status when the answer is not JSON', async () => {
    const { deps } = fakeAtur([new Response('<html>', { status: 502 })]);
    expect(await sendReport(build(), deps)).toEqual({ ok: false, retryable: true, message: 'Atur answered 502' });
  });
});
