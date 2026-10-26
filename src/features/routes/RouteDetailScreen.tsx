import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Input';
import { KeyValue } from '@/components/KeyValue';
import { Screen, Section } from '@/components/Screen';
import { LoadingState, Notice } from '@/components/States';
import { errorMessage } from '@/format';
import { fmtInt } from '@/i18n';
import { WatchNavSection } from '@/features/watchnav/WatchNavSection';

import { formatRouteDateTime, sourceLabel } from './copy';
import { RouteMap } from './map/RouteMap';
import { formatElevation, formatRouteDistance, type RoutePoint, type SavedRoute } from './routeModel';
import { RoutePushSection } from './RoutePushSection';
import { RouteStartGuide } from './RouteStartGuide';
import { deleteRoute, loadRoute, renameRoute } from './routeStore';
import { MAX_NAME_LENGTH } from './routeStorage';
import { useRoutePush } from './useRoutePush';

interface LoadedRoute {
  route: SavedRoute;
  points: RoutePoint[];
}

type Phase = 'loading' | 'ready' | 'missing';

/** The name of the route, saved on its own: also what the watch lists it under. */
function NameSection({ route, onRename }: { route: SavedRoute; onRename: (name: string) => Promise<SavedRoute | null> }) {
  const { t } = useTranslation('routes');
  const [value, setValue] = useState(route.name);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = value.replace(/\s+/g, ' ').trim();
  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const renamed = await onRename(trimmed);
      setMessage(renamed === null ? { ok: false, text: t('detail.notFound') } : { ok: true, text: t('detail.nameSaved') });
    } catch (e) {
      setMessage({ ok: false, text: t('detail.renameFailed', { message: errorMessage(e) }) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={t('detail.nameTitle')} icon="pricetag" tint="workouts">
      <Field
        label={t('detail.nameLabel')}
        value={value}
        onChangeText={(text) => {
          setValue(text);
          setMessage(null);
        }}
        maxLength={MAX_NAME_LENGTH}
        hint={t('detail.nameHint')}
        returnKeyType="done"
      />
      <Button label={t('detail.saveName')} loading={saving} disabled={trimmed === '' || trimmed === route.name} onPress={() => void save()} />
      {message !== null ? <Notice tone={message.ok ? 'info' : 'danger'} icon={message.ok ? 'checkmark-circle' : undefined}>{message.text}</Notice> : null}
    </Section>
  );
}

/** `/routes/[id]`: the route on a map, its numbers, the send to the watch, how to start it there and watch navigation (lab). */
export function RouteDetailScreen() {
  const { t } = useTranslation('routes');
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState<LoadedRoute | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadRoute(id).then(
        (found) => {
          if (cancelled) return;
          setLoaded(found);
          setPhase(found === null ? 'missing' : 'ready');
        },
        (e: unknown) => {
          if (cancelled) return;
          setError(t('detail.loadFailed', { message: errorMessage(e) }));
          setPhase('missing');
        },
      );
      return () => {
        cancelled = true;
      };
    }, [id, t]),
  );

  const replaceRoute = useCallback((route: SavedRoute) => setLoaded((current) => (current ? { ...current, route } : current)), []);

  const rename = useCallback(
    async (name: string) => {
      const route = await renameRoute(id, name);
      if (route !== null) replaceRoute(route);
      return route;
    },
    [id, replaceRoute],
  );

  const push = useRoutePush({ route: loaded?.route ?? null, points: loaded?.points ?? [], rename, onSent: replaceRoute });

  const remove = async () => {
    setConfirmDelete(false);
    try {
      await deleteRoute(id);
      if (router.canGoBack()) router.back();
      else router.replace('/routes');
    } catch (e) {
      setError(t('library.deleteFailed', { message: errorMessage(e) }));
    }
  };

  if (phase === 'loading') {
    return (
      <Screen>
        <LoadingState label={t('detail.loading')} />
      </Screen>
    );
  }
  if (loaded === null) {
    return (
      <Screen>
        <Notice tone="danger">{error ?? t('detail.notFound')}</Notice>
        <Button label={t('titles.library')} icon="list" onPress={() => router.replace('/routes')} />
      </Screen>
    );
  }

  const { route, points } = loaded;
  return (
    <Screen>
      <AppText variant="title" numberOfLines={2}>
        {route.name}
      </AppText>
      <RouteMap points={points} height={280} />

      <Section title={t('detail.statsTitle')} icon="stats-chart" tint="workouts">
        <KeyValue icon="navigate" label={t('detail.distance')} value={formatRouteDistance(route.distanceM)} />
        <KeyValue icon="trending-up" label={t('detail.ascent')} value={formatElevation(route.ascentM)} />
        <KeyValue icon="trending-down" label={t('detail.descent')} value={formatElevation(route.descentM === null ? null : -route.descentM)} />
        <KeyValue icon="git-commit" label={t('detail.points')} value={fmtInt(route.pointCount)} />
        <KeyValue icon="analytics" label={t('detail.altitude')} value={route.hasAltitude ? t('detail.altitudeYes') : t('detail.altitudeNo')} />
        <KeyValue icon="document" label={t('detail.source')} value={sourceLabel(route.source)} />
        <KeyValue icon="calendar" label={t('detail.created')} value={formatRouteDateTime(route.createdAt)} />
        <KeyValue
          icon="watch"
          label={t('detail.lastSent')}
          value={route.lastSentAt === null ? t('detail.neverSent') : formatRouteDateTime(route.lastSentAt)}
        />
        {!route.hasAltitude ? <Notice>{t('detail.noAltitudeNote')}</Notice> : null}
      </Section>

      <RoutePushSection push={push} routeName={route.name} />
      <RouteStartGuide justSent={push.outcome?.kind === 'sent'} />
      <WatchNavSection route={route} points={points} />
      <NameSection key={route.name} route={route} onRename={rename} />

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={t('detail.deleteRoute')} icon="trash" variant="destructive" onPress={() => setConfirmDelete(true)} />

      <ConfirmDialog
        visible={confirmDelete}
        title={t('library.deleteTitle')}
        message={t('library.deleteMessage', { name: route.name })}
        confirmLabel={t('library.deleteConfirm')}
        cancelLabel={t('library.cancel')}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}
