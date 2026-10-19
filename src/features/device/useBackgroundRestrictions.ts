import { useCallback, useState } from 'react';

import { isIos } from '@/components/IosUnavailable';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { HuaweiWear, hasNative, type BackgroundRestrictions } from '@/wear';

function read(): BackgroundRestrictions | null {
  // iOS has no such limit, and a binary built before the function existed cannot answer: both count as nothing to fix.
  if (isIos || !hasNative('getBackgroundRestrictions')) return null;
  return HuaweiWear.getBackgroundRestrictions();
}

/** Whether Android may stop the background service, read again on focus and when the app returns from Android's settings screens. */
export function useBackgroundRestrictions(): BackgroundRestrictions | null {
  const [restrictions, setRestrictions] = useState(read);
  const refresh = useCallback(() => setRestrictions(read()), []);
  useNativeRefresh(refresh);
  return restrictions;
}

/** Opens the system screens of the battery help; `failed` is set when none opened, so the person is told what to open by hand. */
export function useBatteryScreens() {
  const [failed, setFailed] = useState(false);
  const open = (action: () => Promise<void>) => {
    setFailed(false);
    action().catch(() => setFailed(true));
  };
  return {
    failed,
    openBattery: () => open(() => HuaweiWear.openBatteryExemption()),
    openAutoStart: () => open(() => HuaweiWear.openAutoStartSettings()),
  };
}
