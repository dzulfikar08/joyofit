import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { HeaderBackButton } from '@/components/HiddenTabHeader';
import { useStackOptions } from '@/components/navigation';

/**
 * Joyo AI has its own stack, with the history of chats at the bottom and the chat on top. Opening the chat from anywhere (More, a
 * header shortcut, a workout, a night, Coach) puts the history under it, so Back shows the history first and a second Back returns
 * to where the person came from (the tabs keep their own history, `backBehavior="history"` in `_layout.tsx`). The hardware back
 * button, the iOS swipe and the header arrow all take the same way.
 */
export const unstable_settings = { anchor: 'chats', initialRouteName: 'chats' };

export default function JoyoLayout() {
  const { t } = useTranslation('ai');
  return (
    <Stack screenOptions={useStackOptions()}>
      {/* The first screen of a hidden tab has no back button of its own. */}
      <Stack.Screen name="chats" options={{ title: t('chats.title'), headerLeft: () => <HeaderBackButton /> }} />
      {/* The chat draws its own header (title, history, new). */}
      <Stack.Screen name="chat" options={{ headerShown: false }} />
    </Stack>
  );
}
