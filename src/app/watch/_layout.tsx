import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { HeaderBackButton } from '@/components/HiddenTabHeader';
import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { anchor: 'index', initialRouteName: 'index' };

export default function WatchLayout() {
  const { t } = useTranslation('watch');
  return (
    <Stack screenOptions={useStackOptions()}>
      {/* A hidden tab's first screen has no back button of its own (reached from More; no swipe-back across tabs). */}
      <Stack.Screen name="index" options={{ title: t('title'), headerLeft: () => <HeaderBackButton /> }} />
      <Stack.Screen name="alarms" options={{ title: t('screens.alarms') }} />
      <Stack.Screen name="faces" options={{ title: t('screens.faces') }} />
      <Stack.Screen name="face-edit" options={{ title: t('screens.faceEdit') }} />
      <Stack.Screen name="photos" options={{ title: t('screens.photo') }} />
      <Stack.Screen name="sensors" options={{ title: t('screens.sensors') }} />
    </Stack>
  );
}
