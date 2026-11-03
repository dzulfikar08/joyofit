import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Linking, Modal, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PopIn, useFlash } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useToast } from '@/components/Toast';
import { InstagramGlyph } from '@/features/share/InstagramGlyph';
import { errorMessage } from '@/format';
import { useLocale, useTranslation } from '@/i18n';
import { HIT, overlay, spacing, useTheme } from '@/theme';

import { isMissing, lookupPath } from '../core/expr';
import type { ImageRef, StickerData } from '../core/resolve';
import type { Scene } from '../core/scene';
import { sceneFor, type Mode } from '../engine';
import { FIT_FONTS } from '../fonts';
import { ensureStickerFonts } from '../fontLoader';
import { hasCanvasChoice, initialGroup, offerGroups, pickVariant, sectionGroups, type OfferSection, type TemplateGroup } from '../offer';
import { pickStickerPhoto, type PhotoSource } from '../photo';
import {
  PhotosDeniedError,
  captureToFile,
  copyCardImage,
  instagramInstalled,
  saveCardImage,
  shareCardImage,
  shareToInstagram,
  type PhotosPrompt,
} from '../share/shareImage';
import { canSaveToLibrary } from '../share/shareTargets';
import { LruCache, hashText, thumbKey } from '../thumbCache';
import type { JsonObject, StickerSubject } from '../subject';
import type { SportCategory } from '@/features/workouts/sportCategory';
import { applyCustomMetrics, customSlotCount, type CustomMetricsConfig } from '../data/customMetrics';
import { MetricCustomizer } from './MetricCustomizer';
import { EXPORT_CARD_WIDTH, ScenePainter } from './ScenePainter';
import { templateTitle } from './templateTitle';
import { useStickerPro } from './useStickerPro';

/** Android 11 (API 30) is the first release where saving to Pictures needs no storage permission. */
const SAVE_AVAILABLE = canSaveToLibrary(Platform.OS === 'ios' ? 'ios' : 'android', Platform.OS === 'android' ? Number(Platform.Version) : 0);
const GRID_COLUMNS = 3;
const GRID_GAP = spacing.sm;
/** Cell frame height as a multiple of its width: tall enough for a Story card, a square or a sticker sits centered inside. */
const CELL_ASPECT = 1.6;
/** Thumbnail Scenes already built, by `thumbKey`: a cell that scrolls out and back, or a sheet re-render, rebuilds nothing. */
const sceneCache = new LruCache<Scene>(150);

/** One row of the picker list: a section title, or up to three cells. */
type GridRow = { key: string; kind: 'title'; section: OfferSection } | { key: string; kind: 'cells'; groups: TemplateGroup[] };

function gridRows(groups: readonly TemplateGroup[]): GridRow[] {
  return sectionGroups(groups).flatMap(({ section, groups: inSection }) => {
    const rows: GridRow[] = [{ key: `t-${section}`, kind: 'title', section }];
    for (let i = 0; i < inSection.length; i += GRID_COLUMNS) {
      const cells = inSection.slice(i, i + GRID_COLUMNS);
      rows.push({ key: `c-${cells[0]!.key}`, kind: 'cells', groups: cells });
    }
    return rows;
  });
}

type Target = 'instagram' | 'copy' | 'save' | 'more';
type CanvasPref = 'story' | 'square';

interface Feedback {
  tone: 'info' | 'danger';
  text: string;
  action?: { label: string; onPress: () => void };
}

interface PhotosRequest {
  purpose: 'save' | 'instagram';
  answer: (continues: boolean) => void;
}

/** Checkerboard behind a transparent sticker so the person sees what is and is not drawn. Dark squares for light-on-dark stickers. */
function Checker({ mode }: { mode: Mode }) {
  const dark = mode === 'dark';
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="checker" width={20} height={20} patternUnits="userSpaceOnUse">
          <Rect width={20} height={20} fill={dark ? overlay.checkerDark : '#E9E6DF'} />
          <Rect width={10} height={10} fill={dark ? overlay.checkerLight : '#F7F5F0'} />
          <Rect x={10} y={10} width={10} height={10} fill={dark ? overlay.checkerLight : '#F7F5F0'} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#checker)" />
    </Svg>
  );
}

interface TargetButtonProps {
  label: string;
  icon: ReactNode;
  loading: boolean;
  /** A check in place of the icon: the target just worked. */
  done?: boolean;
  disabled: boolean;
  onPress: () => void;
}

/** One big share target: round icon over a label, as in Strava's share row. */
function TargetButton({ label, icon, loading, done = false, disabled, onPress }: TargetButtonProps) {
  const { colors, fonts, radius } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.target, { backgroundColor: colors.muted, borderRadius: radius.card }]}>
      <View style={[styles.targetIcon, { backgroundColor: colors.card }]}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : done ? (
          <PopIn>
            <Ionicons name="checkmark" size={24} color={colors.primary} />
          </PopIn>
        ) : (
          icon
        )}
      </View>
      <AppText variant="label" numberOfLines={1} style={{ fontFamily: fonts.bold }}>
        {label}
      </AppText>
    </PressableScale>
  );
}

interface ThumbProps {
  group: TemplateGroup;
  canvas: CanvasPref;
  data: JsonObject;
  date?: number;
  dataHash: string;
  mode: Mode;
  options: StickerData['options'];
  photo: ImageRef | null;
  width: number;
  selected: boolean;
  label: string;
  onPress: () => void;
}

/**
 * A grid cell: the real Scene of the style, with the person's workout data and chosen photo, painted once at thumbnail size.
 * The list only mounts cells near the screen and the Scene comes from `sceneCache`, so scrolling never rebuilds them.
 */
const Thumb = memo(function Thumb({ group, canvas, data, date, dataHash, mode, options, photo, width, selected, label, onPress }: ThumbProps) {
  const { colors, radius } = useTheme();
  const locale = useLocale();
  const template = pickVariant(group, canvas);
  const scene = useMemo(
    () =>
      sceneCache.getOrCreate(thumbKey({ templateId: template.id, dataHash, date, photoUri: photo?.uri ?? null, locale, mode, options }), () =>
        sceneFor(template, data, { locale, mode, options, date, assets: photo ? { photo } : undefined }),
      ),
    [template, data, date, dataHash, photo, locale, mode, options],
  );
  const frameHeight = width * CELL_ASPECT;
  const paintWidth = Math.min(width, (frameHeight * scene.width) / scene.height);
  const paintHeight = (paintWidth * scene.height) / scene.width;
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={{ width }}>
      <View
        style={{
          width,
          height: frameHeight,
          borderRadius: radius.tile + 3,
          borderWidth: 3,
          borderColor: selected ? colors.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.muted,
        }}>
        <View style={{ width: paintWidth, height: paintHeight, borderRadius: radius.tile, overflow: 'hidden' }}>
          {scene.transparent ? <Checker mode={mode} /> : null}
          <ScenePainter scene={scene} fonts={FIT_FONTS} width={paintWidth} />
        </View>
        {selected ? (
          <View style={[styles.check, { backgroundColor: colors.primary }]}>
            <Ionicons name="checkmark" size={14} color={colors.primaryForeground} />
          </View>
        ) : null}
      </View>
      <AppText variant="caption" numberOfLines={1} muted={!selected} style={styles.thumbLabel}>
        {label}
      </AppText>
    </PressableScale>
  );
});

/**
 * The sticker composer: a picker of every template that fits the subject (card, transparent sticker, photo card, badge), the
 * live Scene at the real export size, Story / Square, dark / light, the privacy and watermark switches, the person's own photo
 * for photo templates, and the Instagram, Copy, Save and More targets. One painter draws the preview, the thumbnails and the
 * exported PNG (1080 px wide on every phone).
 */
export function StickerSheet({
  subject,
  visible,
  onClose,
  onThreads,
}: {
  subject: StickerSubject;
  visible: boolean;
  onClose: () => void;
  /**
   * Shows the Threads button. The button closes this sheet and calls `onThreads` once it is gone (iOS presents one modal at a
   * time), so the caller only opens the Threads carousel sheet there.
   */
  onThreads?: () => void;
}) {
  const { colors, radius, scheme } = useTheme();
  const { t } = useTranslation(['stickers', 'sharing', 'common']);
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const { toast, show } = useToast();
  const pro = useStickerPro();
  const cardRef = useRef<View>(null);

  const groups = useMemo(() => offerGroups(subject), [subject]);
  const rows = useMemo(() => gridRows(groups), [groups]);
  const listRef = useRef<FlatList<GridRow>>(null);
  const cellWidth = (screen.width - spacing.lg * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<CanvasPref>('story');
  const [modePick, setModePick] = useState<Mode | null>(null);
  const [routePrivacy, setRoutePrivacy] = useState(true);
  const [watermark, setWatermark] = useState(true);
  const [photo, setPhoto] = useState<ImageRef | null>(null);
  const [busy, setBusy] = useState<Target | 'photo' | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [installed, setInstalled] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const [settled, setSettled] = useState<{ scene: Scene; failed: boolean } | null>(null);
  const [photosRequest, setPhotosRequest] = useState<PhotosRequest | null>(null);
  const [copied, flashCopied] = useFlash(1400);
  const [saved, flashSaved] = useFlash(1400);
  const threadsPending = useRef(false);

  useEffect(() => {
    if (!visible) return;
    void instagramInstalled().then(setInstalled);
    void ensureStickerFonts().then(() => setFontsReady(true));
  }, [visible]);

  const runData = subject.data.run as JsonObject | undefined;
  const category = (runData?.category as SportCategory | undefined) ?? 'run';
  // Null until the person edits the numbers: every card then draws its own fixed cells, exactly as without the customizer.
  const [metricsConfig, setMetricsConfig] = useState<CustomMetricsConfig | null>(null);

  // A new subject (another workout) starts from the card that fits its sport; a filter that no longer has the chosen group moves on.
  const [seenSubjectId, setSeenSubjectId] = useState(subject.id);
  if (seenSubjectId !== subject.id) {
    setSeenSubjectId(subject.id);
    setGroupKey(null);
    setPhoto(null);
    setFeedback(null);
    setMetricsConfig(null);
  }

  const activeData = useMemo(
    () => (metricsConfig ? applyCustomMetrics(subject.data, metricsConfig, { locale }) : subject.data),
    [subject.data, metricsConfig, locale],
  );

  const dataHash = useMemo(() => hashText(JSON.stringify(activeData)), [activeData]);

  const group = groups.find((g) => g.key === groupKey) ?? initialGroup(groups, subject);
  const template = useMemo(() => (group ? pickVariant(group, canvas) : null), [group, canvas]);
  const mode: Mode = modePick ?? scheme;
  const hasRoute = !isMissing(lookupPath(subject.data, 'run.route'));

  const options = useMemo<StickerData['options']>(
    () => ({ watermark: pro ? watermark : true, hideNumbers: false, showName: false, privacy: { routeTrimMeters: routePrivacy ? 200 : 0 } }),
    [pro, watermark, routePrivacy],
  );
  const scene = useMemo(
    () => (template ? sceneFor(template, activeData, { locale, mode, options, date: subject.date, assets: photo ? { photo } : undefined }) : null),
    [template, activeData, subject.date, locale, mode, options, photo],
  );

  const needsPhoto = group?.needsPhoto === true;
  const imagesReady = scene !== null && settled?.scene === scene && !settled.failed;
  const photoFailed = settled !== null && settled.scene === scene && settled.failed;
  const ready = fontsReady && scene !== null && (!needsPhoto || photo !== null) && imagesReady;

  // The live card keeps its real size and is shrunk from its top-left corner to fill the frame.
  const fullHeight = scene ? (EXPORT_CARD_WIDTH * scene.height) / scene.width : 0;
  const maxFrameHeight = Math.max(screen.height * 0.42, 240);
  const stagePadding = spacing.md;
  const maxFrameWidth = Math.max(screen.width - spacing.lg * 2 - stagePadding * 2, 0);
  const frameWidth = scene ? Math.min(maxFrameWidth, (maxFrameHeight * EXPORT_CARD_WIDTH) / fullHeight) : 0;
  const scale = frameWidth / EXPORT_CARD_WIDTH;
  const frameHeight = fullHeight * scale;
  const innerRadius = Math.max(radius.card - stagePadding, radius.input);

  const pickGroup = (key: string) => {
    setGroupKey(key);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const addPhoto = async (source: PhotoSource) => {
    if (busy) return;
    setBusy('photo');
    setFeedback(null);
    try {
      const picked = await pickStickerPhoto(source);
      if (picked) setPhoto(picked);
    } catch (e) {
      setFeedback({ tone: 'danger', text: t(source === 'camera' ? 'sharing:share.errors.photoTake' : 'sharing:share.errors.photoLoad', { error: errorMessage(e) }) });
    } finally {
      setBusy(null);
    }
  };

  /** Our own "Continue" dialog goes first, so the system Photos dialog is never a surprise. */
  const askPhotos: PhotosPrompt = (purpose) => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    setPhotosRequest({ purpose, answer: resolve });
    return promise;
  };

  const answerPhotos = (continues: boolean) => {
    photosRequest?.answer(continues);
    setPhotosRequest(null);
  };

  const run = async (target: Target) => {
    const card = cardRef.current;
    if (!card || !scene || busy) return;
    const size = { width: scene.width, height: scene.height };
    setBusy(target);
    setFeedback(null);
    try {
      if (target === 'copy') {
        await copyCardImage(card, size);
        show(t('sharing:share.toasts.copied'));
        flashCopied();
      } else if (target === 'more') {
        await shareCardImage(await captureToFile(card, size), subject.caption);
      } else if (target === 'save') {
        if (await saveCardImage(await captureToFile(card, size), askPhotos)) {
          show(t('sharing:share.toasts.saved'));
          flashSaved();
        }
      } else {
        await shareToInstagram(await captureToFile(card, size), scene.transparent, subject.caption, askPhotos);
      }
    } catch (e) {
      if (e instanceof PhotosDeniedError) {
        setFeedback({ tone: 'danger', text: e.message, action: { label: t('sharing:share.errors.openSettings'), onPress: () => void Linking.openSettings() } });
      } else {
        const key = target === 'copy' ? 'copy' : target === 'save' ? 'save' : 'share';
        setFeedback({ tone: 'danger', text: t(`sharing:share.errors.${key}`, { error: errorMessage(e) }) });
      }
    } finally {
      setBusy(null);
    }
  };

  /** iOS reports the end of the dismissal through the Modal's `onDismiss`; Android stacks dialogs, so it hands over at once. */
  const openThreads = () => {
    if (Platform.OS === 'ios') {
      threadsPending.current = true;
      onClose();
    } else {
      onClose();
      onThreads?.();
    }
  };

  const hint = scene?.transparent ? t('stickers:ui.hint.sticker') : needsPhoto ? t('stickers:ui.hint.photo') : t('stickers:ui.hint.card');
  const idle = ready && busy === null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={() => {
        if (!threadsPending.current) return;
        threadsPending.current = false;
        onThreads?.();
      }}
      statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <AppText variant="heading" accessibilityRole="header" style={styles.headerTitle}>
            {subject.heading}
          </AppText>
          <PressableScale accessibilityRole="button" accessibilityLabel={t('common:actions.close')} onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </PressableScale>
        </View>

        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          initialNumToRender={6}
          maxToRenderPerBatch={4}
          windowSize={5}
          removeClippedSubviews
          extraData={`${mode}${locale}${canvas}${group?.key ?? ''}${photo?.uri ?? ''}${dataHash}`}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
            <View style={[styles.stage, { backgroundColor: colors.muted, borderRadius: radius.card }]}>
              {scene ? (
                <View
                  style={{
                    width: frameWidth,
                    height: frameHeight,
                    borderRadius: innerRadius,
                    overflow: 'hidden',
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.hairline,
                  }}>
                  {scene.transparent ? <Checker mode={mode} /> : null}
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: EXPORT_CARD_WIDTH,
                      height: fullHeight,
                      transform: [{ scale }],
                      transformOrigin: 'top left',
                    }}>
                    <View ref={cardRef} collapsable={false}>
                      <ScenePainter scene={scene} fonts={FIT_FONTS} onImagesSettled={(failed) => setSettled({ scene, failed: failed.length > 0 })} />
                    </View>
                  </View>
                </View>
              ) : null}
            </View>

            <AppText variant="caption" muted style={styles.centered}>
              {hint}
            </AppText>

            <View style={styles.controls}>
              {group && hasCanvasChoice(group) ? (
                <Segmented
                  options={[
                    { value: 'story', label: t('stickers:ui.canvas.story') },
                    { value: 'square', label: t('stickers:ui.canvas.square') },
                  ]}
                  value={canvas}
                  onChange={setCanvas}
                />
              ) : null}
              <Segmented
                options={[
                  { value: 'dark', label: t('stickers:ui.mode.dark') },
                  { value: 'light', label: t('stickers:ui.mode.light') },
                ]}
                value={mode}
                onChange={setModePick}
              />
            </View>

            {runData && template && customSlotCount(template) > 0 ? (
              <MetricCustomizer
                run={runData}
                category={category}
                config={metricsConfig}
                onChange={setMetricsConfig}
                slots={customSlotCount(template)}
              />
            ) : null}

            {needsPhoto ? (
              <View style={styles.row}>
                <Button
                  label={photo ? t('stickers:ui.photo.change') : t('stickers:ui.photo.choose')}
                  icon="images-outline"
                  loading={busy === 'photo'}
                  onPress={() => void addPhoto('library')}
                  style={styles.flex}
                />
                <Button label={t('stickers:ui.photo.take')} icon="camera-outline" disabled={busy !== null} onPress={() => void addPhoto('camera')} style={styles.flex} />
              </View>
            ) : null}
            {needsPhoto && photo === null ? (
              <AppText variant="caption" muted style={styles.centered}>
                {t('stickers:ui.photo.needed')}
              </AppText>
            ) : null}
            {photoFailed ? <Notice tone="danger">{t('stickers:ui.photo.failed')}</Notice> : null}

            </View>
          }
          renderItem={({ item }) =>
            item.kind === 'title' ? (
              <AppText variant="label" accessibilityRole="header" style={styles.sectionTitle}>
                {t(`stickers:ui.section.${item.section}`)}
              </AppText>
            ) : (
              <View style={styles.gridRow}>
                {item.groups.map((g) => (
                  <Thumb
                    key={g.key}
                    group={g}
                    canvas={canvas}
                    data={activeData}
                    date={subject.date}
                    dataHash={dataHash}
                    mode={mode}
                    options={options}
                    photo={photo}
                    width={cellWidth}
                    selected={g.key === group?.key}
                    label={templateTitle(g, locale)}
                    onPress={() => pickGroup(g.key)}
                  />
                ))}
              </View>
            )
          }
          ListFooterComponent={
            <View style={styles.footerBlock}>
            {hasRoute ? (
              <SwitchRow label={t('stickers:ui.routePrivacy.label')} hint={t('stickers:ui.routePrivacy.hint')} value={routePrivacy} onValueChange={setRoutePrivacy} />
            ) : null}
            <SwitchRow
              label={t('stickers:ui.watermark.label')}
              hint={pro ? t('stickers:ui.watermark.hintPro') : t('stickers:ui.watermark.hintFree')}
              value={pro ? watermark : true}
              onValueChange={setWatermark}
              disabled={!pro}
            />

            {feedback ? (
              <Notice tone={feedback.tone} action={feedback.action}>
                {feedback.text}
              </Notice>
            ) : null}
            </View>
          }
        />

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md), borderTopColor: colors.hairline }]}>
          {installed ? (
            <TargetButton label={t('sharing:share.targets.instagram')} icon={<InstagramGlyph size={24} color={colors.foreground} />} loading={busy === 'instagram'} disabled={!idle} onPress={() => void run('instagram')} />
          ) : null}
          {onThreads ? (
            <TargetButton label={t('sharing:share.targets.threads')} icon={<Ionicons name="at-outline" size={24} color={colors.foreground} />} loading={false} disabled={busy !== null} onPress={openThreads} />
          ) : null}
          <TargetButton label={t('sharing:share.targets.copy')} icon={<Ionicons name="copy-outline" size={24} color={colors.foreground} />} loading={busy === 'copy'} done={copied} disabled={!idle} onPress={() => void run('copy')} />
          {SAVE_AVAILABLE ? (
            <TargetButton label={t('sharing:share.targets.save')} icon={<Ionicons name="download-outline" size={24} color={colors.foreground} />} loading={busy === 'save'} done={saved} disabled={!idle} onPress={() => void run('save')} />
          ) : null}
          <TargetButton label={t('sharing:share.targets.more')} icon={<Ionicons name="share-outline" size={24} color={colors.foreground} />} loading={busy === 'more'} disabled={!idle} onPress={() => void run('more')} />
        </View>

        {toast}
      </View>

      <ConfirmDialog
        visible={photosRequest !== null}
        title={t('sharing:share.photosDialog.title')}
        message={photosRequest?.purpose === 'instagram' ? t('sharing:share.photosDialog.instagram') : t('sharing:share.photosDialog.save')}
        confirmLabel={t('sharing:share.photosDialog.confirm')}
        cancelLabel={t('sharing:share.photosDialog.cancel')}
        onConfirm={() => answerPhotos(true)}
        onCancel={() => answerPhotos(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, paddingRight: spacing.sm },
  headerTitle: { flex: 1 },
  close: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg },
  headerBlock: { gap: spacing.md },
  footerBlock: { gap: spacing.md, marginTop: spacing.md },
  sectionTitle: { marginTop: spacing.lg, marginBottom: spacing.sm },
  gridRow: { flexDirection: 'row', gap: GRID_GAP, marginBottom: spacing.sm },
  thumbLabel: { textAlign: 'center', marginTop: spacing.xs },
  check: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stage: { padding: spacing.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  centered: { textAlign: 'center' },
  controls: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  footer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  target: { flex: 1, minHeight: 84, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  targetIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
