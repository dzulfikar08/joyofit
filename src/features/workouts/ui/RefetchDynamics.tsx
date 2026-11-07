import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { MoreText } from '@/components/MoreText';
import { Button } from '@/components/Button';
import { Notice } from '@/components/States';
import { errorMessage } from '@/format';
import { spacing } from '@/theme';

import { canRefetch, resultParts, showsRefetch, type RefetchRow, type RefetchRun } from '../refetchDynamics';
import { listRefetchRows } from '../refetchQuery';
import { useRefetchDynamics } from '../useRefetchDynamics';

/** The result sentence of a run over several workouts: `3 lari diperbarui, 5 sudah tidak ada di jam`. */
function useResultText(): (run: RefetchRun) => string {
  const { t } = useTranslation('workouts');
  return useCallback(
    (run) => {
      const parts = resultParts(run.totals).map(({ key, count }) => t(`refetch.result.${key}`, { count }));
      const text = parts.length > 0 ? parts.join(', ') : t('refetch.result.none');
      return run.error === null ? text : `${text}. ${t('refetch.result.stopped', { message: errorMessage(run.error) })}`;
    },
    [t],
  );
}

/**
 * On the detail of a run or walk that has no running form: asks the watch for this workout's samples again. Shown only with the watch that
 * recorded the workout connected and idle, and only when the installed binary has the native function; afterwards the answer stays
 * on screen in words (the figures themselves appear in the Dinamika lari card below once the screen has re-read).
 */
export function RefetchDynamicsAction({ start, sportName, summary, onChanged }: RefetchRow & { onChanged: () => void }) {
  const db = useSQLiteContext();
  const { t } = useTranslation('workouts');
  const { native, connected, address, tried, state, run } = useRefetchDynamics();
  const [workoutDevice, setWorkoutDevice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void db
      .getFirstAsync<{ device: string | null }>('SELECT device FROM workouts WHERE start = ?', start)
      .then((row) => live && setWorkoutDevice(row?.device ?? null), () => {});
    return () => {
      live = false;
    };
  }, [db, start]);

  const ask = useCallback(async () => {
    const result = await run([start]);
    if (result && result.totals.updated > 0) onChanged();
  }, [run, start, onChanged]);

  if (state.status === 'running') return <Notice icon="sync-outline">{t('refetch.running')}</Notice>;
  if (state.status === 'done') {
    const outcome = state.run.outcomes.get(start);
    const message = state.run.error !== null ? errorMessage(state.run.error) : t(`refetch.single.${outcome ?? 'failed'}`);
    return <Notice tone={state.run.error !== null || outcome === 'failed' ? 'danger' : 'info'} icon={outcome === 'updated' ? 'checkmark-circle-outline' : undefined}>{message}</Notice>;
  }
  if (!showsRefetch({ native, connected, address, workoutDevice }, { start, sportName, summary }, tried)) return null;
  return (
    <Notice icon="watch-outline" action={{ label: t('refetch.action'), onPress: () => void ask() }}>
      {t('refetch.hint')}
    </Notice>
  );
}

/**
 * In Settings, under the history pull: asks the watch about every run and walk it recorded that has no running form yet, one workout at a
 * time with "3 dari 12", and says what came of it. Hidden on a binary without the native function.
 */
export function RefetchDynamicsBulk() {
  const db = useSQLiteContext();
  const { t } = useTranslation('workouts');
  const resultText = useResultText();
  const { native, connected, address, tried, state, run } = useRefetchDynamics();
  const [rows, setRows] = useState<RefetchRow[]>([]);
  const finished = state.status === 'done';

  useEffect(() => {
    if (!native || address === null) return;
    let live = true;
    void listRefetchRows(db, address).then((found) => live && setRows(found), () => {});
    return () => {
      live = false;
    };
    // A finished run changes the stored summaries: read them again.
  }, [db, native, address, finished]);

  if (!native) return null;
  const starts = address === null ? [] : rows.filter((row) => canRefetch(row, tried)).map((row) => row.start);
  const running = state.status === 'running';

  return (
    <View style={styles.box}>
      <MoreText muted>{t('refetch.bulkHint')}</MoreText>
      <Button
        label={running ? t('refetch.progress', { done: state.progress.done, total: state.progress.total }) : t('refetch.bulkAction')}
        variant="secondary"
        icon="watch-outline"
        onPress={() => void run(starts)}
        disabled={!connected || starts.length === 0}
        loading={running}
      />
      {running ? null : (
        <AppText variant="caption" muted>
          {starts.length > 0 ? t('refetch.bulkCount', { count: starts.length }) : t('refetch.bulkNone')}
        </AppText>
      )}
      {state.status === 'done' ? <Notice tone={state.run.error !== null ? 'danger' : 'info'}>{resultText(state.run)}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm },
});
