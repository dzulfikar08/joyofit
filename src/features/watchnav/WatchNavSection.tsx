import { useCallback, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { ensureLocation } from '@/features/sensors/permissions';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { formatRouteDistance, type RoutePoint, type SavedRoute } from '@/features/routes/routeModel';
import { errorMessage } from '@/format';
import { spacing } from '@/theme';
import type { WatchNavStatus } from '@/wear';

import type { NavView } from './engine';
import { readWatchNavStatus, setWatchNavNotification, watchNavSession } from './instance';
import type { NavManeuver } from './maneuvers';
import type { NavActivity, SessionSnapshot } from './session';

function useEtaText(): (s: number) => string {
  const { t } = useTranslation('routes');
  return (s) => {
    const minutes = Math.max(1, Math.round(s / 60));
    return minutes < 60 ? t('watchNav.etaMinutes', { count: minutes }) : t('watchNav.etaHours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  };
}

function useTurnText(): (m: NavManeuver | null) => string | null {
  const { t } = useTranslation('routes');
  return (m) => {
    if (m === null) return null;
    const dir = m.dir === 'roundabout' && m.exit !== undefined ? t('watchNav.roundaboutExit', { exit: m.exit }) : t(`watchNav.dir.${m.dir}`);
    return m.street === '' ? dir : t('watchNav.onto', { dir, street: m.street });
  };
}

/** The phone-side status card of a running session. */
function StatusCard({ snap, view }: { snap: SessionSnapshot; view: NavView }) {
  const { t } = useTranslation('routes');
  const etaText = useEtaText();
  const turnText = useTurnText();
  const watchApp: WatchNavStatus['watchApp'] = snap.watch?.watchApp ?? 'unknown';
  const watchAppLabel = watchApp === 'present' ? t('watchNav.watchAppYes') : watchApp === 'absent' ? t('watchNav.watchAppNo') : t('watchNav.watchAppUnknown');
  return (
    <View style={styles.block}>
      {view.phase === 'offRoute' ? <Notice tone="danger">{t('watchNav.offRoute', { m: Math.round(view.offM ?? 0) })}</Notice> : null}
      {view.rerouting ? <Notice icon="sync">{t('watchNav.rerouting')}</Notice> : null}
      {view.phase === 'paused' ? <Notice icon="pause">{t('watchNav.paused')}</Notice> : null}
      {!view.matched && view.phase === 'navigating' ? <Notice icon="locate">{t('watchNav.noFix')}</Notice> : null}
      <KeyValue icon="arrow-redo" label={t('watchNav.nextTurn')} value={turnText(view.maneuver)} />
      <KeyValue icon="navigate" label={t('watchNav.distToTurn')} value={view.distToTurnM === null ? null : formatRouteDistance(view.distToTurnM)} />
      <KeyValue icon="flag" label={t('watchNav.remaining')} value={formatRouteDistance(view.remainingM)} />
      <KeyValue icon="time" label={t('watchNav.eta')} value={etaText(view.etaS)} />
      <KeyValue icon="watch" label={t('watchNav.watchApp')} value={snap.watchAppVersion ? `${watchAppLabel} (${snap.watchAppVersion})` : watchAppLabel} />
      <KeyValue icon="git-branch" label={t('watchNav.source')} value={view.source === 'osrm' ? t('watchNav.sourceOsrm') : t('watchNav.sourceGeometry')} />
    </View>
  );
}

/**
 * "Navigasi di jam (lab)" on a route's page: shown while the lab switch is on (or a session runs). Starts a session for this route, shows the
 * phone-side status (next turn, distances, whether the watch app answers) and stops it. Credits OpenStreetMap and OSRM.
 */
export function WatchNavSection({ route, points }: { route: SavedRoute; points: readonly RoutePoint[] }) {
  const { t } = useTranslation('routes');
  const snap = useSyncExternalStore(watchNavSession.subscribe, watchNavSession.getSnapshot);
  const [status, setStatus] = useState(readWatchNavStatus);
  const [activity, setActivity] = useState<NavActivity>('walk');
  const [reroute, setReroute] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useNativeRefresh(useCallback(() => setStatus(readWatchNavStatus()), []));

  const active = snap.phase !== 'idle';
  if (!active && status?.enabled !== true) return null;
  const ours = snap.routeId === route.id;

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      if ((await ensureLocation()) !== 'granted') {
        setError(t('watchNav.locationDenied'));
        return;
      }
      setWatchNavNotification(t('watchNav.notificationTitle'), t('watchNav.notificationText'));
      await watchNavSession.start({ routeId: route.id, name: route.name, points, activity, reroute });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
      setStatus(readWatchNavStatus());
    }
  };

  const running = snap.phase === 'planning' || snap.phase === 'running';
  return (
    <Section title={t('watchNav.title')} icon="navigate-circle" tint="link">
      <AppText variant="caption" muted>
        {t('watchNav.explainer')}
      </AppText>
      {(snap.watch ?? status)?.placeholderFingerprints !== false ? <Notice>{t('watchNav.placeholder')}</Notice> : null}

      {running && !ours ? (
        <>
          <Notice>{t('watchNav.otherRoute', { name: snap.routeName ?? '' })}</Notice>
          <Button label={t('watchNav.stop')} icon="stop-circle" variant="destructive" onPress={() => void watchNavSession.stop()} />
        </>
      ) : null}

      {snap.phase === 'planning' && ours ? <Notice icon="hourglass">{t('watchNav.planning')}</Notice> : null}
      {snap.phase === 'running' && ours && snap.view ? (
        <>
          <StatusCard snap={snap} view={snap.view} />
          <Button label={t('watchNav.stop')} icon="stop-circle" variant="destructive" onPress={() => void watchNavSession.stop()} />
        </>
      ) : null}

      {(snap.phase === 'ended' || snap.phase === 'failed') && ours ? (
        <>
          <Notice tone={snap.phase === 'failed' || snap.view?.endReason === 'error' ? 'danger' : 'info'}>
            {snap.phase === 'failed' ? t('watchNav.failed', { message: snap.error ?? '' }) : t(`watchNav.${snap.view?.endReason ?? 'stopped'}`)}
          </Notice>
          <Button label={t('watchNav.dismiss')} icon="close" onPress={() => watchNavSession.dismiss()} />
        </>
      ) : null}

      {!running && (snap.phase === 'idle' || !ours) && status?.enabled ? (
        <>
          <AppText variant="caption" muted>
            {t('watchNav.activity')}
          </AppText>
          <Segmented<NavActivity>
            options={[
              { value: 'walk', label: t('watchNav.walk') },
              { value: 'run', label: t('watchNav.run') },
              { value: 'ride', label: t('watchNav.ride') },
            ]}
            value={activity}
            onChange={setActivity}
          />
          <SwitchRow label={t('watchNav.reroute')} hint={t('watchNav.rerouteHint')} value={reroute} onValueChange={setReroute} />
          <Button label={t('watchNav.start')} icon="navigate" variant="primary" loading={starting} onPress={() => void start()} />
        </>
      ) : null}

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      <AppText variant="caption" muted>
        {t('watchNav.credit')}
      </AppText>
    </Section>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
});
