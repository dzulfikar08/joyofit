import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, Divider, Screen, Section } from '@/components/Screen';
import { PressableScale } from '@/components/PressableScale';
import { LoadingState, Notice } from '@/components/States';
import { IconAction } from '@/features/courses/IconAction';
import { errorMessage } from '@/format';
import { radius, spacing, useTheme } from '@/theme';

import { formatRouteDateTime, sourceLabel } from './copy';
import { NumberedSteps } from './NumberedSteps';
import { pickRouteFile } from './readRouteFile';
import { formatElevation, formatRouteDistance, type SavedRoute } from './routeModel';
import { RouteThumbnail } from './RouteThumbnail';
import { deleteRoute, listRouteCards, type RouteCard } from './routeStore';
import { WorkoutPickerSheet } from './WorkoutPickerSheet';

const WAY_KEYS = ['w1', 'w2', 'w3', 'w4', 'w5'] as const;

function SourceTag({ source }: { source: SavedRoute['source'] }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: colors.workoutsSoft }]}>
      <AppText variant="label" color={colors.workoutsText}>
        {sourceLabel(source)}
      </AppText>
    </View>
  );
}

function RouteRow({ card, onOpen, onDelete }: { card: RouteCard; onOpen: () => void; onDelete: () => void }) {
  const { t } = useTranslation('routes');
  const { route } = card;
  const elevation =
    route.ascentM !== null && route.descentM !== null ? ` \u00B7 ${formatElevation(route.ascentM)} \u00B7 ${formatElevation(-route.descentM)}` : '';
  return (
    <Card style={styles.row}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('library.openRoute', { name: route.name })}
        onPress={onOpen}
        scaleTo={0.985}
        style={styles.main}>
        <RouteThumbnail points={card.thumb} />
        <View style={styles.text}>
          <AppText variant="bodyStrong" numberOfLines={2}>
            {route.name}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {`${formatRouteDistance(route.distanceM)}${elevation}`}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {route.lastSentAt === null ? t('library.neverSent') : t('library.lastSent', { date: formatRouteDateTime(route.lastSentAt) })}
          </AppText>
          <SourceTag source={route.source} />
        </View>
      </PressableScale>
      <IconAction icon="trash-outline" label={t('library.deleteRoute', { name: route.name })} danger onPress={onDelete} />
    </Card>
  );
}

/** `/routes`: the saved routes, and the ways to add one: a GPX or TCX file, a drawing on the map, a past workout. */
export function RouteLibraryScreen() {
  const { t } = useTranslation('routes');
  const router = useRouter();
  const [cards, setCards] = useState<RouteCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SavedRoute | null>(null);

  const load = useCallback(async () => {
    try {
      setCards(await listRouteCards());
      setError(null);
    } catch (e) {
      setError(t('library.loadFailed', { message: errorMessage(e) }));
      setCards((current) => current ?? []);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const open = (id: string) => router.push({ pathname: '/routes/[id]', params: { id } });

  const pickFile = async () => {
    try {
      const picked = await pickRouteFile();
      if (picked) router.push({ pathname: '/routes/import', params: { uri: picked.uri, name: picked.name } });
    } catch (e) {
      setError(t('library.pickFailed', { message: errorMessage(e) }));
    }
  };

  const confirmDelete = async () => {
    const route = pendingDelete;
    setPendingDelete(null);
    if (route === null) return;
    try {
      await deleteRoute(route.id);
      await load();
    } catch (e) {
      setError(t('library.deleteFailed', { message: errorMessage(e) }));
    }
  };

  return (
    <Screen
      refresh={{
        refreshing,
        onRefresh: () => {
          setRefreshing(true);
          void load().finally(() => setRefreshing(false));
        },
      }}>
      <Section title={t('library.addTitle')} icon="add-circle" tint="workouts">
        <Button label={t('library.importFile')} icon="document-attach" variant="primary" onPress={() => void pickFile()} />
        <Button label={t('library.loopFromHome')} icon="repeat" onPress={() => router.push('/routes/loop')} />
        <Button label={t('library.drawOnMap')} icon="create" onPress={() => router.push('/routes/draw')} />
        <Button label={t('library.fromWorkout')} icon="fitness" onPress={() => setPickerOpen(true)} />
      </Section>

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}

      {cards === null ? <LoadingState label={t('library.loading')} /> : null}

      {cards !== null && cards.length === 0 ? (
        <Section title={t('library.emptyTitle')} icon="trail-sign" tint="workouts">
          <AppText variant="caption" muted>
            {t('library.emptyDescription')}
          </AppText>
          <Divider />
          <NumberedSteps steps={WAY_KEYS.map((key) => t(`library.ways.${key}`))} />
        </Section>
      ) : null}

      {cards !== null && cards.length > 0 ? (
        <View style={styles.list}>
          <AppText variant="heading" accessibilityRole="header">
            {t('library.listTitle')}
          </AppText>
          {cards.map((card) => (
            <RouteRow key={card.route.id} card={card} onOpen={() => open(card.route.id)} onDelete={() => setPendingDelete(card.route)} />
          ))}
        </View>
      ) : null}

      <WorkoutPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSaved={(route) => {
          setPickerOpen(false);
          open(route.id);
        }}
      />
      <ConfirmDialog
        visible={pendingDelete !== null}
        title={t('library.deleteTitle')}
        message={pendingDelete ? t('library.deleteMessage', { name: pendingDelete.name }) : ''}
        confirmLabel={t('library.deleteConfirm')}
        cancelLabel={t('library.cancel')}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 2 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
});
