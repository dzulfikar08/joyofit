import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FadeIn } from '@/components/motion';
import { currentStep, firstSyncStarts, footerFor, progress, type StepId } from '@/features/onboarding/flow';
import { FirstSyncLine } from '@/features/onboarding/FirstSyncLine';
import { StepProgress } from '@/features/onboarding/StepProgress';
import { CloudStep } from '@/features/onboarding/steps/CloudStep';
import { AccountStep } from '@/features/onboarding/steps/AccountStep';
import { DoneStep } from '@/features/onboarding/steps/DoneStep';
import { PairStep } from '@/features/onboarding/steps/PairStep';
import { PhoneStep } from '@/features/onboarding/steps/PhoneStep';
import { BackgroundStep, HealthStep, NotificationsStep, WeatherStep } from '@/features/onboarding/steps/PermissionSteps';
import { ProStep } from '@/features/onboarding/steps/ProStep';
import { UnbindStep } from '@/features/onboarding/steps/UnbindStep';
import { WelcomeStep } from '@/features/onboarding/steps/WelcomeStep';
import { useFirstSync } from '@/features/onboarding/useFirstSync';
import { useCloud } from '@/state/CloudProvider';
import { useOnboarding } from '@/state/OnboardingProvider';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';

const BODIES: Record<StepId, () => ReactElement> = {
  welcome: () => <WelcomeStep />,
  phone: () => <PhoneStep />,
  unbind: () => <UnbindStep />,
  pair: () => <PairStep />,
  notifications: () => <NotificationsStep />,
  health: () => <HealthStep />,
  weather: () => <WeatherStep />,
  background: () => <BackgroundStep />,
  account: () => <AccountStep />,
  pro: () => <ProStep />,
  cloud: () => <CloudStep />,
  done: () => <DoneStep />,
};

/**
 * The first-run setup guide: one step at a time, a progress bar on top, and Back, Later and Continue underneath. What each step shows
 * is the same section Settings or the Watch tab shows; this screen only sequences them (see `flow.ts` for the order and the rules).
 * It also owns the first history pull, which runs in the background from pairing on and shows as one line under the progress bar.
 */
export function OnboardingScreen() {
  const { t } = useTranslation('common');
  const guide = useOnboarding();
  const watch = useWatch();
  const cloud = useCloud();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, ctx } = guide;
  // Scrolled content ends in a hard edge under the progress bar; a hairline there says it continues above.
  const [scrolledStep, setScrolledStep] = useState<StepId | null>(null);
  const firstSync = useFirstSync(state ? firstSyncStarts(state, ctx) : false);

  // Finished or left: go to Today. A run opened from Settings arrives here already active.
  const status = state?.status;
  useEffect(() => {
    if (status && status !== 'active') router.navigate('/');
  }, [status, router]);

  if (!state || state.status !== 'active') return null;

  const step = currentStep(state, ctx);
  const scrolled = scrolledStep === step;
  const { index, total } = progress(state, ctx);
  const footer = footerFor(step, { linkState: watch.linkState, signedIn: cloud.signedIn });
  const hasButtons = footer.primary !== null || footer.skip !== null || footer.back;

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + spacing.sm }]}>
      <View style={[styles.progress, scrolled && { borderBottomColor: colors.hairline, borderBottomWidth: StyleSheet.hairlineWidth }]}>
        <StepProgress index={index} total={total} />
        <FirstSyncLine sync={firstSync} />
      </View>
      <ScrollView
        key={step}
        onScroll={(event) => setScrolledStep(event.nativeEvent.contentOffset.y > 2 ? step : null)}
        scrollEventThrottle={64}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <FadeIn style={styles.body} distance={10}>
          {BODIES[step]()}
        </FadeIn>
      </ScrollView>
      {hasButtons ? (
        <View style={[styles.footer, { borderTopColor: colors.hairline, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {footer.primary ? (
            <Button label={footer.primary} variant="primary" disabled={footer.primaryDisabled} onPress={guide.next} />
          ) : null}
          {footer.back || footer.skip ? (
            <View style={styles.secondary}>
              {footer.back ? <Button label={t('actions.back')} variant="ghost" icon="chevron-back" onPress={guide.back} style={styles.cell} /> : <View style={styles.cell} />}
              {footer.skip ? (
                <Button label={footer.skip} variant="ghost" onPress={step === 'welcome' ? guide.dismissGuide : guide.skipStep} style={styles.cell} />
              ) : (
                <View style={styles.cell} />
              )}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  progress: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  body: { gap: spacing.lg },
  footer: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  secondary: { flexDirection: 'row', gap: spacing.sm },
  cell: { flex: 1 },
});
