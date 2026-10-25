import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { Details } from '@/components/Details';
import { Section, Screen } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { showsWatchUi } from '@/features/device/presence';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { ensureBluetoothConnect, ensureBluetoothScan } from '@/features/device/useBluetoothPermission';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { dbHealth, useDbHealth } from '@/db/recovery';
import { errorMessage } from '@/format';
import { useTheme } from '@/theme';
import { HuaweiWear, hasNative } from '@/wear';

/** The experimental HW_AGNSS switch, or null on a binary without it (OTA bundle on an older build) or when the status cannot be read. */
function readAgpsLab(): boolean | null {
  if (!hasNative('setAgpsLab')) return null;
  try {
    return HuaweiWear.getAgps().labAgnss === true;
  } catch {
    return null;
  }
}

export default function AdvancedScreen() {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const router = useRouter();
  const presence = useWatchPresence();
  // Courses and the Bluetooth link are for the watch; with none, only the log and About remain.
  const withWatch = presence === null || showsWatchUi(presence);
  const [courses, setCourses] = useState(() => HuaweiWear.getCourses());
  const [coursesBusy, setCoursesBusy] = useState(false);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [forceBle, setForceBle] = useState(() => HuaweiWear.getForceBle());
  const [bleError, setBleError] = useState<string | null>(null);
  const [agpsLab, setAgpsLab] = useState(readAgpsLab);
  const [agpsLabError, setAgpsLabError] = useState<string | null>(null);

  useNativeRefresh(
    useCallback(() => {
      setCourses(HuaweiWear.getCourses());
      setForceBle(HuaweiWear.getForceBle());
      setAgpsLab(readAgpsLab());
    }, []),
  );

  const toggleForceBle = async (enabled: boolean) => {
    setBleError(null);
    try {
      if (enabled && ((await ensureBluetoothConnect()) !== 'granted' || (await ensureBluetoothScan()) !== 'granted')) {
        setBleError(t('advanced.bleDenied'));
      }
      await HuaweiWear.setForceBle(enabled);
    } catch (e) {
      setBleError(errorMessage(e));
    } finally {
      setForceBle(HuaweiWear.getForceBle());
    }
  };

  const toggleCourses = async (enabled: boolean) => {
    setCoursesBusy(true);
    setCoursesError(null);
    try {
      await HuaweiWear.setCoursesEnabled(enabled);
    } catch (e) {
      setCoursesError(errorMessage(e));
    } finally {
      setCourses(HuaweiWear.getCourses());
      setCoursesBusy(false);
    }
  };

  const toggleAgpsLab = async (enabled: boolean) => {
    setAgpsLabError(null);
    try {
      await HuaweiWear.setAgpsLab(enabled);
    } catch (e) {
      setAgpsLabError(errorMessage(e));
    } finally {
      setAgpsLab(readAgpsLab());
    }
  };

  const { repairing } = useDbHealth();
  const [repairHealthy, setRepairHealthy] = useState(false);

  const repairNow = async () => {
    setRepairHealthy(false);
    // The result is shown by the repair notice; only "nothing was wrong" has no notice and is said here.
    const result = await dbHealth.repair();
    setRepairHealthy(result.kind === 'healthy');
  };

  return (
    <Screen>
      <View>
        <NavRow
          icon="terminal"
          title={t('index.rows.log.title')}
          subtitle={t('index.rows.log.subtitle')}
          onPress={() => router.push('/settings/log')}
          style={groupedRowStyle(theme, 0, 3)}
        />
        <NavRow
          icon="construct"
          title={t('advanced.repair')}
          subtitle={t('advanced.repairSubtitle')}
          disabled={repairing}
          onPress={() => void repairNow()}
          style={groupedRowStyle(theme, 1, 3)}
        />
        <NavRow
          icon="information-circle"
          title={t('index.rows.about.title')}
          onPress={() => router.push('/settings/about')}
          style={groupedRowStyle(theme, 2, 3)}
        />
      </View>
      {repairHealthy ? <Notice>{t('advanced.repairHealthy')}</Notice> : null}
      {withWatch ? (
        <Section title={t('advanced.experimental')} icon="flask" tint="workouts">
          <SwitchRow
            label={t('advanced.courses')}
            value={courses.enabled}
            disabled={coursesBusy}
            onValueChange={(enabled) => void toggleCourses(enabled)}
          />
          {coursesError ? <Notice tone="danger">{coursesError}</Notice> : null}
          {agpsLab !== null ? (
            <>
              <SwitchRow label={t('advanced.agnssLab')} value={agpsLab} onValueChange={(enabled) => void toggleAgpsLab(enabled)} />
              <Notice tone={agpsLab ? 'danger' : 'info'}>{t('advanced.agnssLabRisk')}</Notice>
              {agpsLabError ? <Notice tone="danger">{agpsLabError}</Notice> : null}
            </>
          ) : null}
          {__DEV__ ? (
            <SwitchRow
              label={t('advanced.bleLink')}
              value={forceBle}
              onValueChange={(enabled) => void toggleForceBle(enabled)}
            />
          ) : null}
          {__DEV__ && bleError ? <Notice tone="danger">{bleError}</Notice> : null}
          <Details>
            {__DEV__ ? t('advanced.detailsDev') : t('advanced.details')}
          </Details>
        </Section>
      ) : null}
      {withWatch && courses.enabled ? (
        <NavRow
          icon="walk"
          tint="workouts"
          title={t('advanced.courses')}
          subtitle={t('advanced.coursesSubtitle')}
          onPress={() => router.push('/settings/courses')}
          style={groupedRowStyle(theme, 0, 1)}
        />
      ) : null}
    </Screen>
  );
}
