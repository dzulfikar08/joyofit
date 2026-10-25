import * as DocumentPicker from 'expo-document-picker';
import { useEventListener } from 'expo';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatDateTime } from '@/format';
import { fmtInt } from '@/i18n';
import {
  HuaweiWear,
  hasNative,
  type OfflineMapFile,
  type OfflineMapLabStatus,
  type OfflineMapList,
  type OfflineMapSendResult,
} from '@/wear';

import { mapTypeKey, rateKbps, seconds, sendVerdict } from './labText';

function read(): OfflineMapLabStatus | null {
  if (!hasNative('getOfflineMapLab')) return null;
  try {
    return HuaweiWear.getOfflineMapLab();
  } catch {
    return null;
  }
}

type Busy = 'pick' | 'send' | 'list' | 'space' | `delete:${string}` | null;

/**
 * The offline-map lab (Settings → About & advanced → Experimental → Offline maps): pick an OSM-built `<id>.bin` from the phone, check it, send it
 * over the mapkit P2P module, read the watch's parse result; list and delete maps on the watch. Every frame is in the log (`Mapkit:` lines).
 * See docs/offline-maps.md, "Lab".
 */
export function OfflineMapLabScreen() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<OfflineMapLabStatus | null>(read);
  const [picked, setPicked] = useState<{ uri: string; name: string; file: OfflineMapFile } | null>(null);
  const [result, setResult] = useState<OfflineMapSendResult | null>(null);
  const [list, setList] = useState<OfflineMapList | null>(null);
  const [space, setSpace] = useState<number | null | undefined>(undefined);
  const [deleted, setDeleted] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ bytes: number; total: number } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setStatus(read()), []);
  useNativeRefresh(refresh);

  useEventListener(HuaweiWear, 'onUploadProgress', (event) => {
    if (busy === 'send') setProgress({ bytes: event.bytes, total: event.total });
  });

  const run = async (what: Exclude<Busy, null>, action: () => Promise<void>) => {
    setError(null);
    setBusy(what);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const pick = () =>
    run('pick', async () => {
      const chosen = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (chosen.canceled || chosen.assets.length === 0) return;
      const asset = chosen.assets[0];
      setPicked(null);
      setResult(null);
      const file = await HuaweiWear.inspectOfflineMap(asset.uri, asset.name);
      setPicked({ uri: asset.uri, name: asset.name, file });
    });

  const send = () => {
    if (!picked) return;
    return run('send', async () => {
      setResult(null);
      setProgress(null);
      const sent = await HuaweiWear.sendOfflineMap(picked.uri, picked.name);
      setResult(sent);
      setList(await HuaweiWear.listOfflineMaps());
    });
  };

  const listMaps = () => run('list', async () => setList(await HuaweiWear.listOfflineMaps()));

  const freeSpace = () => run('space', async () => setSpace((await HuaweiWear.offlineMapFreeSpace()).value));

  const remove = (mapId: string, mapType: number) =>
    run(`delete:${mapId}`, async () => {
      const answer = await HuaweiWear.deleteOfflineMap(mapId, mapType);
      setDeleted(
        answer.answered ? t('offlineMapLab.deleteAnswer', { id: mapId, code: answer.code ?? '—' }) : t('offlineMapLab.deleteNoAnswer', { id: mapId }),
      );
      setList(await HuaweiWear.listOfflineMaps());
    });

  if (status === null) return <Notice>{t('offlineMapLab.unavailable')}</Notice>;
  if (!status.enabled) return <Notice>{t('offlineMapLab.off')}</Notice>;

  const idle = busy === null;
  const verdict = result ? sendVerdict(result) : null;

  return (
    <>
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
          <Button label={t('offlineMapLab.list')} icon="list" disabled={!idle} loading={busy === 'list'} onPress={() => void listMaps()} />
          <Button label={t('offlineMapLab.space')} icon="server" disabled={!idle} loading={busy === 'space'} onPress={() => void freeSpace()} />
        </ButtonRow>
        {list ? (
          list.maps.length === 0 ? (
            <Notice>{list.complete ? t('offlineMapLab.empty') : t('offlineMapLab.noList')}</Notice>
          ) : (
            list.maps.map((map) => (
              <PairGrid key={`${map.mapId}:${map.mapType}`}>
                <Pair label={t(`offlineMapLab.mapType.${mapTypeKey(map.mapType)}`)} value={map.mapId} wide />
                <Pair label={t('offlineMapLab.version')} value={map.version === null ? null : String(map.version)} />
                <Button
                  label={t('offlineMapLab.delete')}
                  icon="trash"
                  variant="destructive"
                  disabled={!idle}
                  loading={busy === `delete:${map.mapId}`}
                  onPress={() => void remove(map.mapId, map.mapType)}
                />
              </PairGrid>
            ))
          )
        ) : null}
        {deleted ? <Notice>{deleted}</Notice> : null}
      </Section>

      <Section title={t('offlineMapLab.file')} icon="map" tint="workouts">
        <ButtonRow>
          <Button label={t('offlineMapLab.pick')} icon="folder-open" disabled={!idle} loading={busy === 'pick'} onPress={() => void pick()} />
          <Button
            label={t('offlineMapLab.send')}
            icon="send"
            variant="primary"
            disabled={!idle || picked === null}
            loading={busy === 'send'}
            onPress={() => void send()}
          />
        </ButtonRow>
        {picked ? (
          <PairGrid>
            <Pair label={t('offlineMapLab.region')} value={picked.file.region} />
            <Pair label={t('offlineMapLab.fileName')} value={picked.file.fileName} wide />
            <Pair label={t('offlineMapLab.size')} value={t('offlineMapLab.sizeValue', { kb: fmtInt(Math.round(picked.file.bytes / 1024)), mb: picked.file.sizeMb })} />
            <Pair label={t('offlineMapLab.zooms')} value={picked.file.zooms.join(', ')} />
            <Pair label={t('offlineMapLab.version')} value={String(picked.file.formatVersion)} />
            <Pair label={t('offlineMapLab.sha256')} value={picked.file.sha256} wide />
          </PairGrid>
        ) : null}
        {busy === 'send' ? (
          <Notice>
            {progress
              ? t('offlineMapLab.uploading', { done: fmtInt(Math.round(progress.bytes / 1024)), total: fmtInt(Math.round(progress.total / 1024)) })
              : t('offlineMapLab.preparing')}
          </Notice>
        ) : null}
        {result && verdict ? (
          <Notice tone={verdict === 'parsedOk' ? 'info' : 'danger'}>
            {t(`offlineMapLab.verdict.${verdict}`, { code: result.parsed?.code ?? '?', budget: seconds(result.parseBudgetMs) })}{' '}
            {t('offlineMapLab.timing', {
              upload: seconds(result.uploadMs),
              rate: rateKbps(result.bytesPerSecond) ?? '?',
              parse: seconds(result.parseMs) ?? '—',
              update: result.update ? t('offlineMapLab.yes') : t('offlineMapLab.no'),
            })}
          </Notice>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Details>{t('offlineMapLab.details')}</Details>
        <Notice>{t('offlineMapLab.attribution')}</Notice>
      </Section>
    </>
  );
}
