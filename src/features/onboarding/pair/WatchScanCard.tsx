import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FadeIn } from '@/components/motion';
import { Card } from '@/components/Screen';
import { supportLabel } from '@/features/device/modelSupport';
import { watchListName } from '@/features/device/watchName';
import { shownName } from '@/features/device/shownName';
import { WatchGlyph } from '@/features/onboarding/pair/WatchGlyph';
import type { CardAction, ScanCard } from '@/features/onboarding/pairing';
import { spacing, useColors } from '@/theme';

interface WatchScanCardProps {
  card: ScanCard;
  action: CardAction;
  onConnect: (address: string) => void;
  /**
   * Forgets the pairing (the Watch tab's "Lupakan pairing"), offered on the linked watch's card: a link to a watch that was reset or
   * re-paired elsewhere can look connected while the watch refuses everything, and the guide must offer the way out itself.
   */
  onForget: (address: string) => void;
  /** Stagger of the entrance, in list order. */
  delay: number;
}

/**
 * One watch the scan found, large, as Huawei Health lists them: its picture, the model (with the unit suffix, so two of the same model
 * can be told apart), how far JoyoFit gets with it, and the one Connect button. A card of the model picked under "Add manually" is marked.
 */
export function WatchScanCard({ card, action, onConnect, onForget, delay }: WatchScanCardProps) {
  const { t } = useTranslation(['onboarding', 'watch', 'common']);
  const colors = useColors();
  const [confirmingForget, setConfirmingForget] = useState(false);
  const { device, model, picked } = card;
  const title = shownName(watchListName({ name: device.name, model })) || t('watch:device.bonded.unnamed');
  const label =
    action === 'linked'
      ? t('onboarding:pair.cardLinked')
      : action === 'switch'
        ? t('watch:device.bonded.switchHere')
        : action === 'unsupported'
          ? supportLabel('unsupported')
          : t('watch:device.bonded.connect');

  return (
    <FadeIn delay={delay}>
      <Card style={[styles.card, picked && { borderColor: colors.link, borderWidth: 2 }]}>
        <View style={styles.head}>
          <WatchGlyph size={72} highlighted={picked || action === 'linked'} />
          <View style={styles.text}>
            <AppText variant="heading" numberOfLines={2}>
              {title}
            </AppText>
            <AppText variant="caption" muted numberOfLines={1}>
              {model ? supportLabel(device.support) : `${shownName(device.name)} · ${supportLabel(device.support)}`}
            </AppText>
            {picked ? (
              <AppText variant="label" color={colors.linkText}>
                {t('onboarding:pair.cardPicked')}
              </AppText>
            ) : null}
            {device.reason ? (
              <AppText variant="caption" muted>
                {device.reason}
              </AppText>
            ) : null}
          </View>
        </View>
        <Button
          label={label}
          variant={action === 'linked' ? 'secondary' : 'primary'}
          icon={action === 'linked' ? 'checkmark-circle' : 'bluetooth'}
          disabled={action !== 'connect' && action !== 'switch'}
          onPress={() => onConnect(device.address)}
        />
        {action === 'linked' ? (
          <Button label={t('watch:device.bonded.forgetPairing')} variant="destructive" onPress={() => setConfirmingForget(true)} />
        ) : null}
      </Card>
      <ConfirmDialog
        visible={confirmingForget}
        title={t('watch:device.bonded.forgetTitle')}
        message={t(Platform.OS === 'ios' ? 'watch:device.bonded.forgetMessageIos' : 'watch:device.bonded.forgetMessage')}
        confirmLabel={t('watch:device.bonded.forget')}
        onConfirm={() => {
          setConfirmingForget(false);
          onForget(device.address);
        }}
        onCancel={() => setConfirmingForget(false)}
      />
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 2 },
});
