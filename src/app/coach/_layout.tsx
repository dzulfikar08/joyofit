import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { HeaderBackButton } from '@/components/HiddenTabHeader';
import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { anchor: 'index', initialRouteName: 'index' };

export default function CoachLayout() {
  const { t } = useTranslation('coach');
  return (
    <Stack screenOptions={useStackOptions()}>
      {/* The first screen of a hidden tab has no back button of its own. */}
      <Stack.Screen name="index" options={{ title: t('title'), headerLeft: () => <HeaderBackButton /> }} />
      <Stack.Screen name="setup" options={{ title: t('setup.title') }} />
      <Stack.Screen name="session/[key]" options={{ title: t('session.title') }} />
      <Stack.Screen name="library/index" options={{ title: t('library.title') }} />
      <Stack.Screen name="library/[id]" options={{ title: t('library.title') }} />
    </Stack>
  );
}
