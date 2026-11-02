import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { FadeIn } from '@/components/motion';
import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { JoyoRogoCard } from '@/features/today/JoyoRogoCard';
import { ReadinessSection } from '@/features/today/ReadinessSection';
import { computeScores } from '@/features/today/scores';
import { StrainSection } from '@/features/today/StrainSection';
import { useNightHrvAvailability } from '@/features/today/useNightHrvAvailability';
import { useTodayData } from '@/features/today/useTodayData';
import { useLocale } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { useTheme } from '@/theme';

/** What the three rings on Today stand for, with every signal and the strain week behind them. */
export function ReadinessScreen() {
  const router = useRouter();
  const { t } = useTranslation('today');
  const locale = useLocale();
  const theme = useTheme();
  const { linkState, device, dataVersion, sync } = useWatch();
  const { data, error } = useTodayData(dataVersion);
  const nightHrv = useNightHrvAvailability(dataVersion);
  const scores = useMemo(() => (data ? computeScores(data, nightHrv) : null), [data, nightHrv, locale]);
  const canSync = linkState === 'connected' && device !== null;

  return (
    <Screen refresh={{ refreshing: linkState === 'syncing', onRefresh: () => void sync(), enabled: canSync }}>
      <HiddenTabHeader title={t('readiness.screenTitle')} />
      {error ? <Notice tone="danger">{t('readiness.loadError', { error })}</Notice> : null}
      {scores && data ? (
        <>
          <FadeIn>
            <ReadinessSection readiness={scores.readiness} />
          </FadeIn>
          <FadeIn delay={60}>
            <StrainSection days={scores.strain} dayStart={data.dayStart} maxHr={scores.maxHr} />
          </FadeIn>
          <NavRow
            icon="pulse"
            tint="heart"
            title={t('readiness.hrvDayTitle')}
            subtitle={t('readiness.hrvDaySubtitle')}
            onPress={() => router.push('/hrv-day')}
            style={groupedRowStyle(theme, 0, 3)}
          />
          <NavRow
            icon="happy"
            tint="sleep"
            title={t('readiness.stressDayTitle')}
            subtitle={t('readiness.stressDaySubtitle')}
            onPress={() => router.push('/stress')}
            style={groupedRowStyle(theme, 1, 3)}
          />
          <NavRow
            icon="stats-chart"
            tint="link"
            title={t('readiness.trendsTitle')}
            subtitle={t('readiness.trendsSubtitle')}
            onPress={() => router.push('/trends')}
            style={groupedRowStyle(theme, 2, 3)}
          />
          <JoyoRogoCard />
        </>
      ) : error ? null : (
        <Skeleton width="100%" height={260} radius="card" />
      )}
    </Screen>
  );
}
