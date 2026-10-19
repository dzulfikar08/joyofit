import { useRouter, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet, View } from 'react-native';

import { authClient } from '@/cloud/auth';
import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { BrandMark } from '@/components/BrandMark';
import { IconChip, type IconName } from '@/components/IconChip';
import { isIos } from '@/components/IosUnavailable';
import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { PageHeader, useContentPadding } from '@/components/Screen';
import { showsWatchUi } from '@/features/device/presence';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { useAccountDialogs } from '@/features/settings/useAccountDialogs';
import { t as tOther } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { useOnboarding } from '@/state/OnboardingProvider';
import { useStrava } from '@/state/StravaProvider';
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
  const strava = useStrava();
  const presence = useWatchPresence();
  const user = authClient.useSession().data?.user;
  const { askSignOut, askDelete, dialogs } = useAccountDialogs();

  // Until the database has been read (null) the watch rows stay, so the list does not jump when it answers.
  const withWatch = presence === null || showsWatchUi(presence);
  const go = (href: Href) => () => router.push(href);

  const watchGroup: HubGroup = {
    title: t('hub.groups.watch'),
    data: withWatch
      ? [
          { key: 'sync', title: t('screens.sync'), icon: 'sync', onPress: go('/settings/sync') },
          { key: 'notifications', title: t('screens.notifications'), icon: 'notifications', onPress: go('/settings/notifications') },
          { key: 'weather', title: t('screens.weather'), icon: 'partly-sunny', onPress: go('/settings/weather') },
          { key: 'safety', title: t('screens.safety'), icon: 'shield-checkmark', tint: 'heart', onPress: go('/settings/safety') },
          { key: 'meals', title: t('screens.meals'), icon: 'restaurant', onPress: go('/settings/meals') },
        ]
      : [
          {
            key: 'connect-watch',
            title: t('hub.connectWatch.title'),
            subtitle: t('hub.connectWatch.subtitle'),
            icon: 'watch',
            onPress: go('/watch'),
          },
        ],
  };

  const bodyGroup: HubGroup = {
    title: t('hub.groups.body'),
    data: [
      { key: 'profile', title: t('screens.profile'), icon: 'person', onPress: go('/settings/profile') },
      { key: 'scale', title: t('screens.scale'), icon: 'scale-outline', onPress: go('/settings/scale') },
      { key: 'cycling', title: tOther('cycling:settings.title'), icon: 'bicycle', onPress: go('/settings/cycling') },
      ...(withWatch ? [{ key: 'goals', title: t('screens.goals'), icon: 'flag' as const, onPress: go('/settings/goals') }] : []),
      { key: 'cycle', title: t('screens.cycle'), icon: 'calendar', tint: 'heart', onPress: go('/settings/cycle') },
      { key: 'gear', title: t('screens.gear'), icon: 'footsteps', tint: 'workouts', onPress: go('/settings/gear') },
    ],
  };

  const connectionsGroup: HubGroup = {
    title: t('hub.groups.connections'),
    data: [
      {
        key: 'strava',
        title: 'Strava', // i18n-ok: product name
        value: strava.settings.connectedAt !== null ? t('hub.connected') : undefined,
        leading: <BrandMark brand="strava" />,
        onPress: go('/settings/strava'),
      },
      ...(withWatch
        ? [
            {
              key: 'health',
              title: isIos ? t('screens.healthIos') : t('screens.health'),
              leading: <BrandMark brand={isIos ? 'apple-health' : 'health-connect'} />,
              onPress: go('/settings/health'),
            },
          ]
        : []),
      { key: 'joyorogo', title: t('screens.joyorogo'), icon: 'restaurant', tint: 'link', onPress: go('/settings/joyorogo') },
      { key: 'koneksi', title: t('screens.koneksi'), icon: 'sparkles', tint: 'link', onPress: go('/settings/koneksi') },
      { key: 'family', title: tOther('family:title.family'), icon: 'people', tint: 'link', onPress: go('/family') },
      { key: 'import', title: t('screens.importAll'), icon: 'cloud-download', tint: 'heart', onPress: go('/settings/import') },
    ],
  };

  const appGroup: HubGroup = {
    title: t('hub.groups.app'),
    data: [
      { key: 'appearance', title: t('screens.appearance'), icon: 'color-palette', onPress: go('/settings/appearance') },
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

  const groups = [watchGroup, bodyGroup, connectionsGroup, appGroup, ...(cloud.signedIn ? [accountGroup] : [])];

  // Pro is known once a sync or the cloud status has answered; before that the line only says whose account it is.
  const { pro } = cloud;
  const accountLine = !cloud.signedIn
    ? t('hub.account.signedOutHint')
    : pro === null
      ? t('hub.account.signedIn')
      : pro
        ? t('hub.account.pro')
        : t('hub.account.free');

  return (
    <SectionList
      sections={groups}
      keyExtractor={(row) => row.key}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={padding}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <>
          <PageHeader title={t('index.title')} />
          <NavRow
            leading={
              cloud.signedIn ? <Avatar name={user?.name?.trim() || cloud.email || ''} image={user?.image} size="xl" /> : <IconChip icon="person" size="lg" />
            }
            title={cloud.signedIn ? (cloud.email ?? t('hub.account.signedIn')) : t('hub.account.signedOut')}
            subtitle={accountLine}
            value={pro ? t('hub.account.valuePro') : undefined}
            onPress={go('/settings/akun')}
            style={{ ...groupedRowStyle(theme, 0, 1), ...styles.summary }}
          />
        </>
      }
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
  summary: { marginTop: spacing.md },
});
