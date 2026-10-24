import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { HeaderBackButton } from '@/components/HiddenTabHeader';
import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { anchor: 'index', initialRouteName: 'index' };

/**
 * Strength logger. Routes (each screen sets its own title with `<Stack.Screen options={{ title }} />` from its own namespace):
 * `index` home (start, routines), `active` the workout in progress, `summary/[id]` a finished workout, `routine/[id]` routine editor
 * (`new` creates), `history` list and calendar, `exercises` exercise list, `exercise/[id]` charts and records of one exercise,
 * `muscles` weekly muscle volume, `settings` logger settings, `import` JoyoRogo history import.
 */
export default function StrengthLayout() {
  const { t } = useTranslation('strength');
  return (
    <Stack screenOptions={useStackOptions()}>
      {/* The first screen of a hidden tab has no back button of its own. */}
      <Stack.Screen name="index" options={{ title: t('title'), headerLeft: () => <HeaderBackButton /> }} />
      {/* The logger draws its own header and must not be swiped away by accident. */}
      <Stack.Screen name="active" options={{ headerShown: false, gestureEnabled: false, animation: 'slide_from_bottom' }} />
    </Stack>
  );
}
