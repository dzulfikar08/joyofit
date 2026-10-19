import { describe, expect, it } from 'bun:test';

import type { LogEvent } from '@/wear';

import { buildRecordingReport, scaleLogLines } from './report';

const ev = (message: string, hex: string | null = null, direction: LogEvent['direction'] = 'rx'): LogEvent => ({
  ts: Date.UTC(2026, 9, 19, 1, 2, 3), direction, serviceId: null, commandId: null, hex, message,
});

describe('recording report', () => {
  const events = [
    ev('cloud: synced'),
    ev('scale: adv AA name=ADV rssi=-60 services=[] serviceData={} manufacturer={20ca=0102}'),
    ev('scale: value AA ffe0/ffe1', 'cafe'),
    ev('HealthConnect: exported'),
  ];

  it('keeps only the scale lines, with hex', () => {
    const lines = scaleLogLines(events);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('scale: adv AA name=ADV');
    expect(lines[1]).toEndWith('scale: value AA ffe0/ffe1 cafe');
  });

  it('adds a header with the platform and the decoders that were installed', () => {
    const text = buildRecordingReport(events, { platform: 'android', osVersion: 34, appVersion: '1.2.3', now: Date.UTC(2026, 9, 19) }) ?? '';
    expect(text.split('\n').slice(0, 3)).toEqual(['JoyoFit scale recording', 'date: 2026-10-19T00:00:00.000Z', 'app: 1.2.3']);
    expect(text).toContain('platform: android 34');
    expect(text).toContain('okok-chipsea-broadcast');
  });

  it('is null when nothing was recorded', () => {
    expect(buildRecordingReport([ev('cloud: x')], { platform: 'ios', osVersion: '18', appVersion: null, now: 0 })).toBeNull();
  });
});
