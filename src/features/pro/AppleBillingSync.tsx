import { useEffect } from 'react';

import { authClient } from '@/cloud/auth';
import { isIos } from '@/components/IosUnavailable';
import { useCloud } from '@/state/CloudProvider';

import { replayPurchases } from './appleBilling';

/**
 * iOS: once per app start and signed-in account, hands JoyoRogo the purchases StoreKit still holds (an interrupted purchase, a
 * renewal made while the app was closed) and unlocks Pro screens if any was credited. Renders nothing.
 */
export function AppleBillingSync() {
  const { signedIn, refreshPro } = useCloud();
  const userId = authClient.useSession().data?.user.id;

  useEffect(() => {
    if (!isIos || !signedIn || !userId) return;
    void replayPurchases(userId).then((credited) => {
      if (credited) void refreshPro();
    });
  }, [signedIn, userId, refreshPro]);

  return null;
}
