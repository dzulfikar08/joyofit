import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Divider, Screen, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { AlarmEditor, type AlarmFormValues } from '@/features/alarms/AlarmEditor';
import {
  DEFAULT_SMART_ALARM,
  describeRepeat,
  firstFreeSlot,
  formatAlarmTime,
} from '@/features/alarms/alarmUtils';
import { useAlarms } from '@/features/alarms/useAlarms';
import { formatDateTime } from '@/format';
import { fmtInt } from '@/i18n';
import { spacing, useColors } from '@/theme';
import { ALARM_SLOTS, type WatchAlarm, type WatchSmartAlarm } from '@/wear';

type Editing = { kind: 'event'; slot: number; isNew: boolean } | { kind: 'smart' } | null;

/**
 * Reads, edits, adds, deletes and enables the watch's alarms and its smart alarm. The watch has
 * five slots, so the list is bounded and stays in a plain scroll view.
 */
export function AlarmsScreen() {
  const router = useRouter();
  const { t } = useTranslation(['watch', 'common']);
  const colors = useColors();
  const { alarms, connected, busy, error, refresh, save, restorable, restore } = useAlarms();
  const [editing, setEditing] = useState<Editing>(null);

  const writable = connected && alarms.supported && !busy;
  const free = firstFreeSlot(alarms.event);
  const smart = alarms.smart;

  const pushEvents = async (event: WatchAlarm[]) =>
    save({ event: [...event].sort((a, b) => a.slot - b.slot), smart: null });

  const pushSmart = async (smart: WatchSmartAlarm) => save({ event: alarms.event, smart });

  const saveEvent = async (slot: number, values: AlarmFormValues) => {
    const previous = alarms.event.find((alarm) => alarm.slot === slot);
    const next: WatchAlarm = {
      slot,
      enabled: previous?.enabled ?? true,
      hour: values.hour,
      minute: values.minute,
      repeat: values.repeat,
      name: values.name,
    };
    const ok = await pushEvents([...alarms.event.filter((alarm) => alarm.slot !== slot), next]);
    if (ok) setEditing(null);
  };

  const saveSmart = async (values: AlarmFormValues) => {
    const ok = await pushSmart({
      enabled: smart?.enabled ?? true,
      hour: values.hour,
      minute: values.minute,
      repeat: values.repeat,
      aheadMinutes: values.aheadMinutes,
    });
    if (ok) setEditing(null);
  };

  const editor = (() => {
    if (!editing) return null;
    if (editing.kind === 'smart') {
      const current = smart ?? DEFAULT_SMART_ALARM;
      return (
        <AlarmEditor
          kind="smart"
          initial={{ ...current, name: '' }}
          saving={busy}
          onSave={(values) => void saveSmart(values)}
          onCancel={() => setEditing(null)}
        />
      );
    }
    const { slot, isNew } = editing;
    const existing = alarms.event.find((alarm) => alarm.slot === slot);
    return (
      <AlarmEditor
        kind="event"
        initial={{
          hour: existing?.hour ?? 7,
          minute: existing?.minute ?? 0,
          repeat: existing?.repeat ?? 0,
          name: existing?.name ?? t('watch:alarms.defaultName'),
          aheadMinutes: 5,
        }}
        saving={busy}
        onSave={(values) => void saveEvent(slot, values)}
        onCancel={() => setEditing(null)}
        onDelete={
          isNew
            ? undefined
            : async () => {
                const ok = await pushEvents(alarms.event.filter((alarm) => alarm.slot !== slot));
                if (ok) setEditing(null);
              }
        }
      />
    );
  })();

  return (
    <Screen refresh={{ refreshing: busy && editing === null, onRefresh: () => void refresh(), enabled: connected }}>
      {!connected ? (
        <Notice icon="bluetooth" action={{ label: t('watch:openWatch'), onPress: () => router.navigate('/watch') }}>
          {t('watch:alarms.connect')}
        </Notice>
      ) : null}
      {connected && !alarms.supported ? <Notice>{t('watch:alarms.unsupported')}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {restorable && !busy ? (
        <Notice
          icon="cloud-download"
          action={{ label: t('watch:alarms.restore', { count: restorable.event.length }), onPress: () => void restore() }}>
          {t('watch:alarms.restoreHint')}
        </Notice>
      ) : null}

      <Section
        title={t('watch:alarms.title')}
        icon="alarm"
        trailing={
          <AppText variant="caption" muted>
            {t('watch:alarms.count', { used: alarms.event.length, total: ALARM_SLOTS })}
          </AppText>
        }>
        {alarms.event.length === 0 && editing === null ? (
          <AppText variant="caption" muted>
            {t('watch:alarms.empty')}
          </AppText>
        ) : null}
        {alarms.event.map((alarm, index) => (
          <View key={alarm.slot} style={styles.item}>
            {index > 0 ? <Divider /> : null}
            {editing?.kind === 'event' && editing.slot === alarm.slot ? (
              editor
            ) : (
              <View style={styles.row}>
                <View style={styles.top}>
                  <View style={styles.info}>
                    <AppText variant="figure">{formatAlarmTime(alarm.hour, alarm.minute)}</AppText>
                    <AppText variant="caption" muted numberOfLines={1}>
                      {alarm.name} · {describeRepeat(alarm.repeat)}
                    </AppText>
                  </View>
                  <Switch
                    accessibilityLabel={t('watch:alarms.switchA11y', { time: formatAlarmTime(alarm.hour, alarm.minute) })}
                    value={alarm.enabled}
                    disabled={!writable}
                    onValueChange={(enabled) =>
                      void pushEvents(alarms.event.map((a) => (a.slot === alarm.slot ? { ...a, enabled } : a)))
                    }
                    trackColor={{ false: colors.switchOff, true: colors.primary }}
                    thumbColor={alarm.enabled ? colors.primaryForeground : colors.card}
                  />
                </View>
                <Button
                  label={t('common:actions.edit')}
                  icon="create"
                  disabled={!writable}
                  style={styles.edit}
                  onPress={() => setEditing({ kind: 'event', slot: alarm.slot, isNew: false })}
                />
              </View>
            )}
          </View>
        ))}
        {editing?.kind === 'event' && editing.isNew ? (
          <View style={styles.item}>
            {alarms.event.length > 0 ? <Divider /> : null}
            {editor}
          </View>
        ) : null}
        <Button
          label={t('watch:alarms.add')}
          variant="primary"
          icon="add"
          disabled={!writable || free === null || editing !== null}
          onPress={() => free !== null && setEditing({ kind: 'event', slot: free, isNew: true })}
        />
        {free === null ? (
          <AppText variant="caption" muted>
            {t('watch:alarms.full', { total: ALARM_SLOTS })}
          </AppText>
        ) : null}
        <AppText variant="caption" muted>
          {alarms.updatedAt === null
            ? t('watch:alarms.neverRead')
            : t('watch:alarms.lastRead', { time: formatDateTime(alarms.updatedAt / 1000) })}
        </AppText>
        <Button
          label={t('watch:alarms.read')}
          icon="refresh"
          disabled={!connected || busy}
          loading={busy && !editing}
          onPress={() => void refresh()}
        />
      </Section>

      {alarms.smartSupported ? (
        <Section title={t('watch:alarms.smart.title')} icon="moon" tint="sleep">
          <Details>
            {t('watch:alarms.smart.about')}
          </Details>
          {editing?.kind === 'smart' ? (
            editor
          ) : (
            <>
              <View style={styles.stack}>
                <AppText variant="figure">{smart ? formatAlarmTime(smart.hour, smart.minute) : t('watch:alarms.smart.notSet')}</AppText>
                {smart ? (
                  <AppText variant="caption" muted>
                    {t('watch:alarms.smart.summary', { minutes: fmtInt(smart.aheadMinutes), repeat: describeRepeat(smart.repeat) })}
                  </AppText>
                ) : null}
              </View>
              {smart ? (
                <SwitchRow
                  label={t('watch:alarms.smart.on')}
                  value={smart.enabled}
                  disabled={!writable}
                  onValueChange={(enabled) => void pushSmart({ ...smart, enabled })}
                />
              ) : null}
              <Button
                label={smart ? t('watch:alarms.smart.edit') : t('watch:alarms.smart.set')}
                icon="create"
                disabled={!writable || editing !== null}
                onPress={() => setEditing({ kind: 'smart' })}
              />
            </>
          )}
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.md },
  row: { gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1, gap: 2 },
  stack: { gap: 2 },
  edit: { alignSelf: 'flex-start' },
});
