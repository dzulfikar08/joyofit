import { MAP_INK } from '@/features/routes/map/mapConfig';
import type { MapLibre } from '@/features/routes/map/maplibre';

/** A very short dash with round caps is a dot; the numbers are in line widths (dash, gap). */
const DOTS = [0.05, 1.7];

interface LoopLayersProps {
  maplibre: MapLibre;
  /** The person's past tracks, drawn as thin lines under everything. */
  history: GeoJSON.FeatureCollection;
  historyColor: string;
  /** The new loop, dotted. Null while there is none. */
  loop: GeoJSON.FeatureCollection | null;
  loopColor: string;
  /** One point with a `label` property: the start dot and its caption. Null while the start is not known. */
  start: GeoJSON.FeatureCollection | null;
}

/** Past tracks, the dotted loop and the start marker as map layers, in this order (later is on top). Ids are fixed: MapLibre freezes them. */
export function LoopLayers({ maplibre, history, historyColor, loop, loopColor, start }: LoopLayersProps) {
  const { GeoJSONSource, Layer } = maplibre;
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  return (
    <>
      <GeoJSONSource id="loop-history" data={history}>
        <Layer id="loop-history-casing" type="line" layout={round} paint={{ 'line-color': MAP_INK.casing, 'line-width': 5, 'line-opacity': 0.45 }} />
        <Layer id="loop-history-stroke" type="line" layout={round} paint={{ 'line-color': historyColor, 'line-width': 3, 'line-opacity': 0.75 }} />
      </GeoJSONSource>
      {loop ? (
        <GeoJSONSource id="loop-route" data={loop}>
          <Layer
            id="loop-route-casing"
            type="line"
            layout={round}
            paint={{ 'line-color': MAP_INK.casing, 'line-width': 9, 'line-dasharray': DOTS, 'line-opacity': 0.95 }}
          />
          <Layer
            id="loop-route-dots"
            type="line"
            layout={round}
            paint={{ 'line-color': loopColor, 'line-width': 6, 'line-dasharray': DOTS }}
          />
        </GeoJSONSource>
      ) : null}
      {start ? (
        <GeoJSONSource id="loop-start" data={start}>
          <Layer
            id="loop-start-dot"
            type="circle"
            paint={{ 'circle-radius': 8, 'circle-color': loopColor, 'circle-stroke-width': 3, 'circle-stroke-color': MAP_INK.casing }}
          />
          <Layer
            id="loop-start-label"
            type="symbol"
            layout={{
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 12,
              'text-anchor': 'top',
              'text-offset': [0, 1.2],
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            }}
            paint={{ 'text-color': MAP_INK.chipText, 'text-halo-color': MAP_INK.casing, 'text-halo-width': 2 }}
          />
        </GeoJSONSource>
      ) : null}
    </>
  );
}
