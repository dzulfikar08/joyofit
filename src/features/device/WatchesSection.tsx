import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Details } from '@/components/Details';
import { IconChip } from '@/components/IconChip';
import { isIos } from '@/components/IosUnavailable';
import { Divider, Section } from '@/components/Screen';
import { SwitchRow } from '@/components/SwitchRow';
import { isLinkUp, linkLabel } from '@/features/device/linkState';
import { watchListName } from '@/features/device/watchName';
import { shownName } from '@/features/device/shownName';
import { watchActionKey, watchLabel, type WatchRow } from '@/features/device/watches';
import { RoutineNameDialog } from '@/features/strength/ui/RoutineNameDialog';
import { formatSyncTime } from '@/format';
import { fmtPercent } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

interface WatchesSectionProps {
  /** "Add another watch": the Watch tab starts looking for watches and the list below shows the new one. */
  onAdd: () => void;
}

/**
 * The watches this phone has used: which one the phone is linked to, which one is primary (owns the all-day data, see
 * docs/multi-watch.md), a quick switch, a name, and the per-watch switches. One link is open at a time, so "switch" closes the
 * current link and opens the other.
 */
export function WatchesSection({ onAdd }: WatchesSectionProps) {
  const { t } = useTranslation('watch');
  const watch = useWatch();
  const { watches } = watch;
  const [renaming, setRenaming] = useState<WatchRow | null>(null);
  const [removing, setRemoving] = useState<WatchRow | null>(null);

  if (watches.length === 0) return null;
  const several = watches.length > 1;
  const busy = watch.linkState !== 'disconnected' && watch.linkState !== 'connected';

  return (
    <Section title={t('multi.title')} icon="watch" trailing={several ? <AppText variant="caption" muted>{watches.length}</AppText> : null}>
      {watches.map((w, index) => (
        <View key={w.address} style={styles.item}>
          {index > 0 ? <Divider /> : null}
          <WatchItem
            watch={w}
            several={several}
            busy={busy}
            onRename={() => setRenaming(w)}
            onRemove={() => setRemoving(w)}
          />
        </View>
      ))}
      <Button label={t('multi.add')} icon="add" onPress={onAdd} />
      <Details>
        {several ? (
          <AppText variant="caption" muted>
            {t('multi.primaryHint')}
          </AppText>
        ) : null}
        <AppText variant="caption" muted>
          {t('multi.addHint')}
        </AppText>
      </Details>

      <RoutineNameDialog
        visible={renaming !== null}
        title={t('multi.rename.title')}
        placeholder={t('multi.rename.placeholder')}
        confirmLabel={t('multi.rename.save')}
        initial={renaming ? shownName(watchLabel(renaming)) : ''}
        onConfirm={(name) => {
          const target = renaming;
          setRenaming(null);
          if (target) void watch.watchActions.rename(target.address, name);
        }}
        onCancel={() => setRenaming(null)}
      />
      <ConfirmDialog
        visible={removing !== null}
        title={t('multi.remove.title')}
        message={t('multi.remove.message', { name: removing ? shownName(watchLabel(removing)) : '' })}
        confirmLabel={t('multi.remove.confirm')}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (target) void watch.removeWatch(target.address);
        }}
        onCancel={() => setRemoving(null)}
      />
    </Section>
  );
}

interface WatchItemProps {
  watch: WatchRow;
  several: boolean;
  /** A connect, a bind or a sync is under way: no switching. */
  busy: boolean;
  onRename: () => void;
  onRemove: () => void;
}

function WatchItem({ watch: w, several, busy, onRename, onRemove }: WatchItemProps) {
  const { t } = useTranslation('watch');
  const live = useWatch();
  const active = live.activeAddress === w.address && live.linkState !== 'disconnected';
  const linked = active && isLinkUp(live.linkState);
  const label = shownName(watchListName(w));

  const status = [
    w.isPrimary && several ? t('multi.badge.primary') : null,
    active ? (linked ? t('multi.badge.active') : linkLabel(live.linkState)) : null,
    linked && live.battery !== null ? fmtPercent(live.battery) : null,
  ].filter((part): part is string => part !== null);

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <IconChip icon="watch" tint={linked ? 'link' : 'neutral'} />
        <View style={styles.text}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {label}
          </AppText>
          {w.alias ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {shownName(w.name)}
            </AppText>
          ) : null}
          {status.length > 0 ? (
            <AppText variant="caption" numberOfLines={1}>
              {status.join(' · ')}
            </AppText>
          ) : null}
          <AppText variant="caption" muted>
            {w.tracksHealth
              ? w.lastSync !== null
                ? t('multi.lastSync', { time: formatSyncTime(w.lastSync) })
                : t('multi.neverSynced')
              : t('multi.notTracked')}
          </AppText>
        </View>
      </View>
      {!active ? (
        <View style={styles.actions}>
          <Button
            label={t(`multi.${watchActionKey(live.activeAddress, live.linkState)}`)}
            variant="primary"
            icon={watchActionKey(live.activeAddress, live.linkState) === 'connect' ? 'bluetooth' : 'swap-horizontal'}
            disabled={busy}
            onPress={() => void live.switchTo(w.address)}
          />
        </View>
      ) : null}
      <Details title={t('multi.manage')}>
        <View style={styles.manage}>
          <View style={styles.actions}>
            <Button label={t('multi.rename.action')} icon="create-outline" onPress={onRename} />
            {w.alias ? (
              <Button label={t('multi.rename.reset')} onPress={() => void live.watchActions.rename(w.address, '')} />
            ) : null}
            {several && !w.isPrimary ? (
              <Button label={t('multi.makePrimary')} icon="star-outline" onPress={() => void live.watchActions.makePrimary(w.address)} />
            ) : null}
          </View>
          <SwitchRow
            label={t('multi.tracksHealth.label')}
            hint={t('multi.tracksHealth.hint')}
            value={w.tracksHealth}
            onValueChange={(on) => void live.watchActions.setTracksHealth(w.address, on)}
          />
          {!isIos && several && !active && w.tracksHealth ? (
            <SwitchRow
              label={t('multi.background.label')}
              hint={t('multi.background.hint')}
              value={w.bgSync}
              onValueChange={(on) => void live.watchActions.setBackgroundSync(w.address, on)}
            />
          ) : null}
          <Button label={t('multi.remove.action')} variant="destructive" icon="trash-outline" disabled={busy && active} onPress={onRemove} />
        </View>
      </Details>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.md },
  row: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  manage: { gap: spacing.sm, paddingTop: spacing.xs },
});
