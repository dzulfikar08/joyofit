import * as Linking from 'expo-linking';
import { router } from 'expo-router';

import { openProUpgrade, PRO_PAYWALL_ROUTE, type ProUpgradeAction } from '@/features/pro/offer';

/** Carries out an upgrade button's action in the running app: the paywall on iOS, the JoyoRogo app, store or web page elsewhere. False when no link opened. */
export const openUpgrade = (action: ProUpgradeAction): Promise<boolean> =>
  openProUpgrade(action, { open: Linking.openURL, showPaywall: () => router.navigate(PRO_PAYWALL_ROUTE) });
