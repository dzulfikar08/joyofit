import { describe, expect, test } from 'bun:test';

import type { BackgroundRestrictions } from '@/wear';

import { batteryHelpKind, parseDismissed, VENDOR_NAMES, visibleBatteryHelp } from './batteryLimits';

function phone(over: Partial<BackgroundRestrictions> = {}): BackgroundRestrictions {
  return {
    ignoringBatteryOptimizations: false,
    backgroundRestricted: false,
    manufacturer: 'INFINIX',
    autoStartVendor: 'transsion',
    canRequestDirectly: true,
    ...over,
  };
}

describe('battery help', () => {
  test('a phone that may stop the app asks for the exemption', () => {
    expect(batteryHelpKind(phone())).toBe('optimized');
  });

  test('a restricted app needs its own settings screen, whether or not it is exempt', () => {
    expect(batteryHelpKind(phone({ backgroundRestricted: true }))).toBe('restricted');
    expect(batteryHelpKind(phone({ backgroundRestricted: true, ignoringBatteryOptimizations: true }))).toBe('restricted');
  });

  test('an exempt, unrestricted app and iOS (no answer) need nothing', () => {
    expect(batteryHelpKind(phone({ ignoringBatteryOptimizations: true }))).toBeNull();
    expect(batteryHelpKind(null)).toBeNull();
  });

  test('closing the notice hides that situation only', () => {
    expect(visibleBatteryHelp(phone(), null)).toBe('optimized');
    expect(visibleBatteryHelp(phone(), 'optimized')).toBeNull();
    // The person closed the ordinary notice, then the app became restricted: that is news.
    expect(visibleBatteryHelp(phone({ backgroundRestricted: true }), 'optimized')).toBe('restricted');
    expect(visibleBatteryHelp(phone({ backgroundRestricted: true }), 'restricted')).toBeNull();
  });

  test('a fixed phone shows nothing whatever was dismissed', () => {
    expect(visibleBatteryHelp(phone({ ignoringBatteryOptimizations: true }), null)).toBeNull();
    expect(visibleBatteryHelp(null, null)).toBeNull();
  });

  test('a stored value that is not one of the two kinds is never dismissed', () => {
    expect(parseDismissed('optimized')).toBe('optimized');
    expect(parseDismissed('restricted')).toBe('restricted');
    expect(parseDismissed('1')).toBeNull();
    expect(parseDismissed(null)).toBeNull();
  });

  test('every maker group with an auto-start screen has a name', () => {
    expect(VENDOR_NAMES.transsion).toContain('Infinix');
    expect(VENDOR_NAMES.xiaomi).toContain('Xiaomi');
    expect(VENDOR_NAMES.oppo).toContain('realme');
    expect(VENDOR_NAMES.vivo).toContain('vivo');
  });
});
