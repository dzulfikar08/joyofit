import { verifies, type CatalogMap, type StoredMap } from './catalog';

/**
 * The app's map folder, addressed by file name only. Every call opens the file by name, so no file object can silently point somewhere else
 * (expo-file-system's `move` re-points the moved object to its new path: the lab.8 build deleted each map right after moving it into place).
 */
export interface MapDir {
  /** The `file://` URI of `name`, the form the native side reads. */
  uri(name: string): string;
  /** The size of `name` in bytes, or null when there is no such file. */
  size(name: string): number | null;
  readText(name: string): string;
  writeText(name: string, text: string): void;
  /** Deletes `name` when it exists. */
  remove(name: string): void;
  /** Renames `from` to `to`, replacing `to`. */
  move(from: string, to: string): void;
}

/** What the native side reports after reading a file (`inspectOfflineMap`). */
export interface Inspected {
  sha256: string;
  bytes: number;
  mapId: string;
}

export const binName = (id: string) => `${id}.bin`;
const metaName = (id: string) => `${id}.json`;
const partName = (id: string) => `${id}.bin.part`;

/** The checked copy of map `id`, or null: the record says what was checked, and the file must still be there with that size. */
export function storedMap(dir: MapDir, id: string): StoredMap | null {
  const size = dir.size(binName(id));
  if (size === null || dir.size(metaName(id)) === null) return null;
  try {
    const stored = JSON.parse(dir.readText(metaName(id))) as StoredMap;
    return stored.id === id && typeof stored.sha256 === 'string' && stored.sizeBytes === size ? stored : null;
  } catch {
    return null;
  }
}

/** The URI and the name the native send takes for map `id`. */
export function localFile(dir: MapDir, id: string): { uri: string; name: string } {
  return { uri: dir.uri(binName(id)), name: binName(id) };
}

/**
 * Downloads `map` (`fetchTo` writes the part file), lets the native side read it back, and only when header, size and SHA-256 match the catalog
 * renames it to `<id>.bin` and writes the record. The part file never outlives the call.
 */
export async function downloadMap(
  dir: MapDir,
  map: CatalogMap,
  fetchTo: (name: string) => Promise<void>,
  inspect: (uri: string, name: string) => Promise<Inspected>,
): Promise<StoredMap> {
  const part = partName(map.id);
  try {
    await fetchTo(part);
    const checked = await inspect(dir.uri(part), binName(map.id));
    if (!verifies(map, checked)) {
      throw new Error(`The downloaded file does not match the map list (SHA-256 ${checked.sha256.slice(0, 12)}…, ${checked.bytes} bytes)`);
    }
    dir.remove(metaName(map.id));
    dir.move(part, binName(map.id));
    const stored: StoredMap = { id: map.id, sha256: map.sha256, version: map.version, sizeBytes: map.sizeBytes, downloadedAt: Date.now() };
    dir.writeText(metaName(map.id), JSON.stringify(stored));
    return stored;
  } finally {
    dir.remove(part);
  }
}

export function removeFromPhone(dir: MapDir, id: string): void {
  dir.remove(binName(id));
  dir.remove(metaName(id));
}
