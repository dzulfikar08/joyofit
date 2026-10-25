import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { Button } from '@/components/Button';
import { LoadingState, Notice } from '@/components/States';
import type { BluetoothPermission } from '@/features/device/useBluetoothPermission';

/**
 * What a watch list shows until Bluetooth is allowed: a spinner while the permission is read, else why it is needed and the one button
 * that gets it (the system prompt again, or the app settings once Android stopped asking). The Watch tab and the setup guide share it.
 */
export function BluetoothPermissionPrompt({ permission }: { permission: BluetoothPermission }) {
  const { t } = useTranslation('watch');
  if (permission.status === 'checking') return <LoadingState label={t('device.list.checkingPermission')} />;
  return (
    <>
      <Notice tone="danger">{t('device.list.permissionNeeded')}</Notice>
      {permission.status === 'blocked' ? (
        <Button label={t('device.list.openSettings')} icon="settings" onPress={() => void Linking.openSettings()} />
      ) : (
        <Button label={t('device.list.continue')} variant="primary" icon="bluetooth" onPress={() => void permission.request()} />
      )}
    </>
  );
}
