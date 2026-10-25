import { describe, expect, test } from 'bun:test';

import type { AgpsStatus } from '@/wear';

import { AGPS_LAB_SOURCE, AGPS_PGNSS_SOURCE, agpsLabActive, agpsPgnssActive, agpsView, agpsVisible } from './agps';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const BLANK: AgpsStatus = {
  linked: true,
  phase: 'idle',
  cachedAt: 0,
  cachedSize: 0,
  cachedSource: '',
  deliveredAt: 0,
  deliveredSize: 0,
  deliveredSource: '',
  expiresAt: 0,
  lastAskAt: 0,
  lastAskVersion: -1,
  lastAskTags: '',
  outcome: 'none',
  error: '',
  attemptAt: 0,
  retryAt: 0,
  failures: 0,
};

describe('agpsView', () => {
  test('a watch that never took data shows "never" with no time and no size', () => {
    const view = agpsView(BLANK, NOW);
    expect(view.statusKey).toBe('never');
    expect(view.lastUpdatedMs).toBeNull();
    expect(view.sizeKb).toBeNull();
    expect(view.busy).toBe(false);
  });

  test('a delivery shows its time and size in whole KB and the good tone', () => {
    const view = agpsView(
      {
        ...BLANK,
        outcome: 'delivered',
        deliveredAt: NOW - HOUR,
        deliveredSize: 115_749,
        expiresAt: NOW + 100 * HOUR,
      },
      NOW,
    );
    expect(view.statusKey).toBe('delivered');
    expect(view.tone).toBe('ok');
    expect(view.lastUpdatedMs).toBe(NOW - HOUR);
    expect(view.sizeKb).toBe(113);
    expect(view.expired).toBe(false);
  });

  test('data past its validity reads as expired even though the last attempt was a delivery', () => {
    const view = agpsView(
      {
        ...BLANK,
        outcome: 'delivered',
        deliveredAt: NOW - 200 * HOUR,
        deliveredSize: 5000,
        expiresAt: NOW - HOUR,
      },
      NOW,
    );
    expect(view.expired).toBe(true);
    expect(view.statusKey).toBe('expired');
    expect(view.tone).toBe('danger');
  });

  test('a later failure is shown as the failure, not as expired', () => {
    const view = agpsView(
      {
        ...BLANK,
        outcome: 'download_failed',
        error: 'LTO: HTTP 503',
        deliveredAt: NOW - 200 * HOUR,
        deliveredSize: 5000,
        expiresAt: NOW - HOUR,
      },
      NOW,
    );
    expect(view.statusKey).toBe('downloadFailed');
    expect(view.detail).toBe('LTO: HTTP 503');
  });

  test('while something runs the phase wins and the button is busy', () => {
    const view = agpsView({ ...BLANK, phase: 'sending', outcome: 'download_failed', error: 'old' }, NOW);
    expect(view.busy).toBe(true);
    expect(view.statusKey).toBe('sending');
    expect(view.detail).toBeNull();
    expect(agpsView({ ...BLANK, phase: 'waiting' }, NOW).statusKey).toBe('waiting');
    expect(agpsView({ ...BLANK, phase: 'downloading' }, NOW).statusKey).toBe('downloading');
    expect(agpsView({ ...BLANK, phase: 'asking' }, NOW).statusKey).toBe('asking');
  });

  test('the size falls back to the copy on the phone', () => {
    expect(agpsView({ ...BLANK, outcome: 'stored', cachedSize: 2048 }, NOW).sizeKb).toBe(2);
    expect(agpsView({ ...BLANK, cachedSize: 100 }, NOW).sizeKb).toBe(1);
  });

  test('a retry wait is shown only while it lies ahead and nothing runs', () => {
    expect(agpsView({ ...BLANK, retryAt: NOW + 1000 }, NOW).retryAtMs).toBe(NOW + 1000);
    expect(agpsView({ ...BLANK, retryAt: NOW - 1 }, NOW).retryAtMs).toBeNull();
    expect(agpsView({ ...BLANK, retryAt: NOW + 1000, phase: 'asking' }, NOW).retryAtMs).toBeNull();
  });

  test('the row shows only for a watch whose last ask was the Broadcom kind (version 0)', () => {
    expect(agpsVisible({ ...BLANK }, NOW)).toBe(false);
    expect(agpsVisible({ ...BLANK, lastAskAt: NOW, lastAskVersion: -1 }, NOW)).toBe(false);
    expect(agpsVisible({ ...BLANK, lastAskAt: NOW, lastAskVersion: 0 }, NOW)).toBe(true);
    expect(agpsVisible({ ...BLANK, lastAskAt: 0, lastAskVersion: 0 }, NOW)).toBe(false);
    expect(agpsVisible({ ...BLANK, lastAskAt: NOW, lastAskVersion: 1 }, NOW)).toBe(false);
    expect(agpsVisible({ ...BLANK, lastAskAt: NOW, lastAskVersion: 3, outcome: 'unsupported' }, NOW)).toBe(false);
  });

  test('with the experimental switch on the row also shows for a watch whose last ask was exactly HW_AGNSS', () => {
    const asked = { ...BLANK, lastAskAt: NOW, lastAskVersion: 3, lastAskTags: 'HW_AGNSS' };
    expect(agpsVisible(asked, NOW)).toBe(false);
    expect(agpsVisible({ ...asked, labAgnss: false }, NOW)).toBe(false);
    expect(agpsVisible({ ...asked, labAgnss: true }, NOW)).toBe(true);
    expect(agpsLabActive({ ...asked, labAgnss: true })).toBe(true);
    expect(agpsVisible({ ...asked, labAgnss: true, lastAskTags: 'HW_PGNSS_PRED' }, NOW)).toBe(false);
    expect(agpsVisible({ ...asked, labAgnss: true, lastAskTags: 'HW_AGNSS,HW_PGNSS_GPS' }, NOW)).toBe(false);
    expect(agpsVisible({ ...asked, labAgnss: true, lastAskAt: 0 }, NOW)).toBe(false);
  });

  test('a valid lab delivery keeps the row when the watch then asks PRED and is declined (Fit 4 Pro, 2026-10-25)', () => {
    // The watch took the HW_AGNSS file, then asked HW_PGNSS_PRED two seconds later, which JoyoFit declines.
    const afterPred: AgpsStatus = {
      ...BLANK,
      labAgnss: true,
      deliveredAt: NOW - 2000,
      deliveredSize: 6666,
      deliveredSource: AGPS_LAB_SOURCE,
      expiresAt: NOW + 4 * HOUR,
      lastAskAt: NOW,
      lastAskVersion: 3,
      lastAskTags: 'HW_PGNSS_PRED',
      outcome: 'unsupported',
    };
    expect(agpsVisible(afterPred, NOW)).toBe(true);
    const view = agpsView(afterPred, NOW);
    expect(view.statusKey).toBe('deliveredLab');
    expect(view.tone).toBe('ok');
    // Gone once the file expired, once the switch is off, or for a file that did not come from the lab path.
    expect(agpsVisible({ ...afterPred, expiresAt: NOW - 1 }, NOW)).toBe(false);
    expect(agpsVisible({ ...afterPred, labAgnss: false }, NOW)).toBe(false);
    expect(agpsVisible({ ...afterPred, deliveredSource: 'broadcom_lto' }, NOW)).toBe(false);
    expect(agpsView({ ...afterPred, labAgnss: false }, NOW).statusKey).toBe('unsupported');
  });

  test('a delivery of the experimental file says so, and it expires in hours like the native expiry says', () => {
    const delivered = { ...BLANK, outcome: 'delivered' as const, deliveredAt: NOW - HOUR, deliveredSize: 7436, deliveredSource: AGPS_LAB_SOURCE };
    const view = agpsView({ ...delivered, expiresAt: NOW + 3 * HOUR }, NOW);
    expect(view.statusKey).toBe('deliveredLab');
    expect(view.tone).toBe('ok');
    expect(view.sizeKb).toBe(7);
    expect(agpsView({ ...delivered, expiresAt: NOW - 1 }, NOW).statusKey).toBe('expired');
  });

  test('with the PRED switch on the row shows for a watch whose last ask was exactly HW_PGNSS_PRED, and only with that switch', () => {
    const asked = { ...BLANK, lastAskAt: NOW, lastAskVersion: 3, lastAskTags: 'HW_PGNSS_PRED', outcome: 'unsupported' as const };
    expect(agpsVisible(asked, NOW)).toBe(false);
    expect(agpsVisible({ ...asked, labAgnss: true }, NOW)).toBe(false);
    expect(agpsVisible({ ...asked, labPgnss: false }, NOW)).toBe(false);
    expect(agpsVisible({ ...asked, labPgnss: true }, NOW)).toBe(true);
    expect(agpsPgnssActive({ ...asked, labPgnss: true })).toBe(true);
    expect(agpsLabActive({ ...asked, labPgnss: true })).toBe(false);
    expect(agpsVisible({ ...asked, labPgnss: true, lastAskTags: 'HW_AGNSS' }, NOW)).toBe(false);
    expect(agpsVisible({ ...asked, labPgnss: true, lastAskTags: 'HW_AGNSS,HW_PGNSS_PRED' }, NOW)).toBe(false);
    expect(agpsVisible({ ...asked, labPgnss: true, lastAskVersion: 0 }, NOW)).toBe(true);
    expect(agpsVisible({ ...asked, labPgnss: true, lastAskVersion: 4 }, NOW)).toBe(false);
    expect(agpsVisible({ ...asked, labPgnss: true, lastAskAt: 0 }, NOW)).toBe(false);
  });

  test('a delivery of the PRED files says so, expires after the three days they cover, and stays shown after a declined HW_AGNSS ask', () => {
    const delivered: AgpsStatus = {
      ...BLANK,
      labPgnss: true,
      outcome: 'delivered',
      deliveredAt: NOW - HOUR,
      deliveredSize: 799_112,
      deliveredSource: AGPS_PGNSS_SOURCE,
      expiresAt: NOW + 71 * HOUR,
      lastAskAt: NOW - HOUR,
      lastAskVersion: 3,
      lastAskTags: 'HW_PGNSS_PRED',
    };
    expect(agpsVisible(delivered, NOW)).toBe(true);
    const view = agpsView(delivered, NOW);
    expect(view.statusKey).toBe('deliveredPgnss');
    expect(view.tone).toBe('ok');
    expect(view.sizeKb).toBe(780);
    expect(agpsView({ ...delivered, expiresAt: NOW - 1 }, NOW).statusKey).toBe('expired');
    // The watch then asks HW_AGNSS with that switch off: declined, the PRED files are still what it holds.
    const afterAgnss: AgpsStatus = { ...delivered, lastAskAt: NOW, lastAskTags: 'HW_AGNSS', outcome: 'unsupported' };
    expect(agpsVisible(afterAgnss, NOW)).toBe(true);
    expect(agpsView(afterAgnss, NOW).statusKey).toBe('deliveredPgnss');
    expect(agpsVisible({ ...afterAgnss, labPgnss: false }, NOW)).toBe(false);
    expect(agpsVisible({ ...afterAgnss, expiresAt: NOW - 1 }, NOW)).toBe(false);
  });

  test('with both switches on, the HW_AGNSS delivery and the PRED ask after it both keep the row', () => {
    // Fit 4 Pro device run of 2026-10-25: HW_AGNSS first, PRED two seconds after its transfer closed.
    const afterAgnss: AgpsStatus = {
      ...BLANK,
      labAgnss: true,
      labPgnss: true,
      outcome: 'delivered',
      deliveredAt: NOW - 2000,
      deliveredSize: 6666,
      deliveredSource: AGPS_LAB_SOURCE,
      expiresAt: NOW + 4 * HOUR,
      lastAskAt: NOW - 2000,
      lastAskVersion: 3,
      lastAskTags: 'HW_AGNSS',
    };
    expect(agpsVisible(afterAgnss, NOW)).toBe(true);
    const predAsked: AgpsStatus = { ...afterAgnss, lastAskAt: NOW, lastAskTags: 'HW_PGNSS_PRED', phase: 'downloading' };
    expect(agpsVisible(predAsked, NOW)).toBe(true);
    expect(agpsView(predAsked, NOW).statusKey).toBe('downloading');
  });

  test('every native outcome has a status line', () => {
    const outcomes = [
      'none',
      'delivered',
      'stored',
      'watch_silent',
      'no_network',
      'download_failed',
      'invalid_file',
      'unsupported',
      'watch_refused',
      'timeout',
      'cancelled',
      'busy',
      'link_lost',
    ] as const;
    const keys = new Set(outcomes.map((outcome) => agpsView({ ...BLANK, outcome }, NOW).statusKey));
    expect(keys.size).toBe(outcomes.length);
  });

  test('an outcome from a newer native build falls back to the plain "never" line', () => {
    const view = agpsView({ ...BLANK, outcome: 'something_new' as never }, NOW);
    expect(view.statusKey).toBe('never');
  });
});
