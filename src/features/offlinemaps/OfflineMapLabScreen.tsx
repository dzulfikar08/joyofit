import { useEventListener } from 'expo';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View, type ListRenderItem } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { ChipRow, type ChipRowItem } from '@/components/ChipRow';
import { Details } from '@/components/Details';
import { Input } from '@/components/Input';
import { Card, Section, useContentPadding } from '@/components/Screen';
import { Notice } from '@/components/States';
import { currentPosition } from '@/features/loops/position';
import type { LatLon } from '@/features/routes/map/geometry';
import { loadMapLibre } from '@/features/routes/map/maplibre';
import { ensureLocation, locationGranted } from '@/features/sensors/permissions';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatDateTime } from '@/format';
import { fmtInt, fmtNumber } from '@/i18n';
import { HuaweiWear, hasNative, type OfflineMapLabStatus, type OfflineMapList, type OfflineMapOnWatch, type OfflineMapSendResult } from '@/wear';
import { spacing, useColors } from '@/theme';

import { filterMaps, phoneState, provincesOf, sortByDistance, watchState, type CatalogMap, type StoredMap } from './catalog';
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

type Progress = { done: number; total: number };

/** The outcome of the last action, shown on the row it was about (`about` = map id) or above the list (`about` = null). */
interface Messages {
  about: string | null;
  result: { name: string; sent: OfflineMapSendResult } | null;
  notice: string | null;
  error: string | null;
}

const NO_MESSAGES: Messages = { about: null, result: null, notice: null, error: null };

/** Where "near me" stands: the position never leaves the phone, it only orders the list. */
type Near = 'off' | 'ask' | 'locating' | 'denied' | 'noFix';

type Row = CatalogMap & { distanceKm?: number };

const mb = (bytes: number) => fmtNumber(bytes / 1_048_576, 1);

/**
 * The offline-map lab (Settings → About & advanced → Experimental → Offline maps): the maps JoyoFit's server offers (built from OpenStreetMap
 * with tools/offline-maps, one per kabupaten/kota), downloaded into the app and checked (SHA-256), sent to the watch over the mapkit P2P module;
 * the watch's list and delete. Every frame is in the log (`Mapkit:` lines). See docs/offline-maps.md, "Lab".
 *
 * The catalog has hundreds of maps: one virtualised list, the watch section and the search above it as its header. Search, province and
 * "near me" all run on the phone; the position is read only when location is already allowed or the user asks, and is never sent.
 */
export function OfflineMapLabScreen() {
  const { t } = useTranslation('settings');
  const colors = useColors();
  const padding = useContentPadding(false);
  const [status, setStatus] = useState<OfflineMapLabStatus | null>(read);
  const [catalog, setCatalog] = useState<CatalogMap[] | null>(null);
  const [stored, setStored] = useState<Record<string, StoredMap | null>>({});
  const [list, setList] = useState<OfflineMapList | null>(null);
  const [space, setSpace] = useState<number | null | undefined>(undefined);
  const [messages, setMessages] = useState<Messages>(NO_MESSAGES);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [query, setQuery] = useState('');
  const [province, setProvince] = useState<string | null>(null);
  const [here, setHere] = useState<LatLon | null>(null);
  const [near, setNear] = useState<Near>('off');

  const refresh = useCallback(() => setStatus(read()), []);
  useNativeRefresh(refresh);

  useEventListener(HuaweiWear, 'onUploadProgress', (event) => {
    if (busy?.startsWith('send:')) setProgress({ done: event.bytes, total: event.total });
  });

  const run = useCallback(
    async (what: Exclude<Busy, null>, about: string | null, action: () => Promise<void>) => {
      setMessages({ ...NO_MESSAGES, about });
      setProgress(null);
      setBusy(what);
      try {
        await action();
      } catch (e) {
        setMessages((m) => ({ ...m, error: errorMessage(e) }));
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

  const loadCatalog = () => run('catalog', null, async () => showCatalog(await fetchCatalog()));

  const enabled = status?.enabled === true;
  const linked = status?.registered === true;
  // The first load of the catalog and of the watch's list: state is set only when the answer arrives (and the screen is still there).
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchCatalog().then(
      (maps) => live && showCatalog(maps),
      (e: unknown) => live && setMessages({ ...NO_MESSAGES, error: errorMessage(e) }),
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

  // Near me without a prompt: only when location is already allowed. Otherwise the button asks first. No MapLibre, no position, no near me.
  useEffect(() => {
    if (!enabled) return;
    const maplibre = loadMapLibre();
    if (maplibre === null) return;
    let live = true;
    void (async () => {
      const granted = await locationGranted().catch(() => false);
      if (!live) return;
      if (!granted) {
        setNear('ask');
        return;
      }
      setNear('locating');
      const position = await currentPosition(maplibre);
      if (!live) return;
      setHere(position);
      setNear(position ? 'off' : 'noFix');
    })();
    return () => {
      live = false;
    };
  }, [enabled]);

  const nearMe = async () => {
    const maplibre = loadMapLibre();
    if (maplibre === null) return;
    const granted = await ensureLocation().catch(() => 'denied' as const);
    if (granted !== 'granted') {
      setNear('denied');
      return;
    }
    setNear('locating');
    const position = await currentPosition(maplibre);
    setHere(position);
    setNear(position ? 'off' : 'noFix');
  };

  const listMaps = () => run('list', null, async () => setList(await HuaweiWear.listOfflineMaps()));

  const freeSpace = () => run('space', null, async () => setSpace((await HuaweiWear.offlineMapFreeSpace()).value));

  const download = useCallback(
    (map: CatalogMap) =>
      run(`download:${map.id}`, map.id, async () => {
        const copy = await downloadMap(map, (done, total) => setProgress({ done, total }));
        setStored((s) => ({ ...s, [map.id]: copy }));
        setMessages((m) => ({ ...m, notice: t('offlineMapLab.downloaded', { name: map.name }) }));
      }),
    [run, t],
  );

  const send = useCallback(
    (map: CatalogMap) =>
      run(`send:${map.id}`, map.id, async () => {
        // The file itself, not the record of the download, decides: a copy that is gone turns the row back to "Unduh".
        const copy = storedMap(map.id);
        setStored((s) => ({ ...s, [map.id]: copy }));
        if (copy === null) throw new Error(t('offlineMapLab.missingFile', { name: map.name }));
        const { uri, name } = localFile(map.id);
        const sent = await HuaweiWear.sendOfflineMap(uri, name);
        setMessages((m) => ({ ...m, result: { name: map.name, sent } }));
        setList(await HuaweiWear.listOfflineMaps());
      }),
    [run, t],
  );

  const removeLocal = useCallback((map: CatalogMap) => {
    removeFromPhone(map.id);
    setStored((s) => ({ ...s, [map.id]: null }));
  }, []);

  const removeFromWatch = useCallback(
    (mapId: string, mapType: number) =>
      run(`delete:${mapId}`, mapId, async () => {
        const answer = await HuaweiWear.deleteOfflineMap(mapId, mapType);
        const notice = answer.answered
          ? t('offlineMapLab.deleteAnswer', { id: mapId, code: answer.code ?? '—' })
          : t('offlineMapLab.deleteNoAnswer', { id: mapId });
        setMessages((m) => ({ ...m, notice }));
        setList(await HuaweiWear.listOfflineMaps());
      }),
    [run, t],
  );

  const provinces = useMemo(() => provincesOf(catalog ?? []), [catalog]);
  const chips = useMemo<ChipRowItem[]>(
    () => [
      { key: '', label: t('offlineMapLab.allProvinces'), selected: province === null, onPress: () => setProvince(null), role: 'radio' },
      ...provinces.map((p) => ({ key: p, label: p, selected: province === p, onPress: () => setProvince(p), role: 'radio' as const })),
    ],
    [provinces, province, t],
  );
  const rows = useMemo<Row[]>(() => {
    const shown = filterMaps(catalog ?? [], { province, query });
    return here ? sortByDistance(shown, here) : shown;
  }, [catalog, province, query, here]);
  const catalogIds = useMemo(() => new Set(catalog?.map((m) => m.id) ?? []), [catalog]);

  const idle = busy === null;
  const watchReady = status?.p2p === true && status.gateMap;
  const watchMaps = list?.maps ?? null;

  const renderItem = useCallback<ListRenderItem<Row>>(
    ({ item }) => {
      const action = busy?.endsWith(`:${item.id}`) ? (busy.slice(0, busy.indexOf(':')) as RowBusy) : null;
      return (
        <MapRow
          map={item}
          stored={stored[item.id] ?? null}
          watchMaps={watchMaps}
          action={action}
          progress={action ? progress : null}
          messages={messages.about === item.id ? messages : null}
          idle={idle}
          watchReady={watchReady}
          onDownload={download}
          onSend={send}
          onRemoveLocal={removeLocal}
          onRemoveWatch={removeFromWatch}
        />
      );
    },
    [busy, stored, watchMaps, progress, messages, idle, watchReady, download, send, removeLocal, removeFromWatch],
  );

  if (status === null || !status.enabled) {
    return (
      <View style={[styles.fill, padding, { backgroundColor: colors.background }]}>
        <Notice>{t(status === null ? 'offlineMapLab.unavailable' : 'offlineMapLab.off')}</Notice>
      </View>
    );
  }

  const others = list?.maps.filter((m) => !catalogIds.has(m.mapId)) ?? [];
  const filtered = province !== null || query.trim() !== '';

  const header = (
    <View style={styles.header}>
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
          <OtherWatchMap key={`${map.mapId}:${map.mapType}`} map={map} idle={idle} deleting={busy === `delete:${map.mapId}`} onRemove={removeFromWatch} />
        ))}
        <Details>{t('offlineMapLab.details')}</Details>
      </Section>

      <Section title={t('offlineMapLab.maps')} icon="map" tint="workouts">
        {catalog === null && busy !== 'catalog' ? <Button label={t('offlineMapLab.reload')} icon="refresh" onPress={() => void loadCatalog()} /> : null}
        {catalog !== null && catalog.length === 0 ? <Notice>{t('offlineMapLab.noMaps')}</Notice> : null}
        {here ? <Notice icon="navigate">{t('offlineMapLab.nearSorted')}</Notice> : null}
        {near === 'ask' || near === 'denied' || near === 'noFix' ? (
          <Button label={t('offlineMapLab.nearMe')} icon="navigate" onPress={() => void nearMe()} />
        ) : null}
        {near === 'locating' ? <Notice icon="navigate">{t('offlineMapLab.locating')}</Notice> : null}
        {near === 'denied' ? <Notice tone="danger">{t('offlineMapLab.nearDenied')}</Notice> : null}
        {near === 'noFix' ? <Notice tone="danger">{t('offlineMapLab.noFix')}</Notice> : null}
        {messages.about === null || !catalogIds.has(messages.about) ? <ActionMessages messages={messages} /> : null}
        <Notice>{t('offlineMapLab.attribution')}</Notice>
      </Section>

      {catalog !== null && catalog.length > 0 ? (
        <View style={styles.find}>
          <Input
            icon="search"
            value={query}
            onChangeText={setQuery}
            placeholder={t('offlineMapLab.searchPlaceholder')}
            accessibilityLabel={t('offlineMapLab.searchLabel')}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {provinces.length > 0 ? <ChipRow items={chips} /> : null}
          <AppText variant="caption" muted>
            {filtered ? t('offlineMapLab.countOf', { count: rows.length, total: catalog.length }) : t('offlineMapLab.count', { count: rows.length })}
          </AppText>
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={keyOf}
      renderItem={renderItem}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={padding}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={catalog !== null && catalog.length > 0 ? <Notice>{t('offlineMapLab.noMatch')}</Notice> : null}
      ItemSeparatorComponent={Separator}
      initialNumToRender={6}
      maxToRenderPerBatch={8}
      windowSize={7}
      removeClippedSubviews
    />
  );
}

const keyOf = (map: Row) => map.id;

function Separator() {
  return <View style={styles.separator} />;
}

/** The send verdict, notice and error of the last action. */
function ActionMessages({ messages }: { messages: Messages }) {
  const { t } = useTranslation('settings');
  const { result, notice, error } = messages;
  const verdict = result ? sendVerdict(result.sent) : null;
  return (
    <>
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
    </>
  );
}

type RowBusy = 'download' | 'send' | 'delete';

interface MapRowProps {
  map: Row;
  stored: StoredMap | null;
  /** The watch's list; null = never read. */
  watchMaps: OfflineMapOnWatch[] | null;
  /** What runs on this map now. */
  action: RowBusy | null;
  progress: Progress | null;
  /** The last action's outcome when it was about this map. */
  messages: Messages | null;
  idle: boolean;
  watchReady: boolean;
  onDownload: (map: CatalogMap) => Promise<void>;
  onSend: (map: CatalogMap) => Promise<void>;
  onRemoveLocal: (map: CatalogMap) => void;
  onRemoveWatch: (mapId: string, mapType: number) => Promise<void>;
}

/** One catalog map: memoised, so a progress tick or another row's action redraws only the rows whose props changed. */
const MapRow = memo(function MapRow({
  map,
  stored,
  watchMaps,
  action,
  progress,
  messages,
  idle,
  watchReady,
  onDownload,
  onSend,
  onRemoveLocal,
  onRemoveWatch,
}: MapRowProps) {
  const { t } = useTranslation('settings');
  const phone = phoneState(map, stored);
  const watch = watchState(map, watchMaps);
  const onWatch = watchMaps?.find((m) => m.mapId === map.id && m.mapType === 0);
  const where = [map.province, map.kind ? t(`offlineMapLab.kind.${map.kind}`) : ''].filter((s) => s !== '').join(' · ');
  return (
    <Card>
      <PairGrid>
        <Pair label={t('offlineMapLab.region')} value={map.name} wide />
        {where !== '' ? <Pair label={t('offlineMapLab.province')} value={where} wide /> : null}
        <Pair label={t('offlineMapLab.size')} value={t('offlineMapLab.sizeValue', { mb: mb(map.sizeBytes) })} />
        {map.distanceKm !== undefined ? (
          <Pair
            label={t('offlineMapLab.distance')}
            value={map.distanceKm === 0 ? t('offlineMapLab.inside') : t('offlineMapLab.distanceValue', { km: fmtNumber(map.distanceKm, map.distanceKm < 10 ? 1 : 0) })}
          />
        ) : null}
        <Pair label={t('offlineMapLab.osmDate')} value={map.osmDate ? formatDateTime(Date.parse(map.osmDate) / 1000) : null} />
        <Pair label={t('offlineMapLab.onPhone')} value={t(`offlineMapLab.phone.${phone}`)} />
        <Pair label={t('offlineMapLab.onWatch')} value={watch === null ? null : t(`offlineMapLab.watchState.${watch}`)} />
        {action === 'download' && progress ? (
          <Pair label={t('offlineMapLab.downloading')} value={t('offlineMapLab.progress', { done: mb(progress.done), total: mb(progress.total) })} wide />
        ) : null}
        {action === 'send' ? (
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
          loading={action === 'send'}
          onPress={() => void onSend(map)}
        />
      ) : (
        <Button
          label={t(phone === 'outdated' ? 'offlineMapLab.update' : 'offlineMapLab.download')}
          icon="download"
          variant="primary"
          disabled={!idle}
          loading={action === 'download'}
          onPress={() => void onDownload(map)}
        />
      )}
      {phone !== 'none' || onWatch ? (
        <ButtonRow>
          {phone !== 'none' ? (
            <Button label={t('offlineMapLab.deletePhone')} icon="trash" lines={2} disabled={!idle} onPress={() => onRemoveLocal(map)} />
          ) : null}
          {onWatch ? (
            <Button
              label={t('offlineMapLab.deleteWatch')}
              icon="trash"
              variant="destructive"
              lines={2}
              disabled={!idle}
              loading={action === 'delete'}
              onPress={() => void onRemoveWatch(onWatch.mapId, onWatch.mapType)}
            />
          ) : null}
        </ButtonRow>
      ) : null}
      {messages ? <ActionMessages messages={messages} /> : null}
    </Card>
  );
});

/** A map on the watch that the catalog does not offer (an older build, a contour file): it can only be deleted. */
function OtherWatchMap({
  map,
  idle,
  deleting,
  onRemove,
}: {
  map: OfflineMapOnWatch;
  idle: boolean;
  deleting: boolean;
  onRemove: (mapId: string, mapType: number) => Promise<void>;
}) {
  const { t } = useTranslation('settings');
  return (
    <View style={styles.other}>
      <PairGrid>
        <Pair label={t(`offlineMapLab.mapType.${mapTypeKey(map.mapType)}`)} value={map.mapId} wide />
        <Pair label={t('offlineMapLab.version')} value={map.version === null ? null : String(map.version)} />
      </PairGrid>
      <Button
        label={t('offlineMapLab.deleteWatch')}
        icon="trash"
        variant="destructive"
        disabled={!idle}
        loading={deleting}
        onPress={() => void onRemove(map.mapId, map.mapType)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { gap: spacing.lg, paddingBottom: spacing.sm },
  find: { gap: spacing.sm },
  other: { gap: spacing.sm },
  separator: { height: spacing.sm },
});
