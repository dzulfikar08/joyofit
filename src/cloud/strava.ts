import type { SQLiteDatabase } from 'expo-sqlite';

import { t } from '@/i18n';
import { CloudHttpError, cloudRequest } from '@/cloud/api';
import {
  applyStravaConnection,
  getStravaSettings,
  getStravaUpload,
  listAutoUploadCandidates,
  saveStravaUpload,
  type StravaUploadRow,
} from '@/db/strava';
import { getWorkout } from '@/db/queries';
import { gearSport, stravaGearFits } from '@/features/gear/model';
import { gearOfWorkout, getStravaGearSent, reconcileDefaults, setStravaGearSent } from '@/features/gear/store';
import { isEbike } from '@/features/cycling/settings';
import { buildUploadForm, duplicateOf, plainStravaError } from '@/features/strava/activityFile';
import { buildWorkoutFit } from '@/features/strava/workoutFit';
import { errorMessage } from '@/format';
import { pushLog } from '@/state/logStore';

/**
 * Strava for JoyoFit. The Worker keeps the Strava tokens and the client secret (`server/src/strava.ts`); this file
 * asks it for the connection status, the authorize URL and a short-lived access token, then uploads straight from
 * the phone to Strava. Strava sync is free while slots are spare: the shared Strava application has a fixed athlete
 * capacity, JoyoRogo keeps part of it for Pro users and the status says when this user cannot connect. Nothing here
 * checks JoyoRogo Pro itself. A workout is only ever sent to the Strava account of the person whose phone it is; no
 * Strava data is read back except the upload's own status.
 */

const STRAVA_API = 'https://www.strava.com/api/v3';
const REQUEST_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 90_000;
/** Token refetched when it expires within this many seconds. */
const TOKEN_MARGIN_S = 120;

export interface StravaStatus {
  /** The Worker has the Strava client secret. */
  configured: boolean;
  connected: boolean;
  athleteId?: number;
  /** Unix seconds. */
  connectedAt?: number;
  /** The grant also has `profile:read_all`, which listing the athlete's gear needs. */
  gearScope?: boolean;
  /** Not connected and may not connect now: the shared Strava application has no slot open to this user. */
  slotsFull?: boolean;
  /** `reserved_for_paid`: only the slots kept for Pro users are left; `full`: none at all. */
  slotsReason?: StravaSlotsReason;
  /** The last connection was released to make room for Pro users (idle free account). */
  released?: { at: number; reason: 'released_for_pro' };
}

export type StravaSlotsReason = 'reserved_for_paid' | 'full';

/** The Worker refused to start a connection because no Strava slot is open to this user. */
export class StravaSlotsFullError extends Error {
  constructor() {
    super(t('common:strava.slotsFull'));
  }
}

/** The Worker has no Strava connection for this account (never connected, revoked, or deauthorized on strava.com). */
export class StravaNotConnectedError extends Error {
  constructor() {
    super(t('common:strava.stravaNotConnected'));
  }
}

const log = (message: string, direction: 'info' | 'error' = 'info') =>
  pushLog({ ts: Date.now(), direction, serviceId: null, commandId: null, hex: null, message: `strava: ${message}` });

export const fetchStravaStatus = () => cloudRequest<StravaStatus>('GET', '/v1/strava');

/**
 * The Strava OAuth page to open in a browser; its redirect lands on the Worker, which sends the user back to the app.
 * `gear` also asks for `profile:read_all`, so the athlete's shoes and bikes can be listed.
 */
export async function fetchStravaAuthorizeUrl({ gear = false }: { gear?: boolean } = {}): Promise<string> {
  try {
    return (await cloudRequest<{ url: string }>('GET', gear ? '/v1/strava/authorize?gear=1' : '/v1/strava/authorize')).url;
  } catch (error) {
    if (error instanceof CloudHttpError && error.status === 409 && error.code === 'slots_full') throw new StravaSlotsFullError();
    throw error;
  }
}

/** Revokes the grant at Strava (through the Worker) and forgets everything local. */
export async function disconnectStrava(db: SQLiteDatabase): Promise<void> {
  await cloudRequest('POST', '/v1/strava/disconnect');
  token = null;
  await applyStravaConnection(db, { connected: false });
}

/**
 * Reads the Worker's status into the local database. Returns the status, or null when the Worker cannot be reached
 * (the local state stays as it was, so being offline never disconnects anything).
 */
export async function syncStravaStatus(db: SQLiteDatabase): Promise<StravaStatus | null> {
  try {
    const status = await fetchStravaStatus();
    await applyStravaConnection(db, status);
    if (!status.connected) token = null;
    return status;
  } catch (error) {
    log(`status check failed: ${errorMessage(error)}`, 'error');
    return null;
  }
}

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (token && token.expiresAt - now > TOKEN_MARGIN_S) return token.value;
  try {
    const fresh = await cloudRequest<{ accessToken: string; expiresAt: number }>('POST', '/v1/strava/token');
    token = { value: fresh.accessToken, expiresAt: fresh.expiresAt };
    return fresh.accessToken;
  } catch (error) {
    if (error instanceof CloudHttpError && error.status === 409) throw new StravaNotConnectedError();
    throw error;
  }
}

/** A failure that is Strava's verdict on this file, not a hiccup: retrying the same file will not help. */
class StravaRefusedError extends Error {}

interface UploadStatus {
  id: number;
  activity_id: number | null;
  error: string | null;
  status: string;
}

async function stravaFetch<T = UploadStatus>(
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT'; headers?: Record<string, string>; body?: Uint8Array<ArrayBuffer> | string },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${STRAVA_API}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.ok) return (await response.json()) as T;
    const text = await response.text().catch(() => '');
    // Strava answers a duplicate external_id with 400 and the existing upload's error text (parsed by the caller).
    if (response.status === 400 || response.status === 413 || response.status === 422) {
      throw new StravaRefusedError(duplicateOf(text) !== null ? text : t('common:strava.refused', { status: response.status }));
    }
    if (response.status === 401 || response.status === 403) {
      token = null;
      throw new StravaNotConnectedError();
    }
    throw new Error(response.status === 429 ? t('common:strava.rateLimit') : t('common:strava.answered', { status: response.status }));
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `GET /uploads/{id}` until Strava has made the activity, refused the file, or POLL_TIMEOUT_MS pass. */
async function pollUpload(uploadId: number): Promise<UploadStatus> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let status: UploadStatus = { id: uploadId, activity_id: null, error: null, status: '' };
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    status = await stravaFetch(`/uploads/${uploadId}`, { method: 'GET' });
    if (status.activity_id || status.error) break;
  }
  return status;
}

const inFlight = new Map<number, Promise<StravaUploadRow>>();

/**
 * Sends one workout to Strava and records the outcome in `strava_upload`. A workout Strava already has (done, or a
 * duplicate external_id) is not sent twice; one still processing is polled again instead of uploaded again. Calls for
 * the same workout share one run. Never throws for Strava's own refusal: that is the returned row (`rejected`).
 * Connection problems (`StravaNotConnectedError`) and a missing workout throw.
 */
export function sendWorkoutToStrava(db: SQLiteDatabase, workoutId: number): Promise<StravaUploadRow> {
  const running = inFlight.get(workoutId);
  if (running) return running;
  const run = (async () => {
    // The default gear is applied before the upload, so the activity gets its gear in the same pass.
    await reconcileDefaults(db).catch(() => 0);
    const row = await doSend(db, workoutId);
    if (row.status === 'done') await syncActivityGear(db, row.workoutStart).catch((e) => log(`gear of workout ${row.workoutStart}: ${errorMessage(e)}`, 'error'));
    return row;
  })().finally(() => inFlight.delete(workoutId));
  inFlight.set(workoutId, run);
  return run;
}

async function doSend(db: SQLiteDatabase, workoutId: number): Promise<StravaUploadRow> {
  const found = await getWorkout(db, workoutId);
  if (!found) throw new Error(t('common:errors.workoutGone'));
  const { workout, summaryJson } = found;
  const previous = await getStravaUpload(db, workout.start);
  if (previous?.status === 'done') return previous;
  const attempts = (previous?.attempts ?? 0) + 1;
  const base = { workoutStart: workout.start, attempts };

  try {
    let uploadId = previous?.status === 'processing' ? previous.uploadId : null;
    let status: UploadStatus;
    if (uploadId === null) {
      const { addLink, addDevice } = await getStravaSettings(db);
      const { fit, summary, strength, device: watchDevice } = await buildWorkoutFit(db, workout, summaryJson);
      // Like Huawei Health's own description, the watch is named; a workout the phone recorded names none.
      const device = addDevice && summary.source !== 'phone' ? watchDevice : null;
      const deviceLine = device ? t('sharing:strava.recordedWith', { device: device.name }) : null;
      const form = buildUploadForm({ ...workout, ebike: isEbike(workout.start) }, fit.bytes, {
        addLink,
        ...(deviceLine ? { deviceLine } : {}),
        ...(strength ? { ...(strength.name ? { name: strength.name } : {}), description: strength.description } : {}),
      });
      try {
        status = await stravaFetch('/uploads', { method: 'POST', headers: { 'Content-Type': form.contentType }, body: form.body });
      } catch (error) {
        const existing = error instanceof StravaRefusedError ? duplicateOf(error.message) : null;
        if (existing === null) throw error;
        log(`workout ${workout.start} is already on Strava (activity ${existing})`);
        return await saveStravaUpload(db, { ...base, status: 'done', uploadId: null, activityId: existing, error: null });
      }
      uploadId = status.id;
      await saveStravaUpload(db, { ...base, status: 'processing', uploadId, activityId: null, error: null });
    } else {
      status = { id: uploadId, activity_id: null, error: null, status: '' };
    }

    if (!status.activity_id && !status.error) status = await pollUpload(uploadId);
    if (status.activity_id) {
      log(`workout ${workout.start} is on Strava as activity ${status.activity_id}`);
      return await saveStravaUpload(db, { ...base, status: 'done', uploadId, activityId: status.activity_id, error: null });
    }
    if (status.error) {
      const existing = duplicateOf(status.error);
      if (existing !== null) return await saveStravaUpload(db, { ...base, status: 'done', uploadId, activityId: existing, error: null });
      log(`Strava refused workout ${workout.start}: ${status.error}`, 'error');
      return await saveStravaUpload(db, { ...base, status: 'rejected', uploadId, activityId: null, error: plainStravaError(status.error) });
    }
    // Still processing after the polling window: the next run polls the same upload again.
    return await saveStravaUpload(db, { ...base, status: 'processing', uploadId, activityId: null, error: null });
  } catch (error) {
    if (error instanceof StravaNotConnectedError) throw error;
    const message = errorMessage(error);
    log(`upload of workout ${workout.start} failed: ${message}`, 'error');
    const refused = error instanceof StravaRefusedError;
    return saveStravaUpload(db, { ...base, status: refused ? 'rejected' : 'failed', uploadId: null, activityId: null, error: message });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Gear
// ---------------------------------------------------------------------------------------------------------------------

/** A shoe or bike of the athlete's Strava account, as `GET /athlete` lists it. */
export interface StravaGearItem {
  /** `g12345` (shoes) or `b12345` (bike). */
  id: string;
  name: string;
  kind: 'shoes' | 'bike';
  primary: boolean;
}

/** The grant lacks `profile:read_all`: `GET /athlete` then leaves out the athlete's shoes and bikes. */
export class StravaGearScopeError extends Error {
  constructor() {
    super(t('gear:strava.gearAccess.off'));
  }
}

interface AthleteGear {
  id: string;
  name?: string;
  nickname?: string;
  primary?: boolean;
  retired?: boolean;
}

/**
 * The athlete's shoes and bikes (`GET /athlete`, scope `profile:read_all`), for linking JoyoFit's gear. Read for the picker
 * only and shown to its owner; nothing of it is stored except the id and name of the gear they link, on their phone.
 */
export async function fetchStravaGear(): Promise<StravaGearItem[]> {
  const athlete = await stravaFetch<{ shoes?: AthleteGear[]; bikes?: AthleteGear[] }>('/athlete', { method: 'GET' });
  if (athlete.shoes === undefined && athlete.bikes === undefined) throw new StravaGearScopeError();
  const items = (list: AthleteGear[] | undefined, kind: 'shoes' | 'bike'): StravaGearItem[] =>
    (list ?? [])
      .filter((g) => !g.retired)
      .map((g) => ({ id: g.id, name: g.name ?? g.nickname ?? g.id, kind, primary: g.primary === true }));
  return [...items(athlete.shoes, 'shoes'), ...items(athlete.bikes, 'bike')];
}

/** Puts an existing Strava gear on an activity, or none (`PUT /activities/{id}`, `gear_id`; scope `activity:write`). */
async function setActivityGear(activityId: number, stravaGearId: string | null): Promise<void> {
  await stravaFetch(`/activities/${activityId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gear_id: stravaGearId ?? 'none' }),
  });
}

/**
 * Makes the Strava activity of an uploaded workout carry the gear JoyoFit has for it. Sends nothing when Strava already
 * has that gear (`strava_gear_sent`), when the workout has no Strava gear and none was sent before (Strava's own default
 * stays), or when the linked gear does not fit the sport (Strava keeps bikes on rides and shoes on foot sports).
 * Returns whether a call was made. Throws on a failed call, so the caller can log it; the next pass tries again.
 */
export async function syncActivityGear(db: SQLiteDatabase, workoutStart: number): Promise<boolean> {
  const upload = await getStravaUpload(db, workoutStart);
  if (upload?.status !== 'done' || upload.activityId === null) return false;
  const row = await db.getFirstAsync<{ sportType: number }>('SELECT sport_type AS sportType FROM workouts WHERE start = ?', workoutStart);
  if (!row) return false;
  const linked = (await gearOfWorkout(db, workoutStart))?.stravaGearId ?? null;
  const target = linked !== null && stravaGearFits(linked, gearSport(row.sportType)) ? linked : null;
  const sent = await getStravaGearSent(db, workoutStart);
  if (sent === null ? target === null : sent.stravaGearId === target) return false;
  await setActivityGear(upload.activityId, target);
  await setStravaGearSent(db, workoutStart, target);
  log(`activity ${upload.activityId} gear ${target ?? 'none'}`);
  return true;
}

/** Uploaded workouts whose linked gear Strava does not have yet (the gear was linked or defaulted after the upload), a few per pass. */
async function syncPendingActivityGear(db: SQLiteDatabase): Promise<void> {
  const rows = await db.getAllAsync<{ workoutStart: number }>(
    `SELECT u.workout_start AS workoutStart FROM strava_upload u
     JOIN workout_gear wg ON wg.workout_start = u.workout_start
     JOIN gear g ON g.id = wg.gear_id AND g.deleted_at IS NULL AND g.strava_gear_id IS NOT NULL
     WHERE u.status = 'done' AND u.activity_id IS NOT NULL
       AND (SELECT s.strava_gear_id FROM strava_gear_sent s WHERE s.workout_start = u.workout_start) IS NOT g.strava_gear_id
     ORDER BY u.workout_start DESC LIMIT 20`,
  );
  for (const { workoutStart } of rows) await syncActivityGear(db, workoutStart);
}

let autoRunning: Promise<number> | null = null;

/**
 * Sends the workouts that finished since the account connected (and were not imported), oldest first. Returns how many
 * reached a final state. Runs nothing when not connected; overlapping calls share one run. Stops at the first
 * connection-level error (the next sync tries again).
 */
export function autoUploadNewWorkouts(db: SQLiteDatabase): Promise<number> {
  autoRunning ??= (async () => {
    const { connectedAt } = await getStravaSettings(db);
    if (connectedAt === null) return 0;
    let settled = 0;
    for (const candidate of await listAutoUploadCandidates(db, connectedAt)) {
      try {
        const row = await sendWorkoutToStrava(db, candidate.id);
        if (row.status === 'done' || row.status === 'rejected') settled += 1;
      } catch (error) {
        log(`automatic upload stopped: ${errorMessage(error)}`, 'error');
        if (error instanceof StravaNotConnectedError) await syncStravaStatus(db);
        break;
      }
    }
    await reconcileDefaults(db).then(() => syncPendingActivityGear(db)).catch((e) => log(`gear pass: ${errorMessage(e)}`, 'error'));
    return settled;
  })().finally(() => {
    autoRunning = null;
  });
  return autoRunning;
}

export function stravaActivityUrl(activityId: number): string {
  return `https://www.strava.com/activities/${activityId}`;
}
