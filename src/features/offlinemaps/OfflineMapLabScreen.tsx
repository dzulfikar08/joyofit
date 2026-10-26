import { useEventListener } from 'expo';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatDateTime } from '@/format';
import { fmtInt, fmtNumber } from '@/i18n';
import { HuaweiWear, hasNative, type OfflineMapLabStatus, type OfflineMapList, type OfflineMapSendResult } from '@/wear';
import { spacing } from '@/theme';

import { phoneState, watchState, type CatalogMap, type StoredMap } from './catalog';
import { mapTypeKey, rateKbps, seconds, sendVerdict } from './labText';
import { downloadMap, fetchCatalog, localFile, removeFromPhone, storedMap } from './mapStore';

function read(): OfflineMapLabStatus | null {
  if (!hasNative('getOfflineMapLab')) return null;
  try {
    return HuaweiWear.getOfflineMapLab();
  } catch {
    return null;
  }
}

/** What runs now: `<action>:<map id>` for per-map actions. */
type Busy = 'catalog' | 'list' | 'space' | `download:${string}` | `send:${string}` | `delete:${string}` | null;

const mb = (bytes: number) => fmtNumber(bytes / 1_048_576, 1);

/**
 * The offline-map lab (Settings → About & advanced → Experimental → Offline maps): the maps JoyoFit's server offers (built from OpenStreetMap
 * with tools/offline-maps), downloaded into the app and checked (SHA-256), sent to the watch over the mapkit P2P module; the watch's list and
 * delete. Every frame is in the log (`Mapkit:` lines). See docs/offline-maps.md, "Lab".
 */
export function OfflineMapLabScreen() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<OfflineMapLabStatus | null>(read);
  const [catalog, setCatalog] = useState<CatalogMap[] | null>(null);
  const [stored, setStored] = useState<Record<string, StoredMap | null>>({});
  const [list, setList] = useState<OfflineMapList | null>(null);
  const [space, setSpace] = useState<number | null | undefined>(undefined);
  const [result, setResult] = useState<{ name: string; sent: OfflineMapSendResult } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setStatus(read()), []);
  useNativeRefresh(refresh);

  useEventListener(HuaweiWear, 'onUploadProgress', (event) => {
    if (busy?.startsWith('send:')) setProgress({ done: event.bytes, total: event.total });
  });

  const run = useCallback(
    async (what: Exclude<Busy, null>, action: () => Promise<void>) => {
      setError(null);
      setNotice(null);
      setProgress(null);
      setBusy(what);
      try {
        await action();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(null);
        setProgress(null);
        refresh();
      }
    },
    [refresh],
  );

  const showCatalog = useCallback((maps: CatalogMap[]) => {
    setCatalog(maps);
    setStored(Object.fromEntries(maps.map((m) => [m.id, storedMap(m.id)])));
  }, []);

  const loadCatalog = () => run('catalog', async () => showCatalog(await fetchCatalog()));

  const enabled = status?.enabled === true;
  const linked = status?.registered === true;
  // The first load of the catalog and of the watch's list: state is set only when the answer arrives (and the screen is still there).
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchCatalog().then(
      (maps) => live && showCatalog(maps),
      (e: unknown) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [enabled, showCatalog]);
  useEffect(() => {
    if (!linked) return;
    let live = true;
    HuaweiWear.listOfflineMaps().then(
      (maps) => live && setList(maps),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [linked]);

  const listMaps = () => run('list', async () => setList(await HuaweiWear.listOfflineMaps()));

  const freeSpace = () => run('space', async () => setSpace((await HuaweiWear.offlineMapFreeSpace()).value));

  const download = (map: CatalogMap) =>
    run(`download:${map.id}`, async () => {
      const copy = await downloadMap(map, (done, total) => setProgress({ done, total }));
      setStored((s) => ({ ...s, [map.id]: copy }));
      setNotice(t('offlineMapLab.downloaded', { name: map.name }));
    });

  const send = (map: CatalogMap) =>
    run(`send:${map.id}`, async () => {
      setResult(null);
      // The file itself, not the record of the download, decides: a copy that is gone turns the row back to "Unduh".
      const copy = storedMap(map.id);
      setStored((s) => ({ ...s, [map.id]: copy }));
      if (copy === null) throw new Error(t('offlineMapLab.missingFile', { name: map.name }));
      const { uri, name } = localFile(map.id);
      const sent = await HuaweiWear.sendOfflineMap(uri, name);
      setResult({ name: map.name, sent });
      setList(await HuaweiWear.listOfflineMaps());
    });

  const removeLocal = (map: CatalogMap) => {
    removeFromPhone(map.id);
    setStored((s) => ({ ...s, [map.id]: null }));
  };

  const removeFromWatch = (mapId: string, mapType: number) =>
    run(`delete:${mapId}`, async () => {
      const answer = await HuaweiWear.deleteOfflineMap(mapId, mapType);
      setNotice(
        answer.answered ? t('offlineMapLab.deleteAnswer', { id: mapId, code: answer.code ?? '—' }) : t('offlineMapLab.deleteNoAnswer', { id: mapId }),
      );
      setList(await HuaweiWear.listOfflineMaps());
    });

  if (status === null) return <Notice>{t('offlineMapLab.unavailable')}</Notice>;
  if (!status.enabled) return <Notice>{t('offlineMapLab.off')}</Notice>;

  const idle = busy === null;
  const watchReady = status.p2p && status.gateMap;
  const verdict = result ? sendVerdict(result.sent) : null;
  const catalogIds = new Set(catalog?.map((m) => m.id) ?? []);
  const others = list?.maps.filter((m) => !catalogIds.has(m.mapId)) ?? [];

  return (
    <>
      <Section title={t('offlineMapLab.maps')} icon="map" tint="workouts">
        {catalog === null && busy !== 'catalog' ? <Button label={t('offlineMapLab.reload')} icon="refresh" onPress={() => void loadCatalog()} /> : null}
        {catalog !== null && catalog.length === 0 ? <Notice>{t('offlineMapLab.noMaps')}</Notice> : null}
        {catalog?.map((map) => {
          const phone = phoneState(map, stored[map.id] ?? null);
          const watch = watchState(map, list?.maps ?? null);
          const onWatch = list?.maps.find((m) => m.mapId === map.id && m.mapType === 0);
          return (
            <View key={map.id} style={styles.map}>
              <PairGrid>
                <Pair label={t('offlineMapLab.region')} value={map.name} wide />
                <Pair label={t('offlineMapLab.size')} value={t('offlineMapLab.sizeValue', { mb: mb(map.sizeBytes) })} />
                <Pair label={t('offlineMapLab.osmDate')} value={map.osmDate ? formatDateTime(Date.parse(map.osmDate) / 1000) : null} />
                <Pair label={t('offlineMapLab.onPhone')} value={t(`offlineMapLab.phone.${phone}`)} />
                <Pair label={t('offlineMapLab.onWatch')} value={watch === null ? null : t(`offlineMapLab.watchState.${watch}`)} />
                {busy === `download:${map.id}` && progress ? (
                  <Pair label={t('offlineMapLab.downloading')} value={t('offlineMapLab.progress', { done: mb(progress.done), total: mb(progress.total) })} wide />
                ) : null}
                {busy === `send:${map.id}` ? (
                  <Pair
                    label={t('offlineMapLab.sending')}
                    value={progress ? t('offlineMapLab.progress', { done: mb(progress.done), total: mb(progress.total) }) : t('offlineMapLab.preparing')}
                    wide
                  />
                ) : null}
              </PairGrid>
              {/* Buttons sit below the grid, never in it: the grid is a wrapping row, where a row of flex:1 buttons gets no width (lab.8). */}
              {phone === 'current' ? (
                <Button
                  label={t('offlineMapLab.send')}
                  icon="send"
                  variant="primary"
                  disabled={!idle || !watchReady}
                  loading={busy === `send:${map.id}`}
                  onPress={() => void send(map)}
                />
              ) : (
                <Button
                  label={t(phone === 'outdated' ? 'offlineMapLab.update' : 'offlineMapLab.download')}
                  icon="download"
                  variant="primary"
                  disabled={!idle}
                  loading={busy === `download:${map.id}`}
                  onPress={() => void download(map)}
                />
              )}
              {phone !== 'none' || onWatch ? (
                <ButtonRow>
                  {phone !== 'none' ? (
                    <Button label={t('offlineMapLab.deletePhone')} icon="trash" lines={2} disabled={!idle} onPress={() => removeLocal(map)} />
                  ) : null}
                  {onWatch ? (
                    <Button
                      label={t('offlineMapLab.deleteWatch')}
                      icon="trash"
                      variant="destructive"
                      lines={2}
                      disabled={!idle}
                      loading={busy === `delete:${map.id}`}
                      onPress={() => void removeFromWatch(onWatch.mapId, onWatch.mapType)}
                    />
                  ) : null}
                </ButtonRow>
              ) : null}
            </View>
          );
        })}
        {result && verdict ? (
          <Notice tone={verdict === 'parsedOk' || verdict === 'listed' ? 'info' : 'danger'}>
            {result.name}: {t(`offlineMapLab.verdict.${verdict}`, { code: result.sent.parsed?.code ?? '?', budget: seconds(result.sent.parseBudgetMs) })}{' '}
            {t('offlineMapLab.timing', {
              upload: seconds(result.sent.uploadMs),
              rate: rateKbps(result.sent.bytesPerSecond) ?? '?',
              update: result.sent.update ? t('offlineMapLab.yes') : t('offlineMapLab.no'),
            })}
          </Notice>
        ) : null}
        {notice ? <Notice>{notice}</Notice> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Notice>{t('offlineMapLab.attribution')}</Notice>
      </Section>

      <Section title={t('offlineMapLab.watch')} icon="watch" tint="workouts">
        <PairGrid>
          <Pair label={t('offlineMapLab.gate')} value={status.gateMap ? t('offlineMapLab.yes') : t('offlineMapLab.no')} />
          <Pair label={t('offlineMapLab.registered')} value={status.registered ? t('offlineMapLab.yes') : t('offlineMapLab.no')} />
          <Pair label={t('offlineMapLab.ping')} value={status.pingCode === null ? null : `0x${(status.pingCode & 0xff).toString(16)}`} />
          <Pair label={t('offlineMapLab.politicalView', { view: status.politicalView })} value={status.politicalViewResult} />
          <Pair
            label={t('offlineMapLab.freeSpace')}
            value={space === undefined ? null : space === null ? t('offlineMapLab.noAnswer') : fmtInt(space)}
          />
          <Pair
            label={t('offlineMapLab.lastParsed')}
            value={
              status.lastParsed
                ? t('offlineMapLab.parsedValue', {
                    id: status.lastParsed.mapId ?? '?',
                    code: status.lastParsed.code ?? '?',
                    time: status.lastParsed.at ? formatDateTime(status.lastParsed.at / 1000) : '',
                  })
                : null
            }
            wide
          />
        </PairGrid>
        {!status.p2p ? <Notice tone="danger">{t('offlineMapLab.notConnected')}</Notice> : null}
        {status.p2p && !status.gateMap ? <Notice tone="danger">{t('offlineMapLab.noGate')}</Notice> : null}
        <ButtonRow>
          <Button label={t('offlineMapLab.list')} icon="list" disabled={!idle || !watchReady} loading={busy === 'list'} onPress={() => void listMaps()} />
          <Button label={t('offlineMapLab.space')} icon="server" disabled={!idle || !watchReady} loading={busy === 'space'} onPress={() => void freeSpace()} />
        </ButtonRow>
        {list && list.maps.length === 0 ? <Notice>{list.complete ? t('offlineMapLab.empty') : t('offlineMapLab.noList')}</Notice> : null}
        {others.map((map) => (
          <View key={`${map.mapId}:${map.mapType}`} style={styles.map}>
            <PairGrid>
              <Pair label={t(`offlineMapLab.mapType.${mapTypeKey(map.mapType)}`)} value={map.mapId} wide />
              <Pair label={t('offlineMapLab.version')} value={map.version === null ? null : String(map.version)} />
            </PairGrid>
            <Button
              label={t('offlineMapLab.deleteWatch')}
              icon="trash"
              variant="destructive"
              disabled={!idle}
              loading={busy === `delete:${map.mapId}`}
              onPress={() => void removeFromWatch(map.mapId, map.mapType)}
            />
          </View>
        ))}
        <Details>{t('offlineMapLab.details')}</Details>
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  map: { gap: spacing.sm },
});
