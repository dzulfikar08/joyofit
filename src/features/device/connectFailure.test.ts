import { describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';

import { BIND_CONFIRMATION, NOT_PAIRED, describeConnectFailure, isSilentWatch, silentWatchSteps, watchBusyHint } from './connectFailure';

function coded(code: string, message = 'native detail'): Error {
  return Object.assign(new Error(message), { code });
}

describe('describeConnectFailure', () => {
  it('turns the bind stop into a question, not an error', () => {
    expect(describeConnectFailure(coded(BIND_CONFIRMATION))).toEqual({ kind: 'bind' });
  });

  it('explains every way a busy or unreachable watch fails with the same hint', () => {
    for (const code of ['ERR_CONNECT_FAILED', 'ERR_TIMEOUT', 'ERR_DISCONNECTED', 'ERR_AUTH_FAILED']) {
      expect(describeConnectFailure(coded(code))).toEqual({ kind: 'unreachable', message: watchBusyHint() });
    }
  });

  it('says Android has lost its pairing instead of blaming another phone, in the active language', async () => {
    const id = describeConnectFailure(coded(NOT_PAIRED));
    expect(id.kind).toBe('unpaired');
    await applyLocale('en');
    try {
      const en = describeConnectFailure(coded(NOT_PAIRED));
      expect(en).toEqual({ kind: 'unpaired', message: expect.stringContaining('Android has no Bluetooth pairing with this watch') });
      expect(en).not.toEqual(id);
    } finally {
      await applyLocale('id');
    }
  });

  it('keeps the plain message for Bluetooth and support errors', () => {
    expect(describeConnectFailure(coded('ERR_BLUETOOTH_OFF', 'Bluetooth is turned off'))).toEqual({
      kind: 'other',
      message: 'Bluetooth is turned off',
    });
    expect(describeConnectFailure(new Error('boom'))).toEqual({ kind: 'other', message: 'boom' });
    expect(describeConnectFailure('plain')).toEqual({ kind: 'other', message: 'plain' });
  });

  it('words the hint in the active language', async () => {
    const id = watchBusyHint();
    await applyLocale('en');
    try {
      const en = watchBusyHint();
      expect(en).toContain('Could not connect to the watch');
      expect(en).not.toBe(id);
      expect(describeConnectFailure(coded('ERR_TIMEOUT'))).toEqual({ kind: 'unreachable', message: en });
    } finally {
      await applyLocale('id');
    }
  });
});

const SILENT_OLD = 'Authentication timed out: LinkParams: no response (service 0x01, command 0x01) within 10000 ms';
const SILENT_NEW = 'Authentication timed out: LinkParams: no response (service 0x01, command 0x01) within 8000 ms (3 attempts)';

describe('a watch that connects and says nothing', () => {
  it('is recognised from the LinkParams timeout of either build', () => {
    expect(isSilentWatch(coded('ERR_TIMEOUT', SILENT_OLD))).toBe(true);
    expect(isSilentWatch(coded('ERR_TIMEOUT', SILENT_NEW))).toBe(true);
    expect(describeConnectFailure(coded('ERR_TIMEOUT', SILENT_NEW))).toEqual({
      kind: 'silent',
      message: expect.stringContaining('tidak menjawab'),
    });
  });

  it('leaves every other timeout and failure to the general hint', () => {
    expect(isSilentWatch(coded('ERR_TIMEOUT', 'Authentication timed out: PinCode: no response (service 0x01, command 0x2c) within 120000 ms'))).toBe(false);
    expect(isSilentWatch(coded('ERR_TIMEOUT', 'GATT connect: no answer from the watch within 8000 ms'))).toBe(false);
    expect(isSilentWatch(coded('ERR_DISCONNECTED', SILENT_OLD))).toBe(false);
    expect(isSilentWatch(new Error(SILENT_OLD))).toBe(false);
    expect(describeConnectFailure(coded('ERR_TIMEOUT', 'Timed out after 36000 ms connecting to X over Bluetooth LE'))).toEqual({
      kind: 'unreachable',
      message: watchBusyHint(),
    });
  });

  it('lists the checks in order, with the iPhone Bluetooth settings step only on iOS', () => {
    const ios = silentWatchSteps('ios');
    const android = silentWatchSteps('android');
    expect(ios).toHaveLength(4);
    expect(android).toHaveLength(3);
    expect(ios[0]).toContain('Huawei Health');
    expect(ios[1]).toContain('Pengaturan > Bluetooth');
    expect(ios[2]).toContain('Restart jam');
    expect(android.some((step) => step.includes('Pengaturan > Bluetooth'))).toBe(false);
    expect(android[0]).toBe(ios[0]);
  });

  it('words the checks and the message in English too', async () => {
    await applyLocale('en');
    try {
      expect(silentWatchSteps('ios')[1]).toContain('Forget This Device');
      expect(describeConnectFailure(coded('ERR_TIMEOUT', SILENT_OLD))).toEqual({
        kind: 'silent',
        message: expect.stringContaining('does not answer'),
      });
    } finally {
      await applyLocale('id');
    }
  });
});
