import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authClient } from '@/cloud/auth';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { ChipRow } from '@/components/ChipRow';
import { NoticeDialog, useNotice } from '@/components/NoticeDialog';
import { useFlash } from '@/components/motion';
import { Input } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useToast } from '@/components/Toast';
import { errorMessage } from '@/format';
import { useLocale, useTranslation } from '@/i18n';
import { HIT, overlay, spacing, useTheme } from '@/theme';

import { isMissing, lookupPath } from '../core/expr';
import type { StickerData } from '../core/resolve';
import type { Scene } from '../core/scene';
import { sceneFor, type Mode } from '../engine';
import { ensureStickerFonts } from '../fontLoader';
import { FIT_FONTS } from '../fonts';
import { OS, PhotosDeniedError, captureToFile, type PhotosPrompt } from '../share/shareImage';
import { saveAllAndOpenThreads, shareThreadsCarousel, threadsInstalled } from '../share/shareThreads';
import { canSaveToLibrary } from '../share/shareTargets';
import type { StickerSubject } from '../subject';
import { THREADS_TEXT_MAX, buildCaption, questionsFor, type QuestionKey } from '../threads/caption';
import {
  THREADS_HEIGHT,
  THREADS_MAX_SLIDES,
  THREADS_WIDTH,
  enabledSlides,
  slideSetData,
  initialChoices,
  moveChoice,
  offeredSlides,
  reconcileChoices,
  toggleChoice,
} from '../threads/slides';
import { EXPORT_CARD_WIDTH, ScenePainter } from './ScenePainter';

/** Android 11 (API 30) is the first release where saving to Pictures needs no storage permission. */
const SAVE_AVAILABLE = canSaveToLibrary(OS, OS === 'android' ? Number(Platform.Version) : 0);
/** Width of the live slide in the "preparing" card. */
const STAGE_WIDTH = 200;
/** Slides are 1080 x 1350: the card is laid out at the export width and its height follows. */
const STAGE_FULL_HEIGHT = (EXPORT_CARD_WIDTH * THREADS_HEIGHT) / THREADS_WIDTH;

type Target = 'share' | 'save';

interface Feedback {
  tone: 'info' | 'danger';
  text: string;
  action?: { label: string; onPress: () => void };
}

/** Resolves after two frames, so a slide just mounted into the export stage has been drawn before it is captured. */
function afterPaint(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
}

interface PageProps {
  scene: Scene;
  /** Width of the page; the card inside keeps the slide's aspect and fits `cardWidth`. */
  pageWidth: number;
  cardWidth: number;
}

/** One page of the preview pager: the real Scene of a slide at card size (display only; the export is drawn by the stage). */
function SlidePage({ scene, pageWidth, cardWidth }: PageProps) {
  const { colors, radius } = useTheme();
  const height = (cardWidth * scene.height) / scene.width;
  return (
    <View style={{ width: pageWidth, alignItems: 'center' }}>
      <View style={{ width: cardWidth, height, borderRadius: radius.input, overflow: 'hidden', backgroundColor: colors.muted }}>
        <ScenePainter scene={scene} fonts={FIT_FONTS} width={cardWidth} />
      </View>
    </View>
  );
}

/**
 * The Threads composer: a carousel of 1080 x 1350 slides drawn by the sticker engine (one per kind of data the workout has),
 * the person's choice and order of slides, dark or light, the route and name switches, and an editable caption with a
 * question and the #JoyoFit tag. "Share to Threads" hands every PNG to the system share sheet (Threads drops text that comes with
 * images, so the text goes to the clipboard to be pasted); "Save all and open
 * Threads" saves them to the photo library, copies the text and opens the Threads composer, where the photo button picks them.
 * The JoyoFit branding is part of every slide and never goes away, Pro or not.
 */
export function ThreadsSheet({ subject, visible, onClose }: { subject: StickerSubject; visible: boolean; onClose: () => void }) {
  const { colors, radius, scheme } = useTheme();
  const { t } = useTranslation(['threadsshare', 'stickers', 'sharing', 'common']);
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const { toast, show } = useToast();
  const session = authClient.useSession();
  const firstName = session.data?.user?.name?.trim().split(/\s+/)[0] || null;
  const stageRef = useRef<View>(null);
  const pagerRef = useRef<FlatList>(null);
  const waiter = useRef<{ scene: Scene; resolve: () => void } | null>(null);

  const offered = useMemo(() => offeredSlides(subject), [subject]);
  const [choices, setChoices] = useState(() => initialChoices(offered));
  // The offer changes when the workout's data finishes loading: slides keep their place and state, new ones join the end.
  const [seenOffer, setSeenOffer] = useState(offered);
  if (seenOffer !== offered) {
    setSeenOffer(offered);
    setChoices(reconcileChoices(choices, offered));
  }
  const [limitHit, setLimitHit] = useState(false);
  const [modePick, setModePick] = useState<Mode | null>(null);
  const [routePrivacy, setRoutePrivacy] = useState(true);
  const [showRoute, setShowRoute] = useState(true);
  const [showName, setShowName] = useState(false);
  const [questionPick, setQuestionPick] = useState<QuestionKey | null | undefined>(undefined);
  const [hashtag, setHashtag] = useState(true);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<Target | null>(null);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const [stageScene, setStageScene] = useState<Scene | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const photos = useNotice<'save' | 'instagram'>();
  const [copied, flashCopied] = useFlash(1400);

  useEffect(() => {
    if (!visible) return;
    void threadsInstalled().then(setInstalled);
    void ensureStickerFonts().then(() => setFontsReady(true));
  }, [visible]);


  const mode: Mode = modePick ?? scheme;
  const hasRoute = !isMissing(lookupPath(subject.data, 'run.route'));
  const nameOn = showName && firstName !== null;
  const slides = useMemo(() => enabledSlides(choices, offered), [choices, offered]);

  const options = useMemo<StickerData['options']>(
    () => ({ watermark: true, hideNumbers: false, showName: nameOn, privacy: { routeTrimMeters: routePrivacy ? 200 : 0 } }),
    [nameOn, routePrivacy],
  );
  const datas = useMemo(
    () => slideSetData(subject, slides.length, { ...(hasRoute ? { showRoute } : {}), name: nameOn ? firstName : null }),
    [subject, slides.length, hasRoute, showRoute, nameOn, firstName],
  );
  const scenes = useMemo(() => slides.map((slide, i) => sceneFor(slide.template, datas[i]!, { locale, mode, options, date: subject.date })), [slides, datas, subject.date, locale, mode, options]);

  const questions = useMemo(() => questionsFor(subject), [subject]);
  const question = questionPick === undefined ? (questions[0] ?? null) : questionPick !== null && questions.includes(questionPick) ? questionPick : null;
  const generated = useMemo(
    () => buildCaption(subject, { locale, question, hashtag, slideCount: slides.length }),
    [subject, locale, question, hashtag, slides.length],
  );
  // The text is the person's to edit; it is rebuilt only when something it is built from changes.
  const [text, setText] = useState(generated);
  const [builtFrom, setBuiltFrom] = useState(generated);
  if (builtFrom !== generated) {
    setBuiltFrom(generated);
    setText(generated);
  }

  const pageWidth = screen.width - spacing.lg * 2;
  const cardWidth = Math.min(pageWidth, (Math.max(screen.height * 0.45, 260) * THREADS_WIDTH) / THREADS_HEIGHT);
  const pageItems = useMemo(() => scenes.map((scene, i) => ({ id: slides[i]!.id, scene })), [scenes, slides]);

  // Turning slides off can leave the pager past its last page: show the last one and scroll back to it.
  const current = Math.min(index, Math.max(pageItems.length - 1, 0));
  useEffect(() => {
    if (pageItems.length > 0 && index >= pageItems.length) pagerRef.current?.scrollToIndex({ index: pageItems.length - 1, animated: false });
  }, [pageItems.length, index]);

  const slideLabel = (id: string) => String(t(`stickers:threads.slide.${id}` as never));

  const toggle = (id: string) => {
    const next = toggleChoice(choices, id);
    setLimitHit(next.every((c, i) => c.enabled === choices[i]!.enabled));
    setChoices(next);
  };

  const move = (from: number, to: number) => setChoices((previous) => moveChoice(previous, from, to));

  const onPagerEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / pageWidth));
  };

  /** Our own one-button notice goes first, so the system Photos dialog is never a surprise; it always carries on to it. */
  const askPhotos: PhotosPrompt = photos.show;

  /** Mounts `scene` in the export stage; resolves once the painter has settled it. */
  const paintStage = (scene: Scene): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    waiter.current = { scene, resolve };
    setStageScene(scene);
    return promise;
  };

  /** Every enabled slide as a 1080 x 1350 PNG, in order, drawn one after another by the one on-screen stage. */
  const exportSlides = async (): Promise<string[]> => {
    await ensureStickerFonts();
    const uris: string[] = [];
    try {
      for (const [i, scene] of scenes.entries()) {
        setProgress({ n: i + 1, total: scenes.length });
        await paintStage(scene);
        await afterPaint();
        const card = stageRef.current;
        if (!card) throw new Error('export stage is not mounted'); // i18n-ok: developer message
        uris.push(await captureToFile(card, { width: THREADS_WIDTH, height: THREADS_HEIGHT }));
      }
    } finally {
      waiter.current = null;
      setStageScene(null);
      setProgress(null);
    }
    return uris;
  };

  const run = async (target: Target) => {
    if (busy || scenes.length === 0 || !fontsReady) return;
    setBusy(target);
    setFeedback(null);
    try {
      const uris = await exportSlides();
      if (target === 'share') {
        show(t('threadsshare:toasts.captionCopied'));
        await shareThreadsCarousel(uris, text);
      } else {
        await saveAllAndOpenThreads(uris, text, askPhotos);
        show(t('sharing:share.toasts.saved'));
      }
    } catch (e) {
      if (e instanceof PhotosDeniedError) {
        setFeedback({ tone: 'danger', text: e.message, action: { label: t('sharing:share.errors.openSettings'), onPress: () => void Linking.openSettings() } });
      } else {
        setFeedback({ tone: 'danger', text: t(target === 'save' ? 'sharing:share.errors.save' : 'sharing:share.errors.share', { error: errorMessage(e) }) });
      }
    } finally {
      setBusy(null);
    }
  };

  const copyText = async () => {
    await Clipboard.setStringAsync(text);
    show(t('sharing:share.toasts.copied'));
    flashCopied();
  };

  const close = () => {
    if (busy === null) onClose();
  };

  const idle = fontsReady && slides.length > 0 && busy === null;
  const stageScale = STAGE_WIDTH / EXPORT_CARD_WIDTH;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <AppText variant="heading" accessibilityRole="header" style={styles.headerTitle}>
            {subject.heading}
          </AppText>
          <PressableScale accessibilityRole="button" accessibilityLabel={t('common:actions.close')} disabled={busy !== null} onPress={close} style={styles.close}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={[styles.stage, { backgroundColor: colors.muted, borderRadius: radius.card }]}>
            <FlatList
              ref={pagerRef}
              horizontal
              pagingEnabled
              data={pageItems}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              style={{ width: pageWidth }}
              getItemLayout={(_, i) => ({ length: pageWidth, offset: pageWidth * i, index: i })}
              initialNumToRender={2}
              windowSize={3}
              onMomentumScrollEnd={onPagerEnd}
              renderItem={({ item }) => <SlidePage scene={item.scene} pageWidth={pageWidth} cardWidth={cardWidth} />}
            />
            {pageItems.length > 0 ? (
              <AppText variant="caption" muted accessibilityLabel={t('threadsshare:pager.position', { n: current + 1, total: pageItems.length })}>
                {`${current + 1}/${pageItems.length}`}
              </AppText>
            ) : null}
          </View>

          {offered.length === 0 ? <Notice>{t('threadsshare:slides.empty')}</Notice> : null}

          <Segmented
            options={[
              { value: 'dark', label: t('stickers:ui.mode.dark') },
              { value: 'light', label: t('stickers:ui.mode.light') },
            ]}
            value={mode}
            onChange={setModePick}
          />

          <View style={styles.section}>
            <AppText variant="bodyStrong">{t('threadsshare:slides.title')}</AppText>
            <AppText variant="caption" muted>
              {t('threadsshare:slides.hint', { max: THREADS_MAX_SLIDES })}
            </AppText>
            {choices.map((choice, i) => {
              const name = slideLabel(choice.id);
              return (
                <View key={choice.id} style={styles.slideRow}>
                  <View style={styles.flex}>
                    <SwitchRow label={name} value={choice.enabled} onValueChange={() => toggle(choice.id)} />
                  </View>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={t('threadsshare:slides.moveUp', { name })}
                    disabled={i === 0}
                    onPress={() => move(i, i - 1)}
                    style={styles.move}>
                    <Ionicons name="chevron-up" size={22} color={colors.foreground} />
                  </PressableScale>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={t('threadsshare:slides.moveDown', { name })}
                    disabled={i === choices.length - 1}
                    onPress={() => move(i, i + 1)}
                    style={styles.move}>
                    <Ionicons name="chevron-down" size={22} color={colors.foreground} />
                  </PressableScale>
                </View>
              );
            })}
            {limitHit ? <Notice>{t('threadsshare:slides.limit', { max: THREADS_MAX_SLIDES })}</Notice> : null}
          </View>

          {hasRoute ? (
            <>
              <SwitchRow label={t('stickers:ui.routePrivacy.label')} hint={t('stickers:ui.routePrivacy.hint')} value={routePrivacy} onValueChange={setRoutePrivacy} />
              <SwitchRow label={t('threadsshare:route.show.label')} hint={t('threadsshare:route.show.hint')} value={showRoute} onValueChange={setShowRoute} />
            </>
          ) : null}
          {firstName ? <SwitchRow label={t('threadsshare:name.label')} hint={t('threadsshare:name.hint')} value={showName} onValueChange={setShowName} /> : null}

          <View style={styles.section}>
            <AppText variant="bodyStrong">{t('threadsshare:caption.title')}</AppText>
            <Input
              accessibilityLabel={t('threadsshare:caption.label')}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={THREADS_TEXT_MAX}
              style={styles.captionInput}
            />
            <AppText variant="caption" muted accessibilityLabel={t('threadsshare:caption.counter', { n: text.length, max: THREADS_TEXT_MAX })} style={styles.counter}>
              {`${text.length}/${THREADS_TEXT_MAX}`}
            </AppText>
            <AppText variant="label" muted>
              {t('threadsshare:caption.question')}
            </AppText>
            <ChipRow
              inset={spacing.lg}
              items={[
                ...questions.map((key) => ({
                  key,
                  label: t(`stickers:threads.caption.question.${key}`),
                  selected: question === key,
                  onPress: () => setQuestionPick(key),
                })),
                { key: 'none', label: t('threadsshare:caption.noQuestion'), selected: question === null, onPress: () => setQuestionPick(null) },
              ]}
            />
            <SwitchRow label={t('threadsshare:caption.hashtag.label')} hint={t('threadsshare:caption.hashtag.hint')} value={hashtag} onValueChange={setHashtag} />
          </View>

          <Notice>{t('threadsshare:branding')}</Notice>
          <Details>
            <AppText variant="caption" muted>
              {t('threadsshare:actions.pasteHint')}
            </AppText>
            {SAVE_AVAILABLE ? (
              <AppText variant="caption" muted>
                {t('threadsshare:actions.saveOpenHint')}
              </AppText>
            ) : null}
          </Details>

          {feedback ? (
            <Notice tone={feedback.tone} action={feedback.action}>
              {feedback.text}
            </Notice>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md), borderTopColor: colors.hairline }]}>
          <Button
            label={t('threadsshare:actions.share')}
            icon="at-outline"
            variant={installed === false ? 'secondary' : 'primary'}
            loading={busy === 'share'}
            disabled={!idle}
            onPress={() => void run('share')}
          />
          <View style={styles.row}>
            {SAVE_AVAILABLE ? (
              <Button
                label={t('threadsshare:actions.saveOpen')}
                icon="download-outline"
                variant={installed === false ? 'primary' : 'secondary'}
                lines={2}
                loading={busy === 'save'}
                disabled={!idle}
                onPress={() => void run('save')}
                style={styles.saveButton}
              />
            ) : null}
            <Button label={t('threadsshare:actions.copy')} icon="copy-outline" variant="ghost" done={copied} onPress={() => void copyText()} style={styles.flex} />
          </View>
        </View>

        {progress ? (
          <View style={[StyleSheet.absoluteFill, styles.scrim]}>
            <View style={[styles.progressCard, { backgroundColor: colors.card, borderRadius: radius.card }]}>
              <AppText variant="bodyStrong">{t('threadsshare:progress.title', { n: progress.n, total: progress.total })}</AppText>
              {stageScene ? (
                <View style={{ width: STAGE_WIDTH, height: STAGE_FULL_HEIGHT * stageScale, borderRadius: radius.input, overflow: 'hidden', backgroundColor: colors.muted }}>
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: EXPORT_CARD_WIDTH,
                      height: STAGE_FULL_HEIGHT,
                      transform: [{ scale: stageScale }],
                      transformOrigin: 'top left',
                    }}>
                    <View ref={stageRef} collapsable={false}>
                      <ScenePainter
                        scene={stageScene}
                        fonts={FIT_FONTS}
                        onImagesSettled={() => {
                          if (waiter.current?.scene !== stageScene) return;
                          waiter.current.resolve();
                          waiter.current = null;
                        }}
                      />
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {toast}
      </KeyboardAvoidingView>

      <NoticeDialog
        visible={photos.request !== null}
        title={t('sharing:share.photosDialog.title')}
        message={photos.request === 'instagram' ? t('sharing:share.photosDialog.instagram') : t('sharing:share.photosDialog.save')}
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
  stage: { paddingVertical: spacing.md, alignItems: 'center', gap: spacing.sm },
  section: { gap: spacing.sm },
  slideRow: { flexDirection: 'row', alignItems: 'center' },
  move: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  captionInput: { minHeight: 140, paddingVertical: spacing.md, textAlignVertical: 'top' },
  counter: { textAlign: 'right' },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  saveButton: { flex: 2 },
  footer: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  scrim: { backgroundColor: overlay.scrim, alignItems: 'center', justifyContent: 'center' },
  progressCard: { alignItems: 'center', gap: spacing.md, padding: spacing.lg },
});
