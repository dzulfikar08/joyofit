import type { ProtocolSecret, SecretField } from './types';

/**
 * A secret a scale protocol needs (a Tuya local key, the Huawei Hagrid keys), kept per scale in the platform's secure store (Keychain /
 * Keystore, the same place the sign-in token lives), never in the scale table, the support log or a backup of the app database. The store
 * is injected so tests run without the native module; the app passes `expo-secure-store`.
 */
export interface SecretStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Secure store keys allow letters, digits, `.`, `-` and `_` only; a MAC address has colons. */
export const scaleSecretKey = (scaleId: string): string => `joyofit.scale.secret.${scaleId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export const loadScaleSecret = (store: SecretStore, scaleId: string): Promise<string | null> => store.getItemAsync(scaleSecretKey(scaleId));

export const saveScaleSecret = (store: SecretStore, scaleId: string, secret: string): Promise<void> =>
  store.setItemAsync(scaleSecretKey(scaleId), secret);

export const deleteScaleSecret = (store: SecretStore, scaleId: string): Promise<void> => store.deleteItemAsync(scaleSecretKey(scaleId));

/** The fields to ask for this scale: one marked `onlyWithoutAddress` only where the scale id is not a Bluetooth address (iOS). */
export function secretFieldsFor(secret: ProtocolSecret, scaleId: string): readonly SecretField[] {
  const hasAddress = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(scaleId);
  return secret.fields.filter((field) => !field.onlyWithoutAddress || !hasAddress);
}
