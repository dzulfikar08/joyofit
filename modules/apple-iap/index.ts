import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type AppleIapProduct = {
  id: string;
  displayName: string;
  displayPrice: string;
  /** Numeric price in the storefront currency (Swift Decimal, e.g. "29000"). */
  price: string;
};

export type AppleUnfinished = {
  signedTransaction: string;
  transactionId: string;
};

export type ApplePurchaseResult =
  | ({ status: 'success' } & AppleUnfinished)
  | { status: 'cancelled' }
  | { status: 'pending' };

type NativeAppleIap = {
  getProduct(productId: string): Promise<AppleIapProduct | null>;
  /** appAccountToken: UUID derived from the user id (see appleAccountToken in src/features/pro/appleBillingCore.ts). */
  purchase(productId: string, appAccountToken: string): Promise<ApplePurchaseResult>;
  finish(transactionId: string): Promise<boolean>;
  unfinished(): Promise<AppleUnfinished[]>;
  /** Verified active subscription transactions; `sync` asks the App Store to refresh first (restore). */
  currentEntitlements(sync: boolean): Promise<AppleUnfinished[]>;
  /** Opens Apple's subscription management sheet; false when no window scene is available. */
  showManageSubscriptions(): Promise<boolean>;
};

/**
 * StoreKit 2 bridge; null on Android, and null on an iOS binary built before this module existed (an over-the-air update can
 * reach such a binary), so callers must treat null as "cannot buy here".
 */
export const appleIap: NativeAppleIap | null =
  Platform.OS === 'ios' ? requireOptionalNativeModule<NativeAppleIap>('AppleIap') : null;
