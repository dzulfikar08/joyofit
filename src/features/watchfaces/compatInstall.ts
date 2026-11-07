import Storage from 'expo-sqlite/kv-store';

const COMPAT_INSTALL_KEY = 'watchfaces.compatInstall';

/** Whether the person turned on "Compatibility install", kept across launches. A storage failure reads as off. */
export function loadCompatInstall(): boolean {
  try {
    return Storage.getItemSync(COMPAT_INSTALL_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveCompatInstall(on: boolean): void {
  try {
    Storage.setItemSync(COMPAT_INSTALL_KEY, on ? '1' : '0');
  } catch {
    // Only the memory is lost; the switch still applies for this visit.
  }
}
