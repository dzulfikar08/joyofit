/** The phone's position for the loop planner. Never asks for the permission: the screen explains first, then `ensureLocation`. */
import { locationGranted } from '@/features/sensors/permissions';
import type { LatLon } from '@/features/routes/map/geometry';
import type { MapLibre } from '@/features/routes/map/maplibre';

/** A cold GPS can take a while; the map's location manager answers with its last fix at once when it has one. */
const POSITION_TIMEOUT_MS = 10_000;

/** The current position, or null when location is not allowed, the OS does not answer in time or it fails. */
export async function currentPosition(maplibre: MapLibre): Promise<LatLon | null> {
  try {
    if (!(await locationGranted())) return null;
  } catch {
    return null;
  }
  const { promise: timeout, resolve } = Promise.withResolvers<undefined>();
  const timer = setTimeout(() => resolve(undefined), POSITION_TIMEOUT_MS);
  try {
    const position = await Promise.race([maplibre.LocationManager.getCurrentPosition(), timeout]);
    return position ? { lat: position.coords.latitude, lon: position.coords.longitude } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
