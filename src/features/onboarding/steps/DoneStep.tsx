import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { isIos } from '@/components/IosUnavailable';
import { FadeIn } from '@/components/motion';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { openSteps, type StepId } from '@/features/onboarding/flow';
import { StepIntro } from '@/features/onboarding/StepIntro';
import { useOnboarding } from '@/state/OnboardingProvider';
import { spacing, type Tint } from '@/theme';

const HEALTH_STORE = isIos ? 'Apple Health' : 'Health Connect'; // i18n-ok: platform brand names

const WHERE_IDS = ['unbind', 'pair', 'notifications', 'health', 'weather', 'background', 'account', 'cloud'] as const;
type WhereId = (typeof WHERE_IDS)[number];
const isWhereId = (id: StepId): id is WhereId => (WHERE_IDS as readonly string[]).includes(id);

interface Tip {
  icon: IconName;
  tint?: Tint | 'neutral';
  id: 'today' | 'workouts' | 'strava' | 'findWatch' | 'strength' | 'coach' | 'library' | 'watchLater';
}

const TIPS: readonly Tip[] = [
  { icon: 'today', tint: 'steps', id: 'today' },
  { icon: 'fitness', tint: 'workouts', id: 'workouts' },
  { icon: 'fitness', tint: 'workouts', id: 'strava' },
  { icon: 'watch', tint: 'link', id: 'findWatch' },
];

/** The no-watch route's tips: the logger, Coach, the library, and where a watch can be added later. */
const PHONE_TIPS: readonly Tip[] = [
  { icon: 'barbell', tint: 'workouts', id: 'strength' },
  { icon: 'flash', tint: 'workouts', id: 'coach' },
  { icon: 'library', tint: 'steps', id: 'library' },
  { icon: 'watch', tint: 'link', id: 'watchLater' },
];

export function DoneStep() {
  const { t } = useTranslation('onboarding');
  const { state, ctx } = useOnboarding();
  const noWatch = state?.route === 'none';
  const tips = noWatch ? PHONE_TIPS : TIPS;
  const open = state ? openSteps(state, ctx).filter(isWhereId) : [];
  const place = t('done.healthSettings', { store: HEALTH_STORE });
  const whereOf = (id: WhereId) => (id === 'health' || id === 'account' ? t(`done.where.${id}`, { place }) : t(`done.where.${id}`));
  const nameOf = (id: WhereId) => (id === 'health' ? HEALTH_STORE : t(`done.name.${id}`));
  return (
    <>
      <StepIntro icon="checkmark-circle" tint="link" title={t('done.title')}>
        {t(noWatch ? 'done.introNoWatch' : 'done.intro')}
      </StepIntro>
      <Card>
        <View style={styles.tips}>
          {tips.map((tip, i) => (
            <FadeIn key={tip.id} delay={120 + i * 50} distance={6} style={styles.tip}>
              <IconChip icon={tip.icon} tint={tip.tint} size="sm" />
              <View style={styles.tipText}>
                <AppText variant="bodyStrong">{t(`done.tip.${tip.id}.title`)}</AppText>
                <AppText variant="caption" muted>
                  {t(`done.tip.${tip.id}.text`)}
                </AppText>
              </View>
            </FadeIn>
          ))}
        </View>
      </Card>
      {open.length > 0 ? (
        <Notice icon="list">
          {t('done.open', { list: open.map((id) => t('done.openItem', { name: nameOf(id), where: whereOf(id) })).join('; ') })}
        </Notice>
      ) : null}
      <AppText variant="caption" muted>
        {t('done.reopen')}
      </AppText>
    </>
  );
}

const styles = StyleSheet.create({
  tips: { gap: spacing.md },
  tip: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tipText: { flex: 1, gap: 2 },
});
