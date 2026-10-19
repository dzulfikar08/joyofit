import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconChip } from '@/components/IconChip';
import { canConnect, supportLabel } from '@/features/device/modelSupport';
import { spacing } from '@/theme';
import type { BondedDevice, LinkState } from '@/wear';

interface BondedRowProps {
  device: BondedDevice;
  linkState: LinkState;
  /** Address currently connecting/connected, or null. */
  activeAddress: string | null;
  onConnect: (address: string) => void;
  onDisconnect: () => void;
  onForget: (address: string) => void;
}

export function BondedRow({
  device,
  linkState,
  activeAddress,
  onConnect,
  onDisconnect,
  onForget,
}: BondedRowProps) {
  const { t } = useTranslation(['watch', 'common']);
  const isActive = activeAddress === device.address && linkState !== 'disconnected';
  const idle = linkState === 'disconnected';

  const [confirmingForget, setConfirmingForget] = useState(false);
  // A link to another watch is open: Connect moves the link here (the watch in use is disconnected first).
  const switching = linkState === 'connected' && !isActive;

  const connectable = canConnect(device);
  /** Android lost its pairing with a Classic watch JoyoFit remembers: it is still listed and connects by its stored address. */
  const pairingLost = device.remembered === true && device.paired === false && device.classic === true;

  return (
    <View style={styles.row}>
      <View style={[styles.header, !connectable && styles.dimmed]}>
        <IconChip icon="watch" tint={isActive ? 'link' : 'neutral'} />
        <View style={styles.text}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {device.name || t('watch:device.bonded.unnamed')}
          </AppText>
          <AppText variant="mono" muted numberOfLines={1}>
            {device.address} · {device.model ? `${device.model}, ${supportLabel(device.support)}` : supportLabel(device.support)}
          </AppText>
          {device.reason ? (
            <AppText variant="caption" muted>
              {device.reason}
            </AppText>
          ) : null}
          {device.systemConnected ? (
            <AppText variant="caption" muted>
              {t('watch:device.bonded.systemConnected')}
            </AppText>
          ) : device.nearby === false && !isActive ? (
            <AppText variant="caption" muted>
              {t('watch:device.bonded.notInReach')}
            </AppText>
          ) : pairingLost && !isActive ? (
            <AppText variant="caption" muted>
              {t('watch:device.bonded.notPairedRemembered')}
            </AppText>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        {isActive ? (
          <Button
            label={linkState === 'connecting' ? t('common:actions.cancel') : t('watch:device.bonded.disconnect')}
            onPress={onDisconnect}
            disabled={linkState === 'syncing'}
          />
        ) : (
          <Button
            label={switching ? t('watch:device.bonded.switchHere') : t('watch:device.bonded.connect')}
            variant="primary"
            disabled={!connectable || !(idle || switching)}
            onPress={() => onConnect(device.address)}
          />
        )}
        {connectable ? (
          <Button label={t('watch:device.bonded.forgetPairing')} variant="destructive" disabled={!idle && !isActive} onPress={() => setConfirmingForget(true)} />
        ) : null}
      </View>
      <ConfirmDialog
        visible={confirmingForget}
        title={t('watch:device.bonded.forgetTitle')}
        message={t('watch:device.bonded.forgetMessage')}
        confirmLabel={t('watch:device.bonded.forget')}
        onConfirm={() => {
          setConfirmingForget(false);
          onForget(device.address);
        }}
        onCancel={() => setConfirmingForget(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dimmed: { opacity: 0.55 },
  text: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
