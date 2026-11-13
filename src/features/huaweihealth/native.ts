/**
 * The app side of the Health Kit sync (lab): the switch, the Worker calls (`server/src/huaweiHealth.ts`), the remembered
 * sync state, and one sync run into the local database. The pure parts are `api.ts`, `mapping.ts` and `sync.ts`.
 */
import Constants from 'expo-constants';
import type { SQLiteDatabase } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

import { CloudHttpError, cloudRequest } from '@/cloud/api';
import { errorMessage } from '@/format';
import { pushLog } from '@/state/logStore';

import { HealthKitClient, type HealthKitToken } from './api';
import { syncHealthKit, type SyncResult, type SyncState } from './sync';

const LAB_KEY = 'joyofit.huaweiHealthLab';
const STATE_KEY = 'joyofit.huaweiHealth.sync';
/** Token refetched when it expires within this many seconds. */
const TOKEN_MARGIN_S = 120;

/** The experimental switch (Settings → About & advanced → Experimental). Off unless turned on. */
export function getHuaweiHealthLab(): boolean {
  try {
    return Storage.getItemSync(LAB_KEY) === '1';
  } catch {
    return false;
  }
}

export function setHuaweiHealthLab(on: boolean): void {
  if (on) Storage.setItemSync(LAB_KEY, '1');
  else Storage.removeItemSync(LAB_KEY);
}

export interface StoredSync extends SyncState {
  /** The Health Kit host a cross-site answer moved this user to. */
  host?: string;
  /** Unix ms of the last sync that finished. */
  lastSyncAt?: number;
  last?: Pick<SyncResult, 'workoutsAdded' | 'workoutsUpdated' | 'minutesWritten' | 'dayTotalsAdded' | 'missingScopes'>;
}

const EMPTY_STATE: StoredSync = { workoutsUntilMs: null, stepsUntilMs: null };

export function getStoredSync(): StoredSync {
  try {
    const raw = Storage.getItemSync(STATE_KEY);
    return raw ? { ...EMPTY_STATE, ...(JSON.parse(raw) as StoredSync) } : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

function saveStoredSync(state: StoredSync): void {
  Storage.setItemSync(STATE_KEY, JSON.stringify(state));
}

export interface HuaweiHealthStatus {
  /** The Worker has the HUAWEI ID client id and secret (false until Huawei approves the app and the owner sets them). */
  configured: boolean;
  connected: boolean;
  /** Unix seconds. */
  connectedAt?: number;
  scope?: string[];
}

/** The Worker has no (valid) grant: never connected, disconnected, or Huawei expired the refresh token. */
export class HuaweiHealthNotConnectedError extends Error {}

const log = (message: string, direction: 'info' | 'error' = 'info') =>
  pushLog({ ts: Date.now(), direction, serviceId: null, commandId: null, hex: null, message: `huawei-health: ${message}` });

export const fetchHuaweiHealthStatus = () => cloudRequest<HuaweiHealthStatus>('GET', '/v1/huawei-health');

export async function fetchHuaweiHealthAuthorizeUrl(): Promise<string> {
  return (await cloudRequest<{ url: string }>('GET', '/v1/huawei-health/authorize')).url;
}

let token: (HealthKitToken & { expiresAt: number; scope: string[] }) | null = null;

async function freshToken(): Promise<HealthKitToken & { scope: string[] }> {
  const now = Math.floor(Date.now() / 1000);
  if (token && token.expiresAt - now > TOKEN_MARGIN_S) return token;
  try {
    token = await cloudRequest<HealthKitToken & { expiresAt: number; scope: string[] }>('POST', '/v1/huawei-health/token');
    return token;
  } catch (error) {
    if (error instanceof CloudHttpError && error.status === 409) {
      token = null;
      throw new HuaweiHealthNotConnectedError();
    }
    throw error;
  }
}

/** Revokes the grant at Huawei through the Worker and forgets the sync state (imported rows stay, like a ZIP import's). */
export async function disconnectHuaweiHealth(): Promise<void> {
  await cloudRequest('POST', '/v1/huawei-health/disconnect');
  token = null;
  Storage.removeItemSync(STATE_KEY);
}

const appVersion = () => `${Platform.OS === 'ios' ? 'ios' : 'and'}_joyofit_${Constants.expoConfig?.version ?? '0'}`;

/** One sync from the last saved point to now. Resolves with what it wrote; the state is saved as each part finishes. */
export async function runHuaweiHealthSync(
  db: Pick<SQLiteDatabase, 'withExclusiveTransactionAsync'>,
  status: Required<Pick<HuaweiHealthStatus, 'connectedAt'>>,
  options: { isCancelled?: () => boolean; onProgress?: (fraction: number) => void } = {},
): Promise<SyncResult> {
  const stored = getStoredSync();
  const first = await freshToken();
  const client = new HealthKitClient({
    token: freshToken,
    version: appVersion(),
    host: stored.host,
    onHost: (host) => saveStoredSync({ ...getStoredSync(), host }),
  });
  log(`sync from workouts=${stored.workoutsUntilMs ?? 'start'} steps=${stored.stepsUntilMs ?? 'start'}`);
  try {
    const result = await syncHealthKit({
      db,
      client,
      scope: first.scope,
      connectedAt: status.connectedAt,
      state: stored,
      saveState: (state) => saveStoredSync({ ...getStoredSync(), ...state }),
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
      isCancelled: options.isCancelled,
      onProgress: options.onProgress,
    });
    if (!result.cancelled) {
      const { workoutsAdded, workoutsUpdated, minutesWritten, dayTotalsAdded, missingScopes } = result;
      saveStoredSync({ ...getStoredSync(), lastSyncAt: Date.now(), last: { workoutsAdded, workoutsUpdated, minutesWritten, dayTotalsAdded, missingScopes } });
    }
    log(`sync done: ${result.workoutsAdded} workouts added, ${result.workoutsUpdated} filled in, ${result.minutesWritten} minutes, ${result.dayTotalsAdded} day totals`);
    return result;
  } catch (error) {
    log(`sync failed: ${errorMessage(error)}`, 'error');
    throw error;
  }
}
