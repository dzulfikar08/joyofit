import Storage from 'expo-sqlite/kv-store';

import { HuaweiWear, hasNative } from '@/wear';

const KEY = 'joyofit.agpsDefaultOn.v1';

export interface AgpsDefaultDeps {
  applied: () => boolean;
  markApplied: () => void;
  supported: () => boolean;
  setAgnss: (enabled: boolean) => Promise<void>;
  setPgnss: (enabled: boolean) => Promise<void>;
}

/**
 * Both satellite-data switches (HW_AGNSS and HW_PGNSS_PRED, docs/agps.md) are on by default since 2026-11-24 (owner
 * decision). The native stores still default to off, so this turns them on once per install, at launch; after that the
 * person's own choice in Settings stands. A failure leaves the mark unset, so the next launch tries again. Returns
 * whether the switches were turned on now.
 */
export async function applyAgpsDefaultOnce(deps: AgpsDefaultDeps = nativeDeps): Promise<boolean> {
  try {
    if (!deps.supported() || deps.applied()) return false;
    await deps.setAgnss(true);
    await deps.setPgnss(true);
    deps.markApplied();
    return true;
  } catch {
    return false;
  }
}

const nativeDeps: AgpsDefaultDeps = {
  applied: () => Storage.getItemSync(KEY) === '1',
  markApplied: () => Storage.setItemSync(KEY, '1'),
  // An OTA bundle on a binary without the switches does nothing (and tries again on a binary that has them).
  supported: () => hasNative('setAgpsLab') && hasNative('setAgpsPgnssLab'),
  setAgnss: (enabled) => HuaweiWear.setAgpsLab(enabled),
  setPgnss: (enabled) => HuaweiWear.setAgpsPgnssLab(enabled),
};
