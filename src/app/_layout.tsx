import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { Tabs } from 'expo-router';
import { getFocusedRouteNameFromRoute } from 'expo-router/react-navigation';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, Text, View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import { FloatingTabBar } from '@/components/FloatingTabBar';
import { isTabRoot } from '@/components/tabBarRoutes';
import { TabBarInsetProvider, useReportTabBarInset } from '@/components/tabBarInset';
import { TabIcon } from '@/components/TabIcon';
import { TAB_LABEL_LINE, TAB_LABEL_MAX_SCALE, TAB_LABEL_MIN_SHRINK, TAB_LABEL_SIZE } from '@/components/tabBarMetrics';
import { initLocale, refreshAutoLocale } from '@/i18n/native';
import { DATABASE_NAME } from '@/db/appSchema';
import { BUSY_TIMEOUT_MS } from '@/db/migrations';
import { serializeQueries } from '@/db/serialize';
import { DatabaseGate } from '@/features/dbhealth/DatabaseGate';
import { DbHealthNotice } from '@/features/dbhealth/DbHealthNotice';
import { FamilyProvider } from '@/features/family/FamilyProvider';
import { syncHrZonesAtLaunch } from '@/features/hrzones/settings';
import { BikeRideProvider } from '@/features/bikecomputer/BikeRideProvider';
import { lockPortrait } from '@/features/bikecomputer/ui/orientation';
import { flushSupportReports } from '@/features/device/aturReports';
import { LiveExtrasFeed } from '@/features/live/liveExtras';
import { LivePill } from '@/features/record/ui/LivePill';
import { useHydrateWeightUnit } from '@/features/strength/useWeightUnit';
import { RoomCaptureRunner } from '@/features/thermometer/RoomCaptureRunner';
import { UpdateBanner } from '@/features/updates/UpdateBanner';
import { UpdateGateProvider, useUpdateGate } from '@/features/updates/UpdateGateProvider';
import { LaunchUpdateScreen, UpdateRequiredScreen } from '@/features/updates/UpdateRequiredScreen';
import { StartWorkoutProvider, useStartWorkout } from '@/features/workouts/StartWorkoutProvider';
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
import { themeFontMap } from '@/theme/fonts';
import { NavigationTheme } from '@/theme/NavigationTheme';
import { ThemeProvider, useTheme } from '@/theme';

// Stored language choice (or the phone's) applies before the first screen is drawn.
initLocale();
// Heart-rate zones the person set reach the native module (and a connected watch) once per launch.
syncHrZonesAtLaunch();

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
      <NavigationTheme>
        <UpdateGateProvider>
          <RootNavigator />
        </UpdateGateProvider>
      </NavigationTheme>
    </ThemeProvider>
  );
}

/** Puts the saved lift unit (kg or lb) into the strength formatters once the database is open. */
function WeightUnitSync() {
  useHydrateWeightUnit();
  return null;
}

/** A tab's label. It reads the language itself: the navigator keeps the options it first got, so a label built from `t` in them would stay in the old language after a switch in Settings. */
function TabLabel({ name, color }: { name: 'today' | 'workouts' | 'social' | 'more'; color: ColorValue }) {
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
 * The floating tab bar with the way back into a running recording on top of it (`LivePill`); the pill is not drawn where the tab bar is
 * hidden. Both float over the screens (absolute, no solid strip): content scrolls underneath. The height they really cover is measured
 * and published (`tabBarInset`), and every scrolling screen pads the end of its content by it. 0 where nothing is drawn.
 */
function TabBarWithLive(props: BottomTabBarProps) {
  const { t } = useTranslation('common');
  const { open } = useStartWorkout();
  const focused = props.state.routes[props.state.index];
  const hiddenByRoute = StyleSheet.flatten(props.descriptors[focused.key].options.tabBarStyle as StyleProp<ViewStyle>)?.display === 'none';
  // The bar is for the roots of the tabs only; anything pushed on a tab's stack is a detail screen without it.
  const hidden = hiddenByRoute || !isTabRoot(focused.name, getFocusedRouteNameFromRoute(focused));
  const report = useReportTabBarInset();
  useEffect(() => () => report(0), [report]);
  useEffect(() => {
    if (hidden) report(0);
  }, [hidden, report]);
  if (hidden) return null;
  return (
    <View pointerEvents="box-none" style={styles.floating} onLayout={(event) => report(Math.ceil(event.nativeEvent.layout.height))}>
      <LivePill tabBarHidden={hidden} />
      <FloatingTabBar {...props} center={{ label: t('nav.start'), onPress: open }} />
    </View>
  );
}

function RootNavigator() {
  const { theme, colors, scheme } = useTheme();
  const { t } = useTranslation('common');
  // Only the active theme's families (4 to 6 files): the theme is fixed for the life of the JS app (a change restarts it), so
  // this map never changes, and the picker registers the others when it opens.
  const [fontsReady, fontError] = useFonts({
    ...themeFontMap(theme),
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

  // Reports sent while the phone was offline go out at launch and whenever the app comes back.
  useEffect(() => {
    void flushSupportReports();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flushSupportReports();
    });
    return () => sub.remove();
  }, []);

  // app.json allows rotation so the bike computer screen can use landscape; everything else stays portrait.
  useEffect(() => {
    void lockPortrait();
  }, []);

  // The splash also covers the cold-start update gate (server minimum build, newer OTA bundle; at most ~8 s).
  const launched = ready && launch !== 'gate';
  // The root view color is set before the splash goes away, so the first frame and the bars behind it are already the theme's.
  useEffect(() => {
    if (!launched) return;
    SystemUI.setBackgroundColorAsync(colors.background)
      .catch(() => undefined)
      .then(() => SplashScreen.hideAsync())
      .catch(() => undefined);
    // Once, at launch: later changes of the color are the ThemeProvider's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                  {/* The bedroom thermometer's readings (foreground scan, overnight file); idle without a paired thermometer. */}
                  <RoomCaptureRunner />
                  <WeightUnitSync />
                  {/* A watch-started workout's average and highest heart rate, and the phone's step counter while it runs on foot. */}
                  <LiveExtrasFeed />
                  <TabBarInsetProvider>
                  <StartWorkoutProvider>
                  <View style={{ flex: 1 }}>
                  <Tabs
                    // Back from a screen opened out of More (the Watch hub) returns to the tab it came from, not always to Today.
                    backBehavior="history"
                    tabBar={(props) => <TabBarWithLive {...props} />}
                    screenOptions={{
                      headerShown: false,
                      sceneStyle: { backgroundColor: colors.background },
                      // FloatingTabBar draws the bar from the theme; `tabBarStyle: { display: 'none' }` on a route hides it.
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
                    {/* More: the Settings stack (its index lists the Watch section first, then the settings), so /settings and every /settings/* link keep working. */}
                    <Tabs.Screen
                      name="settings"
                      options={{
                        title: t('nav.more'),
                        tabBarLabel: ({ color }) => <TabLabel name="more" color={color} />,
                        tabBarIcon: ({ focused, color, size }) => (
                          <TabIcon on="ellipsis-horizontal-circle" off="ellipsis-horizontal-circle-outline" focused={focused} size={size} color={color} />
                        ),
                      }}
                    />
                    {/* The Watch hub: opened from More; the bar keeps More marked while it is on screen (tabBarRoutes). `/watch` and `/watch/*` links still land here. */}
                    <Tabs.Screen name="watch" options={{ href: null }} />
                    {/* Old deep links; each redirects to where the screen lives now. */}
                    <Tabs.Screen name="today" options={{ href: null }} />
                    <Tabs.Screen name="log" options={{ href: null }} />
                    <Tabs.Screen name="alarms" options={{ href: null }} />
                    <Tabs.Screen name="watchfaces" options={{ href: null }} />
                    {/* Pushed from Today (or Settings, for hrv); each draws its own header (HiddenTabHeader). */}
                    <Tabs.Screen name="health" options={{ href: null }} />
                    <Tabs.Screen name="hrv" options={{ href: null }} />
                    <Tabs.Screen name="heart" options={{ href: null }} />
                    <Tabs.Screen name="home-cards" options={{ href: null }} />
                    <Tabs.Screen name="sleep" options={{ href: null }} />
                    <Tabs.Screen name="readiness" options={{ href: null }} />
                    <Tabs.Screen name="trends" options={{ href: null }} />
                    <Tabs.Screen name="fitness" options={{ href: null }} />
                    <Tabs.Screen name="lactate-test" options={{ href: null }} />
                    <Tabs.Screen name="steps" options={{ href: null }} />
                    {/* Opens by itself when a workout starts on the watch (LiveWorkoutProvider). */}
                    <Tabs.Screen name="workout-live" options={{ href: null, tabBarStyle: { display: 'none' } }} />
                    {/* Family monitoring: opened from Today, More and notifications; its stack draws its own headers. */}
                    <Tabs.Screen name="family" options={{ href: null }} />
                    {/* Watch routes: opened from More (Watch section) and by shared GPX/TCX files; its stack draws its own headers. */}
                    <Tabs.Screen name="routes" options={{ href: null }} />
                    {/* Coach (Pro): plan, session details and setup; its stack draws its own headers. */}
                    <Tabs.Screen name="coach" options={{ href: null }} />
                    {/* Joyo AI: the history of chats with the chat on top of it, so Back from a chat shows the history first; its own stack so the Coach screen is never underneath. */}
                    <Tabs.Screen name="joyo" options={{ href: null }} />
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
                  </StartWorkoutProvider>
                  </TabBarInsetProvider>
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

const styles = StyleSheet.create({
  floating: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
