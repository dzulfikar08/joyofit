import * as Linking from 'expo-linking';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { CloudNotConfiguredError, NotSignedInError } from '@/cloud/api';
import { CLOUD_CONFIGURED } from '@/cloud/config';
import { errorMessage, formatDateTime } from '@/format';
import { useCloud } from '@/state/CloudProvider';

import {
  disconnectHuaweiHealth,
  fetchHuaweiHealthAuthorizeUrl,
  fetchHuaweiHealthStatus,
  getStoredSync,
  HuaweiHealthNotConnectedError,
  runHuaweiHealthSync,
  type HuaweiHealthStatus,
  type StoredSync,
} from './native';
import type { SyncResult } from './sync';

/** The deep link the Worker's callback redirects to (`server/src/huaweiHealth.ts`). */
const RETURN_URL = 'joyofit://settings/huawei-health';
const FAILURES = new Set(['access_denied', 'invalid_state', 'exchange_failed', 'not_configured']);
/** Opening the screen syncs again when the last sync is older than this. */
const AUTO_SYNC_AFTER_MS = 60 * 60 * 1000;

/**
 * Settings → About & advanced → "Sync from your HUAWEI ID account (lab)": connect with HUAWEI ID, sync workouts and steps from
 * Health Kit, disconnect. Shown only while the lab switch is on. Names neither "Huawei Health" nor a Huawei watch (Huawei's
 * review rule); iOS shows no brand at all (iOS overlay).
 */
export function HuaweiHealthSection() {
  const { t } = useTranslation('settings');
  const db = useSQLiteContext();
  const cloud = useCloud();
  const [status, setStatus] = useState<HuaweiHealthStatus | null>(null);
  const [stored, setStored] = useState<StoredSync>(getStoredSync);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const cancelled = useRef(false);
  const running = useRef(false);

  const refresh = useCallback(async (): Promise<HuaweiHealthStatus | null> => {
    try {
      const next = await fetchHuaweiHealthStatus();
      setStatus(next);
      return next;
    } catch (e) {
      if (!(e instanceof NotSignedInError) && !(e instanceof CloudNotConfiguredError)) setError(errorMessage(e));
      setStatus(null);
      return null;
    }
  }, []);

  const sync = useCallback(
    async (current: HuaweiHealthStatus | null) => {
      if (running.current || !current?.connected || current.connectedAt === undefined) return;
      running.current = true;
      cancelled.current = false;
      setBusy(true);
      setError(null);
      setProgress(0);
      try {
        setResult(await runHuaweiHealthSync(db, { connectedAt: current.connectedAt }, { isCancelled: () => cancelled.current, onProgress: setProgress }));
      } catch (e) {
        if (e instanceof HuaweiHealthNotConnectedError) {
          setError(t('huaweiHealth.expired'));
          await refresh();
        } else setError(errorMessage(e));
      } finally {
        setStored(getStoredSync());
        setProgress(null);
        setBusy(false);
        running.current = false;
      }
    },
    [db, refresh, t],
  );

  useFocusEffect(
    useCallback(() => {
      void refresh().then((next) => {
        const last = getStoredSync().lastSyncAt ?? 0;
        if (next?.connected && Date.now() - last > AUTO_SYNC_AFTER_MS) void sync(next);
      });
    }, [refresh, sync]),
  );

  const connect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const url = await fetchHuaweiHealthAuthorizeUrl();
      const answer = await WebBrowser.openAuthSessionAsync(url, RETURN_URL);
      if (answer.type === 'success') {
        const { reason } = Linking.parse(answer.url).queryParams ?? {};
        if (typeof reason === 'string') setError(t(`huaweiHealth.failed.${FAILURES.has(reason) ? (reason as 'access_denied') : 'other'}`));
      }
      const next = await refresh();
      setBusy(false);
      if (next?.connected) await sync(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [refresh, sync, t]);

  const disconnect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await disconnectHuaweiHealth();
      setResult(null);
      setStored(getStoredSync());
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const connected = status?.connected === true;
  const last = result ?? stored.last ?? null;

  return (
    <Section title={t('screens.huaweiHealth')} icon="sync" tint="workouts">
      <AppText variant="caption" muted>
        {t('huaweiHealth.intro')}
      </AppText>
      <Details title={t('huaweiHealth.whatTitle')}>{t('huaweiHealth.what')}</Details>
      {!CLOUD_CONFIGURED ? <Notice tone="danger">{t('huaweiHealth.noCloud')}</Notice> : null}
      {status?.configured === false ? <Notice tone="info">{t('huaweiHealth.serverNotReady')}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {CLOUD_CONFIGURED && !cloud.signedIn ? (
        <>
          <Notice icon="person-circle">{t('huaweiHealth.signInFirst')}</Notice>
          <Button
            label={t('huaweiHealth.signIn')}
            variant="primary"
            icon="log-in-outline"
            onPress={() => void cloud.signIn()}
            disabled={cloud.sessionPending}
            loading={cloud.sessionPending}
          />
        </>
      ) : null}
      {cloud.signedIn && status?.configured && !connected ? (
        <Button label={t('huaweiHealth.connect')} variant="primary" icon="log-in-outline" onPress={() => void connect()} disabled={busy} loading={busy} />
      ) : null}
      {connected ? (
        <>
          <KeyValue icon="checkmark-circle" label={t('huaweiHealth.connectedSince')} value={status?.connectedAt ? formatDateTime(status.connectedAt) : null} />
          <KeyValue
            icon="time"
            label={t('huaweiHealth.lastSync')}
            value={stored.lastSyncAt ? formatDateTime(Math.floor(stored.lastSyncAt / 1000)) : t('huaweiHealth.never')}
          />
          {last ? (
            <AppText variant="caption" muted>
              {t('huaweiHealth.result', {
                workouts: last.workoutsAdded,
                filled: last.workoutsUpdated,
                minutes: last.minutesWritten,
                days: last.dayTotalsAdded,
              })}
            </AppText>
          ) : null}
          {last && last.missingScopes.length > 0 ? <Notice tone="info">{t('huaweiHealth.missingScopes')}</Notice> : null}
          {progress !== null ? (
            <>
              <Notice icon="sync">{t('huaweiHealth.syncing', { percent: Math.round(progress * 100) })}</Notice>
              <Button label={t('huaweiHealth.cancel')} variant="secondary" icon="close" onPress={() => (cancelled.current = true)} />
            </>
          ) : (
            <Button label={t('huaweiHealth.syncNow')} variant="primary" icon="sync" onPress={() => void sync(status)} disabled={busy} loading={busy} />
          )}
          <Button label={t('huaweiHealth.disconnect')} variant="secondary" icon="unlink" onPress={() => void disconnect()} disabled={busy} />
          <AppText variant="caption" muted>
            {t('huaweiHealth.disconnectHint')}
          </AppText>
        </>
      ) : null}
    </Section>
  );
}
