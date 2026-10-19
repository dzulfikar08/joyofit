import type { CameraRef } from '@maplibre/maplibre-react-native';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Linking, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Segmented } from '@/components/Segmented';
import { LoadingState, Notice } from '@/components/States';
import { LIVE_ROUTE, OPEN_LIVE } from '@/features/record/liveRoute';
import { SearchSheet, SheetCard } from '@/features/routes/map/DrawSheets';
import type { Place } from '@/features/routes/map/geocodeClient';
import { boundsOf, lineCollection, pointCollection, type LatLon } from '@/features/routes/map/geometry';
import { MAP_INK, MAP_STYLE_URL, PLACE_ZOOM } from '@/features/routes/map/mapConfig';
import { MapAttribution } from '@/features/routes/map/MapAttribution';
import { MapButton } from '@/features/routes/map/MapButton';
import { loadMapLibre, type MapLibre } from '@/features/routes/map/maplibre';
import { resolveStartView, type StartView } from '@/features/routes/map/startPosition';
import { formatRouteDistance } from '@/features/routes/routeModel';
import { fmtDecimal } from '@/i18n';
import { spacing, useTheme } from '@/theme';

import { bigNumber, formatPace, secondaryLine, targetText } from '../display';
import { TOLERANCE } from '../generate';
import { useLoopPlanner, type LoopPlanner } from '../useLoopPlanner';
import type { StartFrom } from '../prefs';
import { scaleFor, TARGET_MODES, type LoopActivity, type TargetMode } from '../targets';
import { LoopLayers } from './LoopLayers';
import { TargetRuler } from './TargetRuler';

/** The share of the window the plan sheet may take before it scrolls. */
const SHEET_MAX_SHARE = 0.6;

type Sheet = 'plan' | 'home' | 'search';

/** `/routes/loop`: pick a target (steps, distance, time or kcal), get a dotted loop from the door on streets not walked yet. */
export function LoopScreen() {
  const { t } = useTranslation('loops');
  const maplibre = loadMapLibre();
  if (!maplibre) {
    return (
      <View style={styles.unavailable}>
        <Notice icon="map-outline">{t('unavailable')}</Notice>
      </View>
    );
  }
  return <LoopMap maplibre={maplibre} />;
}

function LoopMap({ maplibre }: { maplibre: MapLibre }) {
  const { t } = useTranslation('loops');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { Map: MapView, Camera } = maplibre;
  const planner = useLoopPlanner(maplibre);
  const { prefs, start, loop, area, home } = planner;

  const cameraRef = useRef<CameraRef>(null);
  const rootRef = useRef<View>(null);
  const [rootTop, setRootTop] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(280);
  const [startView, setStartView] = useState<StartView | null>(null);
  const [sheet, setSheet] = useState<Sheet>('plan');
  const [picking, setPicking] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [homeError, setHomeError] = useState(false);
  const [settingHome, setSettingHome] = useState(false);

  useEffect(() => {
    let alive = true;
    void resolveStartView(maplibre).then((view) => {
      if (alive) setStartView(view);
    });
    return () => {
      alive = false;
    };
  }, [maplibre]);

  // The start point became known (or changed): bring it into view.
  const startLat = start?.lat;
  const startLon = start?.lon;
  useEffect(() => {
    if (startLat === undefined || startLon === undefined) return;
    cameraRef.current?.flyTo({ center: [startLon, startLat], zoom: PLACE_ZOOM, duration: 700 });
  }, [startLat, startLon]);

  // A loop appeared: fit it above the sheet.
  const loopId = loop?.id;
  const loopLine = loop?.line;
  useEffect(() => {
    if (!loopLine || loopId === undefined) return;
    const bounds = boundsOf(loopLine);
    if (!bounds) return;
    cameraRef.current?.fitBounds(bounds, {
      padding: { top: insets.top + 72, right: 32, bottom: sheetHeight + 24, left: 32 },
      duration: 800,
    });
    // Only a new loop moves the camera, not a taller sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopId]);

  const layers = useMemo(() => {
    const markerPoint = sheet === 'home' ? home : start;
    const markerLabel = sheet === 'home' || prefs.startFrom === 'home' ? t('start.markerHome') : t('start.markerHere');
    return {
      history: lineCollection(area?.lines ?? []),
      loop: loopLine ? lineCollection([loopLine]) : null,
      start: markerPoint
        ? ({
            type: 'FeatureCollection',
            features: pointCollection([markerPoint]).features.map((f) => ({ ...f, properties: { label: markerLabel } })),
          } as GeoJSON.FeatureCollection)
        : null,
    };
  }, [area, loopLine, start, home, sheet, prefs.startFrom, t]);

  const onMapPress = (point: LatLon) => {
    if (sheet !== 'home' || !picking) return;
    planner.setHomePoint(point);
    setPicking(false);
  };

  const goTo = (place: Place) => {
    setSheet('home');
    cameraRef.current?.flyTo({ center: [place.lon, place.lat], zoom: PLACE_ZOOM, duration: 800 });
  };

  const setHomeHere = async () => {
    setSettingHome(true);
    setHomeError(false);
    const ok = await planner.setHomeHere();
    setSettingHome(false);
    setHomeError(!ok);
  };

  const credits = loop ? [t('credit')] : [];
  const showChip = loop !== null && loop.newShare !== null;

  return (
    <View ref={rootRef} style={styles.root} onLayout={() => rootRef.current?.measureInWindow((_x, y) => setRootTop(y))}>
      {startView ? (
        <MapView
          style={styles.fill}
          mapStyle={MAP_STYLE_URL}
          logo={false}
          compass={false}
          touchRotate={false}
          touchPitch={false}
          attribution
          attributionPosition={{ top: 8, right: 8 }}
          onDidFailLoadingMap={() => setMapFailed(true)}
          onDidFinishLoadingMap={() => setMapFailed(false)}
          onPress={(event) => {
            const [lon, lat] = event.nativeEvent.lngLat;
            onMapPress({ lat, lon });
          }}>
          <Camera
            ref={cameraRef}
            // Read once, when the map opens: the start point if it is known by then, else where the phone or the weather city is.
            initialViewState={
              start
                ? { center: [start.lon, start.lat], zoom: PLACE_ZOOM }
                : { center: [startView.lon, startView.lat], zoom: startView.zoom }
            }
          />
          <LoopLayers
            maplibre={maplibre}
            history={layers.history}
            historyColor={colors.workouts}
            loop={layers.loop}
            loopColor={colors.primary}
            start={layers.start}
          />
        </MapView>
      ) : (
        <View style={styles.fill} accessibilityLabel={t('mapLabel')}>
          <LoadingState label={t('preparing')} />
        </View>
      )}

      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View pointerEvents="box-none" style={styles.top}>
          {showChip ? (
            <View
              accessible
              accessibilityLabel={t('chip.label', { pct: Math.round((loop.newShare ?? 0) * 100) })}
              style={[styles.chip, { backgroundColor: MAP_INK.chipBackground }]}>
              <AppText variant="label" color={MAP_INK.chipText}>
                {t('chip.new', { pct: Math.round((loop.newShare ?? 0) * 100) })}
              </AppText>
            </View>
          ) : null}
          {mapFailed ? <Notice tone="danger">{t('mapFailed')}</Notice> : null}
          {picking ? <Notice icon="locate">{t('home.pickHint')}</Notice> : null}
        </View>

        {start ? (
          <View pointerEvents="box-none" style={styles.side}>
            <MapButton
              icon="locate"
              label={t('start.center')}
              surface="floating"
              onPress={() => cameraRef.current?.flyTo({ center: [start.lon, start.lat], zoom: PLACE_ZOOM, duration: 600 })}
            />
          </View>
        ) : null}

        <KeyboardAvoidingView pointerEvents="box-none" behavior="padding" keyboardVerticalOffset={rootTop} style={styles.bottom}>
          <View
            pointerEvents="box-none"
            onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
            style={[styles.stack, { paddingBottom: sheet === 'search' ? spacing.sm : insets.bottom + spacing.sm }]}>
            <MapAttribution extra={credits} style={styles.credit} />
            {sheet === 'search' ? (
              <SearchSheet onPick={goTo} onClose={() => setSheet('home')} />
            ) : sheet === 'home' ? (
              <HomeSheet
                planner={planner}
                picking={picking}
                busy={settingHome}
                failed={homeError}
                onPick={() => setPicking((p) => !p)}
                onUseHere={() => void setHomeHere()}
                onSearch={() => {
                  setPicking(false);
                  setSheet('search');
                }}
                onClose={() => {
                  setPicking(false);
                  setHomeError(false);
                  setSheet('plan');
                }}
              />
            ) : (
              <PlanSheet
                planner={planner}
                onOpenHome={() => setSheet('home')}
                onBegin={() => router.navigate({ pathname: LIVE_ROUTE, params: { sport: prefs.activity } }, OPEN_LIVE)}
                onOpenSaved={(id) => router.push({ pathname: '/routes/[id]', params: { id } })}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </View>
  );
}

interface PlanSheetProps {
  planner: LoopPlanner;
  onOpenHome: () => void;
  onBegin: () => void;
  onOpenSaved: (id: string) => void;
}

function PlanSheet({ planner, onOpenHome, onBegin, onOpenSaved }: PlanSheetProps) {
  const { t } = useTranslation('loops');
  const { t: tRoot } = useTranslation('routes');
  const router = useRouter();
  const { height } = useWindowDimensions();
  const { prefs, body, value, targetM, start, loop, area, status, progress, error, stale, saved, saving, saveError, push } = planner;

  const modeOptions = TARGET_MODES.map((mode) => ({ value: mode, label: t(`mode.${mode}`) }));
  const activityOptions = (['walk', 'run'] as const).map((activity) => ({ value: activity, label: t(`activity.${activity}`) }));
  const startOptions = (['here', 'home'] as const).map((from) => ({ value: from, label: t(`start.${from}`) }));

  const finding = status === 'finding';
  const number = value !== null ? bigNumber(prefs.mode, value) : null;
  const valueText = value !== null ? targetText(prefs.mode, value) : '';
  const scale = body ? scaleFor(prefs.mode, body.body) : null;

  const onStart = (from: StartFrom) => {
    planner.setStartFrom(from);
    if (from === 'home' && planner.home === null) onOpenHome();
  };

  const lengthOffPercent = loop && Math.abs(loop.lengthError) > TOLERANCE ? Math.round(Math.abs(loop.lengthError) * 100) : null;
  const sentOrOutcome = push.outcome !== null && !push.sending;
  const canSend = push.connected && push.status.deliver && !push.appOutdated;

  return (
    <SheetCard>
      <ScrollView
        style={{ maxHeight: height * SHEET_MAX_SHARE }}
        contentContainerStyle={styles.sheet}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Segmented<TargetMode> options={modeOptions} value={prefs.mode} onChange={planner.setMode} />

        {number && body && targetM !== null && scale && value !== null ? (
          <>
            <View style={styles.numberRow} accessible accessibilityLabel={valueText} accessibilityLiveRegion="polite">
              <AppText variant="display" adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} style={styles.number}>
                {number.number}
              </AppText>
              <AppText variant="bodyStrong" muted style={styles.unit} numberOfLines={1}>
                {number.unit}
              </AppText>
            </View>
            <AppText variant="caption" muted>
              {secondaryLine(prefs.mode, targetM, body.body)}
            </AppText>
            <TargetRuler scale={scale} mode={prefs.mode} value={value} valueText={valueText} onChange={planner.setValue} />
          </>
        ) : (
          <LoadingState label={t('preparing')} />
        )}

        <Segmented<LoopActivity> options={activityOptions} value={prefs.activity} onChange={planner.setActivity} />
        <View style={styles.startRow}>
          <AppText variant="label" muted>
            {t('start.label')}
          </AppText>
          <Segmented<StartFrom> options={startOptions} value={prefs.startFrom} onChange={onStart} />
        </View>
        <Button label={t('home.set')} icon="home-outline" variant="ghost" onPress={onOpenHome} />

        <StartNotices planner={planner} onOpenHome={onOpenHome} />

        {stale ? (
          <Notice icon="refresh">{t('stale', { target: valueText })}</Notice>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {finding && progress ? (
          <AppText variant="caption" muted accessibilityLiveRegion="polite">
            {t('finding', { index: progress.index, count: progress.count })}. {t('findingHint')}
          </AppText>
        ) : null}

        {loop && !stale ? (
          <View style={styles.result}>
            <AppText variant="bodyStrong" accessibilityLiveRegion="polite">
              {loop.newShare !== null
                ? t('result.summary', { distance: formatRouteDistance(loop.lengthM), pct: Math.round(loop.newShare * 100) })
                : t('result.plain', { distance: formatRouteDistance(loop.lengthM) })}
            </AppText>
            {loop.newShare === null ? (
              <AppText variant="caption" muted>
                {t('result.noHistory')}
              </AppText>
            ) : area && area.workouts > 0 ? (
              <AppText variant="caption" muted>
                {t('result.history', { count: area.workouts })}
              </AppText>
            ) : null}
            {lengthOffPercent !== null ? (
              <AppText variant="caption" muted>
                {t('result.lengthOff', { percent: fmtDecimal(lengthOffPercent, 0) })}
              </AppText>
            ) : null}
          </View>
        ) : null}

        <Button
          label={loop && !stale ? t('another') : t('find')}
          icon={loop && !stale ? 'shuffle' : 'search'}
          variant="primary"
          loading={finding}
          disabled={!start || !area || targetM === null}
          onPress={planner.find}
        />

        {loop && !stale ? (
          <>
            <View style={styles.actions}>
              {saved ? (
                <Button label={t('actions.openSaved')} icon="open-outline" lines={2} style={styles.action} onPress={() => onOpenSaved(saved.id)} />
              ) : (
                <Button
                  label={saving ? t('actions.saving') : t('actions.save')}
                  icon="bookmark-outline"
                  lines={2}
                  loading={saving}
                  style={styles.action}
                  onPress={() => void planner.save()}
                />
              )}
              <Button
                label={t('actions.send')}
                icon="send"
                lines={2}
                loading={push.sending}
                disabled={!canSend || saving}
                style={styles.action}
                onPress={planner.sendToWatch}
              />
              <Button label={t('actions.begin')} icon="play" lines={2} style={styles.action} onPress={onBegin} />
            </View>
            {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
            {!push.connected ? (
              <Notice icon="bluetooth" action={{ label: t('push.openWatch'), onPress: () => router.navigate('/watch') }}>
                {t('push.needConnect')}
              </Notice>
            ) : null}
            {push.connected && !push.status.deliver && !push.appOutdated ? <Notice>{tRoot('push.unsupported')}</Notice> : null}
            {push.appOutdated ? <Notice tone="danger">{tRoot('push.appOutdated')}</Notice> : null}
            {push.phase !== 'idle' ? (
              <AppText variant="caption" muted accessibilityLiveRegion="polite">
                {push.phase === 'sending' ? tRoot('push.sendingPercent', { pct: push.percent }) : tRoot(`push.${push.phase}`)}
              </AppText>
            ) : null}
            {sentOrOutcome && push.outcome ? <PushOutcomeView planner={planner} /> : null}
            <AppText variant="caption" muted>
              {t('actions.beginHint', { sport: t(`activity.${prefs.activity}`).toLowerCase() })}
            </AppText>
          </>
        ) : null}

        {body ? (
          <AppText variant="caption" muted>
            {t('body.line', {
              stride: fmtDecimal(body.body.strideM, 2),
              pace: formatPace(body.body.paceSecPerKm),
              weight: fmtDecimal(body.body.weightKg, 0),
            })}{' '}
            {body.sources.stride === 'measured' && body.sources.pace === 'history' && body.sources.weight === 'profile'
              ? t('body.measured')
              : t('body.estimated')}
          </AppText>
        ) : null}
        <AppText variant="caption" muted>
          {t('privacy')}
        </AppText>
      </ScrollView>
    </SheetCard>
  );
}

/** What the screen says while there is no start point: asking for the location, waiting for it, or that it did not come. */
function StartNotices({ planner, onOpenHome }: { planner: LoopPlanner; onOpenHome: () => void }) {
  const { t } = useTranslation('loops');
  const { prefs, start, location, locating, locateFailed, home } = planner;
  if (start) return null;
  if (prefs.startFrom === 'home') {
    return home === null ? <Notice icon="home-outline" action={{ label: t('home.set'), onPress: onOpenHome }}>{t('start.needStart')}</Notice> : null;
  }
  if (location === 'granted') {
    if (locating) return <AppText variant="caption" muted>{t('start.locating')}</AppText>;
    return locateFailed ? (
      <Notice tone="danger" action={{ label: t('start.retry'), onPress: () => void planner.readLocation() }}>
        {t('start.locateFailed')}
      </Notice>
    ) : null;
  }
  if (location === 'denied' || location === 'blocked') {
    return (
      <>
        <Notice tone="danger" icon="location-outline" action={{ label: t('permission.openSettings'), onPress: () => void Linking.openSettings() }}>
          {t('permission.denied')}
        </Notice>
        {location === 'denied' ? <Button label={t('permission.allow')} onPress={() => void planner.askLocation()} /> : null}
      </>
    );
  }
  return (
    <View style={styles.permission}>
      <AppText variant="heading">{t('permission.title')}</AppText>
      <AppText variant="caption" muted>
        {t('permission.body')}
      </AppText>
      <Button label={t('permission.allow')} variant="primary" icon="location" onPress={() => void planner.askLocation()} />
    </View>
  );
}

/** The result of sending the loop to the watch, in the words of the route screen. */
function PushOutcomeView({ planner }: { planner: LoopPlanner }) {
  const { t } = useTranslation('loops');
  const { t: tRoot } = useTranslation('routes');
  const router = useRouter();
  const { push, saved } = planner;
  const outcome = push.outcome;
  if (!outcome) return null;
  const openRoute = saved ? (
    <Button label={t('push.openRoute')} variant="ghost" onPress={() => router.push({ pathname: '/routes/[id]', params: { id: saved.id } })} />
  ) : null;
  if (outcome.kind === 'sent') {
    return (
      <View style={styles.outcome}>
        <Notice icon="checkmark-circle">{tRoot('push.sent')}</Notice>
        {!outcome.confirmed ? <Notice>{tRoot('push.noFinalAnswer')}</Notice> : null}
        {push.recordError !== null ? <Notice tone="danger">{push.recordError}</Notice> : null}
      </View>
    );
  }
  if (outcome.kind === 'already') {
    return (
      <View style={styles.outcome}>
        <Notice icon="alert-circle">{tRoot('push.already')}</Notice>
        {openRoute}
      </View>
    );
  }
  return (
    <View style={styles.outcome}>
      <Notice tone="danger">{outcome.message}</Notice>
      {outcome.canRename ? openRoute : null}
    </View>
  );
}

interface HomeSheetProps {
  planner: LoopPlanner;
  picking: boolean;
  busy: boolean;
  failed: boolean;
  onPick: () => void;
  onUseHere: () => void;
  onSearch: () => void;
  onClose: () => void;
}

/** Setting the Home point: from the current location, by tapping the map, or after searching a place. Stored on the phone only. */
function HomeSheet({ planner, picking, busy, failed, onPick, onUseHere, onSearch, onClose }: HomeSheetProps) {
  const { t } = useTranslation('loops');
  const { home, location } = planner;
  return (
    <SheetCard>
      <AppText variant="heading" accessibilityRole="header">
        {t('home.title')}
      </AppText>
      <AppText variant="caption" muted>
        {home ? t('home.saved') : t('home.none')} {t('home.storedLocally')}
      </AppText>
      {picking ? <Notice icon="locate">{t('home.pickHint')}</Notice> : null}
      {failed ? <Notice tone="danger">{t('home.locateFailed')}</Notice> : null}
      {location !== 'granted' ? (
        <AppText variant="caption" muted>
          {t('permission.body')}
        </AppText>
      ) : null}
      <Button label={t('home.useHere')} icon="navigate" loading={busy} onPress={onUseHere} />
      <Button label={t('home.pickOnMap')} icon="pin" variant={picking ? 'primary' : 'secondary'} onPress={onPick} />
      <Button label={t('home.search')} icon="search" onPress={onSearch} />
      {home ? <Button label={t('home.remove')} icon="trash-outline" variant="destructive" onPress={planner.clearHome} /> : null}
      <Button label={t('home.done')} variant="primary" icon="checkmark" onPress={onClose} />
    </SheetCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  unavailable: { padding: spacing.lg },
  top: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: 64, gap: spacing.sm, alignItems: 'flex-start' },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: 999 },
  side: { position: 'absolute', top: 56, right: spacing.sm, gap: spacing.sm },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  stack: { paddingHorizontal: spacing.sm },
  credit: { position: 'relative', left: 0, bottom: 0, alignSelf: 'flex-start', marginBottom: spacing.xs, marginLeft: spacing.xs },
  sheet: { gap: spacing.md },
  numberRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  number: { flexShrink: 1 },
  unit: { flexShrink: 0 },
  startRow: { gap: spacing.xs },
  result: { gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, paddingHorizontal: spacing.sm },
  outcome: { gap: spacing.sm },
  permission: { gap: spacing.sm },
});
