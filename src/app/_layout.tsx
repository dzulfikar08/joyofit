import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Tabs } from 'expo-router';
import { BottomTabBar, type BottomTabBarProps } from 'expo-router/js-tabs';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, Text, useWindowDimensions, View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import { TabIcon } from '@/components/TabIcon';
import {
  TAB_LABEL_LINE,
  TAB_LABEL_MAX_SCALE,
  TAB_LABEL_MIN_SHRINK,
  TAB_LABEL_SIZE,
  tabBarHeight,
} from '@/components/tabBarMetrics';
import { initLocale, refreshAutoLocale } from '@/i18n/native';
import { DATABASE_NAME } from '@/db/appSchema';
import { BUSY_TIMEOUT_MS } from '@/db/migrations';
import { serializeQueries } from '@/db/serialize';
import { DatabaseGate } from '@/features/dbhealth/DatabaseGate';
import { DbHealthNotice } from '@/features/dbhealth/DbHealthNotice';
import { FamilyProvider } from '@/features/family/FamilyProvider';
import { BikeRideProvider } from '@/features/bikecomputer/BikeRideProvider';
import { lockPortrait } from '@/features/bikecomputer/ui/orientation';
import { LivePill } from '@/features/record/ui/LivePill';
import { UpdateBanner } from '@/features/updates/UpdateBanner';
import { UpdateGateProvider, useUpdateGate } from '@/features/updates/UpdateGateProvider';
import { LaunchUpdateScreen, UpdateRequiredScreen } from '@/features/updates/UpdateRequiredScreen';
import { DeleteSnackbar } from '@/features/workouts/ui/DeleteSnackbar';
import { CloudProvider } from '@/state/CloudProvider';
import { LiveWorkoutProvider } from '@/state/LiveWorkoutProvider';
import { OnboardingProvider } from '@/state/OnboardingProvider';
import { MealsProvider } from '@/state/MealsProvider';
import { RecorderProvider } from '@/state/RecorderProvider';
import { RideProvider } from '@/state/RideProvider';
import { ScaleProvider } from '@/state/ScaleProvider';
import { SensorsProvider } from '@/state/SensorsProvider';
import { StravaProvider } from '@/state/StravaProvider';
import { WatchProvider } from '@/state/WatchProvider';
import { ThemeProvider, useTheme } from '@/theme';

// Stored language choice (or the phone's) applies before the first screen is drawn.
initLocale();

/**
 * The schema is built before this handle opens (`DatabaseGate`, which repairs a damaged file first); from here on one query at a
 * time (see `serialize.ts`). The native writer opens the same file with the same SQLite library, so the two really do lock each
 * other: a statement waits for the other's transaction instead of failing with SQLITE_BUSY.
 */
async function initDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  serializeQueries(db);
}

// Hold the splash until the fonts and tab icons are ready, so the first frame is already typeset.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <ThemeProvider>
      <UpdateGateProvider>
        <RootNavigator />
      </UpdateGateProvider>
    </ThemeProvider>
  );
}

/** A tab's label. It reads the language itself: the navigator keeps the options it first got, so a label built from `t` in them would stay in the old language after a switch in Settings. */
function TabLabel({ name, color }: { name: 'today' | 'workouts' | 'social' | 'watch' | 'settings'; color: ColorValue }) {
  const { t } = useTranslation('common');
  const { fonts } = useTheme();
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={TAB_LABEL_MIN_SHRINK}
      maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE}
      style={{ color, fontFamily: fonts.medium, fontSize: TAB_LABEL_SIZE, lineHeight: TAB_LABEL_LINE }}>
      {t(`nav.${name}`)}
    </Text>
  );
}

/**
 * The tab bar with the way back into a running recording on top of it (`LivePill`); the pill is not drawn where the tab bar is hidden.
 * Its height is the content's (`tabBarMetrics`) plus the bottom inset, not the navigator's 49 + inset, which cut the labels.
 */
function TabBarWithLive(props: BottomTabBarProps) {
  const { fontScale } = useWindowDimensions();
  const focused = props.state.routes[props.state.index];
  const hidden = StyleSheet.flatten(props.descriptors[focused.key].options.tabBarStyle as StyleProp<ViewStyle>)?.display === 'none';
  return (
    <View>
      <LivePill tabBarHidden={hidden} />
      <BottomTabBar {...props} style={{ height: tabBarHeight(fontScale, props.insets.bottom) }} />
    </View>
  );
}

function RootNavigator() {
  const { colors, scheme } = useTheme();
  const { t } = useTranslation('common');
  const [fontsReady, fontError] = useFonts({
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    ...Ionicons.font,
    ...MaterialCommunityIcons.font,
  });
  const ready = fontsReady || fontError !== null;
  const { launch, decision, blockedAtLaunch } = useUpdateGate();

  // The phone language may change while the app sleeps; "Otomatis" follows it.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshAutoLocale();
    });
    return () => sub.remove();
  }, []);

  // app.json allows rotation so the bike computer screen can use landscape; everything else stays portrait.
  useEffect(() => {
    void lockPortrait();
  }, []);

  // The splash also covers the cold-start update gate (server minimum build, newer OTA bundle; at most ~8 s).
  const launched = ready && launch !== 'gate';
  useEffect(() => {
    if (launched) void SplashScreen.hideAsync().catch(() => {});
  }, [launched]);

  if (!launched) return null;
  // A blocked cold start never mounts the app (no database, no sync, no sensors); see docs/force-update.md.
  if (blockedAtLaunch && decision.kind === 'block') return <UpdateRequiredScreen cover={false} />;
  if (launch === 'ota') return <LaunchUpdateScreen />;

  return (
    <DatabaseGate>
    <Suspense fallback={null}>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={initDatabase} useSuspense>
        <WatchProvider>
          <CloudProvider>
            <StravaProvider>
              <SensorsProvider>
              <ScaleProvider>
              <RecorderProvider>
              <BikeRideProvider>
              <RideProvider>
              <MealsProvider>
                <LiveWorkoutProvider>
                  <OnboardingProvider>
                  <FamilyProvider>
                  <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
                  <View style={{ flex: 1 }}>
                  <Tabs
                    tabBar={(props) => <TabBarWithLive {...props} />}
                    screenOptions={{
                      headerShown: false,
                      sceneStyle: { backgroundColor: colors.background },
                      tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.hairline },
                      tabBarActiveTintColor: colors.primary,
                      tabBarInactiveTintColor: colors.mutedForeground,
                    }}>
                    <Tabs.Screen
                      name="index"
                      options={{
                        title: t('nav.today'),
                        tabBarLabel: ({ color }) => <TabLabel name="today" color={color} />,
                        tabBarIcon: ({ focused, color, size }) => (
                          <TabIcon on="today" off="today-outline" focused={focused} size={size} color={color} />
                        ),
                      }}
                    />
                    <Tabs.Screen
                      name="workouts"
                      options={{
                        title: t('nav.workouts'),
                        tabBarLabel: ({ color }) => <TabLabel name="workouts" color={color} />,
                        tabBarIcon: ({ focused, color, size }) => (
                          <TabIcon on="fitness" off="fitness-outline" focused={focused} size={size} color={color} />
                        ),
                      }}
                    />
                    <Tabs.Screen
                      name="social"
                      options={{
                        title: t('nav.social'),
                        tabBarLabel: ({ color }) => <TabLabel name="social" color={color} />,
                        tabBarIcon: ({ focused, color, size }) => (
                          <TabIcon on="people" off="people-outline" focused={focused} size={size} color={color} />
                        ),
                      }}
                    />
                    <Tabs.Screen
                      name="watch"
                      options={{
                        title: t('nav.watch'),
                        tabBarLabel: ({ color }) => <TabLabel name="watch" color={color} />,
                        tabBarIcon: ({ focused, color, size }) => (
                          <TabIcon on="watch" off="watch-outline" focused={focused} size={size} color={color} />
                        ),
                      }}
                    />
                    <Tabs.Screen
                      name="settings"
                      options={{
                        title: t('nav.settings'),
                        tabBarLabel: ({ color }) => <TabLabel name="settings" color={color} />,
                        tabBarIcon: ({ focused, color, size }) => (
                          <TabIcon on="settings" off="settings-outline" focused={focused} size={size} color={color} />
                        ),
                      }}
                    />
                    {/* Old deep links; each redirects to where the screen lives now. */}
                    <Tabs.Screen name="today" options={{ href: null }} />
                    <Tabs.Screen name="log" options={{ href: null }} />
                    <Tabs.Screen name="alarms" options={{ href: null }} />
                    <Tabs.Screen name="watchfaces" options={{ href: null }} />
                    {/* Pushed from Today (or Settings, for hrv); each draws its own header (HiddenTabHeader). */}
                    <Tabs.Screen name="health" options={{ href: null }} />
                    <Tabs.Screen name="hrv" options={{ href: null }} />
                    <Tabs.Screen name="sleep" options={{ href: null }} />
                    <Tabs.Screen name="readiness" options={{ href: null }} />
                    <Tabs.Screen name="trends" options={{ href: null }} />
                    <Tabs.Screen name="fitness" options={{ href: null }} />
                    {/* Opens by itself when a workout starts on the watch (LiveWorkoutProvider). */}
                    <Tabs.Screen name="workout-live" options={{ href: null }} />
                    {/* Family monitoring: opened from Today, Settings and notifications; its stack draws its own headers. */}
                    <Tabs.Screen name="family" options={{ href: null }} />
                    {/* Watch routes: opened from the Watch tab and by shared GPX/TCX files; its stack draws its own headers. */}
                    <Tabs.Screen name="routes" options={{ href: null }} />
                    {/* Coach (Pro): plan, session details and setup; its stack draws its own headers. */}
                    <Tabs.Screen name="coach" options={{ href: null }} />
                    {/* "Main di web": the phone as the sensor bridge of the browser game; its stack draws its own headers. */}
                    <Tabs.Screen name="ride" options={{ href: null }} />
                    {/* Strength logger (workout, routines, history); its stack draws its own headers. */}
                    <Tabs.Screen name="strength" options={{ href: null }} />
                    {/* The setup guide: opened by OnboardingProvider on a first run and from Settings; full screen, no tab bar. */}
                    <Tabs.Screen name="onboarding" options={{ href: null, tabBarStyle: { display: 'none' } }} />
                    {/* Where a link to a screen this version lacks lands (+not-found.tsx); not a tab. */}
                    <Tabs.Screen name="+not-found" options={{ href: null }} />
                  </Tabs>
                  {/* Android installs from Google Play only: flexible in-app update. */}
                  <UpdateBanner />
                  {/* A block found when the app returns to the foreground covers the running app instead of unmounting it. */}
                  <UpdateRequiredScreen cover />
                  <DeleteSnackbar />
                  <DbHealthNotice />
                  </View>
                  </FamilyProvider>
                  </OnboardingProvider>
                </LiveWorkoutProvider>
              </MealsProvider>
              </RideProvider>
              </BikeRideProvider>
              </RecorderProvider>
              </ScaleProvider>
              </SensorsProvider>
            </StravaProvider>
          </CloudProvider>
        </WatchProvider>
      </SQLiteProvider>
    </Suspense>
    </DatabaseGate>
  );
}
