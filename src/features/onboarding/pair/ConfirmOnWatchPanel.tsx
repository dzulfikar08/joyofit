import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { isIos } from '@/components/IosUnavailable';
import { EASE_OUT, FadeIn } from '@/components/motion';
import { Card } from '@/components/Screen';
import { linkLabel } from '@/features/device/linkState';
import { WatchGlyph } from '@/features/onboarding/pair/WatchGlyph';
import { CONFIRM_HELP_AFTER_S } from '@/features/onboarding/pairing';
import { Bullet } from '@/features/onboarding/StepIntro';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { fmtInt } from '@/i18n';
import { radius, spacing, useColors } from '@/theme';
import type { LinkState } from '@/wear';

interface ConfirmOnWatchPanelProps {
  /** What the watch is called on its card. */
  name: string;
  linkState: LinkState;
  /** Gives up the connect; offered while it is still `connecting`, as the Watch tab's row does. */
  onCancel: () => void;
}

/**
 * The full-width "confirm on your watch" panel while the link is set up (connecting, authenticating, initializing), in place of the
 * scan, as Huawei Health's pairing guide does: the watch with the tick to tap, the seconds waited, and after `CONFIRM_HELP_AFTER_S`
 * what to check when nothing shows on the watch. Mounted for exactly those states, so the count starts with the connect.
 */
export function ConfirmOnWatchPanel({ name, linkState, onCancel }: ConfirmOnWatchPanelProps) {
  const { t } = useTranslation(['onboarding', 'common']);
  const colors = useColors();
  const [startedAt] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <Card style={styles.card}>
      <View style={styles.hero}>
        <WatchGlyph size={120} highlighted badge={<TickBadge />} />
        <AppText variant="title" style={styles.centered} accessibilityRole="header">
          {t('pair.confirm.title')}
        </AppText>
        <AppText variant="body" muted style={styles.centered}>
          {t('pair.confirm.body', { name })}
        </AppText>
        <AppText variant="caption" muted style={styles.centered}>
          {isIos ? t('pair.keepAwakeIos') : t('pair.keepAwake')}
        </AppText>
        <View style={[styles.status, { backgroundColor: colors.muted }]} accessibilityLiveRegion="polite">
          <AppText variant="label">{linkLabel(linkState)}</AppText>
          <AppText variant="label" muted style={styles.tabular}>
            {t('pair.confirm.elapsed', { seconds: fmtInt(seconds) })}
          </AppText>
        </View>
      </View>
      {seconds >= CONFIRM_HELP_AFTER_S ? (
        <FadeIn style={styles.help}>
          <AppText variant="heading">{t('pair.confirm.helpTitle')}</AppText>
          <Bullet label="1">{t('pair.confirm.helpAwake')}</Bullet>
          <Bullet label="2">{t('pair.confirm.helpNear')}</Bullet>
          <Bullet label="3">{t('pair.confirm.helpUnpaired')}</Bullet>
          {isIos ? <Bullet label="4">{t('pair.confirm.helpIos')}</Bullet> : null}
        </FadeIn>
      ) : null}
      {linkState === 'connecting' ? <Button label={t('common:actions.cancel')} variant="ghost" onPress={onCancel} /> : null}
    </Card>
  );
}

/** The tick on the watch's corner; it pulses gently so the eye goes to it (still under reduced motion). */
function TickBadge() {
  const colors = useColors();
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 500, easing: EASE_OUT, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 700, easing: EASE_OUT, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, scale]);

  return (
    <Animated.View style={[styles.tick, { backgroundColor: colors.link, borderColor: colors.card, transform: [{ scale }] }]}>
      <Ionicons name="checkmark" size={22} color={colors.primaryForeground} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.lg },
  hero: { alignItems: 'center', gap: spacing.sm },
  centered: { textAlign: 'center' },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, marginTop: spacing.xs },
  tabular: { fontVariant: ['tabular-nums'] },
  help: { gap: spacing.sm },
  tick: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
});
