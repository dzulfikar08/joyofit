import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { HeaderBackButton } from '@/components/HiddenTabHeader';
import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { anchor: 'index', initialRouteName: 'index' };

/** "Main di web": `index` the room (join form, status, the ride), `join` the `joyofit://ride/join?code=` deep link from the game's QR. */
export default function RideLayout() {
  const { t } = useTranslation('ride');
  return (
    <Stack screenOptions={useStackOptions()}>
      {/* The first screen of a hidden tab has no back button of its own. */}
      <Stack.Screen name="index" options={{ title: t('title'), headerLeft: () => <HeaderBackButton /> }} />
      <Stack.Screen name="join" options={{ title: t('title') }} />
    </Stack>
  );
}
