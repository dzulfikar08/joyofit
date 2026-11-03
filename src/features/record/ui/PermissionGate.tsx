import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';

import type { BluetoothState } from '@/ble';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { IconChip, type IconName } from '@/components/IconChip';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { ensureLocation, ensureSensorPermissions, ensureStepCounter, locationState, stepCounterState } from '@/features/sensors/permissions';
import { spacing } from '@/theme';

import type { PermissionAnswer, PermissionPlan } from './format';

/** Android 12 split Bluetooth into BLUETOOTH_SCAN and BLUETOOTH_CONNECT; before it scanning needs fine location (see `ensureSensorPermissions`). */
const ANDROID_BLUETOOTH_API = 31;

/** Whether the Bluetooth permission is already given, without asking. iOS shows it in the radio state, Android in PermissionsAndroid. */
async function bluetoothGranted(radio: BluetoothState): Promise<boolean | null> {
  if (Platform.OS !== 'android') return radio === 'on' || radio === 'off' ? true : radio === 'unauthorized' ? false : null;
  const needed =
    Number(Platform.Version) < ANDROID_BLUETOOTH_API
      ? [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
      : [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT];
  const checks = await Promise.all(needed.map((permission) => PermissionsAndroid.check(permission)));
  return checks.every(Boolean);
}

/** Allowed stays allowed only while the system agrees (the person may have taken it back in the settings); a refusal is kept. */
function settle(granted: boolean | null, prev: PermissionAnswer): PermissionAnswer {
  if (granted) return 'granted';
  return prev === 'granted' && granted === false ? 'unknown' : prev;
}

interface RecordPermissions {
  location: PermissionAnswer;
  bluetooth: PermissionAnswer;
  /** Which question is on screen right now. */
  /** The phone's step counter (optional: `canPrepare` never waits for it). `granted` also when the phone has none, so nothing is asked. */
  steps: PermissionAnswer;
  asking: 'location' | 'bluetooth' | 'steps' | null;
  askLocation: () => Promise<void>;
  askBluetooth: () => Promise<void>;
  askSteps: () => Promise<void>;
  /** `prepare` was refused for the location after all (the permission was taken back): ask again. */
  locationRefused: () => void;
}

/**
 * What the person has already allowed, read without asking (on mount and when the app returns from the settings), and the two
 * questions. Nothing here prompts by itself: the system dialog opens only from `askLocation` / `askBluetooth`, which the "Lanjut"
 * buttons call after the explanation card.
 */
export function useRecordPermissions(plan: PermissionPlan, radio: BluetoothState): RecordPermissions {
  const [location, setLocation] = useState<PermissionAnswer>('unknown');
  const [bluetooth, setBluetooth] = useState<PermissionAnswer>('unknown');
  const [steps, setSteps] = useState<PermissionAnswer>('unknown');
  const [asking, setAsking] = useState<RecordPermissions['asking']>(null);

  useEffect(() => {
    let live = true;
    const check = () => {
      void Promise.all([
        locationState().catch(() => null),
        bluetoothGranted(radio).catch(() => null),
        stepCounterState().catch(() => 'unavailable' as const),
      ]).then(([locationAllowed, bluetoothAllowed, stepCounter]) => {
        if (!live) return;
        // A phone without a step counter has nothing to ask; Android cannot tell "never asked" from "refused", iOS can.
        setSteps((prev) => (stepCounter === 'unavailable' ? 'granted' : stepCounter === 'denied' && Platform.OS !== 'android' ? 'denied' : settle(stepCounter === 'granted', prev)));
        // A refusal iOS can no longer ask again opens as the way to the settings, not as a question with no prompt behind it.
        setLocation((prev) => (locationAllowed === 'blocked' ? 'blocked' : settle(locationAllowed === null ? null : locationAllowed === 'granted', prev)));
        setBluetooth((prev) =>
          bluetoothAllowed === false && Platform.OS !== 'android' && radio === 'unauthorized' ? 'denied' : settle(bluetoothAllowed, prev),
        );
      });
    };
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, [radio]);

  const askLocation = useCallback(async () => {
    setAsking('location');
    try {
      setLocation(await ensureLocation());
    } finally {
      setAsking(null);
    }
  }, []);

  const askSteps = useCallback(async () => {
    setAsking('steps');
    try {
      setSteps(await ensureStepCounter());
    } finally {
      setAsking(null);
    }
  }, []);

  const askBluetooth = useCallback(async () => {
    setAsking('bluetooth');
    try {
      setBluetooth(await ensureSensorPermissions());
    } finally {
      setAsking(null);
    }
  }, []);

  // A question that is not part of this recording stays quiet.
  return {
    location: plan.location ? location : 'granted',
    bluetooth: plan.bluetooth ? bluetooth : 'granted',
    steps: plan.steps ? steps : 'granted',
    asking,
    askLocation,
    askBluetooth,
    askSteps,
    locationRefused: () => setLocation('denied'),
  };
}

interface ExplainCardProps {
  icon: IconName;
  title: string;
  body: string;
  /** Long optional rationale: hidden behind "Details" so the button stays in view. */
  collapsed?: boolean;
  busy: boolean;
  onContinue: () => void;
}

/** Why the app asks, before the system dialog. The only button is "Lanjut": the system dialog opens from it. */
function ExplainCard({ icon, title, body, collapsed = false, busy, onContinue }: ExplainCardProps) {
  const { t } = useTranslation('workouts');
  return (
    <Card>
      <View style={styles.head}>
        <IconChip icon={icon} tint="link" size="sm" />
        <AppText variant="heading" style={styles.title} accessibilityRole="header">
          {title}
        </AppText>
      </View>
      {collapsed ? null : (
        <AppText variant="caption" muted>
          {body}
        </AppText>
      )}
      <Button label={t('record.permission.continue')} variant="primary" loading={busy} onPress={onContinue} />
      {collapsed ? <Details>{body}</Details> : null}
    </Card>
  );
}

interface PermissionCardsProps {
  permissions: RecordPermissions;
  plan: PermissionPlan;
}

/** The cards and notices of the permissions an outdoor or sensor recording cannot go without: an explanation first, a way to the settings after a refusal. */
export function PermissionCards({ permissions, plan }: PermissionCardsProps) {
  const { t } = useTranslation('workouts');
  const { location, bluetooth, asking } = permissions;
  const settings = { label: t('record.permission.openSettings'), onPress: () => void Linking.openSettings() };
  return (
    <>
      {plan.location && location !== 'granted' ? (
        <>
          {location === 'denied' || location === 'blocked' ? (
            <Notice tone="danger" icon="location-outline" action={settings}>
              {t('record.permission.location.denied')}
            </Notice>
          ) : null}
          {location !== 'blocked' ? (
            <ExplainCard
              icon="location"
              title={t('record.permission.location.title')}
              body={t('record.permission.location.body')}
              busy={asking === 'location'}
              onContinue={() => void permissions.askLocation()}
            />
          ) : null}
        </>
      ) : null}
      {plan.bluetooth && bluetooth !== 'granted' ? (
        <>
          {bluetooth === 'denied' || bluetooth === 'blocked' ? (
            <Notice tone="danger" icon="bluetooth" action={settings}>
              {t('record.permission.bluetooth.denied')}
            </Notice>
          ) : null}
          {bluetooth === 'unknown' ? (
            <ExplainCard
              icon="bluetooth"
              title={t('record.permission.bluetooth.title')}
              body={t('record.permission.bluetooth.body')}
              busy={asking === 'bluetooth'}
              onContinue={() => void permissions.askBluetooth()}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

/**
 * What the phone's step counter question says in its current state, opened from the "Langkah" segment of the status pill: the
 * explanation and "Lanjut" while it is not asked, the way to the settings after a refusal, and what the counter does once it is on.
 * Optional: `canPrepare` never waits for it, so unlike `PermissionCards` it only shows when the person asks to see it.
 */
export function StepsPanel({ permissions }: { permissions: RecordPermissions }) {
  const { t } = useTranslation('workouts');
  const { steps, asking } = permissions;
  if (steps === 'granted') return <Notice icon="footsteps-outline">{t('record.setup.stepsOn')}</Notice>;
  if (steps === 'unknown') {
    return (
      <ExplainCard
        icon="footsteps-outline"
        title={t('record.permission.steps.title')}
        body={t('record.permission.steps.body')}
        collapsed
        busy={asking === 'steps'}
        onContinue={() => void permissions.askSteps()}
      />
    );
  }
  return (
    <Notice icon="footsteps-outline" action={{ label: t('record.permission.openSettings'), onPress: () => void Linking.openSettings() }}>
      {t('record.permission.steps.denied')}
    </Notice>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1 },
});
