import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isIos } from '@/components/IosUnavailable';
import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { initialRouteName: 'index' };

export default function SettingsLayout() {
  const { t } = useTranslation('settings');
  const { t: tg } = useTranslation('gear');
  const { t: tc } = useTranslation('cycling');
  const { t: tb } = useTranslation('bikecomp');
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="akun" options={{ title: t('screens.akun') }} />
      <Stack.Screen name="import" options={{ title: t('screens.importAll') }} />
      <Stack.Screen name="sync" options={{ title: t('screens.sync') }} />
      <Stack.Screen name="notifications" options={{ title: t('screens.notifications') }} />
      <Stack.Screen name="notification-apps" options={{ title: t('screens.notificationApps') }} />
      <Stack.Screen name="weather" options={{ title: t('screens.weather') }} />
      <Stack.Screen name="safety" options={{ title: t('screens.safety') }} />
      <Stack.Screen name="health" options={{ title: isIos ? t('screens.healthIos') : t('screens.health') }} />
      <Stack.Screen name="strava" options={{ title: t('screens.strava') }} />
      <Stack.Screen name="koneksi" options={{ title: t('screens.koneksi') }} />
      <Stack.Screen name="joyorogo" options={{ title: t('screens.joyorogo') }} />
      <Stack.Screen name="gear" options={{ title: t('screens.gear') }} />
      <Stack.Screen name="gear-edit" options={{ title: tg('edit.newTitle') }} />
      <Stack.Screen name="import-huawei" options={{ title: t('screens.importHuawei') }} />
      <Stack.Screen name="import-apple-health" options={{ title: t('screens.importAppleHealth') }} />
      <Stack.Screen name="import-fit" options={{ title: t('screens.importFit') }} />
      <Stack.Screen name="profile" options={{ title: t('screens.profile') }} />
      <Stack.Screen name="scale" options={{ title: t('screens.scale') }} />
      <Stack.Screen name="cycling" options={{ title: tc('settings.title') }} />
      <Stack.Screen name="bikecomputer" options={{ title: tb('settings.title') }} />
      <Stack.Screen name="meals" options={{ title: t('screens.meals') }} />
      <Stack.Screen name="goals" options={{ title: t('screens.goals') }} />
      <Stack.Screen name="cycle" options={{ title: t('screens.cycle') }} />
      <Stack.Screen name="courses" options={{ title: t('screens.courses') }} />
      <Stack.Screen name="advanced" options={{ title: t('screens.advanced') }} />
      <Stack.Screen name="log" options={{ title: t('screens.log') }} />
      <Stack.Screen name="about" options={{ title: t('screens.about') }} />
      <Stack.Screen name="appearance" options={{ title: t('screens.appearance') }} />
    </Stack>
  );
}
