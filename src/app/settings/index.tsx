import { useRouter, type Href } from 'expo-router';

import { activeWatchName } from '@/features/device/watchName';
import { shownName } from '@/features/device/shownName';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet, View } from 'react-native';

import { authClient } from '@/cloud/auth';
import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { IconChip, type IconName } from '@/components/IconChip';
import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { PageHeader, useContentPadding } from '@/components/Screen';
import { showsWatchUi } from '@/features/device/presence';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { linkLabel } from '@/features/device/linkState';
import { HEALTH_STORE } from '@/features/sources/store';
import { useAccountDialogs } from '@/features/settings/useAccountDialogs';
import { useByokAccess } from '@/features/ai/hooks';
import { joyoAiDestination, OPEN_JOYO_AI } from '@/features/ai/open';
import { hubStatusLine } from '@/features/ai/ui/status';
import { useCoachAccess } from '@/features/coach/useCoachAccess';
import { t as tOther } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { useOnboarding } from '@/state/OnboardingProvider';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useTheme, type Tint } from '@/theme';

interface HubRow {
  key: string;
  title: string;
  subtitle?: string;
  value?: string;
  /** Own features get a round icon chip; third parties get their real mark. */
  icon?: IconName;
  tint?: Tint;
  leading?: ReactNode;
  destructive?: boolean;
  onPress: () => void;
}

interface HubGroup {
  /** The destructive group has none. */
  title?: string;
  data: readonly HubRow[];
}

export default function SettingsScreen() {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const { colors } = theme;
  const router = useRouter();
  const padding = useContentPadding(true);
  const guide = useOnboarding();
  const cloud = useCloud();
  const { t: ta } = useTranslation('ai');
  const ai = useByokAccess();
  const coachAccess = useCoachAccess();
  const presence = useWatchPresence();
  const { device, linkState, watches } = useWatch();
  const user = authClient.useSession().data?.user;
  const { askSignOut, askDelete, dialogs } = useAccountDialogs();

  // Until the database has been read (null) the watch rows stay, so the list does not jump when it answers.
  const withWatch = presence === null || showsWatchUi(presence);
  const go = (href: Href) => () => router.push(href);

  // One row into the Watch hub (connected card, faces, alarms, routes live there); its subtitle is the watch's name and link state.
  const watchGroup: HubGroup = {
    data: [
      {
        key: 'watch',
        title: t('hub.groups.watch'),
        subtitle: device ? `${shownName(activeWatchName(device, watches))} · ${linkLabel(linkState)}` : t('hub.watchRow.none'),
        icon: 'watch',
        onPress: go('/watch'),
      },
    ],
  };

  const watchSettingsGroup: HubGroup = {
    title: t('hub.groups.watchSettings'),
    data: withWatch
      ? [
          { key: 'sync', title: t('screens.sync'), icon: 'sync', onPress: go('/settings/sync') },
          { key: 'notifications', title: t('screens.notifications'), icon: 'notifications', onPress: go('/settings/notifications') },
          { key: 'weather', title: t('screens.weather'), icon: 'partly-sunny', onPress: go('/settings/weather') },
          { key: 'safety', title: t('screens.safety'), icon: 'shield-checkmark', tint: 'heart', onPress: go('/settings/safety') },
          { key: 'meals', title: t('screens.meals'), icon: 'restaurant', onPress: go('/settings/meals') },
        ]
      : [],
  };

  // Coach (plans, library) and Joyo AI (the chat; its settings are one tap away in the chat) sit right under the account.
  const coachGroup: HubGroup = {
    title: t('hub.groups.coach'),
    data: [
      { key: 'coach', title: t('screens.coach'), subtitle: t('hub.coach'), icon: 'flash', tint: 'workouts', onPress: go('/coach') },
      {
        key: 'joyo-ai',
        title: t('screens.joyoAi'),
        subtitle: hubStatusLine({ settings: ai.settings, access: ai.access, coachAccess }, ta),
        icon: 'chatbubbles',
        tint: 'link',
        onPress: () => router.navigate(joyoAiDestination({ settings: ai.settings, access: ai.access, coachAccess }), OPEN_JOYO_AI),
      },
    ],
  };

  const bodyGroup: HubGroup = {
    title: t('hub.groups.body'),
    data: [
      { key: 'profile', title: t('screens.profile'), icon: 'person', onPress: go('/settings/profile') },
      { key: 'scale', title: t('screens.scale'), icon: 'scale-outline', onPress: go('/settings/scale') },
      { key: 'thermometer', title: t('screens.thermometer'), icon: 'thermometer-outline', onPress: go('/settings/thermometer') },
      { key: 'cycling', title: tOther('cycling:settings.title'), icon: 'bicycle', onPress: go('/settings/cycling') },
      { key: 'hr-zones', title: t('screens.hrZones'), icon: 'pulse', tint: 'heart', onPress: go('/settings/hr-zones') },
      ...(withWatch ? [{ key: 'goals', title: t('screens.goals'), icon: 'flag' as const, onPress: go('/settings/goals') }] : []),
      { key: 'cycle', title: t('screens.cycle'), icon: 'calendar', tint: 'heart', onPress: go('/settings/cycle') },
      { key: 'gear', title: t('screens.gear'), icon: 'footsteps', tint: 'workouts', onPress: go('/settings/gear') },
    ],
  };

  // One row for the sources (watch, health store, Strava, JoyoRogo, scale) with their status; the deep screens open from there.
  const connectionsGroup: HubGroup = {
    title: t('hub.groups.connections'),
    data: [
      {
        key: 'sources',
        title: t('sources.title'),
        subtitle: t('sources.entrySubtitle', { store: HEALTH_STORE }),
        icon: 'swap-horizontal',
        tint: 'link',
        onPress: go('/settings/sources'),
      },
      { key: 'koneksi', title: t('screens.koneksi'), subtitle: t('hub.koneksi'), icon: 'link', tint: 'link', onPress: go('/settings/koneksi') },
      { key: 'family', title: tOther('family:title.family'), icon: 'people', tint: 'link', onPress: go('/family') },
      { key: 'import', title: t('screens.importAll'), icon: 'cloud-download', tint: 'heart', onPress: go('/settings/import') },
    ],
  };

  const appGroup: HubGroup = {
    title: t('hub.groups.app'),
    data: [
      { key: 'appearance', title: t('screens.appearance'), icon: 'color-palette', onPress: go('/settings/appearance') },
      ...(withWatch
        ? [{ key: 'home-cards', title: t('screens.homeCards'), icon: 'albums' as const, onPress: go('/home-cards') }]
        : []),
      { key: 'guide', title: t('index.rows.guide.title'), icon: 'compass', onPress: () => guide.open() },
      { key: 'advanced', title: t('screens.advanced'), icon: 'information-circle', onPress: go('/settings/advanced') },
    ],
  };

  const accountGroup: HubGroup = {
    data: [
      { key: 'sign-out', title: t('cloud.signOut'), icon: 'log-out-outline', destructive: true, onPress: askSignOut },
      { key: 'delete-account', title: t('cloud.deleteAccount'), icon: 'trash-outline', destructive: true, onPress: askDelete },
    ],
  };

  // Pro is known once a sync or the cloud status has answered; before that the line only says whose account it is.
  const { pro } = cloud;
  const accountLine = !cloud.signedIn
    ? t('hub.account.signedOutHint')
    : pro === null
      ? t('hub.account.signedIn')
      : pro
        ? t('hub.account.pro')
        : t('hub.account.free');

  const accountSummaryGroup: HubGroup = {
    data: [
      {
        key: 'account',
        title: cloud.signedIn ? (cloud.email ?? t('hub.account.signedIn')) : t('hub.account.signedOut'),
        subtitle: accountLine,
        value: pro ? t('hub.account.valuePro') : undefined,
        leading: cloud.signedIn ? (
          <Avatar name={user?.name?.trim() || cloud.email || ''} image={user?.image} size="xl" />
        ) : (
          <IconChip icon="person" size="lg" />
        ),
        onPress: go('/settings/akun'),
      },
    ],
  };

  // Account on top, then goals and body, then the one Watch row, then the settings.
  const groups = [
    accountSummaryGroup,
    coachGroup,
    bodyGroup,
    watchGroup,
    watchSettingsGroup,
    connectionsGroup,
    appGroup,
    ...(cloud.signedIn ? [accountGroup] : []),
  ].filter((group) => group.data.length > 0);

  return (
    <SectionList
      sections={groups}
      keyExtractor={(row) => row.key}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={padding}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={<PageHeader title={t('index.title')} />}
      ListFooterComponent={<>{dialogs}</>}
      renderSectionHeader={({ section }) =>
        section.title ? (
          <AppText variant="heading" accessibilityRole="header" style={styles.groupTitle}>
            {section.title}
          </AppText>
        ) : (
          <View style={styles.groupGap} />
        )
      }
      renderItem={({ item, index, section }) => (
        <NavRow
          icon={item.icon}
          tint={item.tint}
          leading={item.leading}
          destructive={item.destructive}
          title={item.title}
          subtitle={item.subtitle}
          value={item.value}
          onPress={item.onPress}
          style={groupedRowStyle(theme, index, section.data.length)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  groupTitle: { paddingTop: spacing.lg, paddingBottom: spacing.sm },
  groupGap: { height: spacing.lg },
});
