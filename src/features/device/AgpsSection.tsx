import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { agpsLabActive, agpsView, agpsVisible } from '@/features/device/agps';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatClock, formatDateTime } from '@/format';
import { fmtInt } from '@/i18n';
import { HuaweiWear, hasNative, type AgpsStatus } from '@/wear';

const POLL_MS = 1000;

function read(): AgpsStatus | null {
  try {
    return HuaweiWear.getAgps();
  } catch {
    return null;
  }
}

/**
 * The satellite-data (A-GPS) row of the Watch tab: when the watch last took data, how big it was, "Update now", the last result
 * in words. It shows only for a watch that asked for a kind JoyoFit serves (`agpsVisible`: the Broadcom kind, or HW_AGNSS with the experimental
 * switch on). The exchange lives in the native module (Kotlin and
 * Swift). OTA bundles on an older binary have no `getAgps` and show nothing.
 */
export function AgpsSection() {
  const { t } = useTranslation('watch');
  const supported = hasNative('getAgps');
  const [status, setStatus] = useState<AgpsStatus | null>(() => (supported ? read() : null));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(() => {
    if (!supported) return;
    setStatus(read());
    setNow(Date.now());
  }, [supported]);
  useNativeRefresh(refresh);

  const active = running || (status !== null && status.phase !== 'idle');
  useEffect(() => {
    if (!supported || !active) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [supported, active, refresh]);

  if (!supported || status === null || !agpsVisible(status, now)) return null;

  const view = agpsView(status, now);

  const update = async () => {
    setError(null);
    setRunning(true);
    try {
      await HuaweiWear.refreshAgps();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
      refresh();
    }
  };

  const asked =
    status.lastAskAt > 0 ? (status.lastAskTags.length > 0 ? status.lastAskTags.replaceAll(',', ', ') : `v${status.lastAskVersion}`) : null;

  return (
    <Section title={t('agps.title')} icon="navigate">
      <PairGrid>
        <Pair
          label={t('agps.lastUpdated')}
          value={view.lastUpdatedMs === null ? t('agps.never') : formatDateTime(view.lastUpdatedMs / 1000)}
        />
        <Pair label={t('agps.size')} value={view.sizeKb === null ? null : t('agps.sizeValue', { kb: fmtInt(view.sizeKb) })} />
        <Pair label={t('agps.phoneCopy')} value={status.cachedAt > 0 ? formatDateTime(status.cachedAt / 1000) : null} />
        <Pair label={t('agps.asked')} value={asked ?? t('agps.askedNever')} />
      </PairGrid>
      <Notice
        tone={view.tone === 'danger' ? 'danger' : 'info'}
        icon={view.tone === 'ok' ? 'checkmark-circle' : view.busy ? 'sync' : undefined}
      >
        {t(`agps.status.${view.statusKey}`)}
        {view.detail ? ` ${view.detail}` : ''}
        {view.retryAtMs !== null ? ` ${t('agps.retryAt', { time: formatClock(view.retryAtMs / 1000) })}` : ''}
      </Notice>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <ButtonRow>
        <Button label={t('agps.refresh')} icon="refresh" disabled={view.busy && !running} loading={running} onPress={() => void update()} />
        {view.busy ? (
          <Button label={t('agps.cancel')} variant="secondary" icon="close" onPress={() => void HuaweiWear.cancelAgps().then(refresh)} />
        ) : null}
      </ButtonRow>
      <Details>{agpsLabActive(status) ? t('agps.detailsLab') : t('agps.details')}</Details>
    </Section>
  );
}
