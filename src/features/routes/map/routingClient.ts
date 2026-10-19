/**
 * Snaps a leg between two waypoints to roads and paths with the FOSSGIS OSRM instances (`routed-foot`, `routed-bike`).
 * Policy (https://routing.openstreetmap.de/about.html): at most one request per second, a valid User-Agent and Referer,
 * attribution, no heavy use. So: one serial queue at >= 1.1 s between request starts, a cache per session, and a
 * 10 s timeout. Pure: `fetch`, the throttle and the identity are injected.
 */
import type { LatLon } from '@/features/routes/map/geometry';
import { getJson, RequestError, type FetchLike } from '@/features/routes/map/http';
import { createThrottle, type Throttle } from '@/features/routes/map/throttle';

export type RoutingProfile = 'foot' | 'bike';

export const ROUTING_BASE_URL = 'https://routing.openstreetmap.de';
export const ROUTING_MIN_INTERVAL_MS = 1100;
export const ROUTING_TIMEOUT_MS = 10_000;
const MAX_CACHED_LEGS = 300;

/** A coordinate as the URL and the cache key carry it: 6 decimals (about 0.1 m) without trailing zeros. */
function coordinateText(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** The "driving" in the path is right for the foot and bike instances: it is the name of the profile they all share. */
export function routeViaUrl(profile: RoutingProfile, waypoints: readonly LatLon[]): string {
  const path = waypoints.map((p) => `${coordinateText(p.lon)},${coordinateText(p.lat)}`).join(';');
  return `${ROUTING_BASE_URL}/routed-${profile}/route/v1/driving/${path}?overview=full&geometries=geojson`;
}

export function routeUrl(profile: RoutingProfile, from: LatLon, to: LatLon): string {
  return routeViaUrl(profile, [from, to]);
}

/** Waypoints within about a metre of each other are the same request (5 decimals is 1.1 m). */
export function routeViaCacheKey(profile: RoutingProfile, waypoints: readonly LatLon[]): string {
  return `${profile}:${waypoints.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join('>')}`;
}

export function routeCacheKey(profile: RoutingProfile, from: LatLon, to: LatLon): string {
  return routeViaCacheKey(profile, [from, to]);
}

function isCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

/** A line through several waypoints and how far OSRM had to move each waypoint to reach a road. */
export interface ViaRoute {
  line: readonly LatLon[];
  /** Metres from each requested waypoint to the road point OSRM used; as many entries as waypoints sent (empty when the answer has none). */
  snapM: readonly number[];
}

function parseSnapDistances(body: unknown): number[] {
  const waypoints = (body as { waypoints?: unknown }).waypoints;
  if (!Array.isArray(waypoints)) return [];
  const out: number[] = [];
  for (const w of waypoints) {
    const distance = (w as { distance?: unknown } | null)?.distance;
    if (typeof distance !== 'number' || !Number.isFinite(distance)) return [];
    out.push(distance);
  }
  return out;
}

/** The line of `routes[0]` and the snap distance of each waypoint. Errors as `parseRouteResponse`. */
export function parseViaResponse(body: unknown): ViaRoute {
  return { line: parseRouteResponse(body), snapM: parseSnapDistances(body) };
}

/** The line of `routes[0]` as lat/lon points. Throws a `code` error when OSRM found no route and a `parse` error for any other shape. */
export function parseRouteResponse(body: unknown): LatLon[] {
  if (typeof body !== 'object' || body === null) throw new RequestError('parse', 'The routing answer is empty.');
  const { code, routes } = body as { code?: unknown; routes?: unknown };
  if (code !== 'Ok') throw new RequestError('code', `Routing code: ${String(code)}`);
  const coordinates = (Array.isArray(routes) ? (routes[0] as { geometry?: { coordinates?: unknown } } | undefined) : undefined)
    ?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(isCoordinatePair)) {
    throw new RequestError('parse', 'The routing answer has no usable line.');
  }
  // GeoJSON order is longitude first.
  return coordinates.map(([lon, lat]) => ({ lat, lon }));
}

export interface RoutingClientOptions {
  fetch: FetchLike;
  /** `JoyoFit/<version> (https://joyofit.app)`: the service blocks anonymous and library default agents. */
  userAgent: string;
  referer: string;
  /** One shared queue per service; defaults to 1.1 s between request starts. */
  throttle?: Throttle;
  timeoutMs?: number;
}

export interface RoutingClient {
  /** The snapped line from `from` to `to`, both ends at the road. Rejects with a `RequestError`; an abort has kind `aborted`. */
  route(profile: RoutingProfile, from: LatLon, to: LatLon, signal?: AbortSignal): Promise<readonly LatLon[]>;
  /** One line through all `waypoints` in order (at least two), in a single request. Same queue, cache and errors as `route`. */
  routeVia(profile: RoutingProfile, waypoints: readonly LatLon[], signal?: AbortSignal): Promise<ViaRoute>;
}

export function createRoutingClient(options: RoutingClientOptions): RoutingClient {
  const throttle = options.throttle ?? createThrottle({ minIntervalMs: ROUTING_MIN_INTERVAL_MS });
  const timeoutMs = options.timeoutMs ?? ROUTING_TIMEOUT_MS;
  const headers = { 'User-Agent': options.userAgent, Referer: options.referer, Accept: 'application/json' };
  const cache = new Map<string, ViaRoute>();

  async function routeVia(profile: RoutingProfile, waypoints: readonly LatLon[], signal?: AbortSignal): Promise<ViaRoute> {
    const key = routeViaCacheKey(profile, waypoints);
    const hit = cache.get(key);
    if (hit) return hit;

    const answer = await throttle(
      async () => parseViaResponse(await getJson(options.fetch, routeViaUrl(profile, waypoints), { headers, timeoutMs, signal })),
      signal,
    );
    if (cache.size >= MAX_CACHED_LEGS) cache.delete(cache.keys().next().value as string);
    cache.set(key, answer);
    return answer;
  }

  return {
    async route(profile, from, to, signal) {
      return (await routeVia(profile, [from, to], signal)).line;
    },
    routeVia,
  };
}
