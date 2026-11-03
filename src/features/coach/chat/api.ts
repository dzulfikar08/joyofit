import { RogoError, rogoCall } from '@/cloud/rogo';
import { guardHosted } from '@/features/ai/hostedChat';
import { aiSettings } from '@/features/ai/stores';
import { getLocale } from '@/i18n';
import type { CoachSnapshot } from './snapshot';

/** One turn of the conversation as the server takes it (content 1 to 2000 characters). */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const MAX_MESSAGE_CHARS = 2000;
/** The server keeps the last 12 turns of a request. */
export const MAX_TURNS = 12;

export interface ChatAnswer {
  reply: string;
  used: number;
  cap: number;
  /** The server's keyword pass found an injury or medical message: the reply is the fixed safe answer. */
  flagged: 'injury' | 'medical' | null;
}

export interface ChatStatus {
  unlocked: boolean;
  chatUsedToday: number;
  chatDailyCap: number;
}

/** How a failed chat call is worded: not Pro, the daily cap, or anything else (the server's own message). */
export type ChatFailure = { kind: 'paywall' } | { kind: 'cap' } | { kind: 'other'; message: string };

export function chatFailure(error: unknown): ChatFailure {
  if (error instanceof RogoError) {
    if (error.code === 'FORBIDDEN') return { kind: 'paywall' };
    if (error.code === 'TOO_MANY_REQUESTS') return { kind: 'cap' };
    return { kind: 'other', message: error.message };
  }
  return { kind: 'other', message: error instanceof Error ? error.message : String(error) };
}

export const coachChatStatus = (): Promise<ChatStatus> => rogoCall<ChatStatus>('coach/status', {});

const sendChat = (messages: readonly ChatTurn[], snapshot: CoachSnapshot): Promise<ChatAnswer> =>
  rogoCall<ChatAnswer>('coach/chat', { messages: messages.slice(-MAX_TURNS), snapshot, locale: getLocale() });

/**
 * The hosted Joyo AI: sends the chat and the snapshot to JoyoRogo's server, which has Cloudflare Workers AI answer. The only function in
 * the app that does; it throws `HostedConsentError` without sending anything unless the person agreed on this phone (`hostedConsent.ts`).
 */
export const coachChat = guardHosted(aiSettings, sendChat);
