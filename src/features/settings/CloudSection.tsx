import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Details } from '@/components/Details';
import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { formatSize } from '@/cloud/estimate';
import { cycleSyncEnabled, setCycleSync } from '@/cloud/healthSync';
import { onUnmeteredNetwork } from '@/cloud/syncSettings';
import { errorMessage, formatCount, formatDateTime } from '@/format';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { SignInButtons } from '@/features/settings/SignInButtons';
import { PRO_SUPPORT } from '@/features/pro/support';
import { UpgradeCard } from '@/features/pro/UpgradeCard';
import { useCloud } from '@/state/CloudProvider';
import { useTheme } from '@/theme';
import type { TFunction } from '@/i18n';

type T = TFunction<'settings'>;

const workoutsText = (t: T, count: number) => t('cloud.workouts', { count, n: formatCount(count) });

/** What is waiting to go up: the workouts with the size they will take, and the step and sleep rows. */
function waitingText(t: T, workouts: number, bytes: number, rows: number): string {
  const workoutsPart =
    workouts > 0 ? t('cloud.waiting.workouts', { workouts: workoutsText(t, workouts), size: formatSize(bytes) }) : null;
  const rowsPart = rows > 0 ? t('cloud.waiting.rows', { count: rows, n: formatCount(rows) }) : null;
  if (workoutsPart && rowsPart) return t('cloud.waiting.both', { first: workoutsPart, second: rowsPart });
  return workoutsPart ?? rowsPart ?? t('cloud.waiting.nothing');
}

/**
 * Sign in with the JoyoRogo account and sync with the cloud. With a Pro account every workout (GPS, heart rate, speed,
 * cadence, power and the analysis) goes up as a compressed file, steps and sleep go to the JoyoFit cloud, and a new
 * phone restores its workouts after sign-in. Syncs run on their own after each watch sync; "Sync now" forces one, and
 * "Wi-Fi only" keeps the automatic ones off mobile data. Without Pro nothing is uploaded and the workouts stay on the phone.
 * Signing out and deleting the account live in the Settings hub (`useAccountDialogs`); "Delete cloud data", which keeps the
 * account, closes this screen as a destructive row.
 */
export function CloudSection() {
  const { t } = useTranslation('settings');
  const cloud = useCloud();
  const theme = useTheme();
  const db = useSQLiteContext();
  const presence = useWatchPresence();
  const [cycleOn, setCycleOn] = useState(cycleSyncEnabled);
  const [cycleError, setCycleError] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [confirmingMobile, setConfirmingMobile] = useState(false);
  const busy = cloud.uploading || cloud.deleting || cloud.wiping;

  const syncNow = async () => {
    if (cloud.wifiOnly && !(await onUnmeteredNetwork())) setConfirmingMobile(true);
    else await cloud.syncNow();
  };

  const changeCycle = (on: boolean) => {
    setCycleOn(on);
    setCycleError(null);
    setCycleSync(db, on).catch((e) => {
      // Turning it off deletes the cloud copy first: when that failed nothing changed, so the switch goes back.
      setCycleOn(cycleSyncEnabled());
      setCycleError(errorMessage(e));
    });
  };

  // Only a signed-in account that is not Pro, a signed-out phone, or a locked sync means "this data lives on this phone alone".
  const onlyHere = !cloud.signedIn || cloud.pro === false;
  // History came to a phone that has no watch of its own: the watch is paired per phone.
  const pairingNote = cloud.signedIn && presence === 'data';

  return (
    <>
      {cloud.signedIn && cloud.pro === false ? <UpgradeCard moment="cloud" dismissible /> : null}
      <Section title={t('cloud.title')} icon="cloud-upload">
        {!cloud.configured ? (
          <Notice tone="danger">
            {t('cloud.notConfigured')}
          </Notice>
        ) : null}
        {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
        {onlyHere ? <Notice icon="phone-portrait-outline">{t('cloud.onlyHere')}</Notice> : null}
        {cloud.pro === true ? <Notice icon="cloud-done-outline">{t('cloud.proSyncs')}</Notice> : null}
        {cloud.pro === true ? (
          <>
            <Notice icon="chatbubble-ellipses-outline">{t('cloud.support.body')}</Notice>
            <Button
              label={t('cloud.support.open', { handle: PRO_SUPPORT.handle })}
              variant="secondary"
              icon="open-outline"
              onPress={() => void Linking.openURL(PRO_SUPPORT.url)}
            />
            {cloud.email ? (
              <Button
                label={emailCopied ? t('cloud.support.copied') : t('cloud.support.copy')}
                variant="ghost"
                icon="copy-outline"
                onPress={() => {
                  void Clipboard.setStringAsync(cloud.email ?? '').then(() => setEmailCopied(true));
                }}
              />
            ) : null}
          </>
        ) : null}
        {pairingNote ? <Notice icon="watch-outline">{t('cloud.pairingNote')}</Notice> : null}
        {cloud.restoring ? (
          <Notice icon="cloud-download-outline">
            {cloud.restoring.total === null
              ? t('cloud.restoring')
              : t('cloud.restoringProgress', { done: formatCount(cloud.restoring.done), total: formatCount(cloud.restoring.total) })}
          </Notice>
        ) : null}
        {cloud.progress ? (
          <Notice icon="cloud-upload">{t('cloud.uploading', { done: formatCount(cloud.progress.done), total: formatCount(cloud.progress.total) })}</Notice>
        ) : null}
        {cloud.refusedWorkouts > 0 ? (
          <Notice tone="danger">
            {t('cloud.refused', { count: cloud.refusedWorkouts, n: formatCount(cloud.refusedWorkouts) })}
            {cloud.refusedError ? ` ${t('cloud.refusedError', { error: cloud.refusedError })}` : ''}
          </Notice>
        ) : null}
        <PairGrid>
          <Pair label={t('cloud.labels.account')} value={cloud.signedIn ? cloud.email : null} wide />
          {cloud.signedIn ? (
            <>
              <Pair label={t('cloud.labels.lastSync')} value={cloud.lastSyncAt ? formatDateTime(cloud.lastSyncAt) : null} />
              <Pair
                label={t('cloud.labels.inCloud')}
                value={
                  cloud.cloudWorkouts
                    ? t('cloud.inCloudValue', {
                        workouts: workoutsText(t, cloud.cloudWorkouts.count),
                        used: formatSize(cloud.cloudWorkouts.bytes),
                        quota: formatSize(cloud.cloudWorkouts.quotaBytes),
                      })
                    : null
                }
              />
              {cloud.locked ? null : (
                <Pair
                  label={t('cloud.labels.waiting')}
                  value={
                    cloud.pendingWorkouts == null || cloud.pendingRows == null || cloud.pendingBytes == null
                      ? null
                      : waitingText(t, cloud.pendingWorkouts, cloud.pendingBytes, cloud.pendingRows)
                  }
                  wide
                />
              )}
            </>
          ) : null}
        </PairGrid>
        {cloud.signedIn ? (
          <>
            <Button
              label={t('cloud.syncNow')}
              variant="primary"
              icon="sync"
              onPress={() => void syncNow()}
              disabled={!cloud.configured || cloud.deleting || cloud.wiping}
              loading={cloud.uploading}
            />
            <SwitchRow
              label={t('cloud.wifiOnly')}
              hint={t('cloud.wifiOnlyHint')}
              icon="wifi"
              value={cloud.wifiOnly}
              onValueChange={cloud.setWifiOnly}
            />
            <SwitchRow
              label={t('cloud.autoSync')}
              hint={t('cloud.autoSyncHint')}
              icon="sync"
              value={cloud.autoSync}
              onValueChange={cloud.setAutoSync}
              disabled={cloud.wiping}
            />
            <SwitchRow
              label={t('cloud.cycleSync')}
              hint={t('cloud.cycleSyncHint')}
              icon="calendar"
              value={cycleOn}
              onValueChange={changeCycle}
              disabled={cloud.wiping}
            />
            {cycleError ? <Notice tone="danger">{cycleError}</Notice> : null}
          </>
        ) : (
          <>
            <SignInButtons />
            {/* Said once, where the person signs in: the first account takes over this phone's data, a later one asks. */}
            <AppText variant="caption" muted>
              {cloud.email ? t('cloud.signInAgainHint', { email: cloud.email }) : t('cloud.firstSignInHint')}
            </AppText>
          </>
        )}
        <ConfirmDialog
          visible={confirmingMobile}
          title={t('cloud.mobileTitle')}
          message={t('cloud.mobileMessage')}
          confirmLabel={t('cloud.syncNow')}
          onConfirm={() => {
            setConfirmingMobile(false);
            void cloud.syncNow();
          }}
          onCancel={() => setConfirmingMobile(false)}
        />
        <ConfirmDialog
          visible={confirmingWipe}
          title={t('cloud.wipeTitle')}
          message={t('cloud.wipeMessage')}
          confirmLabel={t('cloud.wipe')}
          destructive
          busy={cloud.wiping}
          onConfirm={() => void cloud.wipeCloud().finally(() => setConfirmingWipe(false))}
          onCancel={() => setConfirmingWipe(false)}
        />
        <Details>{t('cloud.details')}</Details>
      </Section>
      {cloud.signedIn ? (
        <NavRow
          destructive
          icon="cloud-offline-outline"
          title={t('cloud.wipe')}
          disabled={busy}
          onPress={() => setConfirmingWipe(true)}
          style={groupedRowStyle(theme, 0, 1)}
        />
      ) : null}
    </>
  );
}
