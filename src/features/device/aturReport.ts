import type { SupportReport } from '@/wear';

/** Atur's limits for one item (`createItemSchema`, `contextSchema` in the Atur worker). */
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 4000;
const EXTRA_VALUE_MAX = 500;
/** What the person typed leaves room for the summary in the description. */
export const MESSAGE_MAX = 1500;

export interface ReportEnv {
  /** `expo.version`, e.g. "1.0". */
  appVersion: string | null;
  /** Version, native build and OTA update id (`APP_BUILD`). */
  build: string;
  platform: string;
  /** The OS version alone ("35", "18.1"): Atur shows it after the platform. */
  os: string;
  locale: string;
}

export interface Reporter {
  /** Where the maintainers can write back; null when the person left it empty. */
  email: string | null;
  /** The JoyoRogo account the phone is signed in to, if any. */
  accountId: string | null;
  name: string | null;
}

/** One report, ready to send and small enough to wait in the queue: nothing in it needs the watch or the network. */
export interface PendingReport {
  /** Local id, also in the report as `report_id` so a retry that arrives twice is recognisable. */
  id: string;
  createdAt: number;
  title: string;
  description: string;
  reporter: Reporter;
  context: {
    app_version?: string;
    platform: string;
    os: string;
    user_agent: string;
    extra: Record<string, string | number | boolean>;
  };
  /** The attachment: the summary and the whole log. */
  filename: string;
  text: string;
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** The value after `Key: ` on the summary's line of that name. */
function summaryField(summary: string, key: string): string | null {
  for (const line of summary.split('\n')) {
    if (line.startsWith(`${key}: `)) return line.slice(key.length + 2).trim() || null;
  }
  return null;
}

/** The text the person wrote, then the summary; the whole report travels as the attachment, so a cut here loses nothing. */
function describe(message: string, summary: string): string {
  const head = message.trim() ? `${clip(message.trim(), MESSAGE_MAX)}\n\n` : '';
  const room = DESCRIPTION_MAX - head.length;
  if (summary.length <= room) return head + summary;
  const note = '\n(summary cut here; the attachment has the whole report)'; // i18n-ok: written for the maintainers
  return head + summary.slice(0, room - note.length) + note;
}

export function buildReport(
  report: SupportReport,
  input: { id: string; now: number; message: string; reporter: Reporter; env: ReportEnv },
): PendingReport {
  const { env } = input;
  const what = report.model ?? report.watch ?? 'unknown watch';
  const fields: Record<string, string | null> = {
    report_id: input.id,
    watch: report.watch,
    model: report.model,
    support: report.support,
    app: summaryField(report.summary, 'App'),
    build: env.build,
    phone: summaryField(report.summary, 'Phone'),
    product: summaryField(report.summary, 'Product'),
    transport: summaryField(report.summary, 'Transport'),
    link: summaryField(report.summary, 'Link'),
    created: summaryField(report.summary, 'Created'),
    locale: env.locale,
    log_lines: String(report.log.split('\n').length),
  };
  const extra: PendingReport['context']['extra'] = {};
  for (const [key, value] of Object.entries(fields)) if (value) extra[key] = clip(value, EXTRA_VALUE_MAX);
  const stamp = new Date(input.now).toISOString().replace(/[:.]/g, '-');
  return {
    id: input.id,
    createdAt: input.now,
    title: clip(`[Watch report] ${what} (${report.support})`, TITLE_MAX),
    description: describe(input.message, report.summary),
    reporter: input.reporter,
    context: {
      app_version: env.appVersion ?? undefined,
      platform: env.platform,
      os: env.os,
      user_agent: clip(`JoyoFit ${env.build} (${env.platform} ${env.os})`, 500),
      extra,
    },
    filename: `joyofit-report-${stamp}.txt`,
    text: `${report.summary}\n\n${report.log}`,
  };
}

/** The body of `POST /api/feedback/:token/items`. Atur marks it unverified: no signature, so the email is only a way to write back. */
export function itemBody(report: PendingReport, attachmentId: string) {
  const { email, accountId, name } = report.reporter;
  return {
    title: report.title,
    description: report.description,
    kind: 'bug',
    source: 'native',
    email: email ?? undefined,
    name: name ?? undefined,
    context: report.context,
    attachment_ids: [attachmentId],
    // The same email on both: Atur prefers the one in `external_user`.
    external_user: accountId ? { id: accountId, email: email ?? undefined, name: name ?? undefined } : undefined,
  };
}

export interface SendDeps {
  fetch: typeof fetch;
  baseUrl: string;
  token: string;
  /** A file the multipart upload can stream from (React Native's FormData takes a uri, not text). */
  writeTempFile: (name: string, text: string) => { uri: string; remove: () => void };
}

export type SendResult =
  | { ok: true; sequenceId: number }
  | { ok: false; /** Worth another try later: no network, rate limit, server trouble. */ retryable: boolean; message: string };

const RETRYABLE = new Set([408, 425, 429]);

async function failure(res: Response): Promise<SendResult> {
  let message = `Atur answered ${res.status}`;
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // Not JSON: the status says enough.
  }
  return { ok: false, retryable: RETRYABLE.has(res.status) || res.status >= 500, message };
}

/** Uploads the report file, then files the item that claims it. Never throws: the outcome says whether to queue or give up. */
export async function sendReport(report: PendingReport, deps: SendDeps): Promise<SendResult> {
  const base = `${deps.baseUrl}/api/feedback/${encodeURIComponent(deps.token)}`;
  const file = deps.writeTempFile(report.filename, report.text);
  try {
    const form = new FormData();
    form.append('file', { uri: file.uri, name: report.filename, type: 'text/plain' } as unknown as Blob);
    const upload = await deps.fetch(`${base}/attachments`, { method: 'POST', body: form });
    if (!upload.ok) return await failure(upload);
    const { id } = (await upload.json()) as { id: string };

    const created = await deps.fetch(`${base}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(itemBody(report, id)),
    });
    if (!created.ok) return await failure(created);
    const { sequence_id } = (await created.json()) as { sequence_id: number };
    return { ok: true, sequenceId: sequence_id };
  } catch (e) {
    return { ok: false, retryable: true, message: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      file.remove();
    } catch {
      // The cache is cleared by the system anyway.
    }
  }
}
