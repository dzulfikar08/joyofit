import { useEventListener } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { Card, Screen, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { radius, spacing, useColors } from '@/theme';
import { HuaweiWear, hasNative, type WatchMusicList, type WatchMusicStatus, type WatchSong } from '@/wear';

import { failureOf, failureText, rejectText } from './errorText';
import { checkSongs, type PickedSong, type SongCheck } from './musicFiles';
import { byteFraction, bytesMb, formatList, freeMb, slotFraction, songCount } from './storage';
import { currentItem, IDLE_QUEUE, queueReducer, type QueueAction, type QueueItem, type QueueState } from './uploadQueue';

function read(): WatchMusicStatus | null {
  if (!hasNative('getWatchMusic')) return null;
  try {
    return HuaweiWear.getWatchMusic();
  } catch {
    return null;
  }
}

/**
 * Android providers label some .aac files `application/octet-stream`, so that type is offered too there; on iOS it would open the
 * picker to every file, and `audio/*` (public.audio) already covers MP3, M4A and AAC. Every pick is checked by extension anyway.
 */
const PICK_TYPES = Platform.OS === 'android' ? ['audio/*', 'application/octet-stream'] : ['audio/*'];

/** What runs now: reading the list, a batch of uploads, or deleting one song (`delete:<id>`). */
type Busy = 'list' | 'upload' | `delete:${number}` | null;

type Progress = { bytes: number; total: number };

/** The files refused before the batch, with the watch's formats at that moment (for the "it takes" part). */
type Rejected = { checks: SongCheck[]; formats: string[] };

/**
 * The watch-music lab (Settings → About & advanced → Experimental → Music on the watch): the songs on the watch with their storage,
 * delete, and "Add songs" for the person's own MP3, M4A and AAC files. Picked files are checked here first (format, the watch's formats,
 * size, free space), then sent one by one; `uploadQueue.ts` decides the batch, `errorText.ts` the words. Nothing is converted and nothing
 * leaves the phone except to the watch.
 */
export function WatchMusicScreen() {
  const { t } = useTranslation(['settings', 'common']);
  const [status, setStatus] = useState<WatchMusicStatus | null>(read);
  const [list, setList] = useState<WatchMusicList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<{ danger: boolean; text: string } | null>(null);
  const [rejected, setRejected] = useState<Rejected | null>(null);
  const [queue, setQueue] = useState<QueueState>(IDLE_QUEUE);
  const queueRef = useRef<QueueState>(IDLE_QUEUE);
  const [progress, setProgress] = useState<Progress | null>(null);

  const refresh = useCallback(() => setStatus(read()), []);
  useNativeRefresh(refresh);

  useEventListener(HuaweiWear, 'onUploadProgress', (event) => {
    if (queueRef.current.phase === 'uploading') setProgress({ bytes: event.bytes, total: event.total });
  });

  /** The batch lives in a ref for the upload loop, which reads it between songs; the state copy is for drawing. */
  const apply = useCallback((action: QueueAction) => {
    queueRef.current = queueReducer(queueRef.current, action);
    setQueue(queueRef.current);
  }, []);

  const ready = status !== null && status.enabled && status.connected && status.uploadSupported;

  // The first read of the watch's songs once it can answer; state is set only when the answer arrives (and the screen is still there).
  useEffect(() => {
    if (!ready) return;
    let live = true;
    HuaweiWear.listWatchMusic().then(
      (answer) => {
        if (!live) return;
        setList(answer);
        setListError(null);
      },
      (e: unknown) => live && setListError(failureText(failureOf(e))),
    );
    return () => {
      live = false;
    };
  }, [ready]);

  const load = useCallback(async () => {
    setBusy('list');
    try {
      setList(await HuaweiWear.listWatchMusic());
      setListError(null);
    } catch (e) {
      setListError(failureText(failureOf(e)));
    } finally {
      setBusy(null);
      refresh();
    }
  }, [refresh]);

  const info = list?.info ?? null;

  const addSongs = async () => {
    if (info === null) return;
    setNotice(null);
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({ type: PICK_TYPES, copyToCacheDirectory: true, multiple: true });
    } catch (e) {
      setNotice({ danger: true, text: errorMessage(e) });
      return;
    }
    if (picked.canceled || picked.assets.length === 0) return;
    const files: PickedSong[] = picked.assets.map((a) => ({ uri: a.uri, name: a.name, size: a.size ?? null }));
    const checks = checkSongs(files, info);
    const refused = checks.filter((c) => !c.accepted);
    setRejected(refused.length > 0 ? { checks: refused, formats: info.formats } : null);
    const accepted = checks.filter((c) => c.accepted).map((c) => c.file);
    apply({ type: 'start', files: accepted });
    if (accepted.length === 0) return;
    setBusy('upload');
    try {
      for (let item = currentItem(queueRef.current); item !== null; item = currentItem(queueRef.current)) {
        setProgress(null);
        try {
          const result = await HuaweiWear.uploadWatchSong(item.file.uri, item.file.name);
          apply({ type: 'done', status: result.status });
        } catch (e) {
          apply({ type: 'failed', failure: failureOf(e) });
        }
      }
    } finally {
      setProgress(null);
      setBusy(null);
    }
    await load();
  };

  const cancel = async () => {
    apply({ type: 'cancel' });
    try {
      await HuaweiWear.cancelWatchMusicUpload();
    } catch (e) {
      setNotice({ danger: true, text: failureText(failureOf(e)) });
    }
  };

  const remove = async (song: WatchSong, title: string) => {
    setNotice(null);
    setBusy(`delete:${song.id}`);
    try {
      const answer = await HuaweiWear.deleteWatchSongs([song.id]);
      setNotice(
        answer.ok
          ? { danger: false, text: t('watchMusic.deleted', { title }) }
          : { danger: true, text: t('watchMusic.deleteNotOk', { title, code: answer.code ?? '—' }) },
      );
    } catch (e) {
      setNotice({ danger: true, text: failureText(failureOf(e)) });
    } finally {
      setBusy(null);
    }
    await load();
  };

  const confirmRemove = (song: WatchSong, title: string) =>
    Alert.alert(t('watchMusic.deleteTitle'), t('watchMusic.deleteBody', { title }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.delete'), style: 'destructive', onPress: () => void remove(song, title) },
    ]);

  const idle = busy === null;
  const details = <Details>{t('watchMusic.details')}</Details>;

  if (status === null || !status.enabled || !status.connected || !status.uploadSupported) {
    const key =
      status === null ? 'unavailable' : !status.enabled ? 'off' : !status.connected ? 'notConnected' : 'noSupport';
    return (
      <Screen>
        <Notice tone={key === 'notConnected' || key === 'noSupport' ? 'danger' : 'info'}>{t(`watchMusic.${key}`)}</Notice>
        {status !== null ? details : null}
      </Screen>
    );
  }

  const running = currentItem(queue);
  const count = list === null ? null : songCount(list);
  const fraction = info === null ? null : slotFraction(count, info.maxSongs);
  const songs = list?.songs ?? [];

  return (
    <Screen refresh={{ refreshing: busy === 'list', onRefresh: () => void load(), enabled: idle }}>
      {list === null && listError === null ? <Notice>{t('watchMusic.loading')}</Notice> : null}
      {listError !== null ? (
        <Notice tone="danger" action={idle ? { label: t('common:actions.retry'), onPress: () => void load() } : undefined}>
          {t('watchMusic.loadFailed', { message: listError })}
        </Notice>
      ) : null}
      {info !== null ? (
        <Section title={t('watchMusic.storageTitle')} icon="musical-notes" tint="workouts">
          <AppText variant="bodyStrong">
            {info.freeSpaceMb === null ? t('watchMusic.freeSpaceUnknown') : t('watchMusic.freeSpace', { mb: freeMb(info.freeSpaceMb) })}
          </AppText>
          {count !== null ? (
            <AppText>{info.maxSongs === null ? t('watchMusic.songs', { count }) : t('watchMusic.songsOfMax', { n: count, max: info.maxSongs })}</AppText>
          ) : null}
          {fraction !== null ? <Bar fraction={fraction} /> : null}
          <AppText variant="caption" muted>
            {info.formats.length > 0 ? t('watchMusic.formats', { formats: formatList(info.formats) }) : t('watchMusic.formatsUnknown')}
          </AppText>
          <ButtonRow>
            <Button
              label={t('watchMusic.add')}
              icon="add"
              variant="primary"
              disabled={!idle}
              loading={busy === 'upload'}
              onPress={() => void addSongs()}
            />
            <Button label={t('watchMusic.refresh')} icon="refresh" disabled={!idle} loading={busy === 'list'} onPress={() => void load()} />
          </ButtonRow>
        </Section>
      ) : null}
      {running !== null ? (
        <UploadCard
          item={running}
          index={queue.index}
          total={queue.items.length}
          progress={progress}
          cancelling={queue.cancelRequested}
          onCancel={() => void cancel()}
        />
      ) : null}
      {notice ? <Notice tone={notice.danger ? 'danger' : 'info'}>{notice.text}</Notice> : null}
      {rejected !== null ? (
        <Section title={t('watchMusic.rejectedTitle')} icon="close-circle" tint="neutral">
          {rejected.checks.map((check, i) => (
            <AppText key={`${i}:${check.file.uri}`} danger>
              {rejectText(check, rejected.formats)}
            </AppText>
          ))}
        </Section>
      ) : null}
      {queue.phase === 'finished' ? <Results queue={queue} /> : null}
      {list !== null ? (
        <Section
          title={t('watchMusic.songsTitle')}
          icon="musical-notes"
          tint="workouts"
          trailing={
            <AppText variant="caption" muted>
              {t('watchMusic.songs', { count: songs.length })}
            </AppText>
          }>
          {songs.length === 0 ? <AppText muted>{t('watchMusic.empty')}</AppText> : null}
          {songs.map((song) => {
            const title = song.title || song.fileName;
            return (
              <View key={song.id} style={styles.song}>
                <View style={styles.songText}>
                  <AppText variant="bodyStrong" numberOfLines={2}>
                    {title}
                  </AppText>
                  <AppText variant="caption" muted numberOfLines={2}>
                    {[song.artist, song.fileName].filter((s) => s !== '').join(' · ')}
                  </AppText>
                </View>
                <Button
                  label={t('watchMusic.deleteSong', { title })}
                  icon="trash"
                  variant="destructive"
                  iconOnly
                  disabled={!idle}
                  loading={busy === `delete:${song.id}`}
                  onPress={() => confirmRemove(song, title)}
                />
              </View>
            );
          })}
        </Section>
      ) : null}
      {details}
    </Screen>
  );
}

/** Share of something used, as a thin bar. */
function Bar({ fraction }: { fraction: number }) {
  const colors = useColors();
  const percent = Math.round(fraction * 100);
  return (
    <View style={[styles.track, { backgroundColor: colors.muted }]}>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        style={[styles.bar, { width: `${percent}%`, backgroundColor: fraction > 0.9 ? colors.destructive : colors.primary }]}
      />
    </View>
  );
}

/** The song being sent: "Song 2 of 5: name", its bytes so far, and Cancel (which also stops the songs after it). */
function UploadCard({
  item,
  index,
  total,
  progress,
  cancelling,
  onCancel,
}: {
  item: QueueItem;
  index: number;
  total: number;
  progress: Progress | null;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const fraction = progress === null ? null : byteFraction(progress.bytes, progress.total);
  return (
    <Card>
      <AppText variant="bodyStrong" numberOfLines={2}>
        {t('watchMusic.uploading', { index: index + 1, total, name: item.file.name })}
      </AppText>
      <AppText variant="caption" muted>
        {progress === null
          ? t('watchMusic.preparing')
          : t('watchMusic.progress', { done: bytesMb(progress.bytes), total: bytesMb(progress.total) })}
      </AppText>
      <Bar fraction={fraction ?? 0} />
      <Button
        label={cancelling ? t('watchMusic.cancelling') : t('common:actions.cancel')}
        icon="close"
        disabled={cancelling}
        onPress={onCancel}
      />
    </Card>
  );
}

/** Each song of the last batch: sent, cancelled, failed (with why) or not sent, and why the batch stopped early. */
function Results({ queue }: { queue: QueueState }) {
  const { t } = useTranslation('settings');
  return (
    <Section title={t('watchMusic.resultsTitle')} icon="list" tint="workouts">
      {queue.stop !== null ? (
        <Notice tone={queue.stop === 'disconnected' ? 'danger' : 'info'}>
          {t(queue.stop === 'disconnected' ? 'watchMusic.stoppedDisconnected' : 'watchMusic.stoppedCancelled')}
        </Notice>
      ) : null}
      {queue.items.map((item, i) => (
        <View key={`${i}:${item.file.uri}`} style={styles.result}>
          <AppText variant="bodyStrong" numberOfLines={2}>
            {item.file.name}
          </AppText>
          <AppText variant="caption" muted={item.status !== 'failed'} danger={item.status === 'failed'}>
            {/* A finished batch has no pending or running song; the type still allows them. */}
            {t(`watchMusic.status.${item.status === 'pending' || item.status === 'uploading' ? 'skipped' : item.status}`)}
            {item.failure ? `: ${failureText(item.failure)}` : ''}
          </AppText>
        </View>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden', marginVertical: 2 },
  bar: { height: '100%', borderRadius: radius.pill },
  song: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  songText: { flex: 1, gap: 2 },
  result: { gap: 2 },
});
