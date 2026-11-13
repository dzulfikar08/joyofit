/** Largest JSON body accepted by POST /v1/sync. A table travels to D1 as JSON bind parameters of at most JSON_PARAM_TARGET_BYTES each. */
export const MAX_SYNC_BODY_BYTES = 3_000_000;

/** Largest JSON body accepted by PUT /v1/gear. */
export const MAX_GEAR_BODY_BYTES = 1_048_576;

/** Most bytes of JSON one bind parameter of a sync statement carries; D1 refuses a value over 2 MB (src/d1.ts). */
export const JSON_PARAM_TARGET_BYTES = 1_000_000;

export const MAX_STEP_SAMPLES = 5_000;
export const MAX_SLEEP_SEGMENTS = 2_000;
export const MAX_WORKOUTS = 50;
export const MAX_DEVICES = 10;
export const MAX_POINTS_PER_WORKOUT = 30_000;
/** Workout points per D1 statement, so one bind parameter stays well under D1's 2 MB string limit. */
export const POINTS_PER_STATEMENT = 4_000;

export const PULL_DEFAULT_LIMIT = 500;
export const PULL_MAX_LIMIT = 1_000;
/** Workouts carry their GPS track, so a pull page holds fewer of them. */
export const PULL_MAX_WORKOUTS = 25;

export const RESTORE_DEFAULT_LIMIT = 2_000;
export const RESTORE_MAX_LIMIT = 5_000;
/** GET /v1/restore refuses a window starting further back than this, to bound the cost of one restore. */
export const RESTORE_MAX_AGE_DAYS = 400;

/** How long a verified session is reused before JoyoRogo is asked again. */
export const AUTH_CACHE_TTL_MS = 60_000;
export const AUTH_CACHE_MAX_ENTRIES = 500;
export const AUTH_TIMEOUT_MS = 5_000;

export const DEFAULT_MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const IMPORT_LIST_LIMIT = 50;

/**
 * How long a "Founder" answer is reused before JoyoRogo is asked again. A "not Founder" answer is kept far shorter,
 * so someone who has just paid is not told to wait.
 */
export const ACCESS_CACHE_TTL_MS = 60_000;
export const ACCESS_LOCKED_CACHE_TTL_MS = 10_000;

/** How long the signed `state` of a Strava authorization stays valid. */
export const STRAVA_STATE_TTL_S = 600;
/** A call to JoyoRogo's Strava grant API; a code exchange or token refresh inside it waits for Strava (5 s). */
export const STRAVA_BROKER_TIMEOUT_MS = 12_000;
/** The deauthorization forward must finish inside Strava's two-second webhook deadline. */
export const STRAVA_WEBHOOK_BROKER_TIMEOUT_MS = 1_500;

/** POST /v1/waitlist: submissions per IP per clock hour (invalid ones count), and the largest body read. */
export const WAITLIST_MAX_PER_HOUR = 5;
export const WAITLIST_MAX_BODY_BYTES = 4_096;
export const WAITLIST_MAX_ENTRIES = 5_000;

/** Live tracking (src/live.ts). Points per batch, the largest batch body read, and the write rate per session. */
export const LIVE_MAX_POINTS_PER_POST = 30;
export const LIVE_MAX_BODY_BYTES = 8_192;
/** Requests per session per clock minute; the app posts every 20 s, so this leaves room for retries after an outage. */
export const LIVE_MAX_POSTS_PER_MINUTE = 12;
/** Rows one session may hold (about 28 h at one point per 5 s). */
export const LIVE_MAX_POINTS_PER_SESSION = 20_000;
/** New sessions one user may start per hour. */
export const LIVE_MAX_STARTS_PER_HOUR = 10;
/** A point's `ts` may be this far in the past or future of the server clock. */
export const LIVE_TS_PAST_MS = 6 * 3_600_000;
export const LIVE_TS_FUTURE_MS = 10 * 60_000;
/** The link stops answering this long after the last accepted batch. */
export const LIVE_EXPIRE_MS = 12 * 3_600_000;
/** Sessions and points are deleted this long after the last batch or the end. */
export const LIVE_PURGE_MS = 24 * 3_600_000;
/** The most track points `GET /v1/live/:token` returns (first and last always kept). */
export const LIVE_MAX_TRACK_POINTS = 300;

/** `GET /v1/sleep`: the widest window a request may ask for, in WIB calendar days. */
export const SLEEP_MAX_WINDOW_DAYS = 92;

/** Watchface library (src/watchfaces.ts): the largest upload, the faces one user may keep, the inflated size a package may declare. */
export const MAX_WATCHFACE_BYTES = 8 * 1024 * 1024;
export const MAX_WATCHFACES_PER_USER = 40;
export const MAX_WATCHFACE_UNZIPPED_BYTES = 32 * 1024 * 1024;
/** The display name of a face is cut to this many characters. */
export const WATCHFACE_NAME_MAX = 80;

/** Studio cloud projects (src/studio.ts): the largest request body, the projects one user may keep, the name and thumbnail caps. */
export const MAX_STUDIO_BODY_BYTES = 5 * 1024 * 1024;
export const MAX_STUDIO_PROJECTS_PER_USER = 100;
export const STUDIO_NAME_MAX = 80;
/** The longest `thumb` data URL, in characters. */
export const STUDIO_THUMB_MAX = 16 * 1024;

/** One call to Huawei's OAuth server or Health Kit from the Worker (token exchange, refresh, revoke). */
export const HUAWEI_HEALTH_TIMEOUT_MS = 15_000;
