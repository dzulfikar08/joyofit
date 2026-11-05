import { describe, expect, it } from 'bun:test';

import { hasAlarms, normalizeBackup, parseBackup, shouldOfferRestore } from './alarmBackupModel';

const morning = { slot: 2, enabled: true, hour: 6, minute: 30, repeat: 31, name: 'Pagi' };
const gym = { slot: 1, enabled: false, hour: 18, minute: 0, repeat: 0, name: 'Gym' };
const smartOn = { enabled: true, hour: 6, minute: 45, repeat: 127, aheadMinutes: 20 } as never;
const smartOff = { enabled: false, hour: 6, minute: 45, repeat: 127, aheadMinutes: 20 } as never;
const empty = { event: [], smart: null };

describe('alarm backup', () => {
  it('normalises to slot order and the fields the watch takes, dropping a smart alarm that is off', () => {
    const b = normalizeBackup({ event: [{ ...morning, extra: 1 } as never, gym], smart: smartOff });
    expect(b.event.map((a) => a.slot)).toEqual([1, 2]);
    expect(Object.keys(b.event[1]!)).toEqual(['slot', 'enabled', 'hour', 'minute', 'repeat', 'name']);
    expect(b.smart).toBeNull();
  });

  it('counts a watch with an alarm or a smart alarm that is on as having alarms', () => {
    expect(hasAlarms(empty)).toBe(false);
    expect(hasAlarms({ event: [], smart: smartOff })).toBe(false);
    expect(hasAlarms({ event: [], smart: smartOn })).toBe(true);
    expect(hasAlarms({ event: [morning], smart: null })).toBe(true);
  });

  it('offers Restore only when the watch is empty and the backup is not', () => {
    const backup = normalizeBackup({ event: [morning], smart: null });
    expect(shouldOfferRestore(empty, backup)).toBe(true);
    expect(shouldOfferRestore({ event: [gym], smart: null }, backup)).toBe(false);
    expect(shouldOfferRestore(empty, null)).toBe(false);
    expect(shouldOfferRestore(empty, normalizeBackup(empty))).toBe(false);
  });

  it('rejects a pulled document that is not a usable backup', () => {
    expect(parseBackup(null)).toBeNull();
    expect(parseBackup({ event: 'x' })).toBeNull();
    expect(parseBackup({ event: [{ ...morning, slot: 9 }] })).toBeNull();
    expect(parseBackup({ event: [{ ...morning, hour: 25 }] })).toBeNull();
    expect(parseBackup({ event: [morning, gym, morning, gym, morning, gym] })).toBeNull();
    expect(parseBackup({ event: [morning], smart: null })).toEqual({ event: [morning], smart: null });
  });
});
