import { NotSignedInError } from '@/cloud/api';
import { authClient } from '@/cloud/auth';
import { JOYOROGO_URL } from '@/cloud/config';
import { getLocale, t } from '@/i18n';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import type { SportKind } from '@/features/social/feedRoute';

/**
 * Minimal client for JoyoRogo's oRPC API (`packages/api` in the joyorogo repo, mounted at `<server>/rpc`).
 *
 * oRPC's RPC wire format, as `RPCLink` speaks it (checked in @orpc/client 1.15): `POST <url>/rpc/<router>/<procedure>` with the
 * JSON body `{"json": <input>}` and the JoyoRogo session cookie in a `Cookie` header (better-auth's expo client keeps it in
 * secure storage); a 2xx answer is `{"json": <output>, "meta": [...]}`, an error is `{"json": {"defined", "code", "status",
 * "message", "data"}}`. `meta` only describes Date / BigInt values and is ignored here: dates arrive as ISO strings.
 * Types below are written by hand to match the procedures used; nothing in JoyoRogo is changed for this.
 */

/** JoyoRogo answered with an oRPC error (or a non-JSON failure). */
export class RogoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;

/** `<router>/<procedure>`, for example `food/listByDate`. */
export async function rogoCall<T>(path: string, input: unknown): Promise<T> {
  const cookie = await authClient.getCookie();
  if (!cookie) throw new NotSignedInError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${JOYOROGO_URL}/rpc/${path}`, {
      method: 'POST',
      headers: { Cookie: cookie, Accept: 'application/json', 'Content-Type': 'application/json', 'x-locale': getLocale() },
      body: JSON.stringify({ json: input }),
      credentials: 'omit',
      signal: controller.signal,
    });
    const text = await response.text();
    let body: { json?: unknown } | null = null;
    try {
      body = text ? (JSON.parse(text) as { json?: unknown }) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = (body?.json ?? null) as { code?: unknown; message?: unknown } | null;
      const code = typeof error?.code === 'string' ? error.code : null;
      const message = typeof error?.message === 'string' ? error.message : t('common:errors.rogoAnswered', { status: response.status });
      throw new RogoError(response.status, code, response.status === 401 ? t('common:errors.sessionRejectedShort') : message);
    }
    return body?.json as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Meal values of JoyoRogo's `food_log.meal`. */
export type RogoMeal = 'sarapan' | 'makan_siang' | 'makan_malam' | 'snack';

/** A `food_log` row as `food.listByDate` returns it (only the fields JoyoFit reads). */
export interface RogoFoodItem {
  id: string;
  /** `YYYY-MM-DD`, Jakarta day. */
  date: string;
  meal: RogoMeal;
  name: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** ISO timestamp (a JS Date in JoyoRogo, serialized by oRPC). */
  createdAt: string;
}

export interface RogoFoodDay {
  items: RogoFoodItem[];
  totals: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
}

/** `profile.myProfile`: the profile row and today's computed targets (`Targets` in packages/api/src/lib/engine.ts). */
export interface RogoMyProfile {
  profile: {
    heightCm: number;
    gender: string;
    startWeightKg: number;
    targetWeightKg: number;
    targetDate: string;
  } | null;
  targets: {
    /** Basal metabolic rate, kcal per day. */
    bmr: number;
    tdee: number;
    /** The daily kcal to eat: the target for the intake card. */
    eatKcal: number;
    /** Planned daily burn through activity, kcal. */
    burnKcal: number;
    /** Planned daily deficit, kcal. */
    deficitKcal: number;
  } | null;
  latestWeightKg: number | null;
}

export interface RogoWeightEntry {
  /** `YYYY-MM-DD`. */
  date: string;
  weightKg: number;
  createdAt: string;
}

/** JoyoFit's readiness word, as `fitness.upsertScores` accepts it. */
export type RogoReadiness = 'Primed' | 'Balanced' | 'Strained' | 'Run down';

/** Values of the `hrvStatus` field of `fitness.upsertScores` (JoyoFit's HRV status against the personal range). */
export type RogoHrvStatus = 'balanced' | 'unbalanced' | 'low';

/** Values of the `trainingStatus` field of `fitness.upsertScores` (JoyoFit's acute : chronic load status). */
export type RogoTrainingStatus = 'productive' | 'maintaining' | 'recovery' | 'overreaching' | 'detraining';

/**
 * The daily body metrics of `fitness.upsertScores`, every one optional: a metric JoyoFit has not computed is left out (never
 * zero), and JoyoRogo keeps what it stored for it. Today's entry carries all of them; an earlier day carries only `sleepHours`.
 *  - sleepHours 0..24: hours asleep on that day (the night that ended on it plus that day's naps), which JoyoRogo shows as that day's sleep.
 *  - restingHr integer bpm 25..220: the watch's resting heart rate of the day.
 *  - hrvMs 1..500: average overnight RMSSD of the night that ended that day.
 *  - hrvStatus: the last 7 nights against the personal range.
 *  - vo2max 10..90 ml/kg/min: the watch's value or JoyoFit's estimate.
 *  - trainingStatus and loadRatio 0..10: the 7-day : 28-day load ratio and its band.
 *  - recoveryHours integer 0..240: recovery time still left.
 */
export interface RogoScoreMetrics {
  sleepHours?: number;
  restingHr?: number;
  hrvMs?: number;
  hrvStatus?: RogoHrvStatus;
  vo2max?: number;
  trainingStatus?: RogoTrainingStatus;
  loadRatio?: number;
  recoveryHours?: number;
}

/**
 * One day of scores for `fitness.upsertScores`. `date` is `YYYY-MM-DD`; a score that is left out keeps what JoyoRogo has
 * stored for that day. Ranges: recoveryPct 0..100, strain 0..21, sleepPct 0..300, activeKcal 0..20000. Past days carry strain,
 * activeKcal and sleepHours only; today's entry also carries the {@link RogoScoreMetrics} JoyoFit has computed for it.
 */
export interface RogoScoreDay extends RogoScoreMetrics {
  date: string;
  recoveryPct?: number;
  strain?: number;
  sleepPct?: number;
  readiness?: RogoReadiness;
  /**
   * The watch's all-day active energy of that day in whole kcal: the day's sum of the watch-recorded per-minute samples'
   * calories (small calories / 1000), the amount written to Health Connect as ActiveCaloriesBurned. JoyoRogo counts it in
   * Sisa (as exercise credit) and keeps the larger of the stored and the sent value, since a day's total only grows. Left
   * out when the day has no samples or the total is 0 (never 0 for "no data"), in which case JoyoRogo keeps what it stored.
   */
  activeKcal?: number;
}

/** `post.visibility`: `publik` is the public feed, `grup` only people who share a group with the author. */
export type RogoVisibility = 'publik' | 'grup';

export interface RogoAuthor {
  id: string;
  name: string;
  /** Null until the person has a handle; without one their profile page cannot be opened. */
  handle: string | null;
  /** A server-relative `/avatar/...` path or an absolute photo URL; null when they have no photo. */
  image: string | null;
}

/**
 * A post as `social.feed`, `social.post`, `social.myPosts` and `social.publicProfile` return it. `stats` is the post's
 * `statsJson`; a post made by `createWatchPost` has `source: 'joyofit'` and the keys of {@link RogoWatchStats}.
 */
export interface RogoPost {
  id: string;
  kind: 'makan' | 'latihan' | 'berat' | 'cerita';
  title: string;
  kcal: number | null;
  durationMin: number | null;
  stats?: Record<string, number | string | null>;
  /** A workout post's route as a Google encoded polyline (precision 5), trimmed and simplified by JoyoRogo; only present when a map is to be shown (never inside `stats`). */
  mapLine?: string;
  caption: string | null;
  visibility: RogoVisibility;
  /** ISO timestamp. */
  createdAt: string;
  author: RogoAuthor;
  kudosCount: number;
  commentCount: number;
  kudosByMe?: boolean;
}

export interface RogoPostPage {
  items: RogoPost[];
  /** Pass as `cursor` for the next page; null on the last one. */
  nextCursor: number | null;
}

/** `social.myProfile`: the signed-in person's feed profile. The display name is the account's, from the session. */
export interface RogoSocialProfile {
  handle: string | null;
  followerCount: number;
  followingCount: number;
  postCount: number;
  /** The account switch "Peta rute di postingan": off hides the maps of all of the account's posts, for everyone. */
  shareMaps: boolean;
}

/** `social.publicProfile`; a private profile comes back with `publicProfile: false`, no `stats` and no posts. */
export interface RogoPublicProfile {
  name: string;
  handle: string | null;
  image: string | null;
  bio: string | null;
  publicProfile: boolean;
  isSelf: boolean;
  stats: { postCount: number; followerCount: number; followingCount: number } | null;
  posts: RogoPostPage;
}

/** What a comment can carry besides text (`social.comments`): a photo, or one of the commenter's own items from the app. */
export type RogoAttachmentKind = 'image' | 'workout' | 'food' | 'weight' | 'recap' | 'route';

/** The safe preview JoyoRogo renders for an attachment; every `stats` key may be null or absent. */
export interface RogoAttachment {
  kind: RogoAttachmentKind;
  /** `''` for image, weight and recap: the app words those by kind. */
  title: string;
  /** `YYYY-MM-DD`. */
  date: string | null;
  /** Encoded polyline (5 decimals), trimmed for privacy. */
  mapLine: string | null;
  hasPhoto: boolean;
  /**
   * workout `durationMin kcal distanceM sportKind sets volumeKg avgHr`, route `distanceM durationMin sportKind`,
   * food `kcal protein carbs fat meal items`, weight `weightKg deltaKg`, recap `weekStart weekEnd avgKcal targetKcal
   * daysOnTarget loggedDays streakDays exerciseMin weightChangeKg`.
   */
  stats: Record<string, number | string | null | undefined>;
}

/**
 * A comment of a post. Top-level comments carry `replyCount`; a reply carries `parentId` (the top-level comment) and, when it
 * answers another reply, `replyTo`. `deleted` is a tombstone kept because replies survive: its `body` is a localized line.
 */
export interface RogoComment {
  id: string;
  body: string;
  /** ISO timestamp. */
  createdAt: string;
  author: RogoAuthor;
  deleted: boolean;
  parentId: string | null;
  replyCount: number;
  replyTo: { id: string; name: string; handle: string | null } | null;
  attachment: RogoAttachment | null;
}

export interface RogoCommentPage {
  items: RogoComment[];
  nextCursor: number | null;
}

/** What `addComment` takes besides the text: an uploaded photo, or an item of the commenter's by its id. */
export type RogoAttachmentInput = { kind: 'image'; photoId: string } | { kind: Exclude<RogoAttachmentKind, 'image'>; refId: string };

/** One recent item of the caller for the "Dari aplikasi" picker (`social.commentAttachables`). */
export interface RogoAttachable {
  kind: Exclude<RogoAttachmentKind, 'image'>;
  refId: string;
  photoId: string | null;
  preview: RogoAttachment;
}

/** The stats of a post JoyoFit made (`stats.source === 'joyofit'`); every number may be null. */
export interface RogoWatchStats {
  source: 'joyofit';
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Epoch milliseconds. */
  startedAt: number;
  /** 1 when `social.workoutDetail` has a heart-rate series or a route for the post. */
  hasDetail: 0 | 1;
  /** `run`, `walk`, `ride`, `swim` or `other`; null on posts made before JoyoRogo stored it. */
  sportKind: SportKind | null;
  /** Moving time in seconds; null on older posts or when the post has no analysis. */
  movingSec: number | null;
  /** Elevation gain in metres; null on older posts or without elevation data. */
  elevGainM: number | null;
  /** 1 when the post has a stored route map (`mapLine` is sent only while `showMap` is 1 and the author's account allows maps). */
  hasMap: 0 | 1;
  /** The author's per-post "Tampilkan peta" switch. */
  showMap: 0 | 1;
}

/** Heart rate as `post_workout_detail.hr_json`: one reading per `intervalSec`, null where the watch had none. */
export interface RogoHrSeries {
  intervalSec: number;
  bpm: (number | null)[];
}

/** `[latitude, longitude]` pairs, in time order. */
export type RogoRoute = [number, number][];

/** Input of `social.createWatchPost`; the limits are the server's (zod), `features/social/watchPost.ts` builds within them. */
export interface RogoWatchPostInput {
  workout: {
    sportName: string;
    /** Epoch milliseconds. */
    startedAt: number;
    durationMin: number;
    kcal: number | null;
    distanceM: number | null;
    avgHr: number | null;
    maxHr: number | null;
  };
  detail?: { hr?: RogoHrSeries | null; route?: RogoRoute | null; analysis?: WorkoutAnalysis | null };
  caption?: string;
  visibility: RogoVisibility;
  /** "Tampilkan peta": default on. The line others get is trimmed 200 m at both ends and simplified by JoyoRogo. */
  showMap?: boolean;
}

/** `social.workoutDetail`: what the viewer may see of a watch post's detail. `locked` means the viewer is not Pro. */
export interface RogoWorkoutDetail {
  locked: boolean;
  /** Legacy posts only; a post with `analysis` carries everything in it. */
  hr: RogoHrSeries | null;
  route: RogoRoute | null;
  analysis: WorkoutAnalysis | null;
}

export interface RogoGroup {
  id: string;
  name: string;
  role: string;
  memberCount: number;
  inviteCode: string;
}

/** A member's JoyoFit scores for the day, as `group.detail` shares them. */
export interface RogoMemberFitness {
  recoveryPct: number | null;
  strain: number | null;
  sleepPct: number | null;
  readiness: RogoReadiness | null;
}

export interface RogoGroupMember {
  userId: string;
  name: string;
  image: string | null;
  role: string;
  shareFood: boolean;
  shareFitness: boolean;
  today: { fitness: RogoMemberFitness | null };
}

export interface RogoGroupDetail {
  group: { id: string; name: string; inviteCode: string };
  members: RogoGroupMember[];
}

/** `mcpConnection.info`: the AI connector's address and whether the account is Pro (an AI app can only read data once it is). */
export interface RogoMcpInfo {
  url: string;
  unlocked: boolean;
}

/** An AI app connected to the account (`mcpConnection.list`), newest first. `name` is what the app calls itself, so `redirectHosts` say where it really is. */
export interface RogoMcpConnection {
  clientId: string;
  name: string;
  redirectHosts: string[];
  /** Data scopes the person agreed to: `profile:read`, `food:read`, `weight:read`, `workouts:read`, `recovery:read`. */
  scopes: string[];
  /** Epoch milliseconds. */
  connectedAt: number;
  /** Epoch milliseconds; null when the app never read anything. */
  lastUsedAt: number | null;
  calls30d: number;
}

export type RogoMcpOutcome = 'ok' | 'error' | 'not_pro' | 'rate_limited' | 'scope';

/** One read an AI app made (`mcpConnection.activity`), newest first. `args` is JSON text with the date range or id, never data. */
export interface RogoMcpActivity {
  id: string;
  clientId: string;
  clientName: string | null;
  tool: string;
  args: string | null;
  outcome: RogoMcpOutcome;
  ms: number;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** Procedures JoyoFit calls. */
export const rogo = {
  foodDay: (date: string) => rogoCall<RogoFoodDay>('food/listByDate', { date }),
  myProfile: () => rogoCall<RogoMyProfile>('profile/myProfile', {}),
  /** The newest weigh-in, or null. `weight.history` returns oldest first, so the last entry is the latest. */
  async latestWeighIn(): Promise<RogoWeightEntry | null> {
    const history = await rogoCall<{ entries: RogoWeightEntry[] }>('weight/history', { limit: 1 });
    return history.entries.at(-1) ?? null;
  },
  /**
   * A weigh-in (`weight.checkIn`, 25 to 400 kg): JoyoRogo keeps one weight per Jakarta day and the last write of a day wins. It has no
   * field for the source (a scale) or for body composition, so only weight and day travel.
   */
  checkInWeight: (input: { weightKg: number; date: string }) => rogoCall<RogoWeightEntry>('weight/checkIn', input),
  /** Writes one item to the diary (a meal the watch quick-logged). */
  addFood: (input: { date: string; meal: RogoMeal; name: string; kcal: number }) =>
    rogoCall<RogoFoodItem>('food/add', { ...input, source: 'manual' }),
  /** Stores the day's Recovery / Strain / Sleep and body metrics (sleep hours, resting HR, HRV, VO2max, training status, recovery time) for JoyoRogo's diary and its AI connector. JoyoRogo answers 404 until it is deployed with the `fitness` router. */
  pushScores: (days: RogoScoreDay[]) => rogoCall<{ saved: number }>('fitness/upsertScores', { days }),
  avatar: {
    /** Replaces the profile photo; the answer is the new server-relative `/avatar/...` path. */
    upload: (input: { imageBase64: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }) =>
      rogoCall<{ image: string }>('avatar/upload', input),
    /** Removes an uploaded photo; the answer is the account's image after that: the Google photo it had before, or null. */
    remove: () => rogoCall<{ image: string | null }>('avatar/remove', {}),
  },
  mcp: {
    info: () => rogoCall<RogoMcpInfo>('mcpConnection/info', {}),
    list: () => rogoCall<RogoMcpConnection[]>('mcpConnection/list', {}),
    /** Cuts the app off at once. */
    revoke: (clientId: string) => rogoCall<{ revoked: boolean }>('mcpConnection/revoke', { clientId }),
    activity: (limit = 20) => rogoCall<RogoMcpActivity[]>('mcpConnection/activity', { limit }),
  },
  group: {
    list: () => rogoCall<RogoGroup[]>('group/list', {}),
    join: (code: string) => rogoCall<{ groupId: string }>('group/join', { code }),
    detail: (groupId: string) => rogoCall<RogoGroupDetail>('group/detail', { groupId }),
    setShareFitness: (groupId: string, shareFitness: boolean) =>
      rogoCall<{ ok: true }>('group/setShareFitness', { groupId, shareFitness }),
    setShareFood: (groupId: string, shareFood: boolean) => rogoCall<{ ok: true }>('group/setShareFood', { groupId, shareFood }),
  },
  social: {
    feed: (tab: 'mengikuti' | 'jelajah', cursor?: number) => rogoCall<RogoPostPage>('social/feed', { tab, cursor }),
    post: (id: string) => rogoCall<RogoPost>('social/post', { id }),
    myProfile: () => rogoCall<RogoSocialProfile>('social/myProfile', {}),
    myPosts: (cursor?: number) => rogoCall<RogoPostPage>('social/myPosts', { cursor }),
    publicProfile: (handle: string, cursor?: number) => rogoCall<RogoPublicProfile>('social/publicProfile', { handle, cursor }),
    /** Toggles the signed-in person's kudos; the answer is the new state. */
    kudos: (postId: string) => rogoCall<{ kudos: boolean; kudosCount: number }>('social/kudos', { postId }),
    comments: (postId: string, cursor?: number) => rogoCall<RogoCommentPage>('social/comments', { postId, cursor }),
    /** The replies under a top-level comment, oldest first. */
    commentReplies: (parentId: string, cursor?: number) => rogoCall<RogoCommentPage>('social/commentReplies', { parentId, cursor }),
    addComment: (input: { postId: string; body?: string; parentId?: string; attachment?: RogoAttachmentInput }) =>
      rogoCall<{ id: string; parentId: string | null; comment: RogoComment }>('social/addComment', input),
    /** Removes the comment, or turns it into a tombstone when it has replies. Allowed for its author and the post's author. */
    deleteComment: (id: string) => rogoCall<{ ok: true; mode: 'removed' | 'hidden' }>('social/deleteComment', { id }),
    uploadCommentPhoto: (input: { imageBase64: string; mimeType: 'image/jpeg' | 'image/webp' }) =>
      rogoCall<{ photoId: string }>('social/uploadCommentPhoto', input),
    commentAttachables: (kind: Exclude<RogoAttachmentKind, 'image'>) =>
      rogoCall<{ items: RogoAttachable[] }>('social/commentAttachables', { kind }),
    createWatchPost: (input: RogoWatchPostInput) =>
      rogoCall<{ id: string; visibility: RogoVisibility }>('social/createWatchPost', input),
    workoutDetail: (postId: string) => rogoCall<RogoWorkoutDetail>('social/workoutDetail', { postId }),
    /** The author's per-post "Tampilkan peta" switch, for a post whose `stats.hasMap` is 1 (NOT_FOUND otherwise). */
    setPostMap: (postId: string, show: boolean) => rogoCall<{ showMap: 0 | 1 }>('social/setPostMap', { postId, show }),
    /** Account feed settings; `shareMaps` is "Peta rute di postingan". */
    updateProfile: (input: { shareMaps?: boolean }) => rogoCall<{ ok: true }>('social/updateProfile', input),
  },
};
