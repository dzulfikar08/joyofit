/**
 * The saved route (GPX or TCX import, drawn, or saved from a workout) drawn on the live map as a guide line. The choice is kept in the
 * key-value store, so the next workout starts with the same line until it is switched off. Both live screens share it.
 */
import Storage from 'expo-sqlite/kv-store';
import { useEffect, useSyncExternalStore, useState } from 'react';

import { onRouteChange } from '@/features/routes/routeChanges';
import { simplifyRoute, type SavedRoute } from '@/features/routes/routeModel';
import { listRoutes, loadRoute } from '@/features/routes/routeStore';

const KEY = 'joyofit.live.route';
/** A guide line needs no more points than this to look right on a phone map. */
const OVERLAY_POINTS = 800;

let selectedId: string | null | undefined;
const listeners = new Set<() => void>();

function readSelected(): string | null {
  if (selectedId !== undefined) return selectedId;
  try {
    selectedId = Storage.getItemSync(KEY) || null;
  } catch {
    selectedId = null;
  }
  return selectedId;
}

function select(id: string | null): void {
  selectedId = id;
  try {
    if (id === null) Storage.removeItemSync(KEY);
    else Storage.setItemSync(KEY, id);
  } catch {
    // The choice still applies for this session.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface OverlayRoute {
  /** Every saved route, newest first, for the picker. */
  routes: readonly SavedRoute[];
  /** The route being drawn: its facts and the line (simplified); null when none is chosen or the file is gone. */
  selected: { route: SavedRoute; line: readonly { lat: number; lon: number }[] } | null;
  /** Choose a route by id, or `null` for no line. */
  select: (id: string | null) => void;
}

/** The saved routes, the chosen one with its points loaded, and the way to change the choice. */
export function useOverlayRoute(): OverlayRoute {
  const id = useSyncExternalStore(subscribe, readSelected, readSelected);
  const [routes, setRoutes] = useState<readonly SavedRoute[]>([]);
  const [loaded, setLoaded] = useState<{ id: string; route: SavedRoute; line: readonly { lat: number; lon: number }[] } | null>(null);
  // A route saved, renamed or deleted elsewhere changes the list.
  const [version, setVersion] = useState(0);

  useEffect(() => onRouteChange(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    let live = true;
    void listRoutes().then((list) => {
      if (live) setRoutes(list);
    });
    return () => {
      live = false;
    };
  }, [version]);

  // Nothing selected: drop the loaded route now, so picking the same one again reloads it.
  if (id === null && loaded !== null) setLoaded(null);

  useEffect(() => {
    let live = true;
    if (id === null) return;
    void loadRoute(id).then((found) => {
      if (!live) return;
      // A route that no longer exists (deleted, damaged) is dropped from the choice instead of staying invisible.
      if (!found) {
        select(null);
        setLoaded(null);
        return;
      }
      setLoaded({ id, route: found.route, line: simplifyRoute(found.points, OVERLAY_POINTS) });
    });
    return () => {
      live = false;
    };
  }, [id, version]);

  return { routes, selected: loaded && loaded.id === id ? loaded : null, select };
}
