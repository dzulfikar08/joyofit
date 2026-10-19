import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { HeaderBackButton } from '@/components/HiddenTabHeader';
import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { initialRouteName: 'index' };

export default function RoutesLayout() {
  const { t } = useTranslation('routes');
  return (
    <Stack screenOptions={useStackOptions()}>
      {/* The first screen of a hidden tab has no back button of its own. */}
      <Stack.Screen name="index" options={{ title: t('titles.library'), headerLeft: () => <HeaderBackButton /> }} />
      <Stack.Screen name="[id]" options={{ title: t('titles.detail') }} />
      <Stack.Screen name="import" options={{ title: t('titles.import') }} />
      <Stack.Screen name="draw" options={{ title: t('titles.draw') }} />
      <Stack.Screen name="loop" options={{ title: t('titles.loop') }} />
    </Stack>
  );
}
