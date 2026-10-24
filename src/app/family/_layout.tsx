import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { HeaderBackButton } from '@/components/HiddenTabHeader';
import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { anchor: 'index', initialRouteName: 'index' };

export default function FamilyLayout() {
  const { t } = useTranslation('family');
  return (
    <Stack screenOptions={useStackOptions()}>
      {/* The first screen of a hidden tab has no back button of its own. */}
      <Stack.Screen name="index" options={{ title: t('title.family'), headerLeft: () => <HeaderBackButton /> }} />
      <Stack.Screen name="[id]" options={{ title: t('title.detail') }} />
      <Stack.Screen name="rules/[id]" options={{ title: t('title.rules') }} />
      <Stack.Screen name="invite" options={{ title: t('title.invite') }} />
      <Stack.Screen name="accept" options={{ title: t('title.accept') }} />
      <Stack.Screen name="consent/[id]" options={{ title: t('title.consent') }} />
      <Stack.Screen name="me" options={{ title: t('title.me') }} />
    </Stack>
  );
}
