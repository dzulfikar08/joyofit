import { describe, expect, test } from 'bun:test';

import { cameraRemoteState, PENDING_OPEN_MS } from './state';

describe('cameraRemoteState', () => {
  test('an open from the background opens the camera once, and only while fresh', () => {
    cameraRemoteState.markPendingOpen(1_000);
    expect(cameraRemoteState.takePendingOpen(1_000 + PENDING_OPEN_MS)).toBe(true);
    expect(cameraRemoteState.takePendingOpen(1_000 + PENDING_OPEN_MS)).toBe(false);

    cameraRemoteState.markPendingOpen(1_000);
    expect(cameraRemoteState.takePendingOpen(1_001 + PENDING_OPEN_MS)).toBe(false);
  });

  test('the camera screen coming up drops a pending open', () => {
    cameraRemoteState.markPendingOpen(5_000);
    cameraRemoteState.setScreenMounted(true);
    expect(cameraRemoteState.screenMounted).toBe(true);
    expect(cameraRemoteState.takePendingOpen(5_001)).toBe(false);
    cameraRemoteState.setScreenMounted(false);
  });

  test('a queued shutter press is taken once', () => {
    cameraRemoteState.queueShutter();
    expect(cameraRemoteState.takePendingShutter()).toBe(true);
    expect(cameraRemoteState.takePendingShutter()).toBe(false);
  });
});
