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
import { watchNavSession } from '@/features/watchnav/instance';
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

/** The experimental HW_PGNSS_PRED switch, or null on a binary without it or when the status cannot be read. */
function readAgpsPgnssLab(): boolean | null {
  if (!hasNative('setAgpsPgnssLab')) return null;
  try {
    return HuaweiWear.getAgps().labPgnss === true;
  } catch {
    return null;
  }
}

/** The offline-map lab switch, or null on a binary without it or when the status cannot be read. */
function readOfflineMapLab(): boolean | null {
  if (!hasNative('setOfflineMapLab')) return null;
  try {
    return HuaweiWear.getOfflineMapLab().enabled;
  } catch {
    return null;
  }
}

/** The watch-music lab switch, or null on a binary without it (OTA bundle on an older build) or when the status cannot be read. */
function readWatchMusicLab(): boolean | null {
  if (!hasNative('getWatchMusic')) return null;
  try {
    return HuaweiWear.getWatchMusic().enabled;
  } catch {
    return null;
  }
}

/** The watch-navigation lab switch, or null on a binary without it or when the status cannot be read. */
function readWatchNavLab(): boolean | null {
  if (!hasNative('setWatchNavLab')) return null;
  try {
    return HuaweiWear.getWatchNav().enabled;
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
  const [pgnssLab, setPgnssLab] = useState(readAgpsPgnssLab);
  const [pgnssLabError, setPgnssLabError] = useState<string | null>(null);
  const [mapLab, setMapLab] = useState(readOfflineMapLab);
  const [mapLabError, setMapLabError] = useState<string | null>(null);
  const [navLab, setNavLab] = useState(readWatchNavLab);
  const [navLabError, setNavLabError] = useState<string | null>(null);
  const [musicLab, setMusicLab] = useState(readWatchMusicLab);
  const [musicLabError, setMusicLabError] = useState<string | null>(null);

  useNativeRefresh(
    useCallback(() => {
      setCourses(HuaweiWear.getCourses());
      setForceBle(HuaweiWear.getForceBle());
      setAgpsLab(readAgpsLab());
      setPgnssLab(readAgpsPgnssLab());
      setMapLab(readOfflineMapLab());
      setNavLab(readWatchNavLab());
      setMusicLab(readWatchMusicLab());
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

  const togglePgnssLab = async (enabled: boolean) => {
    setPgnssLabError(null);
    try {
      await HuaweiWear.setAgpsPgnssLab(enabled);
    } catch (e) {
      setPgnssLabError(errorMessage(e));
    } finally {
      setPgnssLab(readAgpsPgnssLab());
    }
  };

  const toggleMapLab = async (enabled: boolean) => {
    setMapLabError(null);
    try {
      await HuaweiWear.setOfflineMapLab(enabled);
    } catch (e) {
      setMapLabError(errorMessage(e));
    } finally {
      setMapLab(readOfflineMapLab());
    }
  };

  const toggleMusicLab = async (enabled: boolean) => {
    setMusicLabError(null);
    try {
      await HuaweiWear.setWatchMusicLab(enabled);
    } catch (e) {
      setMusicLabError(errorMessage(e));
    } finally {
      setMusicLab(readWatchMusicLab());
    }
  };

  const toggleNavLab = async (enabled: boolean) => {
    setNavLabError(null);
    // Off ends a running session: the watch gets its `end` before the native side unregisters.
    if (!enabled && watchNavSession.running) await watchNavSession.stop();
    try {
      await HuaweiWear.setWatchNavLab(enabled);
    } catch (e) {
      setNavLabError(errorMessage(e));
    } finally {
      setNavLab(readWatchNavLab());
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

  // The rows the switches above turned on, grouped as one block: each row's place in it picks its rounded corners.
  const labRows = (['courses', 'maps', 'music'] as const).filter((row) =>
    row === 'courses' ? courses.enabled : row === 'maps' ? mapLab === true : musicLab === true,
  );

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
          {pgnssLab !== null ? (
            <>
              <SwitchRow label={t('advanced.pgnssLab')} value={pgnssLab} onValueChange={(enabled) => void togglePgnssLab(enabled)} />
              <Notice tone={pgnssLab ? 'danger' : 'info'}>{t('advanced.pgnssLabRisk')}</Notice>
              {pgnssLabError ? <Notice tone="danger">{pgnssLabError}</Notice> : null}
            </>
          ) : null}
          {mapLab !== null ? (
            <>
              <SwitchRow label={t('advanced.offlineMapLab')} value={mapLab} onValueChange={(enabled) => void toggleMapLab(enabled)} />
              <Notice tone={mapLab ? 'danger' : 'info'}>{t('advanced.offlineMapLabRisk')}</Notice>
              {mapLabError ? <Notice tone="danger">{mapLabError}</Notice> : null}
            </>
          ) : null}
          {musicLab !== null ? (
            <>
              <SwitchRow label={t('advanced.watchMusicLab')} value={musicLab} onValueChange={(enabled) => void toggleMusicLab(enabled)} />
              <Notice tone={musicLab ? 'danger' : 'info'}>{t('advanced.watchMusicLabRisk')}</Notice>
              {musicLabError ? <Notice tone="danger">{musicLabError}</Notice> : null}
            </>
          ) : null}
          {navLab !== null ? (
            <>
              <SwitchRow label={t('advanced.watchNavLab')} value={navLab} onValueChange={(enabled) => void toggleNavLab(enabled)} />
              <Notice tone={navLab ? 'danger' : 'info'}>{t('advanced.watchNavLabRisk')}</Notice>
              {navLabError ? <Notice tone="danger">{navLabError}</Notice> : null}
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
      {withWatch && labRows.length > 0 ? (
        <View>
          {courses.enabled ? (
            <NavRow
              icon="walk"
              tint="workouts"
              title={t('advanced.courses')}
              subtitle={t('advanced.coursesSubtitle')}
              onPress={() => router.push('/settings/courses')}
              style={groupedRowStyle(theme, labRows.indexOf('courses'), labRows.length)}
            />
          ) : null}
          {mapLab ? (
            <NavRow
              icon="map"
              tint="workouts"
              title={t('advanced.offlineMapLab')}
              subtitle={t('advanced.offlineMapLabSubtitle')}
              onPress={() => router.push('/settings/offline-maps')}
              style={groupedRowStyle(theme, labRows.indexOf('maps'), labRows.length)}
            />
          ) : null}
          {musicLab ? (
            <NavRow
              icon="musical-notes"
              tint="workouts"
              title={t('advanced.watchMusicLab')}
              subtitle={t('advanced.watchMusicLabSubtitle')}
              onPress={() => router.push('/settings/watch-music')}
              style={groupedRowStyle(theme, labRows.indexOf('music'), labRows.length)}
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
