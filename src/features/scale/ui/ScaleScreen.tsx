import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { AppText } from '@/components/AppText';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Divider, Screen, Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { SwitchRow } from '@/components/SwitchRow';
import { Notice } from '@/components/States';
import { scaleUserFrom } from '@/features/scale/profile';
import { PROTOCOLS, protocolById } from '@/features/scale/registry';
import { scaleLabel } from '@/features/scale/store';
import type { Granted } from '@/features/sensors/permissions';
import { RoutineNameDialog } from '@/features/strength/ui/RoutineNameDialog';
import { useScale } from '@/state/ScaleProvider';
import { HuaweiWear } from '@/wear';

import { HistorySection } from './HistorySection';
import { LiveCard } from './LiveCard';
import { RecordSection } from './RecordSection';
import { ScalePicker } from './ScalePicker';
import { useDiscovery } from './useDiscovery';

const GUARD_OPTIONS = [0, 6, 12] as const;

/** Pengaturan > Timbangan: the scale in use with a live reading and test weigh-in, the search, the options, the history and the recorder. */
export function ScaleScreen() {
  const { t } = useTranslation('scale');
  const s = useScale();
  const discovery = useDiscovery();
  const [permission, setPermission] = useState<Granted | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [forgetting, setForgetting] = useState(false);

  // A test weigh-in must not outlive the screen.
  const { stopTest } = s;
  useEffect(() => stopTest, [stopTest]);

  const protocol = s.scale ? protocolById(s.scale.protocolId) : null;
  const hasProfile = scaleUserFrom(HuaweiWear.getUserProfile(), new Date().getFullYear()) !== null;
  const searchProblem =
    permission === 'denied' || permission === 'blocked' || discovery.error === 'ERR_BLUETOOTH_PERMISSION'
      ? 'permission'
      : discovery.error === 'ERR_BLUETOOTH_OFF'
        ? 'off'
        : discovery.error
          ? 'unavailable'
          : null;
  const problem = s.problem ?? searchProblem;

  const startTest = async () => setPermission(await s.startTest());

  return (
    <Screen>
      {problem ? (
        <Notice
          tone="danger"
          action={problem === 'permission' ? { label: t('problem.openSettings'), onPress: () => void Linking.openSettings() } : undefined}>
          {t(`problem.${problem}`)}
        </Notice>
      ) : null}

      {s.scale ? (
        <LiveCard
          scale={s.scale}
          kindLabel={protocol?.label ?? null}
          live={s.live}
          testing={s.testing}
          onTest={() => void startTest()}
          onStopTest={s.stopTest}
          onRename={() => setRenaming(true)}
          onForget={() => setForgetting(true)}
        />
      ) : (
        <Section title={t('title')} icon="scale-outline">
          <AppText variant="caption" muted>
            {t('card.empty')}
          </AppText>
        </Section>
      )}

      <ScalePicker
        discovery={discovery}
        currentId={s.scale?.id ?? null}
        onPermission={setPermission}
        onPick={(device) => {
          if (device.protocolId) void s.pick({ id: device.id, name: device.name ?? scaleLabelFallback(device.id), protocolId: device.protocolId });
        }}
      />

      {s.scale ? (
        <Section title={t('settings.title')} icon="options-outline">
          <SwitchRow
            label={t('settings.auto')}
            hint={t('settings.autoHint')}
            value={s.settings.autoCapture}
            onValueChange={(autoCapture) => s.updateSettings({ autoCapture })}
          />
          <Divider />
          <SwitchRow
            label={t('settings.rogo')}
            hint={t('settings.rogoHint')}
            value={s.settings.pushToRogo}
            onValueChange={(pushToRogo) => s.updateSettings({ pushToRogo })}
          />
          <Divider />
          <AppText variant="bodyStrong">{t('settings.guard')}</AppText>
          <AppText variant="caption" muted>
            {t('settings.guardHint')}
          </AppText>
          <Segmented
            options={[
              { value: GUARD_OPTIONS[0], label: t('settings.guardOff') },
              { value: GUARD_OPTIONS[1], label: t('settings.guardNormal') },
              { value: GUARD_OPTIONS[2], label: t('settings.guardLoose') },
            ]}
            value={nearestGuard(s.settings.guardPercent)}
            onChange={(guardPercent) => s.updateSettings({ guardPercent })}
          />
        </Section>
      ) : null}

      <HistorySection
        weighIns={s.weighIns}
        rogoWaiting={s.rogoWaiting}
        needsProfile={!hasProfile}
        onRetry={() => void s.retryPush()}
        onDelete={(id) => void s.remove(id)}
      />

      <RecordSection devices={discovery.devices} />

      <Section title={t('supported.title')} icon="information-circle">
        <AppText variant="caption" muted>
          {t('supported.body')}
        </AppText>
        {PROTOCOLS.map((p) => (
          <AppText key={p.id} variant="caption">
            {`${p.label} (${p.brands.slice(0, 3).join(', ')})`}
          </AppText>
        ))}
      </Section>

      <RoutineNameDialog
        visible={renaming}
        title={t('card.renameTitle')}
        placeholder={t('card.renameTitle')}
        confirmLabel={t('card.rename')}
        initial={s.scale ? scaleLabel(s.scale) : ''}
        onConfirm={(name) => {
          setRenaming(false);
          void s.rename(name);
        }}
        onCancel={() => setRenaming(false)}
      />
      <ConfirmDialog
        visible={forgetting}
        title={t('card.forgetTitle')}
        message={t('card.forgetMessage')}
        confirmLabel={t('card.forget')}
        destructive
        onConfirm={() => {
          setForgetting(false);
          void s.forget();
        }}
        onCancel={() => setForgetting(false)}
      />
    </Screen>
  );
}

/** A scale that advertises no name is told apart by the tail of its id, like the sensors. */
const scaleLabelFallback = (id: string): string => id.slice(-5);

/** The saved percent may be anything between 0 and 50 (an older value); the control shows the closest option. */
function nearestGuard(percent: number): number {
  return GUARD_OPTIONS.reduce((best, option) => (Math.abs(option - percent) < Math.abs(best - percent) ? option : best));
}
