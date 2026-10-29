import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { rogo, type RogoMcpActivity, type RogoMcpConnection, type RogoMcpInfo } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Details } from '@/components/Details';
import { Divider, Screen, Section } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { activityRange, isMcpTool, readableScopeKeys } from '@/features/koneksi/scopes';
import { UpgradeCard } from '@/features/pro/UpgradeCard';
import { SignInGate } from '@/features/social/SignInGate';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { formatAgo } from '@/format';
import { fmtDate, fmtDateTime, fmtDay } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { spacing, useColors } from '@/theme';

const GUIDE_URL = 'https://joyorogo.com/panduan/ai';
const PRIVACY_URL = 'https://fit.joyorogo.com/privasi#koneksi-ai';
const ACTIVITY_LIMIT = 20;
/** How long the copy button shows its check. */
const COPIED_MS = 1800;

interface Overview {
  info: RogoMcpInfo;
  connections: RogoMcpConnection[];
  activity: RogoMcpActivity[];
  /** When the list was read, so the relative times are computed without a clock read in render. */
  nowSec: number;
}

const load = async (): Promise<Overview> => {
  const [info, connections, activity] = await Promise.all([rogo.mcp.info(), rogo.mcp.list(), rogo.mcp.activity(ACTIVITY_LIMIT)]);
  return { info, connections, activity, nowSec: Math.floor(Date.now() / 1000) };
};

/** The AI apps (Claude, ChatGPT, any MCP app) connected to the JoyoRogo account: connector address, who can read what, disconnecting, and what they read lately. */
export function KoneksiScreen() {
  const { t } = useTranslation(['koneksi', 'common']);
  const colors = useColors();
  const cloud = useCloud();
  const describe = useCallback(() => t('koneksi:list.error'), [t]);
  const { data, error, refreshing, refresh, setData } = useRogoQuery(load, cloud.signedIn, describe);
  const { toast, show } = useToast();

  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (copiedTimer.current && clearTimeout(copiedTimer.current)), []);

  const [confirming, setConfirming] = useState<RogoMcpConnection | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const copyAddress = async () => {
    if (!data) return;
    await Clipboard.setStringAsync(data.info.url);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  const revoke = async (connection: RogoMcpConnection) => {
    setConfirming(null);
    setRevoking(connection.clientId);
    setRevokeError(null);
    try {
      await rogo.mcp.revoke(connection.clientId);
      show(t('koneksi:revoke.done', { name: connection.name }));
      if (data) setData({ ...data, connections: data.connections.filter((c) => c.clientId !== connection.clientId) });
      // Reads the server's list again so what is shown is what it holds.
      void refresh();
    } catch {
      setRevokeError(t('koneksi:revoke.error'));
    } finally {
      setRevoking(null);
    }
  };

  const nowSec = data?.nowSec ?? 0;

  return (
    <View style={styles.root}>
      <Screen refresh={{ refreshing, onRefresh: () => void refresh(), enabled: cloud.signedIn }}>
        <SignInGate copy={{ title: t('koneksi:signedOut.title'), description: t('koneksi:signedOut.description') }}>
          <AppText variant="caption" muted>
            {t('koneksi:subtitle')}
          </AppText>

          {data === null && error === null ? <Skeleton width="100%" height={200} radius="card" /> : null}
          {data === null && error !== null ? (
            <Notice tone="danger" action={{ label: t('koneksi:list.retry'), onPress: () => void refresh() }}>
              {error}
            </Notice>
          ) : null}

          {data ? (
            <>
              {error !== null ? (
                <Notice tone="danger" action={{ label: t('koneksi:list.retry'), onPress: () => void refresh() }}>
                  {error}
                </Notice>
              ) : null}

              {!data.info.unlocked ? <UpgradeCard moment="koneksi" dismissible /> : null}

              <Section title={t('koneksi:connector.title')} icon="link" tint="link">
                <AppText variant="caption" muted>
                  {t('koneksi:connector.hint')}
                </AppText>
                <View style={[styles.address, { backgroundColor: colors.muted }]}>
                  <AppText variant="mono" selectable>
                    {data.info.url}
                  </AppText>
                </View>
                <Button
                  label={copied ? t('koneksi:connector.copied') : t('koneksi:connector.copy')}
                  icon="copy-outline"
                  done={copied}
                  onPress={() => void copyAddress()}
                />
                <Button label={t('koneksi:connector.guide')} variant="ghost" icon="book-outline" onPress={() => void Linking.openURL(GUIDE_URL)} />
              </Section>

              <Section title={t('koneksi:list.title')} icon="sparkles" tint="link">
                {revokeError ? <Notice tone="danger">{revokeError}</Notice> : null}
                {data.connections.length === 0 ? (
                  <EmptyState icon="sparkles" title={t('koneksi:list.empty')} description={t('koneksi:list.emptyHint')} />
                ) : (
                  data.connections.map((connection, i) => (
                    <View key={connection.clientId} style={styles.connection}>
                      {i > 0 ? <Divider /> : null}
                      <ConnectionCard
                        connection={connection}
                        nowSec={nowSec}
                        busy={revoking === connection.clientId}
                        onRevoke={() => setConfirming(connection)}
                      />
                    </View>
                  ))
                )}
              </Section>

              <Section title={t('koneksi:activity.title')} icon="time" tint="link">
                {data.activity.length === 0 ? (
                  <AppText variant="caption" muted>
                    {t('koneksi:activity.empty')}
                  </AppText>
                ) : (
                  data.activity.map((entry, i) => (
                    <View key={entry.id} style={styles.connection}>
                      {i > 0 ? <Divider /> : null}
                      <ActivityRow entry={entry} />
                    </View>
                  ))
                )}
                <Details>{t('koneksi:activity.hint')}</Details>
              </Section>

              <Button label={t('koneksi:privacy')} variant="ghost" icon="shield-checkmark-outline" onPress={() => void Linking.openURL(PRIVACY_URL)} />
              <Details>{t('koneksi:disclaimer')}</Details>
            </>
          ) : null}
        </SignInGate>
      </Screen>
      {toast}
      <ConfirmDialog
        visible={confirming !== null}
        title={t('koneksi:revoke.title', { name: confirming?.name ?? '' })}
        message={t('koneksi:revoke.body', { name: confirming?.name ?? '' })}
        confirmLabel={t('koneksi:revoke.confirm')}
        cancelLabel={t('koneksi:revoke.cancel')}
        onConfirm={() => confirming && void revoke(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </View>
  );
}

function ConnectionCard({
  connection,
  nowSec,
  busy,
  onRevoke,
}: {
  connection: RogoMcpConnection;
  nowSec: number;
  busy: boolean;
  onRevoke: () => void;
}) {
  const { t } = useTranslation('koneksi');
  const scopes = readableScopeKeys(connection.scopes);
  return (
    <View style={styles.card}>
      <View>
        <AppText variant="bodyStrong">{connection.name}</AppText>
        {connection.redirectHosts.length > 0 ? (
          <AppText variant="caption" muted>
            {t('list.via', { hosts: connection.redirectHosts.join(', ') })}
          </AppText>
        ) : null}
      </View>
      <AppText variant="caption" muted>
        {t('list.connectedAt', { date: fmtDate(connection.connectedAt / 1000, 'medium') })}
        {'\n'}
        {connection.lastUsedAt === null ? t('list.neverUsed') : t('list.lastUsed', { when: formatAgo(connection.lastUsedAt / 1000, nowSec) })}
        {'\n'}
        {t('list.calls', { count: connection.calls30d })}
      </AppText>
      {scopes.length > 0 ? (
        <View style={styles.scopes}>
          <AppText variant="label">{t('list.allows')}</AppText>
          {scopes.map((key) => (
            <View key={key}>
              <AppText variant="bodyStrong">{t(`scope.${key}.label`)}</AppText>
              <AppText variant="caption" muted>
                {t(`scope.${key}.desc`)}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
      <Button label={t('revoke.action')} variant="destructive" icon="unlink" loading={busy} onPress={onRevoke} />
    </View>
  );
}

function ActivityRow({ entry }: { entry: RogoMcpActivity }) {
  const { t } = useTranslation('koneksi');
  const range = activityRange(entry.args);
  const detail = [entry.clientName, range ? t('activity.range', { from: fmtDay(range.from, 'short'), to: fmtDay(range.to, 'short') }) : null]
    .filter((part): part is string => !!part)
    .join(' \u00b7 ');
  return (
    <View style={styles.activity}>
      <View style={styles.activityText}>
        <AppText variant="bodyStrong">{isMcpTool(entry.tool) ? t(`activity.tool.${entry.tool}`) : entry.tool}</AppText>
        {detail ? (
          <AppText variant="caption" muted>
            {detail}
          </AppText>
        ) : null}
      </View>
      <View style={styles.activityRight}>
        <AppText variant="caption" danger={entry.outcome !== 'ok'}>
          {t(`activity.outcome.${entry.outcome}`)}
        </AppText>
        <AppText variant="caption" muted>
          {fmtDateTime(entry.createdAt / 1000)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  address: { borderRadius: 12, padding: spacing.md },
  connection: { gap: spacing.sm + 2 },
  card: { gap: spacing.sm + 2 },
  scopes: { gap: spacing.sm },
  activity: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  activityText: { flex: 1 },
  activityRight: { alignItems: 'flex-end' },
});
