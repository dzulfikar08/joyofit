/**
 * `<TileMap>`: a pan/zoom vector tile map (OpenFreeMap) with a route on top, drawn with react-native-svg.
 * Pure JS: no native map module. Copyable as-is: it only imports react, react-native,
 * react-native-svg, @expo/vector-icons and sibling files; every colour comes in through props.
 *
 * Rendering
 * - Tiles are fetched/decoded/simplified by `tileSource` and drawn as one `<Path>` per style layer.
 * - The tile Svg is larger than the viewport (30 % margin each side) so a pan never shows blank edges.
 * - During a gesture only a transform (translate + scale) on the whole map layer changes; React does not
 *   re-render. On release the transform is folded into the view, tiles for the new zoom/centre are
 *   requested (debounced) and the previous tiles stay underneath until the new ones arrived.
 * - A tile that fails to load stays blank; the route and the neutral background are still drawn.
 *
 * Gesture vs. page scroll (decision)
 * - `dragMode="press"` (default, for maps inside a ScrollView): a second finger takes the gesture at
 *   once (pinch + pan). A single finger takes it only after being held still for 150 ms (press and
 *   drag); a quick swipe that starts moving earlier scrolls the page. `onInteract(true)` fires the
 *   moment the map takes the gesture and `onInteract(false)` on release, so the parent flips
 *   `scrollEnabled`. The +/- and recenter buttons and double-tap zoom always work.
 * - `dragMode="immediate"` (full screen maps): one finger drags right away.
 */
import { Ionicons } from '@expo/vector-icons';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeTouchEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, G, Path } from 'react-native-svg';

import {
  ATTRIBUTION_URL,
  layerPaint,
  paletteFor,
  type MapPalette,
  type MapTheme,
} from './palette';
import type { RenderedTile } from './renderTile';
import { pickKmPills, routePath, type FixedBox, type KmCandidate } from './routeOverlay';
import { tileSource } from './tileCache';
import {
  MAX_VIEW_ZOOM,
  MIN_VIEW_ZOOM,
  TILE_SIZE,
  boundsOf,
  clamp,
  fitBounds,
  lonLatToWorld,
  tileCover,
  worldToLonLat,
  type CoverTile,
  type LatLon,
  type View as MapView,
} from './tileMath';

export interface MapMarker {
  pos: LatLon;
  /** km: the number shown in the pill. */
  label?: string;
  /** km: the whole kilometre. Give every kilometre of the route: the map shows only as many as fit at the current zoom. Without it the pill is always drawn. */
  km?: number;
  kind: 'start' | 'finish' | 'km';
}

export interface TileMapColors {
  route: string;
  routeCasing: string;
  start: string;
  finish: string;
  text: string;
  surface: string;
}

export interface TileMapProps {
  segments: readonly (readonly LatLon[])[];
  markers?: readonly MapMarker[];
  /** A ring + dot that follows e.g. a chart scrubber. */
  highlight?: LatLon | null;
  theme: MapTheme;
  colors: TileMapColors;
  height: number;
  /** Default true: pan, pinch, double-tap zoom and the zoom / recenter buttons. */
  interactive?: boolean;
  /** `press` (default): one finger needs a 150 ms hold, two fingers act at once. `immediate`: one finger drags. */
  dragMode?: 'press' | 'immediate';
  /** True while the map owns the touch (disable the parent ScrollView), false on release. */
  onInteract?: (active: boolean) => void;
  a11yLabel: string;
}

/** Clears the zoom column (8 px gap + 34 px buttons) plus the route casing, so the fitted route never hides under a button. */
const FIT_PADDING = 48;
const MARGIN_FRACTION = 0.3;
const PRESS_MS = 150;
const SLOP = 8;
const TAP_MS = 250;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 40;
const FETCH_DEBOUNCE_MS = 80;
const ANIMATION_MS = 200;
const ROUTE_WIDTH = 4;
const ROUTE_CASING_WIDTH = 7.5;
const KM_PILL_HEIGHT = 18;

/** The pill's drawn width: 10 px bold digits (about 6 px each) plus 5 px padding and 1 px border on both sides, 18 px at least. */
const kmPillWidth = (label = ''): number => Math.max(KM_PILL_HEIGHT, label.length * 6 + 12);

interface ShownTile {
  key: string;
  z: number;
  x: number;
  y: number;
  ux: number;
  r: RenderedTile;
}

interface Transform {
  tx: number;
  ty: number;
  s: number;
}

const IDENTITY: Transform = { tx: 0, ty: 0, s: 1 };

function mergeShown(prev: ShownTile[], add: ShownTile[]): ShownTile[] {
  if (add.length === 0) return prev;
  const keys = new Set(add.map((a) => a.key));
  return [...prev.filter((p) => !keys.has(p.key)), ...add];
}

function placeKey(t: { key: string; ux: number }): string {
  return `${t.key}@${t.ux}`;
}

interface TileGroupProps {
  tile: ShownTile;
  left: number;
  top: number;
  scale: number;
  zoom: number;
  palette: MapPalette;
}

const TileGroup = memo(function TileGroup({ tile, left, top, scale, zoom, palette }: TileGroupProps) {
  return (
    <G transform={`translate(${left} ${top}) scale(${scale})`}>
      {tile.r.layers.map((l, i) => {
        const paint = layerPaint(l.kind, l.id, zoom, palette);
        if (!paint) return null;
        if (paint.fill) {
          return <Path key={i} d={l.d} fill={paint.fill} fillRule="evenodd" />;
        }
        return (
          <Path
            key={i}
            d={l.d}
            fill="none"
            stroke={paint.stroke}
            strokeWidth={paint.width / scale}
            strokeLinejoin="round"
            strokeLinecap={paint.dash ? 'butt' : 'round'}
            strokeDasharray={paint.dash ? paint.dash.map((d) => d / scale).join(' ') : undefined}
          />
        );
      })}
    </G>
  );
});

const dist = (a: NativeTouchEvent, b: NativeTouchEvent) => Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);

interface Gesture {
  startT: number;
  startX: number;
  startY: number;
  moved: boolean;
  maxTouches: number;
  engaged: boolean;
  /** Bumped to cancel the pending press timer (its callback checks the id it was armed with). */
  pressId: number;
  last: readonly NativeTouchEvent[];
  base: { t: Transform; qx: number; qy: number; dist: number } | null;
  lastTap: { t: number; x: number; y: number } | null;
}

export function TileMap({
  segments,
  markers,
  highlight,
  theme,
  colors,
  height,
  interactive = true,
  dragMode = 'press',
  onInteract,
  a11yLabel,
}: TileMapProps) {
  const { t } = useTranslation('routes', { keyPrefix: 'tileMap' });
  const palette = paletteFor(theme);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<MapView>({ lat: 0, lon: 0, zoom: 2 });
  const [shown, setShown] = useState<ShownTile[]>([]);

  const bounds = useMemo(() => boundsOf(segments), [segments]);
  const hasRoute = bounds !== null;
  const fitKey = bounds
    ? `${bounds.minLat.toFixed(5)},${bounds.maxLat.toFixed(5)},${bounds.minLon.toFixed(5)},${bounds.maxLon.toFixed(5)}`
    : 'none';

  const containerRef = useRef<View>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef({ w: 0, h: height });
  sizeRef.current = { w: width, h: height };
  const origin = useRef({ x: 0, y: 0 });
  const T = useRef<Transform>(IDENTITY);
  const resetPending = useRef(false);
  const anim = useRef<number | null>(null);
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  const dragModeRef = useRef(dragMode);
  dragModeRef.current = dragMode;

  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const sc = useRef(new Animated.Value(1)).current;

  const applyTransform = useCallback(
    (t: Transform) => {
      T.current = t;
      tx.setValue(t.tx);
      ty.setValue(t.ty);
      sc.setValue(t.s);
    },
    [tx, ty, sc],
  );

  const fit = useCallback((): MapView | null => {
    const { w, h } = sizeRef.current;
    if (!bounds || w === 0) return null;
    return fitBounds(bounds, w, h, FIT_PADDING);
  }, [bounds]);

  // Default view: fit the route whenever the route or the box changes. The view is adjusted during render; the
  // transform reset and animation cancel touch refs, so they run in the layout effect below.
  const [fitted, setFitted] = useState({ fitKey, width, height });
  if (fitted.fitKey !== fitKey || fitted.width !== width || fitted.height !== height) {
    setFitted({ fitKey, width, height });
    if (bounds && width !== 0) setView(fitBounds(bounds, width, height, FIT_PADDING));
  }

  useLayoutEffect(() => {
    if (!fit()) return;
    cancelAnimation();
    applyTransform(IDENTITY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, width, height]);

  useLayoutEffect(() => {
    if (resetPending.current) {
      resetPending.current = false;
      applyTransform(IDENTITY);
    }
  }, [view, applyTransform]);

  const marginX = width * MARGIN_FRACTION;
  const marginY = height * MARGIN_FRACTION;

  // Tiles for the committed view; with no route or no box yet there is nothing to show.
  if ((!hasRoute || width === 0) && shown.length > 0) setShown([]);

  useEffect(() => {
    if (!hasRoute || width === 0) return;
    const ctrl = new AbortController();
    const cover = tileCover(view, width, height, marginX, marginY);
    const needed = new Set(cover.map(placeKey));
    const prune = (prev: ShownTile[]) => {
      const next = prev.filter((p) => needed.has(placeKey(p)));
      return next.length === prev.length ? prev : next;
    };
    const hits: ShownTile[] = [];
    const missing: CoverTile[] = [];
    for (const t of cover) {
      const r = tileSource.peekRendered(t.z, t.x, t.y);
      if (r) hits.push({ key: t.key, z: t.z, x: t.x, y: t.y, ux: t.ux, r });
      else missing.push(t);
    }
    // The cached tiles must land in the same commit as the view they belong to; a render-phase read would duplicate the cover work.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync read of an external tile cache
    setShown((prev) => (missing.length === 0 ? prune(mergeShown(prev, hits)) : mergeShown(prev, hits)));
    if (missing.length === 0) return () => ctrl.abort();

    const timer = setTimeout(() => {
      void Promise.all(
        missing.map((t) =>
          tileSource.rendered(t.z, t.x, t.y, ctrl.signal).then(
            (r) => {
              if (ctrl.signal.aborted) return;
              const tile: ShownTile = { key: t.key, z: t.z, x: t.x, y: t.y, ux: t.ux, r };
              setShown((prev) => mergeShown(prev, [tile]));
            },
            () => undefined, // that tile stays blank
          ),
        ),
      ).then(() => {
        if (!ctrl.signal.aborted) setShown(prune);
      });
    }, FETCH_DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [view, width, height, marginX, marginY, hasRoute]);

  // ----- view <-> screen -----
  const center = lonLatToWorld(view.lat, view.lon, view.zoom);
  const originX = center.x - width / 2;
  const originY = center.y - height / 2;
  const project = (p: LatLon) => {
    const w = lonLatToWorld(p[0], p[1], view.zoom);
    return { x: w.x - originX, y: w.y - originY };
  };

  const tilesNode = useMemo(() => {
    const zoom = view.zoom;
    const c = lonLatToWorld(view.lat, view.lon, zoom);
    const ox = c.x - width / 2;
    const oy = c.y - height / 2;
    const needed = new Set(tileCover(view, width, height, marginX, marginY).map(placeKey));
    const visible: { tile: ShownTile; left: number; top: number; scale: number; fresh: boolean }[] = [];
    for (const tile of shown) {
      const size = TILE_SIZE * 2 ** (zoom - tile.z);
      const left = tile.ux * size - ox;
      const top = tile.y * size - oy;
      if (left > width + marginX || top > height + marginY) continue;
      if (left + size < -marginX || top + size < -marginY) continue;
      visible.push({ tile, left, top, scale: size / TILE_SIZE, fresh: needed.has(placeKey(tile)) });
    }
    // Stale tiles first (coarse under fine), current ones on top.
    visible.sort((a, b) => Number(a.fresh) - Number(b.fresh) || a.tile.z - b.tile.z);
    return visible.map((v) => (
      <TileGroup
        key={placeKey(v.tile)}
        tile={v.tile}
        left={v.left + marginX}
        top={v.top + marginY}
        scale={v.scale}
        zoom={zoom}
        palette={palette}
      />
    ));
  }, [shown, view, width, height, marginX, marginY, palette]);

  const routeNode = useMemo(() => {
    const zoom = view.zoom;
    const c = lonLatToWorld(view.lat, view.lon, zoom);
    const ox = c.x - width / 2 - marginX;
    const oy = c.y - height / 2 - marginY;
    const paths: string[] = [];
    let dot: { x: number; y: number } | null = null;
    for (const seg of segments) {
      const d = routePath(seg, zoom, ox, oy);
      if (d) paths.push(d);
      else if (seg.length > 0 && Number.isFinite(seg[0][0])) {
        const w = lonLatToWorld(seg[0][0], seg[0][1], zoom);
        dot = { x: w.x - ox, y: w.y - oy };
      }
    }
    if (paths.length === 0 && !dot) return null;
    const d = paths.join('');
    return (
      <>
        {d ? (
          <>
            <Path
              d={d}
              fill="none"
              stroke={colors.routeCasing}
              strokeWidth={ROUTE_CASING_WIDTH}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <Path
              d={d}
              fill="none"
              stroke={colors.route}
              strokeWidth={ROUTE_WIDTH}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        ) : null}
        {dot ? (
          <>
            <Circle cx={dot.x} cy={dot.y} r={ROUTE_CASING_WIDTH} fill={colors.routeCasing} />
            <Circle cx={dot.x} cy={dot.y} r={ROUTE_WIDTH} fill={colors.route} />
          </>
        ) : null}
      </>
    );
  }, [segments, view, width, height, marginX, marginY, colors.route, colors.routeCasing]);

  // ----- gesture -----
  const g = useRef<Gesture>({
    startT: 0,
    startX: 0,
    startY: 0,
    moved: false,
    maxTouches: 0,
    engaged: false,
    pressId: 0,
    last: [],
    base: null,
    lastTap: null,
  }).current;

  function cancelAnimation() {
    if (anim.current !== null) {
      cancelAnimationFrame(anim.current);
      anim.current = null;
    }
  }

  /** Folds the live transform into the committed view (centre + zoom) and schedules a transform reset. */
  const commit = useCallback(() => {
    const t = T.current;
    if (t.s === 1 && t.tx === 0 && t.ty === 0) return;
    const v = viewRef.current;
    const c = lonLatToWorld(v.lat, v.lon, v.zoom);
    const worldSize = TILE_SIZE * 2 ** v.zoom;
    const nx = c.x - t.tx / t.s;
    const ny = clamp(c.y - t.ty / t.s, 0, worldSize);
    const [lat, lon] = worldToLonLat(nx, ny, v.zoom);
    const next: MapView = { lat, lon, zoom: clamp(v.zoom + Math.log2(t.s), MIN_VIEW_ZOOM, MAX_VIEW_ZOOM) };
    resetPending.current = true;
    viewRef.current = next;
    setView(next);
  }, []);

  const sBounds = () => {
    const z = viewRef.current.zoom;
    return { lo: 2 ** (MIN_VIEW_ZOOM - z), hi: 2 ** (MAX_VIEW_ZOOM - z) };
  };

  const rebaseline = () => {
    const ts = g.last;
    if (ts.length === 0) {
      g.base = null;
      return;
    }
    const a = ts[0];
    const b = ts[1];
    g.base = {
      t: T.current,
      qx: (b ? (a.pageX + b.pageX) / 2 : a.pageX) - origin.current.x,
      qy: (b ? (a.pageY + b.pageY) / 2 : a.pageY) - origin.current.y,
      dist: b ? dist(a, b) : 0,
    };
  };

  const engage = () => {
    if (g.engaged) return;
    cancelAnimation();
    g.engaged = true;
    rebaseline();
    onInteractRef.current?.(true);
  };

  const release = () => {
    g.pressId++;
    if (!g.engaged) return;
    g.engaged = false;
    g.base = null;
    commit();
    onInteractRef.current?.(false);
  };

  /** Animates zoom by `dz` about screen point (qx, qy) relative to the map box, then commits. */
  const animateZoom = useCallback(
    (dz: number, qx?: number, qy?: number) => {
      cancelAnimation();
      commit();
      const { w, h } = sizeRef.current;
      const z0 = viewRef.current.zoom;
      const target = clamp(z0 + dz, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM) - z0;
      if (Math.abs(target) < 1e-3 || w === 0) return;
      const sT = 2 ** target;
      const cx = w / 2;
      const cy = h / 2;
      const ax = (qx ?? cx) - cx;
      const ay = (qy ?? cy) - cy;
      const start = Date.now();
      resetPending.current = false;
      const step = () => {
        const p = Math.min(1, (Date.now() - start) / ANIMATION_MS);
        const eased = 1 - (1 - p) ** 3;
        const s = sT ** eased;
        applyTransform({ tx: (1 - s) * ax, ty: (1 - s) * ay, s });
        if (p < 1) {
          anim.current = requestAnimationFrame(step);
        } else {
          anim.current = null;
          commit();
        }
      };
      anim.current = requestAnimationFrame(step);
    },
    [applyTransform, commit],
  );

  /**
   * Page position of the map box, re-measured on every first touch. `measure` answers asynchronously, so a gesture that
   * is already running (a pinch whose fingers landed together) is re-based when the answer differs: otherwise the map
   * would jump by the difference between the stale and the measured origin.
   */
  const measureOrigin = () => {
    containerRef.current?.measure((_x, _y, _w, _h, px, py) => {
      const o = origin.current;
      if (o.x === px && o.y === py) return;
      origin.current = { x: px, y: py };
      if (g.engaged) rebaseline();
    });
  };

  const onTouchStart = (e: GestureResponderEvent) => {
    const ts = e.nativeEvent.touches;
    g.last = ts;
    if (ts.length === 1) {
      cancelAnimation();
      commit();
      measureOrigin();
      g.startT = Date.now();
      g.startX = ts[0].pageX;
      g.startY = ts[0].pageY;
      g.moved = false;
      g.maxTouches = 1;
      const pressId = ++g.pressId;
      if (dragModeRef.current === 'immediate') engage();
      else setTimeout(() => g.pressId === pressId && !g.moved && engage(), PRESS_MS);
    } else if (ts.length >= 2) {
      g.maxTouches = 2;
      engage();
      rebaseline();
    }
  };

  const onTouchMove = (e: GestureResponderEvent) => {
    const ts = e.nativeEvent.touches;
    g.last = ts;
    if (ts.length === 0) return;
    if (!g.moved && Math.hypot(ts[0].pageX - g.startX, ts[0].pageY - g.startY) > SLOP) {
      g.moved = true;
      // A one-finger swipe before the press delay belongs to the page scroll.
      if (!g.engaged) g.pressId++;
    }
    if (!g.engaged || !g.base) return;
    const base = g.base;
    const a = ts[0];
    const b = ts[1];
    const qx = (b ? (a.pageX + b.pageX) / 2 : a.pageX) - origin.current.x;
    const qy = (b ? (a.pageY + b.pageY) / 2 : a.pageY) - origin.current.y;
    const { lo, hi } = sBounds();
    const s = b && base.dist > 0 ? clamp((base.t.s * dist(a, b)) / base.dist, lo, hi) : base.t.s;
    const r = s / base.t.s;
    const cx = sizeRef.current.w / 2;
    const cy = sizeRef.current.h / 2;
    applyTransform({
      s,
      tx: qx - base.qx + (1 - r) * (base.qx - cx) + r * base.t.tx,
      ty: qy - base.qy + (1 - r) * (base.qy - cy) + r * base.t.ty,
    });
  };

  const onTouchEnd = (e: GestureResponderEvent) => {
    const ts = e.nativeEvent.touches;
    g.last = ts;
    if (ts.length > 0) {
      if (g.engaged) rebaseline();
      return;
    }
    const now = Date.now();
    const wasTap = !g.moved && g.maxTouches === 1 && now - g.startT < TAP_MS;
    release();
    if (!wasTap) return;
    const prev = g.lastTap;
    const x = g.startX;
    const y = g.startY;
    if (
      prev &&
      now - prev.t < DOUBLE_TAP_MS &&
      Math.hypot(x - prev.x, y - prev.y) < DOUBLE_TAP_DIST
    ) {
      g.lastTap = null;
      animateZoom(1, x - origin.current.x, y - origin.current.y);
    } else {
      g.lastTap = { t: now, x, y };
    }
  };

  const onTouchCancel = () => {
    g.lastTap = null;
    release();
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // `immediate` claims the touch at once; `press` waits until the raw handlers engaged.
        onStartShouldSetPanResponder: () => dragModeRef.current === 'immediate',
        onMoveShouldSetPanResponder: () => g.engaged,
        onMoveShouldSetPanResponderCapture: () => g.engaged,
        onPanResponderTerminationRequest: () => !g.engaged,
        onPanResponderTerminate: () => release(),
        onPanResponderRelease: () => undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(
    () => () => {
      cancelAnimation();
      g.pressId++;
      if (g.engaged) onInteractRef.current?.(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== width) setWidth(w);
  };

  const recenter = () => {
    const v = fit();
    if (!v) return;
    cancelAnimation();
    applyTransform(IDENTITY);
    resetPending.current = false;
    viewRef.current = v;
    setView(v);
  };

  // ----- overlay nodes -----
  const inRect = (p: { x: number; y: number }) =>
    p.x > -marginX - 20 && p.x < width + marginX + 20 && p.y > -marginY - 20 && p.y < height + marginY + 20;

  const markerNodes: ReactNode[] = [];
  const placed = (markers ?? []).map((m) => ({ m, p: project(m.pos) })).filter(({ p }) => Number.isFinite(p.x) && inRect(p));
  // A ride has a pill per kilometre; which of them are drawn depends on the zoom and on what would overlap (see pickKmPills).
  const fixedBoxes: FixedBox[] = [];
  const kmCandidates: KmCandidate[] = [];
  for (const { m, p } of placed) {
    if (m.kind === 'km') {
      if (m.km !== undefined) kmCandidates.push({ km: m.km, x: p.x, y: p.y, w: kmPillWidth(m.label), h: KM_PILL_HEIGHT });
    } else {
      const size = m.kind === 'start' ? 16 : 20;
      fixedBoxes.push({ x: p.x, y: p.y, w: size, h: size });
    }
  }
  const shownKm = new Set(pickKmPills(kmCandidates, fixedBoxes));
  placed.forEach(({ m, p }, i) => {
    if (m.kind === 'km') {
      if (m.km !== undefined && !shownKm.has(m.km)) return;
      markerNodes.push(
        <View
          key={`m${i}`}
          pointerEvents="none"
          style={[styles.kmWrap, { left: p.x - 20, top: p.y - KM_PILL_HEIGHT / 2 }]}>
          <View
            style={[styles.kmPill, { backgroundColor: colors.surface, borderColor: colors.routeCasing }]}>
            <Text style={[styles.kmText, { color: colors.text }]}>{m.label ?? ''}</Text>
          </View>
        </View>,
      );
    } else if (m.kind === 'start') {
      markerNodes.push(
        <View
          key={`m${i}`}
          pointerEvents="none"
          style={[
            styles.dot,
            { left: p.x - 8, top: p.y - 8, backgroundColor: colors.start, borderColor: colors.surface },
          ]}
        />,
      );
    } else {
      markerNodes.push(
        <View
          key={`m${i}`}
          pointerEvents="none"
          style={[
            styles.finish,
            { left: p.x - 10, top: p.y - 10, backgroundColor: colors.surface, borderColor: colors.finish },
          ]}>
          <View style={[styles.finishDot, { backgroundColor: colors.finish }]} />
        </View>,
      );
    }
  });

  const hl = highlight ? project(highlight) : null;
  const border = theme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.14)';

  const stop = (e: GestureResponderEvent) => e.stopPropagation();
  const handlers = interactive
    ? { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, ...responder.panHandlers }
    : {};

  return (
    <View
      ref={containerRef}
      onLayout={onLayout}
      style={[styles.box, { height, backgroundColor: palette.background }]}
      {...handlers}>
      {width > 0 ? (
        <Animated.View
          pointerEvents="none"
          accessible
          accessibilityRole="image"
          accessibilityLabel={a11yLabel}
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateX: tx }, { translateY: ty }, { scale: sc }] },
          ]}>
          <Svg
            width={width + marginX * 2}
            height={height + marginY * 2}
            style={{ position: 'absolute', left: -marginX, top: -marginY }}>
            {tilesNode}
            {routeNode}
          </Svg>
          {markerNodes}
          {hl && Number.isFinite(hl.x) ? (
            <View
              pointerEvents="none"
              style={[
                styles.highlight,
                { left: hl.x - 12, top: hl.y - 12, borderColor: colors.route, backgroundColor: colors.surface },
              ]}>
              <View style={[styles.highlightDot, { backgroundColor: colors.route }]} />
            </View>
          ) : null}
        </Animated.View>
      ) : null}

      {interactive && hasRoute ? (
        <View
          style={styles.controls}
          onTouchStart={stop}
          onTouchMove={stop}
          onTouchEnd={stop}
          onTouchCancel={stop}>
          <MapButton
            icon="add"
            label={t('zoomIn')}
            colors={colors}
            border={border}
            onPress={() => animateZoom(1)}
          />
          <MapButton
            icon="remove"
            label={t('zoomOut')}
            colors={colors}
            border={border}
            onPress={() => animateZoom(-1)}
          />
          <MapButton
            icon="locate"
            label={t('recenter')}
            colors={colors}
            border={border}
            onPress={recenter}
          />
        </View>
      ) : null}

      <View style={styles.attribution} onTouchStart={stop} onTouchEnd={stop}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('attributionLabel')}
          hitSlop={6}
          onPress={() => void Linking.openURL(ATTRIBUTION_URL).catch(() => undefined)}>
          <Text style={[styles.attributionText, { color: colors.text }]}>{t('attribution')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MapButton({
  icon,
  label,
  colors,
  border,
  onPress,
}: {
  icon: 'add' | 'remove' | 'locate';
  label: string;
  colors: TileMapColors;
  border: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.surface, borderColor: border, opacity: pressed ? 0.7 : 0.94 },
      ]}>
      <Ionicons name={icon} size={18} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', overflow: 'hidden' },
  controls: { position: 'absolute', right: 8, top: 8, gap: 6 },
  button: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attribution: { position: 'absolute', left: 6, bottom: 4, maxWidth: '86%' },
  attributionText: { fontSize: 9, lineHeight: 12, opacity: 0.72 },
  kmWrap: { position: 'absolute', width: 40, height: 18, alignItems: 'center' },
  kmPill: {
    height: 18,
    minWidth: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kmText: { fontSize: 10, lineHeight: 12, fontWeight: '700' },
  dot: { position: 'absolute', width: 16, height: 16, borderRadius: 8, borderWidth: 2.5 },
  finish: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishDot: { width: 6, height: 6, borderRadius: 3 },
  highlight: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightDot: { width: 8, height: 8, borderRadius: 4 },
});
