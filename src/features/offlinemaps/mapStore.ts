import { Directory, File, Paths } from 'expo-file-system';

import { CLOUD_URL } from '@/cloud/config';
import { HuaweiWear } from '@/wear';

import { parseCatalog, verifies, type CatalogMap, type StoredMap } from './catalog';

/**
 * Maps on the phone for the offline-map lab: the catalog from JoyoFit's server (`GET /v1/maps`), the files downloaded into the app's own
 * documents (`offline-maps/<id>.bin` plus `<id>.json`, the catalog entry it was checked against). The requests carry nothing about the user.
 */
const dir = () => new Directory(Paths.document, 'offline-maps');
const binOf = (id: string) => new File(dir(), `${id}.bin`);
const metaOf = (id: string) => new File(dir(), `${id}.json`);

export async function fetchCatalog(): Promise<CatalogMap[]> {
  const response = await fetch(`${CLOUD_URL}/v1/maps`);
  if (!response.ok) throw new Error(`The map list could not be loaded (HTTP ${response.status})`);
  return parseCatalog(await response.json());
}

/** The checked copy of map `id` on the phone, or null (no file, or no record of the check). */
export function storedMap(id: string): StoredMap | null {
  const bin = binOf(id);
  const meta = metaOf(id);
  if (!bin.exists || !meta.exists) return null;
  try {
    const stored = JSON.parse(meta.textSync()) as StoredMap;
    return stored.id === id && typeof stored.sha256 === 'string' ? stored : null;
  } catch {
    return null;
  }
}

/** The `file://` URI and the name the native send takes. */
export function localFile(id: string): { uri: string; name: string } {
  return { uri: binOf(id).uri, name: `${id}.bin` };
}

/**
 * Downloads `map` into a `.part` file, lets the native side read it (the `offvmp` header, size and SHA-256), and only when everything matches the
 * catalog moves it in place and writes the record. A failed check deletes the download.
 */
export async function downloadMap(map: CatalogMap, onProgress: (written: number, total: number) => void, signal?: AbortSignal): Promise<StoredMap> {
  const folder = dir();
  if (!folder.exists) folder.create({ intermediates: true });
  const part = new File(folder, `${map.id}.bin.part`);
  try {
    await File.downloadFileAsync(`${CLOUD_URL}/v1/maps/${map.id}.bin`, part, {
      idempotent: true,
      signal,
      onProgress: ({ bytesWritten, totalBytes }) => onProgress(bytesWritten, totalBytes > 0 ? totalBytes : map.sizeBytes),
    });
    const checked = await HuaweiWear.inspectOfflineMap(part.uri, `${map.id}.bin`);
    if (!verifies(map, checked)) {
      throw new Error(`The downloaded file does not match the map list (SHA-256 ${checked.sha256.slice(0, 12)}…, ${checked.bytes} bytes)`);
    }
    const bin = binOf(map.id);
    if (bin.exists) bin.delete();
    part.moveSync(bin);
    const stored: StoredMap = { id: map.id, sha256: map.sha256, version: map.version, sizeBytes: map.sizeBytes, downloadedAt: Date.now() };
    const meta = metaOf(map.id);
    if (!meta.exists) meta.create();
    meta.write(JSON.stringify(stored));
    return stored;
  } finally {
    if (part.exists) part.delete();
  }
}

export function removeFromPhone(id: string): void {
  for (const file of [binOf(id), metaOf(id)]) if (file.exists) file.delete();
}
