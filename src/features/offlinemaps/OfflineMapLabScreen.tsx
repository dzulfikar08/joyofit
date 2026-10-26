import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet, View, type SectionListData, type SectionListRenderItem } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { ChipRow, type ChipRowItem } from '@/components/ChipRow';
import { Details } from '@/components/Details';
import { InfoPill } from '@/components/InfoPill';
import { Input } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { Card, Section, useContentPadding } from '@/components/Screen';
import { Notice } from '@/components/States';
import { currentPosition } from '@/features/loops/position';
import type { LatLon } from '@/features/routes/map/geometry';
import { loadMapLibre } from '@/features/routes/map/maplibre';
import { locationGranted } from '@/features/sensors/permissions';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatDate, formatDateTime } from '@/format';
import { fmtInt, fmtNumber } from '@/i18n';
import { HuaweiWear, hasNative, type OfflineMapLabStatus, type OfflineMapList, type OfflineMapOnWatch, type OfflineMapSendResult } from '@/wear';
import { spacing, useColors } from '@/theme';

import { phoneState, watchState, type CatalogMap, type StoredMap } from './catalog';
import { mapTypeKey, rateKbps, seconds, sendVerdict } from './labText';
import { buildListing, isFiltered, provinceKey, provinceTotals, watchIdsOf, type KindFilter, type MapSection, type MapWithDistance } from './listing';
import { downloadMap, fetchCatalog, localFile, removeFromPhone, storedMap } from './mapStore';
import { ProvinceSheet } from './ProvinceSheet';

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

/** "Terdekat": the phone's position when location is already allowed. This screen never asks for it, and the position never leaves the phone. */
type Near = 'checking' | 'notAllowed' | 'locating' | 'noFix' | 'ready';

type Row = MapWithDistance;

const KINDS: readonly KindFilter[] = ['all', 'kabupaten', 'kota'];

const mb = (bytes: number) => fmtNumber(bytes / 1_048_576, 1);

/**
 * The offline-map lab (Settings → About & advanced → Experimental → Offline maps): the maps JoyoFit's server offers (built from OpenStreetMap
 * with tools/offline-maps, one per kabupaten/kota), downloaded into the app and checked (SHA-256), sent to the watch over the mapkit P2P module;
 * the watch's list and delete. Every frame is in the log (`Mapkit:` lines). See docs/offline-maps.md, "Lab".
 *
 * The catalog has 514 maps: search and filter chips stay above one virtualised section list (`listing.ts` decides its content). Without a search:
 * the maps on the watch, the ten nearest regions, then every province collapsed. "Terdekat" needs location already allowed (no prompt here);
 * the distance is computed on the phone and the position is never sent.
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
  const [kind, setKind] = useState<KindFilter>('all');
  const [onWatchOnly, setOnWatchOnly] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [pickingProvince, setPickingProvince] = useState(false);
  const [here, setHere] = useState<LatLon | null>(null);
  const [near, setNear] = useState<Near>('checking');

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

  // "Terdekat" only when location is already allowed: never a prompt here. No MapLibre (it reads the position), no "Terdekat".
  useEffect(() => {
    if (!enabled) return;
    const maplibre = loadMapLibre();
    if (maplibre === null) {
      setNear('notAllowed');
      return;
    }
    let live = true;
    void (async () => {
      const granted = await locationGranted().catch(() => false);
      if (!live) return;
      if (!granted) {
        setNear('notAllowed');
        return;
      }
      setNear('locating');
      const position = await currentPosition(maplibre);
      if (!live) return;
      setHere(position);
      setNear(position ? 'ready' : 'noFix');
    })();
    return () => {
      live = false;
    };
  }, [enabled]);

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

  const toggleSection = useCallback((key: string) => {
    setExpanded((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const clearFilters = () => {
    setQuery('');
    setProvince(null);
    setKind('all');
    setOnWatchOnly(false);
  };

  const watchMaps = list?.maps ?? null;
  const watchIds = useMemo(() => watchIdsOf(watchMaps), [watchMaps]);
  const provinces = useMemo(() => provinceTotals(catalog ?? []), [catalog]);
  const filter = useMemo(() => ({ query, province, kind, onWatch: onWatchOnly }), [query, province, kind, onWatchOnly]);
  const listing = useMemo(() => buildListing(catalog ?? [], { filter, watchIds, here, expanded }), [catalog, filter, watchIds, here, expanded]);
  const catalogIds = useMemo(() => new Set(catalog?.map((m) => m.id) ?? []), [catalog]);
  const osmDate = useMemo(() => (catalog ?? []).reduce((latest, m) => (m.osmDate > latest ? m.osmDate : latest), ''), [catalog]);

  const chips = useMemo<ChipRowItem[]>(
    () => [
      {
        key: 'province',
        label: province === null ? t('offlineMapLab.provinceAny') : t('offlineMapLab.provinceOne', { province }),
        selected: province !== null,
        onPress: () => setPickingProvince(true),
        role: 'button',
      },
      ...KINDS.map((k) => ({ key: `kind:${k}`, label: t(`offlineMapLab.kindFilter.${k}`), selected: kind === k, onPress: () => setKind(k), role: 'radio' as const })),
      // The watch's list is read when the screen opens; until it answers there is nothing to keep.
      ...(watchMaps !== null
        ? [{ key: 'watch', label: t('offlineMapLab.onWatch'), selected: onWatchOnly, onPress: () => setOnWatchOnly((on) => !on), role: 'checkbox' as const }]
        : []),
    ],
    [province, kind, onWatchOnly, watchMaps, t],
  );

  const idle = busy === null;
  const watchReady = status?.p2p === true && status.gateMap;

  const renderItem = useCallback<SectionListRenderItem<Row, MapSection<Row>>>(
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

  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<Row, MapSection<Row>> }) => <SectionHeader section={section} onToggle={toggleSection} />,
    [toggleSection],
  );

  if (status === null || !status.enabled) {
    return (
      <View style={[styles.fill, padding, { backgroundColor: colors.background }]}>
        <Notice>{t(status === null ? 'offlineMapLab.unavailable' : 'offlineMapLab.off')}</Notice>
      </View>
    );
  }

  const others = list?.maps.filter((m) => !catalogIds.has(m.mapId)) ?? [];
  const hasMaps = catalog !== null && catalog.length > 0;
  const count = isFiltered(filter)
    ? t('offlineMapLab.countOf', { count: listing.matched, total: catalog?.length ?? 0 })
    : t('offlineMapLab.count', { count: catalog?.length ?? 0 });

  const header = (
    <View style={styles.header}>
      {!status.p2p ? <Notice tone="danger">{t('offlineMapLab.notConnected')}</Notice> : null}
      {status.p2p && !status.gateMap ? <Notice tone="danger">{t('offlineMapLab.noGate')}</Notice> : null}
      {catalog === null && busy !== 'catalog' ? <Button label={t('offlineMapLab.reload')} icon="refresh" onPress={() => void loadCatalog()} /> : null}
      {catalog !== null && catalog.length === 0 ? <Notice>{t('offlineMapLab.noMaps')}</Notice> : null}
      {messages.about === null || !catalogIds.has(messages.about) ? <ActionMessages messages={messages} /> : null}
      {hasMaps && !listing.filtered && near === 'locating' ? (
        <AppText variant="caption" muted>
          {t('offlineMapLab.locating')}
        </AppText>
      ) : null}
      {hasMaps && !listing.filtered && (near === 'notAllowed' || near === 'noFix') ? (
        <AppText variant="caption" muted>
          {t(near === 'notAllowed' ? 'offlineMapLab.nearNotAllowed' : 'offlineMapLab.noFix')}
        </AppText>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
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
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      {/* Search, filters and the OpenStreetMap credit stay in view above the list. */}
      {hasMaps ? (
        <View style={[styles.find, { paddingHorizontal: padding.paddingHorizontal, paddingTop: padding.paddingTop }]}>
          <Input
            icon="search"
            value={query}
            onChangeText={setQuery}
            placeholder={t('offlineMapLab.searchPlaceholder')}
            accessibilityLabel={t('offlineMapLab.searchLabel')}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          <ChipRow items={chips} />
          <AppText variant="caption" muted>
            {count}
          </AppText>
          <AppText variant="caption" muted>
            {osmDate ? t('offlineMapLab.attributionDated', { date: formatDate(Date.parse(osmDate) / 1000) }) : t('offlineMapLab.attribution')}
          </AppText>
        </View>
      ) : null}
      <SectionList
        sections={listing.sections}
        keyExtractor={keyOf}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        style={styles.fill}
        contentContainerStyle={padding}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          hasMaps ? <Notice action={{ label: t('offlineMapLab.clearFilters'), onPress: clearFilters }}>{t('offlineMapLab.noMatch')}</Notice> : null
        }
        ItemSeparatorComponent={Separator}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
      />
      <ProvinceSheet
        visible={pickingProvince}
        provinces={provinces}
        selected={province}
        onPick={(picked) => {
          setProvince(picked);
          setPickingProvince(false);
        }}
        onClose={() => setPickingProvince(false)}
      />
    </View>
  );
}

const keyOf = (map: Row) => map.id;

function Separator() {
  return <View style={styles.separator} />;
}

/** "Di jam" and "Terdekat" with their count and size; a province is a button that opens or closes it. Search results have no header. */
const SectionHeader = memo(function SectionHeader({ section, onToggle }: { section: MapSection<Row>; onToggle: (key: string) => void }) {
  const { t } = useTranslation('settings');
  const colors = useColors();
  if (section.kind === 'results') return null;
  const meta = t('offlineMapLab.sectionMeta', { count: section.count, mb: fmtNumber(section.totalBytes / 1_048_576, 0) });
  if (section.kind !== 'province') {
    return (
      <View style={styles.sectionHeader}>
        <AppText variant="heading" accessibilityRole="header">
          {t(section.kind === 'watch' ? 'offlineMapLab.onWatch' : 'offlineMapLab.sectionNear')}
        </AppText>
        <AppText variant="caption" muted>
          {section.kind === 'near' ? `${meta} · ${t('offlineMapLab.nearNote')}` : meta}
        </AppText>
      </View>
    );
  }
  const title = section.province === '' ? t('offlineMapLab.noProvince') : section.province;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${meta}`}
      accessibilityState={{ expanded: !section.collapsed }}
      onPress={() => onToggle(provinceKey(section.province))}
      scaleTo={0.985}
      style={styles.provinceHeader}>
      <Ionicons name={section.collapsed ? 'chevron-forward' : 'chevron-down'} size={18} color={colors.mutedForeground} />
      <AppText variant="bodyStrong" numberOfLines={1} style={styles.provinceTitle}>
        {title}
      </AppText>
      <AppText variant="caption" muted>
        {meta}
      </AppText>
    </PressableScale>
  );
});

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
  // The watch or the phone holds another build than the catalog's: the catalog has a newer one.
  const newer = watch === 'other' || phone === 'outdated';
  const distance =
    map.distanceKm === undefined
      ? ''
      : map.distanceKm === 0
        ? t('offlineMapLab.inside')
        : t('offlineMapLab.distanceValue', { km: fmtNumber(map.distanceKm, map.distanceKm < 10 ? 1 : 0) });
  const line = [map.province, map.kind ? t(`offlineMapLab.kind.${map.kind}`) : '', t('offlineMapLab.sizeValue', { mb: mb(map.sizeBytes) }), distance]
    .filter((s) => s !== '')
    .join(' · ');
  return (
    <Card>
      <View style={styles.rowTitle}>
        <AppText variant="bodyStrong">{map.name}</AppText>
        <AppText variant="caption" muted>
          {line}
        </AppText>
      </View>
      {onWatch || newer ? (
        <View style={styles.badges}>
          {onWatch ? <InfoPill label={t('offlineMapLab.onWatch')} tint="workouts" /> : null}
          {newer ? <InfoPill label={t('offlineMapLab.badgeNewer')} tint="link" /> : null}
        </View>
      ) : null}
      {action === 'download' && progress ? (
        <AppText variant="caption" muted>
          {t('offlineMapLab.downloading')}: {t('offlineMapLab.progress', { done: mb(progress.done), total: mb(progress.total) })}
        </AppText>
      ) : null}
      {action === 'send' ? (
        <AppText variant="caption" muted>
          {t('offlineMapLab.sending')}:{' '}
          {progress ? t('offlineMapLab.progress', { done: mb(progress.done), total: mb(progress.total) }) : t('offlineMapLab.preparing')}
        </AppText>
      ) : null}
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
  find: { gap: spacing.sm, paddingBottom: spacing.sm },
  header: { gap: spacing.sm, paddingBottom: spacing.sm },
  footer: { paddingTop: spacing.xl },
  sectionHeader: { gap: 2, paddingTop: spacing.md, paddingBottom: spacing.sm },
  provinceHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  provinceTitle: { flex: 1 },
  rowTitle: { gap: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  other: { gap: spacing.sm },
  separator: { height: spacing.sm },
});
