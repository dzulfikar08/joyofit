import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { NoticeDialog, useNotice } from '@/components/NoticeDialog';
import { PressableScale } from '@/components/PressableScale';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useToast } from '@/components/Toast';
import { authClient } from '@/cloud/auth';
import { tileSource } from '@/features/map';
import { InstagramGlyph } from '@/features/share/InstagramGlyph';
import { FIT_BRAND } from '@/features/stickers/brand';
import { FIT_FONTS } from '@/features/stickers/fonts';
import { PhotosDeniedError, instagramInstalled, type PhotosPrompt } from '@/features/stickers/share/shareImage';
import { canSaveToLibrary } from '@/features/stickers/share/shareTargets';
import { useStickerPro } from '@/features/stickers/ui/useStickerPro';
import { EXPORT_CARD_WIDTH } from '@/features/stickers/ui/ScenePainter';
import { errorMessage } from '@/format';
import { getT, useLocale, useTranslation } from '@/i18n';
import { HIT, spacing, useTheme } from '@/theme';

import { BasemapStore, loadBasemap } from '../basemap';
import { createSceneBuilder } from '../build';
import { EncoderUnsupportedError, FRAME_FORMAT, deleteVideo, encodeReplay, type EncodedVideo } from '../exportVideo';
import { frameAt } from '../frame';
import { planReplay, DEFAULT_TRIM_M, type ReplayPlan } from '../plan';
import { EXPORT_FPS, EXPORT_HEIGHT, EXPORT_WIDTH, ExportCancelled, type FrameJob } from '../scheduler';
import { saveVideo, shareVideoFile, shareVideoToInstagram } from '../shareVideo';
import { themeFor, type ReplayMode } from '../theme';
import { SPEEDS, playbackSec, type ReplaySpeed } from '../timing';
import type { ReplayTrack } from '../track';
import { ReplayPainter } from './ReplayPainter';
import { usePlayer } from './usePlayer';

const SAVE_AVAILABLE = canSaveToLibrary(Platform.OS === 'ios' ? 'ios' : 'android', Platform.OS === 'android' ? Number(Platform.Version) : 0);
type MapState =
  | { status: 'unavailable'; reason: 'no-route' | 'too-short' }
  | { status: 'loading'; done: number; total: number }
  | { status: 'ready'; offline: boolean };

type ExportState = { status: 'idle' } | { status: 'running'; fraction: number } | { status: 'done'; video: EncodedVideo };

function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
}

/** Two frames: the new scene is committed, then drawn natively, before the capture reads it. */
async function afterPaint(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

function TargetButton({ label, icon, loading, disabled, onPress }: { label: string; icon: ReactNode; loading?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors, radius } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.target, { backgroundColor: colors.muted, borderRadius: radius.card, opacity: disabled ? 0.5 : 1 }]}>
      <View style={styles.targetIcon}>{loading ? <ActivityIndicator color={colors.foreground} /> : icon}</View>
      <AppText variant="caption" style={styles.centered}>
        {label}
      </AppText>
    </PressableScale>
  );
}

export interface ReplayScreenProps {
  track: ReplayTrack;
  /** The sport word shown on the summary card. */
  sportLabel: string;
  visible: boolean;
  onClose: () => void;
}

/**
 * The replay of a workout: the route drawn over a dark map by a camera that follows the rider, pins for the high points, a
 * live distance counter and an elevation strip, then a summary card. The same scene painter draws the preview and the frames
 * that are captured at 1080 x 1920 and encoded to an MP4 by the native encoder.
 */
export function ReplayScreen({ track, sportLabel, visible, onClose }: ReplayScreenProps) {
  const { colors, radius, scheme } = useTheme();
  const { t } = useTranslation(['replay', 'sharing', 'common', 'stickers']);
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const { toast, show } = useToast();
  const pro = useStickerPro();
  const session = authClient.useSession();
  const firstName = session.data?.user?.name?.trim().split(/\s+/)[0] ?? null;
  const cardRef = useRef<View>(null);

  const [modePick, setModePick] = useState<ReplayMode | null>(null);
  const [routePrivacy, setRoutePrivacy] = useState(true);
  const [showName, setShowName] = useState(false);
  const [watermark, setWatermark] = useState(true);
  const [mapState, setMap] = useState<MapState>({ status: 'loading', done: 0, total: 0 });
  const [tilesVersion, setTilesVersion] = useState(0);
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });
  const [exportT, setExportT] = useState(0);
  const [feedback, setFeedback] = useState<{ tone: 'info' | 'danger'; text: string; action?: { label: string; onPress: () => void } } | null>(null);
  const [busy, setBusy] = useState<'save' | 'instagram' | 'share' | null>(null);
  const [installed, setInstalled] = useState(false);
  const photos = useNotice<'save' | 'instagram'>();
  const abort = useRef<AbortController | null>(null);
  const mode: ReplayMode = modePick ?? scheme;

  // The plan depends on the privacy trim; the tiles it needs are loaded once per plan, into a store of their own.
  const { result: planned, store } = useMemo(() => ({ result: planReplay(track, { trimM: routePrivacy ? DEFAULT_TRIM_M : 0 }), store: new BasemapStore() }), [track, routePrivacy]);
  const plan: ReplayPlan | null = 'plan' in planned ? planned.plan : null;
  // A new plan starts its map over (state adjusted while rendering, React's way to reset state when an input changes).
  const [mapFor, setMapFor] = useState(plan);
  if (mapFor !== plan) {
    setMapFor(plan);
    setMap({ status: 'loading', done: 0, total: plan?.basemap.total ?? 0 });
  }
  const map: MapState = plan ? mapState : { status: 'unavailable', reason: 'failure' in planned ? planned.failure : 'no-route' };

  useEffect(() => {
    if (!visible) return;
    void instagramInstalled().then(setInstalled);
  }, [visible]);

  useEffect(() => {
    if (!visible || !plan) return;
    const ctl = new AbortController();
    let lastBump = 0;
    loadBasemap(plan.basemap, tileSource, store, {
      signal: ctl.signal,
      onProgress: (done, total) => {
        const now = Date.now();
        if (done === total || now - lastBump > 400) {
          lastBump = now;
          setTilesVersion((v) => v + 1);
          setMap((m) => (m.status === 'loading' ? { status: 'loading', done, total } : m));
        }
      },
    })
      .then((result) => {
        if (!ctl.signal.aborted) {
          setTilesVersion((v) => v + 1);
          setMap({ status: 'ready', offline: result.offline });
        }
      })
      .catch(() => {
        if (!ctl.signal.aborted) setMap({ status: 'ready', offline: true });
      });
    return () => ctl.abort();
  }, [visible, plan, store]);

  const ready = map.status === 'ready' && plan !== null;
  const player = usePlayer(plan?.timing.totalSec ?? 1, visible && ready && exportState.status !== 'running');

  // Starts by itself once the map is in, from the beginning, each time the plan changes.
  useEffect(() => {
    if (ready) player.restart();
    // `player.restart` is stable; the plan (a new privacy choice, a new workout) is what restarts the replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, plan]);

  const builder = useMemo(() => {
    if (!plan) return null;
    return createSceneBuilder({
      plan,
      theme: themeFor(mode, track.kind),
      locale,
      t: (key, args) => String(getT(locale, 'replay')(key as never, args as never)),
      fonts: FIT_FONTS,
      store,
      options: { watermark: pro ? watermark : true, name: showName ? firstName : null },
      sportLabel,
      brand: { name: FIT_BRAND.name, link: FIT_BRAND.link },
    });
  }, [plan, mode, track.kind, locale, store, pro, watermark, showName, firstName, sportLabel]);

  const shownT = exportState.status === 'running' ? exportT : player.t;
  const scene = useMemo(() => {
    // Tiles arrive into the store while the replay is paused: `tilesVersion` redraws the paused frame with them.
    void tilesVersion;
    return plan && builder ? builder(frameAt(plan, shownT)) : null;
  }, [plan, builder, shownT, tilesVersion]);

  // The live card keeps its real size and is shrunk from its top-left corner to the preview frame.
  const cardWidth = EXPORT_CARD_WIDTH;
  const fullHeight = (cardWidth * EXPORT_HEIGHT) / EXPORT_WIDTH;
  const maxFrameHeight = Math.max(screen.height * 0.55, 320);
  const frameWidth = Math.min(screen.width - spacing.lg * 2, (maxFrameHeight * cardWidth) / fullHeight);
  const scale = frameWidth / cardWidth;
  const frameHeight = fullHeight * scale;

  /** Our own one-button notice goes first, so the system Photos dialog is never a surprise; it always carries on to it. */
  const askPhotos: PhotosPrompt = photos.show;

  const finishVideo = useCallback((video: EncodedVideo | null) => {
    setExportState((prev) => {
      if (prev.status === 'done' && prev.video.uri !== video?.uri) deleteVideo(prev.video.uri);
      return video ? { status: 'done', video } : { status: 'idle' };
    });
  }, []);

  const renderFrame = useCallback(async (job: FrameJob): Promise<string> => {
    setExportT(job.t);
    await afterPaint();
    const card = cardRef.current;
    if (!card) throw new Error('card is not mounted');
    return captureRef(card, { format: FRAME_FORMAT, result: 'tmpfile', quality: 0.95, width: EXPORT_WIDTH, height: EXPORT_HEIGHT });
  }, []);

  const makeVideo = async () => {
    if (!plan || exportState.status === 'running') return;
    const ctl = new AbortController();
    abort.current = ctl;
    setFeedback(null);
    finishVideo(null);
    player.pause();
    setExportT(0);
    setExportState({ status: 'running', fraction: 0 });
    await activateKeepAwakeAsync('replay-export').catch(() => undefined);
    try {
      const video = await encodeReplay({
        totalSec: plan.timing.totalSec,
        speed: player.speed,
        renderFrame,
        signal: ctl.signal,
        onProgress: (p) => {
          if (p.frame % 6 === 0 || p.frame === p.frames) setExportState({ status: 'running', fraction: p.fraction });
        },
      });
      setExportState({ status: 'done', video });
    } catch (e) {
      setExportState({ status: 'idle' });
      if (e instanceof ExportCancelled) setFeedback({ tone: 'info', text: t('replay:export.cancelled') });
      else if (e instanceof EncoderUnsupportedError) setFeedback({ tone: 'danger', text: t('replay:export.errors.unsupported') });
      else setFeedback({ tone: 'danger', text: t('replay:export.errors.render', { error: errorMessage(e) }) });
    } finally {
      abort.current = null;
      deactivateKeepAwake('replay-export');
    }
  };

  const cancelVideo = () => abort.current?.abort();

  const close = () => {
    abort.current?.abort();
    if (exportState.status === 'done') deleteVideo(exportState.video.uri);
    setExportState({ status: 'idle' });
    player.pause();
    onClose();
  };

  const share = async (target: 'save' | 'instagram' | 'share') => {
    if (exportState.status !== 'done' || busy) return;
    const uri = exportState.video.uri;
    setBusy(target);
    setFeedback(null);
    try {
      if (target === 'save') {
        await saveVideo(uri, askPhotos);
        show(t('replay:export.saved'));
      } else if (target === 'instagram') {
        await shareVideoToInstagram(uri, t('replay:ui.caption'), askPhotos);
      } else {
        await shareVideoFile(uri, t('replay:ui.caption'));
      }
    } catch (e) {
      if (e instanceof PhotosDeniedError) {
        setFeedback({ tone: 'danger', text: e.message, action: { label: t('sharing:share.errors.openSettings'), onPress: () => void Linking.openSettings() } });
      } else {
        setFeedback({ tone: 'danger', text: t(`replay:export.errors.${target === 'save' ? 'save' : 'share'}`, { error: errorMessage(e) }) });
      }
    } finally {
      setBusy(null);
    }
  };

  const running = exportState.status === 'running';
  const speedSec = plan ? Math.round(playbackSec(plan.timing, player.speed)) : 0;
  const progress = plan ? Math.min(1, player.t / plan.timing.totalSec) : 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <AppText variant="heading" accessibilityRole="header" style={styles.headerTitle}>
            {t('replay:title')}
          </AppText>
          <PressableScale accessibilityRole="button" accessibilityLabel={t('common:actions.close')} onPress={close} style={styles.close}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {map.status === 'unavailable' ? (
            <Notice tone="info">{map.reason === 'too-short' ? t('replay:ui.tooShort') : t('replay:ui.noRoute')}</Notice>
          ) : null}

          {scene ? (
            <View style={[styles.stage, { backgroundColor: colors.muted, borderRadius: radius.card }]} accessibilityLabel={t('replay:ui.player')}>
              <View style={{ width: frameWidth, height: frameHeight, borderRadius: radius.input, overflow: 'hidden' }}>
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: cardWidth, height: fullHeight, transform: [{ scale }], transformOrigin: 'top left' }}>
                  <View ref={cardRef} collapsable={false}>
                    <ReplayPainter scene={scene} fonts={FIT_FONTS} width={cardWidth} />
                  </View>
                </View>
                {map.status === 'loading' ? (
                  <View style={styles.loading} pointerEvents="none">
                    <ActivityIndicator color="#ffffff" />
                    <AppText variant="caption" style={styles.loadingText}>
                      {t('replay:ui.loadingMap', { done: map.done, total: map.total })}
                    </AppText>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {ready && !running ? (
            <View style={styles.transport}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={player.playing ? t('replay:ui.pause') : player.ended ? t('replay:ui.restart') : t('replay:ui.play')}
                onPress={() => (player.playing ? player.pause() : player.play())}
                style={[styles.play, { backgroundColor: colors.primary }]}>
                <Ionicons name={player.playing ? 'pause' : player.ended ? 'refresh' : 'play'} size={22} color={colors.primaryForeground} />
              </PressableScale>
              <View style={[styles.track, { backgroundColor: colors.muted }]}>
                <View style={[styles.fill, { backgroundColor: colors.primary, width: `${progress * 100}%` }]} />
              </View>
            </View>
          ) : null}
          {map.status === 'ready' && map.offline ? <Notice tone="info">{t('replay:ui.offline')}</Notice> : null}

          {ready ? (
            <>
              <View style={styles.controls}>
                <Segmented
                  options={SPEEDS.map((s) => ({ value: s, label: t('replay:ui.speed', { speed: String(s).replace('.', locale === 'id' ? ',' : '.') }) }))}
                  value={player.speed}
                  onChange={(s: ReplaySpeed) => player.setSpeed(s)}
                  disabled={running}
                />
                <Segmented
                  options={[
                    { value: 'dark', label: t('replay:ui.theme.dark') },
                    { value: 'light', label: t('replay:ui.theme.light') },
                  ]}
                  value={mode}
                  onChange={setModePick}
                  disabled={running}
                />
              </View>
              <SwitchRow label={t('stickers:ui.routePrivacy.label')} hint={t('stickers:ui.routePrivacy.hint')} value={routePrivacy} onValueChange={setRoutePrivacy} disabled={running} />
              {firstName ? <SwitchRow label={t('replay:ui.showName.label')} hint={t('replay:ui.showName.hint')} value={showName} onValueChange={setShowName} disabled={running} /> : null}
              <SwitchRow
                label={t('stickers:ui.watermark.label')}
                hint={pro ? t('stickers:ui.watermark.hintPro') : t('stickers:ui.watermark.hintFree')}
                value={pro ? watermark : true}
                onValueChange={setWatermark}
                disabled={!pro || running}
              />
              <AppText variant="caption" muted style={styles.centered}>
                {t('replay:ui.length', { seconds: speedSec })}
              </AppText>
            </>
          ) : null}

          {feedback ? (
            <Notice tone={feedback.tone} action={feedback.action}>
              {feedback.text}
            </Notice>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md), borderTopColor: colors.hairline }]}>
          {running ? (
            <View style={styles.exporting}>
              <AppText variant="bodyStrong">{t('replay:export.progress', { percent: Math.round(exportState.fraction * 100) })}</AppText>
              <View style={[styles.track, { backgroundColor: colors.muted }]}>
                <View style={[styles.fill, { backgroundColor: colors.primary, width: `${exportState.fraction * 100}%` }]} />
              </View>
              <Button label={t('replay:export.cancel')} onPress={cancelVideo} variant="secondary" />
            </View>
          ) : exportState.status === 'done' ? (
            <View style={styles.exporting}>
              <AppText variant="bodyStrong">{t('replay:export.done')}</AppText>
              <AppText variant="caption" muted>
                {t('replay:export.size', { size: (exportState.video.bytes / 1_000_000).toFixed(1), fps: EXPORT_FPS })}
              </AppText>
              <View style={styles.targets}>
                {installed ? (
                  <TargetButton label={t('replay:export.instagram')} icon={<InstagramGlyph size={24} color={colors.foreground} />} loading={busy === 'instagram'} disabled={busy !== null} onPress={() => void share('instagram')} />
                ) : null}
                {SAVE_AVAILABLE ? (
                  <TargetButton label={t('replay:export.save')} icon={<Ionicons name="download-outline" size={24} color={colors.foreground} />} loading={busy === 'save'} disabled={busy !== null} onPress={() => void share('save')} />
                ) : null}
                <TargetButton label={t('replay:export.share')} icon={<Ionicons name="share-outline" size={24} color={colors.foreground} />} loading={busy === 'share'} disabled={busy !== null} onPress={() => void share('share')} />
              </View>
              {!SAVE_AVAILABLE ? <AppText variant="caption" muted>{t('replay:export.errors.saveUnavailable')}</AppText> : null}
              <Button label={t('replay:export.button')} icon="film-outline" onPress={() => void makeVideo()} variant="ghost" />
            </View>
          ) : (
            <Button label={t('replay:export.button')} icon="film-outline" variant="primary" disabled={!ready} onPress={() => void makeVideo()} />
          )}
        </View>

        {toast}
      </View>

      <NoticeDialog
        visible={photos.request !== null}
        title={t('sharing:share.photosDialog.title')}
        message={photos.request === 'instagram' ? t('replay:export.photosDialog.instagram') : t('replay:export.photosDialog.save')}
        confirmLabel={t('sharing:share.photosDialog.confirm')}
        onConfirm={photos.done}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, paddingRight: spacing.sm },
  headerTitle: { flex: 1 },
  close: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md },
  stage: { paddingVertical: spacing.md, alignItems: 'center' },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 140, gap: spacing.xs },
  loadingText: { color: '#ffffff' },
  centered: { textAlign: 'center' },
  transport: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  play: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  controls: { gap: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  exporting: { gap: spacing.sm },
  targets: { flexDirection: 'row', gap: spacing.sm },
  target: { flex: 1, minHeight: 84, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  targetIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
