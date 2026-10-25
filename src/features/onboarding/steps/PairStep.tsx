import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { BindConfirmDialog } from '@/features/device/BindConfirmDialog';
import { BluetoothPermissionPrompt } from '@/features/device/BluetoothPermissionPrompt';
import { withActiveWatch } from '@/features/device/bondedList';
import { noWatchFoundHint, noWatchFoundScanHint } from '@/features/device/connectFailure';
import { isLinkUp } from '@/features/device/linkState';
import { useBluetoothPermission } from '@/features/device/useBluetoothPermission';
import { useBondedDevices, type BondedDevices } from '@/features/device/useBondedDevices';
import { useWatchRowActions } from '@/features/device/useWatchRowActions';
import { familyOfModel, pairingModeOf } from '@/features/device/watchCatalogue';
import { WATCH_FAMILIES } from '@/features/device/watchFamilies';
import { watchListName } from '@/features/device/watchName';
import { WatchStatusCard } from '@/features/device/WatchStatusCard';
import { AddManuallySheet } from '@/features/onboarding/pair/AddManuallySheet';
import { ConfirmOnWatchPanel } from '@/features/onboarding/pair/ConfirmOnWatchPanel';
import { ScanRadar } from '@/features/onboarding/pair/ScanRadar';
import { WatchGlyph } from '@/features/onboarding/pair/WatchGlyph';
import { WatchScanCard } from '@/features/onboarding/pair/WatchScanCard';
import { cardAction, isLinkSettingUp, scanCards } from '@/features/onboarding/pairing';
import { StepIntro } from '@/features/onboarding/StepIntro';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

/**
 * Pairing the way Huawei Health does it: no text before the scan. Arriving here asks for Bluetooth and starts looking at once, under a
 * radar; every watch found is one large card with one Connect button. "Add manually" picks the model from the catalogue, explains how
 * that model is put in pairing mode and marks its cards. While the link is set up a full-width panel shows what to tap on the watch.
 * The permission, the list, the connect and the bind confirmation are the Watch tab's (shared hooks and components), not a copy.
 */
export function PairStep() {
  const { t } = useTranslation('onboarding');
  const permission = useBluetoothPermission();
  const granted = permission.status === 'granted';
  const bonded = useBondedDevices(granted);
  const { linkState, bindRequest } = useWatch();
  const linked = isLinkUp(linkState);

  return (
    <>
      <StepIntro icon="bluetooth" tint="link" title={t('pair.title')}>
        {t('pair.intro')}
      </StepIntro>
      {linked ? (
        <>
          <WatchStatusCard />
          <Notice icon="checkmark-circle">{t('pair.connected')}</Notice>
        </>
      ) : null}
      {!granted ? (
        <BluetoothPermissionPrompt permission={permission} />
      ) : (
        <Scan bonded={bonded} settingUp={isLinkSettingUp(linkState) && !bindRequest} linked={linked} />
      )}
      <Details title={t('pair.helpTitle')}>{t('pair.help')}</Details>
      <BindConfirmDialog />
    </>
  );
}

/** Mounted once Bluetooth is allowed: starts the first scan by itself (iOS: the list refresh, which scans) unless a watch is linked. */
function Scan({ bonded, settingUp, linked }: { bonded: BondedDevices; settingUp: boolean; linked: boolean }) {
  const { t } = useTranslation('onboarding');
  const watch = useWatch();
  const actions = useWatchRowActions(bonded);
  const [picked, setPicked] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  // The first look runs once, by itself; until it has begun the step shows the radar, not "no watch found".
  const autoStarted = useRef(false);
  const [firstLookPending, setFirstLookPending] = useState(true);

  const { startScan, stopScan, reload, refresh } = bonded;
  useEffect(() => {
    if (autoStarted.current || linked) return;
    autoStarted.current = true;
    // Below Android 12 a scan needs the location permission JoyoFit does not ask for (`startScan` says so in red); the first look is
    // then the paired list only, and Scan again still tries and explains.
    const firstLook = isIos ? refresh() : Number(Platform.Version) < 31 ? reload() : startScan();
    void firstLook.finally(() => setFirstLookPending(false));
  }, [linked, refresh, reload, startScan]);

  const cards = useMemo(
    () => scanCards(withActiveWatch(bonded.devices, watch.activeAddress, watch.device), picked),
    [bonded.devices, watch.activeAddress, watch.device, picked],
  );
  const searching = (isIos ? bonded.loading : bonded.scanning) || (firstLookPending && !linked);
  const scanAgain = () => {
    if (isIos) {
      void refresh();
      return;
    }
    void reload();
    void startScan();
  };

  if (settingUp) {
    const active = cards.find((c) => c.device.address === watch.activeAddress);
    const name = active ? watchListName({ name: active.device.name, model: active.model }) : watch.device?.name || t('pair.confirm.thisWatch');
    return <ConfirmOnWatchPanel name={name} linkState={watch.linkState} onCancel={actions.disconnect} />;
  }

  const found = cards.length;
  const showPrompt = !searching && found === 0 && !picked;
  return (
    <>
      {linked ? null : (
        <ScanRadar
          scanning={searching}
          title={searching ? t('pair.scan.searching') : found > 0 ? t('pair.scan.found', { count: found }) : t('pair.scan.none')}
          caption={searching || found > 0 ? t('pair.scan.keepClose') : isIos ? noWatchFoundHint() : noWatchFoundScanHint()}
        />
      )}
      {bonded.error ? <Notice tone="danger">{bonded.error}</Notice> : null}
      {picked ? <PickedModel model={picked} onChange={() => setChoosing(true)} onClear={() => setPicked(null)} /> : null}
      {cards.map((card, index) => (
        <WatchScanCard
          key={card.device.address}
          card={card}
          action={cardAction(card.device, watch.linkState, watch.activeAddress)}
          onConnect={actions.connect}
          onForget={actions.forget}
          delay={Math.min(index, 5) * 40}
        />
      ))}
      {showPrompt ? (
        <Card style={styles.gap}>
          <AppText variant="heading">{t('pair.manual.promptTitle')}</AppText>
          <AppText variant="caption" muted>
            {t('pair.manual.prompt')}
          </AppText>
          <Button label={t('pair.manual.open')} variant="primary" icon="list" onPress={() => setChoosing(true)} />
        </Card>
      ) : null}
      <ButtonRow>
        {showPrompt ? null : <Button label={t('pair.manual.open')} icon="list" onPress={() => setChoosing(true)} />}
        {searching && !isIos ? (
          <Button label={t('pair.scan.stop')} icon="close" onPress={() => void stopScan()} />
        ) : (
          <Button label={t('pair.scan.again')} icon="refresh" loading={searching} onPress={scanAgain} />
        )}
      </ButtonRow>
      <AddManuallySheet
        visible={choosing}
        onClose={() => setChoosing(false)}
        onPick={(model) => {
          setPicked(model);
          setChoosing(false);
          if (!searching) scanAgain();
        }}
      />
    </>
  );
}

/** The model picked under "Add manually": how to put it in pairing mode, and the way to pick another. */
function PickedModel({ model, onChange, onClear }: { model: string; onChange: () => void; onClear: () => void }) {
  const { t } = useTranslation(['onboarding', 'nowatch']);
  const family = WATCH_FAMILIES.find((f) => f.id === familyOfModel(model));
  return (
    <Card style={styles.gap}>
      <View style={styles.head}>
        <WatchGlyph size={56} highlighted />
        <View style={styles.text}>
          <AppText variant="heading">{model}</AppText>
          {family ? (
            <AppText variant="caption" muted>
              {t(`nowatch:supported.status.${family.support}`)}
            </AppText>
          ) : null}
        </View>
      </View>
      <AppText variant="label">{t('onboarding:pair.mode.title')}</AppText>
      <AppText variant="caption">{t(`onboarding:pair.mode.${pairingModeOf(model)}`)}</AppText>
      <AppText variant="caption" muted>
        {isIos ? t('onboarding:pair.mode.thenIos') : t('onboarding:pair.mode.then')}
      </AppText>
      <ButtonRow>
        <Button label={t('onboarding:pair.manual.change')} icon="swap-horizontal" onPress={onChange} />
        <Button label={t('onboarding:pair.manual.clear')} icon="close" variant="ghost" onPress={onClear} />
      </ButtonRow>
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 2 },
});
