import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { initialRouteName: 'index' };

export default function WorkoutsLayout() {
  const { t } = useTranslation('workouts');
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="manual" options={{ title: t('manual.title') }} />
      <Stack.Screen name="record" options={{ title: t('record.title') }} />
      <Stack.Screen name="strava-upload" options={{ title: t('strava.manual.title', { ns: 'sharing' }) }} />
      <Stack.Screen name="[id]" options={{ title: t('detail.title') }} />
    </Stack>
  );
}
