import { useEffect } from 'react';

import { authClient } from '@/cloud/auth';
import { useCloud } from '@/state/CloudProvider';

import { billing } from './billing';

/**
 * Once per app start and signed-in account, hands JoyoRogo the purchases the store still holds (StoreKit on iOS, Google Play Billing
 * in the Play build): an interrupted purchase, a renewal made while the app was closed, one made on another phone. Unlocks Pro screens
 * if any was credited. Renders nothing, and does nothing where this build has no store (a sideloaded APK).
 */
export function BillingSync() {
  const { signedIn, refreshPro } = useCloud();
  const userId = authClient.useSession().data?.user.id;

  useEffect(() => {
    if (!billing.supported || !signedIn || !userId) return;
    void billing.replayPurchases(userId).then((credited) => {
      if (credited) void refreshPro();
    });
  }, [signedIn, userId, refreshPro]);

  return null;
}
