import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { anchor: 'index', initialRouteName: 'index' };

export default function SocialLayout() {
  const { t } = useTranslation('social');
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="post/[id]" options={{ title: t('nav.post') }} />
      <Stack.Screen name="groups" options={{ title: t('nav.groups') }} />
      <Stack.Screen name="group/[id]" options={{ title: t('nav.group') }} />
      <Stack.Screen name="profile" options={{ title: t('nav.myProfile') }} />
      <Stack.Screen name="u/[handle]" options={{ title: t('nav.profile') }} />
    </Stack>
  );
}
