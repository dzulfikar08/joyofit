import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Divider, Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { SwitchRow } from '@/components/SwitchRow';
import { fmtClock } from '@/i18n/format';
import { ensureSensorPermissions } from '@/features/sensors/permissions';
import { nativeErrorCode } from '@/features/scale/native';
import type { RoomCaptureState } from '../../../../modules/ble-sensors/src/BleSensors.types';

import { startNightCapture } from '../capture';
import { pairingVersion } from '../events';
import type { RoomLink } from '../link';
import { roomCaptureNative } from '../native';
import { keepsMiBeacon } from '../roomNative';
import { captureEnd } from '../nightWindow';
import { getAutoArm, getWakeHour, setAutoArm, setWakeHour, WAKE_HOURS } from '../settings';

interface NightSectionProps {
  /** Addresses of the paired thermometers. */
  ids: string[];
  /** How the thermometer is read: a connected-read one has no overnight scan, a bind-key one has it only on a build that keeps MiBeacon frames. */
  link: RoomLink;
  /** Tells the screen what went wrong (a permission answer, a refusal) so it can say so above. */
  onProblem: (problem: 'permission' | 'off' | 'unavailable' | 'notAllowed' | null) => void;
}

const hourLabel = (hour: number): string => fmtClock(new Date(2000, 0, 1, hour));

/**
 * The overnight scan (Android store build): its state, a start and stop button, the automatic start and the hour it ends. Where there is
 * no overnight scan (iPhone, or an Android binary from before it existed) it says so and what that means: readings only while the app is open.
 */
export function NightSection({ ids, link, onProblem }: NightSectionProps) {
  const { t } = useTranslation('thermometer');
  const found = roomCaptureNative();
  // A connected read cannot run with the app closed; a bind-key unit needs a build whose scan keeps its frames.
  const native = link === 'gatt' ? null : link === 'bindkey' && found && !keepsMiBeacon(found) ? null : found;
  const [state, setState] = useState<RoomCaptureState | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(getAutoArm);
  const [wakeHour, setWake] = useState(getWakeHour);

  const reload = useCallback(async () => {
    if (!native) return;
    try {
      setState(await native.roomCaptureState());
    } catch {
      setState(null);
    }
  }, [native]);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    native.roomCaptureState().then(
      (s) => {
        if (!cancelled) setState(s);
      },
      () => {
        if (!cancelled) setState(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [native]);

  const start = async () => {
    if (!native) return;
    setBusy(true);
    onProblem(null);
    try {
      const permission = await ensureSensorPermissions();
      if (permission !== 'granted') {
        onProblem('permission');
        return;
      }
      await startNightCapture(native, ids, captureEnd(new Date(), wakeHour));
    } catch (e) {
      const code = nativeErrorCode(e);
      onProblem(code === 'ERR_BLUETOOTH_PERMISSION' ? 'permission' : code === 'ERR_BLUETOOTH_OFF' ? 'off' : code === 'ERR_SERVICE_NOT_ALLOWED' ? 'notAllowed' : 'unavailable');
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const stop = async () => {
    if (!native) return;
    setBusy(true);
    try {
      await native.stopRoomCapture();
    } finally {
      setBusy(false);
      await reload();
    }
  };

  return (
    <Section title={t('night.title')} icon="moon">
      {native ? (
        <>
          <AppText variant="bodyStrong" accessibilityLiveRegion="polite">
            {state?.active && state.untilMs !== null ? t('night.running', { time: fmtClock(state.untilMs) }) : t('night.idle')}
          </AppText>
          {state?.active ? (
            <Button label={t('night.stop')} icon="stop-circle-outline" loading={busy} onPress={() => void stop()} />
          ) : (
            <Button label={t('night.start')} icon="moon" variant="primary" loading={busy} onPress={() => void start()} />
          )}
          <Divider />
          <SwitchRow
            label={t('night.auto')}
            hint={t('night.autoHint')}
            value={auto}
            onValueChange={(on) => {
              setAuto(on);
              setAutoArm(on);
              pairingVersion.bump();
            }}
          />
          <AppText variant="bodyStrong">{t('night.until')}</AppText>
          <Segmented
            options={WAKE_HOURS.map((hour): { value: number; label: string } => ({ value: hour, label: hourLabel(hour) }))}
            value={wakeHour}
            onChange={(hour) => {
              setWake(hour);
              setWakeHour(hour);
            }}
          />
        </>
      ) : (
        <AppText variant="caption">
          {t(link === 'gatt' ? 'night.gatt' : Platform.OS !== 'android' ? 'night.ios' : link === 'bindkey' && found ? 'night.oldBuildKey' : 'night.oldBuild')}
        </AppText>
      )}
      <Details>{t('night.explain')}</Details>
    </Section>
  );
}
