import { isIos } from '@/components/IosUnavailable';

import { appleBilling } from './appleBilling';
import type { ProBilling } from './billingCore';
import { playBilling } from './playBilling';

/**
 * Where this build sells JoyoRogo Pro: StoreKit on iOS, Google Play Billing in the Play build. Both stores' implementations exist in
 * every bundle but only the running platform's native module is ever touched (`apple-iap` is null off iOS, `expo-iap` loads only in
 * the Play build). A sideloaded APK cannot be billed by Play, so it sells nothing here (`proOffer` sends it to the web page).
 */
export const billing: ProBilling = isIos ? appleBilling : playBilling;
