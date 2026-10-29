import { useCallback, useEffect, useState } from 'react';

import { rogo, type RogoAttachable, type RogoAttachment, type RogoAttachmentInput } from '@/cloud/rogo';
import { useFlash } from '@/components/motion';
import {
  EMPTY_COMMENTS,
  addCreated,
  addReplyPage,
  appendPage,
  applyDeleted,
  refreshPage,
  toggleReplies,
  type CommentsState,
  type ReplyTarget,
  type Thread,
} from '@/features/social/commentThreads';
import { ownPhotoUrl } from '@/features/social/commentPhotoUrl';
import type { CommentImage } from '@/features/social/pickCommentImage';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { errorMessage } from '@/format';

/** JoyoRogo's limit for one comment. */
export const COMMENT_MAX = 280;

/** What the comment being written carries: a picked photo, or one of the person's own items. */
export type Pending =
  | { kind: 'image'; image: CommentImage }
  | { kind: 'item'; item: RogoAttachable };

/** The preview card data of a pending attachment, and where its picture is. */
export function pendingPreview(pending: Pending): { attachment: RogoAttachment; photo: { uri: string; local: boolean } | null } {
  if (pending.kind === 'image') {
    return {
      attachment: { kind: 'image', title: '', date: null, mapLine: null, hasPhoto: true, stats: {} },
      photo: { uri: pending.image.uri, local: true },
    };
  }
  const { preview, photoId } = pending.item;
  return { attachment: preview, photo: photoId ? { uri: ownPhotoUrl(photoId), local: false } : null };
}

/** What `useComments` hands to the list and to the pinned composer. */
export interface Comments {
  state: CommentsState;
  /** The first page has been read. */
  loaded: boolean;
  /** Why the first page could not be read; null otherwise. */
  error: string | null;
  draft: string;
  setDraft: (text: string) => void;
  replyTo: ReplyTarget | null;
  setReplyTo: (target: ReplyTarget | null) => void;
  pending: Pending | null;
  setPending: (pending: Pending | null) => void;
  sending: boolean;
  /** True for a moment after a comment went out. */
  sent: boolean;
  canSend: boolean;
  /** `'top'` while the next page of comments loads, a comment id while that thread's replies load. */
  loadingMore: string | null;
  problem: string | null;
  send: () => Promise<void>;
  loadMore: () => Promise<void>;
  showReplies: (thread: Thread) => Promise<void>;
  hideReplies: (id: string) => void;
  /** Deletes a comment; rejects when JoyoRogo refuses (the reason is also in `problem`). */
  remove: (id: string) => Promise<void>;
}

/**
 * The comments of one post and the box that writes them: top-level comments page by page, replies under each, the draft,
 * who it answers, what it carries. The screen reads the list and the composer from the same state, so replying from a row
 * fills the pinned composer. `onChanged` runs after a comment was added or removed, so the screen can reread the post's count.
 */
export function useComments(postId: string | null, enabled: boolean, onChanged: () => void): Comments {
  const load = useCallback(() => (postId ? rogo.social.comments(postId) : Promise.resolve({ items: [], nextCursor: null })), [postId]);
  const { data, error } = useRogoQuery(load, enabled && postId !== null);
  const [state, setState] = useState<CommentsState>(EMPTY_COMMENTS);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, flashSent] = useFlash(1600);

  const [seenData, setSeenData] = useState<typeof data | undefined>(undefined);
  if (data !== seenData) {
    setSeenData(data);
    if (data) setState((current) => refreshPage(current, data));
  }

  const canSend = !sending && (draft.trim().length > 0 || pending !== null);

  const send = useCallback(async () => {
    if (!postId || !canSend) return;
    setSending(true);
    setProblem(null);
    try {
      let attachment: RogoAttachmentInput | undefined;
      if (pending?.kind === 'image') {
        const { photoId } = await rogo.social.uploadCommentPhoto({ imageBase64: pending.image.base64, mimeType: pending.image.mimeType });
        attachment = { kind: 'image', photoId };
      } else if (pending) {
        attachment = { kind: pending.item.kind, refId: pending.item.refId };
      }
      const body = draft.trim();
      const created = await rogo.social.addComment({
        postId,
        ...(body ? { body } : {}),
        ...(replyTo ? { parentId: replyTo.commentId } : {}),
        ...(attachment ? { attachment } : {}),
      });
      setState((current) => addCreated(current, created.comment));
      setDraft('');
      setPending(null);
      setReplyTo(null);
      onChanged();
      flashSent();
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setSending(false);
    }
  }, [postId, canSend, pending, draft, replyTo, onChanged, flashSent]);

  const loadMore = useCallback(async () => {
    if (!postId || state.nextCursor === null) return;
    setLoadingMore('top');
    setProblem(null);
    try {
      const page = await rogo.social.comments(postId, state.nextCursor);
      setState((current) => appendPage(current, page));
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setLoadingMore(null);
    }
  }, [postId, state.nextCursor]);

  /** Opens the replies of a thread, reading the first page the first time and the next one when asked again. */
  const showReplies = useCallback(
    async (thread: Thread) => {
      const id = thread.comment.id;
      if (thread.repliesRead && thread.repliesCursor === null) {
        setState((current) => toggleReplies(current, id, true));
        return;
      }
      setLoadingMore(id);
      setProblem(null);
      try {
        const page = await rogo.social.commentReplies(id, thread.repliesRead ? (thread.repliesCursor ?? undefined) : undefined);
        setState((current) => addReplyPage(current, id, page));
      } catch (e) {
        setProblem(errorMessage(e));
      } finally {
        setLoadingMore(null);
      }
    },
    [],
  );

  const hideReplies = useCallback((id: string) => setState((current) => toggleReplies(current, id, false)), []);

  const remove = useCallback(
    async (id: string) => {
      setProblem(null);
      try {
        const { mode } = await rogo.social.deleteComment(id);
        setState((current) => applyDeleted(current, id, mode));
        setReplyTo((target) => (target?.commentId === id ? null : target));
        onChanged();
      } catch (e) {
        setProblem(errorMessage(e));
        throw e;
      }
    },
    [onChanged],
  );

  return {
    state,
    loaded: data !== null,
    error,
    draft,
    setDraft,
    replyTo,
    setReplyTo,
    pending,
    setPending,
    sending,
    sent,
    canSend,
    loadingMore,
    problem,
    send,
    loadMore,
    showReplies,
    hideReplies,
    remove,
  };
}
