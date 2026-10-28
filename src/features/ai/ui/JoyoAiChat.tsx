import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View, type ListRenderItemInfo, type TextInput } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { HeaderIconButton } from '@/components/HeaderIconButton';
import { PressableScale } from '@/components/PressableScale';
import { Card, Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { chatFailure, coachChat, MAX_MESSAGE_CHARS } from '@/features/coach/chat/api';
import { buildSnapshot } from '@/features/coach/chat/snapshot';
import { CoachSignIn } from '@/features/coach/ui/CoachGate';
import { useCoach } from '@/features/coach/useCoach';
import { useCoachAccess } from '@/features/coach/useCoachAccess';
import { UpgradeCard } from '@/features/pro/UpgradeCard';
import { useNightHrvAvailability } from '@/features/today/useNightHrvAvailability';
import { fmtInt, useLocale } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { useWatch } from '@/state/WatchProvider';
import { radius as radii, spacing, useColors } from '@/theme';
import { chatLines, type ChatMessage } from '../conversations';
import { askJoyoAi, warmDigestData } from '../engine';
import { hostOf } from '../providers';
import { useByokAccess } from '../hooks';
import { finishReply, type SafetyText } from '../safety';
import { aiChats, aiUsage } from '../stores';
import { AiError } from '../types';
import { AiErrorNotice } from './AiErrorNotice';
import {
  assistantMessage,
  createCoalescer,
  displayTitle,
  initialLive,
  lastIndexOfRole,
  parseSeed,
  partialOnStop,
  reduceLive,
  seedText,
  type LiveState,
} from './chatState';
import { Composer } from './Composer';
import { EngineChip } from './EngineChip';
import { GateCard } from './GateCard';
import { viewAiError, type AiErrorView } from './errors';
import { LiveMessage } from './LiveMessage';
import { HeaderBackButton } from '@/components/HiddenTabHeader';
import { MarqueeTitle } from './MarqueeTitle';
import { MessageView } from './MessageView';
import { RenameDialog } from './RenameDialog';
import { ownChipLabel } from './status';
import { useChatScroll } from './useChatScroll';
import { useRogoStatus } from './useRogoStatus';
import { OPEN_IN_STACK } from '@/components/navigation';

/** How often the growing text is shown: a fast stream is read into a ref at full speed and committed at most this often. */
const COMMIT_MS = 50;

/** A callback with a stable identity that always calls the latest closure (so memoised messages are not re-rendered by every token). */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

const loadCurrent = (): { id: string | null; messages: ChatMessage[] } => {
  const id = aiChats.current();
  const conversation = id ? aiChats.get(id) : null;
  return conversation ? { id: conversation.id, messages: conversation.messages } : { id: null, messages: [] };
};

/**
 * Joyo AI: the chat. Answers come from the person's own key (on the phone, streamed, with the tools it read shown as steps) or from
 * JoyoRogo's hosted coach (Pro, the whole reply at once), whichever Settings, Joyo AI says. Both write the same conversations.
 */
export function JoyoAiChat() {
  const { t } = useTranslation('ai');
  const { t: tc } = useTranslation('coach');
  useLocale();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ seed?: string; ref?: string; label?: string }>();
  const db = useSQLiteContext();
  const cloud = useCloud();
  const { dataVersion } = useWatch();
  const availability = useNightHrvAvailability(dataVersion);
  const coach = useCoach(dataVersion, availability);
  const coachAccess = useCoachAccess();
  const { access, settings } = useByokAccess();
  const { toast, show } = useToast();
  const scroll = useChatScroll();
  const follow = scroll.follow;
  // Back near the newest message during an answer: draw what has arrived meanwhile.
  useEffect(() => {
    scroll.onBack(() => {
      if (sendingRef.current) setLive(liveRef.current);
    });
  }, [scroll.onBack]);
  const inputRef = useRef<TextInput>(null);

  const seed = parseSeed(params);
  const seedKey = seed ? `${seed.kind}|${seed.ref}` : null;

  const [initial] = useState(() => (seedKey ? { id: null, messages: [] as ChatMessage[] } : loadCurrent()));
  const [conversationId, setConversationId] = useState<string | null>(initial.id);
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const idRef = useRef<string | null>(initial.id);
  const messagesRef = useRef<ChatMessage[]>(initial.messages);

  const [text, setText] = useState('');
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [live, setLive] = useState<LiveState | null>(null);
  const liveRef = useRef<LiveState>(initialLive());
  const liveId = useRef('live');
  const [aiError, setAiError] = useState<AiErrorView | null>(null);
  const [hostedError, setHostedError] = useState<string | null>(null);
  // The server refused the hosted chat because the account is not Pro (the phone's last known answer said it was).
  const [paywall, setPaywall] = useState(false);
  // A purchase or restore turned Pro on while the paywall notice was showing: it no longer applies.
  const [seenAccess, setSeenAccess] = useState(coachAccess);
  if (seenAccess !== coachAccess) {
    setSeenAccess(coachAccess);
    if (coachAccess === 'pro') setPaywall(false);
  }
  const [toolsOff, setToolsOff] = useState(false);
  const [usage, setUsage] = useState(() => aiUsage.today(Math.floor(Date.now() / 1000)));
  const [focusTick, setFocusTick] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [titleTick, setTitleTick] = useState(0);
  const insets = useSafeAreaInsets();

  const engine = settings.engine;
  const [rogoUsage, setRogoUsage] = useRogoStatus(engine === 'rogo' && coachAccess === 'pro');

  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  // Why the request was aborted: "user" keeps what arrived; "switch" (another chat opened) and a closed screen end quietly.
  const stopped = useRef<'user' | 'switch' | null>(null);
  // An answer that finishes after another chat was opened must not touch the screen.
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopped.current = 'switch';
      controller.current?.abort();
    };
  }, []);

  const setChat = useCallback((id: string | null, next: ChatMessage[]) => {
    idRef.current = id;
    messagesRef.current = next;
    setConversationId(id);
    setMessages(next);
  }, []);
  const setList = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  /** Shows a saved conversation, or an empty new one for null. A running answer is dropped quietly. */
  const open = useCallback(
    (id: string | null) => {
      generation.current += 1;
      stopped.current = 'switch';
      controller.current?.abort();
      const conversation = id ? aiChats.get(id) : null;
      setChat(conversation ? conversation.id : null, conversation?.messages ?? []);
      sendingRef.current = false;
      setSending(false);
      setLive(null);
      setText('');
      setEditing(null);
      setAiError(null);
      setHostedError(null);
      setPaywall(false);
      setToolsOff(false);
      follow();
    },
    [setChat, follow],
  );

  // Coming back from the history (or from Settings after the chats were deleted): show the chat the store says is open.
  useFocusEffect(
    useCallback(() => {
      if (seedKey) return;
      const current = aiChats.current();
      if (current !== idRef.current) open(current);
    }, [seedKey, open]),
  );

  // An entry point ("debrief this workout", "this night") opens a new chat with the question typed in, once per navigation, and leaves the sending to the person.
  const appliedSeed = useRef<string | null>(null);
  useEffect(() => {
    if (seedKey === null || seed === null) {
      appliedSeed.current = null;
      return;
    }
    if (appliedSeed.current === seedKey) return;
    appliedSeed.current = seedKey;
    aiChats.setCurrent(null);
    open(null);
    setText(seedText(seed, t));
    setFocusTick((n) => n + 1);
    router.setParams({ seed: undefined, ref: undefined, label: undefined });
  }, [seedKey, seed, open, router, t]);

  const gate: 'checking' | 'rogoSignIn' | 'rogoUpsell' | 'blocked' | 'ready' =
    engine === 'rogo'
      ? coachAccess === 'checking'
        ? 'checking'
        : coachAccess === 'signedOut'
          ? 'rogoSignIn'
          : coachAccess === 'free'
            ? 'rogoUpsell'
            : 'ready'
      : access === null
        ? 'checking'
        : access.ok
          ? 'ready'
          : 'blocked';
  const own = engine === 'byok' && access?.ok ? access : null;
  const composerReady = gate === 'ready' && coach !== null;

  useEffect(() => {
    if (focusTick === 0 || !composerReady) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [focusTick, composerReady]);

  // The diary and weight the digest needs are read while the person is still typing.
  const today = coach?.today ?? null;
  useEffect(() => {
    if (own && today) warmDigestData(today, cloud.signedIn);
  }, [own, today, cloud.signedIn]);

  const safetyText: SafetyText = {
    disclaimer: t('disclaimerLine'),
    refuseLeak: t('refuseLeak'),
    safe: { injury: t('safe.injury'), medical: t('safe.medical'), eatingDisorder: t('safe.eatingDisorder'), minorDiet: t('safe.minorDiet') },
  };

  /** Writes the answer to `history` (which ends with the question) into conversation `id`: streamed for the own key, whole for the hosted coach. */
  const answerFor = async (id: string, history: ChatMessage[]) => {
    if (!coach) return;
    const mine = generation.current;
    const current = (): boolean => mounted.current && generation.current === mine;
    const ctl = new AbortController();
    controller.current = ctl;
    stopped.current = null;
    sendingRef.current = true;
    setSending(true);
    setAiError(null);
    setHostedError(null);
    setPaywall(false);
    setToolsOff(false);
    liveRef.current = initialLive();
    // The finished answer takes the id of the live one, so the list keeps the same cell when the live text becomes the message.
    const replyId = aiChats.newMessageId();
    liveId.current = replyId;
    setLive(liveRef.current);
    const commit = createCoalescer(
      () => {
        // Away from the newest message the answer is not drawn (nothing under the person's eyes changes); it is drawn again when they come back.
        if (current() && !scroll.awayRef.current) setLive(liveRef.current);
      },
      COMMIT_MS,
      { now: Date.now, setTimer: (run, ms) => setTimeout(run, ms), clearTimer: (h) => clearTimeout(h as never) },
    );
    const finish = (messagesNow: ChatMessage[]) => {
      scroll.expectGrowth();
      setList(messagesNow);
      aiChats.setMessages(id, messagesNow);
    };
    try {
      let reply: ChatMessage;
      if (own) {
        const result = await askJoyoAi({
          db,
          coach,
          signedIn: cloud.signedIn,
          history: chatLines(history),
          text: safetyText,
          signal: ctl.signal,
          onEvent: (event) => {
            liveRef.current = reduceLive(liveRef.current, event);
            if (event.type === 'text' || event.type === 'reasoning') commit.schedule();
            else commit.flush();
          },
        });
        if (!current()) return;
        reply = assistantMessage({
          id: replyId,
          at: Date.now(),
          content: result.reply,
          engine: 'byok',
          ...(result.fixed ? {} : { provider: own.provider, model: own.model }),
          steps: result.fixed ? [] : result.steps,
          reasoning: result.fixed ? '' : result.reasoning,
          proposed: result.proposedNotes,
          fixed: result.fixed,
          tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
        });
        setToolsOff(result.toolsUnsupported);
      } else {
        // The hosted call cannot be cancelled on the wire: Stop stops waiting for it.
        const aborted = new Promise<never>((_, reject) => ctl.signal.addEventListener('abort', () => reject(new AiError('aborted')), { once: true }));
        const turns = chatLines(history).map((turn) => ({ ...turn, content: turn.content.slice(0, MAX_MESSAGE_CHARS) }));
        const result = await Promise.race([coachChat(turns, buildSnapshot(coach)), aborted]);
        if (!current()) return;
        reply = assistantMessage({ id: replyId, at: Date.now(), content: result.reply, engine: 'rogo', fixed: result.flagged !== null });
        setRogoUsage({ used: result.used, cap: result.cap });
      }
      commit.cancel();
      finish([...history, reply]);
    } catch (e) {
      if (!current()) return;
      if (e instanceof AiError && e.kind === 'aborted') {
        // Stop: what arrived stays as the answer, marked stopped; with nothing arrived only the question stays. No error either way.
        const rawPartial = own && stopped.current === 'user' ? partialOnStop(liveRef.current) : null;
        // The same cleaning and disclaimer rule as a finished answer, so a stopped answer about pain or medication still carries the line.
        const cleaned = rawPartial ? finishReply(rawPartial.content, { text: safetyText, lastUserText: history.findLast((m) => m.role === 'user')?.content ?? '', mode: { conservative: false, minor: false } }) : null;
        const partial = rawPartial && cleaned ? { ...rawPartial, content: cleaned } : null;
        if (partial) {
          commit.cancel();
          finish([...history, assistantMessage({ id: replyId, at: Date.now(), engine: 'byok', provider: own?.provider, model: own?.model, ...partial })]);
        }
        return;
      }
      if (own) {
        setAiError(viewAiError(e, t, { provider: own.provider, ceiling: settings.dailyCeiling }));
      } else {
        const failure = chatFailure(e);
        setPaywall(failure.kind === 'paywall');
        setHostedError(failure.kind === 'cap' ? tc('chat.capReached') : failure.kind === 'other' ? tc('chat.error', { message: failure.message }) : null);
      }
    } finally {
      commit.cancel();
      if (controller.current === ctl) controller.current = null;
      if (current()) {
        sendingRef.current = false;
        setSending(false);
        setLive(null);
        setUsage(aiUsage.today(Math.floor(Date.now() / 1000)));
      }
    }
  };

  /** Sends a question: a new one at the end, or (when editing) in place of an earlier one, dropping everything after it. */
  const submit = (raw: string) => {
    const content = raw.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!content || sendingRef.current || !composerReady) return;
    let id = idRef.current;
    let kept = messagesRef.current;
    if (editing && id) kept = aiChats.truncateFrom(id, editing.id);
    if (!id) id = aiChats.create(content).id;
    const question: ChatMessage = { id: aiChats.newMessageId(), role: 'user', content, at: Date.now() };
    const next = [...kept, question];
    setChat(id, next);
    aiChats.setMessages(id, next);
    setText('');
    setEditing(null);
    scroll.follow();
    void answerFor(id, next);
  };

  const stop = () => {
    stopped.current = 'user';
    controller.current?.abort();
  };

  const regenerate = useStable(() => {
    const id = idRef.current;
    const list = messagesRef.current;
    const last = list.length - 1;
    if (!id || sendingRef.current || last < 0 || list[last]!.role !== 'assistant') return;
    const kept = aiChats.truncateFrom(id, list[last]!.id);
    setList(kept);
    void answerFor(id, kept);
  });

  const retry = useStable(() => {
    const id = idRef.current;
    const list = messagesRef.current;
    if (!id || sendingRef.current || list.length === 0 || list[list.length - 1]!.role !== 'user') return;
    void answerFor(id, list);
  });

  const edit = useStable((message: ChatMessage) => {
    if (sendingRef.current) return;
    setEditing(message);
    setText(message.content);
    setFocusTick((n) => n + 1);
  });

  const cancelEdit = () => {
    setEditing(null);
    setText('');
  };

  const copy = useStable((message: ChatMessage) => {
    void Clipboard.setStringAsync(message.content).then(() => show(t('chat.copied')));
  });

  const resolveNote = useStable((messageId: string, note: string, saved: boolean) => {
    const id = idRef.current;
    const next = messagesRef.current.map((message) => {
      if (message.id !== messageId) return message;
      const { proposed, ...rest } = message;
      const left = (proposed ?? []).filter((n) => n !== note);
      return left.length > 0 ? { ...rest, proposed: left } : rest;
    });
    setList(next);
    if (id) aiChats.setMessages(id, next);
    if (saved) show(t('notes.saved'));
  });

  const startNew = () => {
    aiChats.setCurrent(null);
    open(null);
  };

  const chipLabel = own
    ? ownChipLabel(own, t)
    : engine === 'rogo'
      ? rogoUsage
        ? t('chip.rogoUsed', { used: fmtInt(rogoUsage.used), cap: fmtInt(rogoUsage.cap) })
        : t('chip.rogo')
      : t('chip.ownOff');

  const providerName = own ? (own.provider === 'custom' ? hostOf(own.baseUrl) : t(`provider.${own.provider}`)) : '';
  const lastUser = lastIndexOfRole(messages, 'user');
  const lastIndex = messages.length - 1;
  const lastMessage = messages[lastIndex];
  const flagged = !sending && lastMessage?.role === 'assistant' && lastMessage.fixed === true;
  // The title is stored with the conversation (the first question); a chat that has not been sent yet has none.
  const title = useMemo(
    () => displayTitle(conversationId ? (aiChats.list().find((m) => m.id === conversationId)?.title ?? '') : '', t('chat.newTitle')),
    // The first send fills the title in, so it is read again when the messages change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId, messages.length, titleTick, t],
  );

  const composer = composerReady ? (
    <Composer
      text={text}
      onChangeText={setText}
      onSend={() => submit(text)}
      onStop={stop}
      sending={sending}
      editing={editing !== null}
      onCancelEdit={cancelEdit}
      suggest={messages.length === 0 && text.length === 0 && !sending}
      onSuggest={submit}
      maxLength={MAX_MESSAGE_CHARS}
      inputRef={inputRef}
    />
  ) : undefined;

  const jump = scroll.away ? (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('chat.jump')}
      onPress={scroll.follow}
      scaleTo={0.96}
      style={[styles.jump, { backgroundColor: colors.card, borderColor: colors.hairline, borderRadius: radii.pill }]}>
      <Ionicons name="arrow-down" size={16} color={colors.foreground} />
      <AppText variant="label">{t('chat.jump')}</AppText>
    </PressableScale>
  ) : undefined;

  // Newest first: the list is inverted, so the newest message is at the bottom and growing text never moves what is above it.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      out.push({
        kind: 'msg',
        key: message.id,
        message,
        canEdit: i === lastUser,
        canRegenerate: i === lastIndex && message.role === 'assistant',
        canRetry: i === lastIndex && message.role === 'user' && !sending,
        busy: sending,
      });
    }
    return out;
  }, [messages, lastUser, lastIndex, sending]);
  const listReady = gate === 'ready' && coach !== null;
  const hosted = own === null;
  const data = useMemo<Row[]>(() => {
    if (!listReady) return [];
    return sending && live ? [{ kind: 'live', key: liveId.current, live, hosted }, ...rows] : rows;
  }, [listReady, sending, live, hosted, rows]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Row>) =>
      item.kind === 'live' ? (
        <LiveMessage live={item.live} hosted={item.hosted} />
      ) : (
        <MessageView
          message={item.message}
          canEdit={item.canEdit}
          canRegenerate={item.canRegenerate}
          canRetry={item.canRetry}
          busy={item.busy}
          onCopy={copy}
          onRegenerate={regenerate}
          onEdit={edit}
          onRetry={retry}
          onNote={resolveNote}
        />
      ),
    [copy, regenerate, edit, retry, resolveNote],
  );

  // At the bottom of the list (below the newest message): what the last answer left to say.
  const hasNotices = flagged || toolsOff || paywall || hostedError !== null || aiError !== null;
  const bottom = listReady && hasNotices ? (
    <View style={styles.notices}>
      {flagged ? <Notice icon="medkit">{tc('chat.flagged')}</Notice> : null}
      {toolsOff ? (
        <Notice icon="construct" action={{ label: t('errors.action.model'), onPress: () => router.push({ pathname: '/settings/ai', params: { model: '1' } }, OPEN_IN_STACK) }}>
          {t('chat.toolsOff')}
        </Notice>
      ) : null}
      {paywall ? <UpgradeCard moment="coach-chat" /> : null}
      {hostedError ? <Notice tone="danger">{hostedError}</Notice> : null}
      {aiError ? <AiErrorNotice view={aiError} provider={own?.provider ?? null} /> : null}
    </View>
  ) : null;

  // At the top of the list (above the oldest message): which engine answers, why nothing can, or the empty chat.
  const top = (
    <View style={styles.top}>
      <View style={styles.head}>
        <EngineChip label={chipLabel} />
        {own ? (
          <AppText variant="caption" muted>
            {t('chat.usageToday', { tokens: fmtInt(usage.inputTokens + usage.outputTokens), calls: fmtInt(usage.calls), ceiling: fmtInt(settings.dailyCeiling) })}
          </AppText>
        ) : null}
      </View>

      {gate === 'checking' ? <Skeleton width="100%" height={140} radius="card" /> : null}
      {gate === 'rogoSignIn' || gate === 'rogoUpsell' ? (
        <>
          {gate === 'rogoSignIn' ? <CoachSignIn /> : <UpgradeCard moment="coach-chat" />}
          <Card>
            <AppText variant="heading">{t('chat.ownTitle')}</AppText>
            <AppText variant="caption" muted>
              {t('chat.ownBody')}
            </AppText>
            <Button label={t('chat.ownCta')} variant="secondary" icon="key" onPress={() => router.push('/settings/ai-setup', OPEN_IN_STACK)} />
          </Card>
        </>
      ) : null}
      {gate === 'blocked' && access && !access.ok ? <GateCard reason={access.reason} provider={settings.provider} /> : null}
      {gate === 'ready' && !coach ? <Skeleton width="100%" height={220} radius="card" /> : null}
      {listReady && own && !cloud.signedIn ? (
        <Notice icon="restaurant" action={{ label: t('chat.signIn'), onPress: () => router.push('/settings/akun', OPEN_IN_STACK) }}>
          {t('chat.noFood')}
        </Notice>
      ) : null}
      {listReady && messages.length === 0 ? (
        <View style={styles.empty}>
          <AppText variant="heading">{tc('chat.emptyTitle')}</AppText>
          <AppText variant="caption" muted>
            {own ? t('chat.emptyOwn', { model: own.model, provider: providerName }) : tc('chat.emptyBody')}
          </AppText>
          <Details>
            <AppText variant="caption" muted>
              {own ? t('chat.privacyOwn', { provider: providerName, host: hostOf(own.baseUrl) }) : tc('chat.privacy')}
            </AppText>
            <AppText variant="caption" muted>
              {t('chat.disclaimer')}
            </AppText>
          </Details>
        </View>
      ) : null}
    </View>
  );

  const renderList = (padding: { paddingHorizontal: number; paddingTop: number; paddingBottom: number }) => (
    <FlatList
      ref={scroll.ref}
      data={data}
      renderItem={renderItem}
      keyExtractor={rowKey}
      inverted
      ItemSeparatorComponent={Gap}
      ListHeaderComponent={bottom}
      ListFooterComponent={top}
      // No native anchoring: the list only moves for the person (see useChatScroll).
      onScroll={scroll.scrollProps.onScroll}
      onContentSizeChange={scroll.scrollProps.onContentSizeChange}
      scrollEventThrottle={scroll.scrollProps.scrollEventThrottle}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      initialNumToRender={10}
      windowSize={9}
      // In an inverted list the native top is the bottom of the screen: swap the padding, and push a short chat to the top.
      contentContainerStyle={[styles.listContent, { paddingHorizontal: padding.paddingHorizontal, paddingTop: spacing.sm + scroll.room, paddingBottom: spacing.sm }]}
    />
  );

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs, backgroundColor: colors.background }]}>
        <HeaderBackButton />
        <View style={styles.headerTitle}>
          <MarqueeTitle title={title} hint={t('chat.renameHint')} onPress={conversationId ? () => setRenaming(true) : undefined} />
        </View>
        <HeaderIconButton icon="time-outline" label={t('chat.history')} onPress={() => router.dismissTo('/joyo/chats')} />
        <HeaderIconButton icon="add" label={t('chat.new')} onPress={startNew} />
      </View>
      <Screen footer={composer} overlay={composerReady ? jump : undefined} list={renderList}>
        {null}
      </Screen>
      {toast}
      <RenameDialog
        visible={renaming}
        title={title === t('chat.newTitle') ? '' : title}
        onClose={() => setRenaming(false)}
        onSave={(next) => {
          if (conversationId) aiChats.rename(conversationId, next);
          setTitleTick((n) => n + 1);
          setRenaming(false);
        }}
      />
    </View>
  );
}

type Row =
  | { kind: 'live'; key: string; live: LiveState; hosted: boolean }
  | { kind: 'msg'; key: string; message: ChatMessage; canEdit: boolean; canRegenerate: boolean; canRetry: boolean; busy: boolean };

const rowKey = (row: Row): string => row.key;
const Gap = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { gap: spacing.xs },
  top: { gap: spacing.lg, paddingBottom: spacing.lg },
  notices: { gap: spacing.md, paddingTop: spacing.md },
  empty: { gap: spacing.sm },
  gap: { height: spacing.lg },
  listContent: { flexGrow: 1, justifyContent: 'flex-end' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  headerTitle: { flex: 1, minWidth: 0 },
  jump: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth },
});
