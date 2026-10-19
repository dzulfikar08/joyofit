import { formatLogLine } from '@/features/log/formatLog';
import type { LogEvent } from '@/wear';

import { PROTOCOLS } from './registry';
import { RECORD_PREFIX } from './recorder';

export interface ReportMeta {
  platform: string;
  osVersion: string | number;
  appVersion: string | null;
  now: number;
}

/** The scale lines of the app log, oldest first, one per line. */
export function scaleLogLines(events: readonly LogEvent[]): string[] {
  return events.filter((e) => e.message.startsWith(RECORD_PREFIX)).map(formatLogLine);
}

/** The text a person sends for support: a short header, then every recorded scale line. Null when nothing was recorded. */
export function buildRecordingReport(events: readonly LogEvent[], meta: ReportMeta): string | null {
  const lines = scaleLogLines(events);
  if (lines.length === 0) return null;
  return [
    'JoyoFit scale recording',
    `date: ${new Date(meta.now).toISOString()}`,
    `app: ${meta.appVersion ?? 'unknown'}`,
    `platform: ${meta.platform} ${meta.osVersion}`,
    `decoders: ${PROTOCOLS.map((p) => p.id).join(' ')}`,
    '',
    ...lines,
  ].join('\n');
}
