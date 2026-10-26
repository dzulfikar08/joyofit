import { Directory, File, Paths } from 'expo-file-system';

import { CLOUD_URL } from '@/cloud/config';
import { HuaweiWear } from '@/wear';

import { parseCatalog, type CatalogMap, type StoredMap } from './catalog';
import * as files from './mapFiles';

/**
 * Maps on the phone for the offline-map lab: the catalog from JoyoFit's server (`GET /v1/maps`) and the files downloaded into the app's own
 * documents (`offline-maps/<id>.bin` plus `<id>.json`, the catalog entry it was checked against; logic in `mapFiles.ts`). The requests carry
 * nothing about the user.
 */
const root = () => new Directory(Paths.document, 'offline-maps');

/** expo-file-system behind `MapDir`: a fresh `File` per call, never one kept across a move. */
const dir: files.MapDir = {
  uri: (name) => new File(root(), name).uri,
  size: (name) => {
    const file = new File(root(), name);
    return file.exists ? file.size : null;
  },
  readText: (name) => new File(root(), name).textSync(),
  writeText: (name, text) => new File(root(), name).write(text),
  remove: (name) => {
    const file = new File(root(), name);
    if (file.exists) file.delete();
  },
  move: (from, to) => new File(root(), from).moveSync(new File(root(), to), { overwrite: true }),
};

export async function fetchCatalog(): Promise<CatalogMap[]> {
  const response = await fetch(`${CLOUD_URL}/v1/maps`);
  if (!response.ok) throw new Error(`The map list could not be loaded (HTTP ${response.status})`);
  return parseCatalog(await response.json());
}

export const storedMap = (id: string): StoredMap | null => files.storedMap(dir, id);

export const localFile = (id: string) => files.localFile(dir, id);

export const removeFromPhone = (id: string) => files.removeFromPhone(dir, id);

export function downloadMap(map: CatalogMap, onProgress: (written: number, total: number) => void): Promise<StoredMap> {
  const folder = root();
  if (!folder.exists) folder.create({ intermediates: true });
  return files.downloadMap(
    dir,
    map,
    async (name) => {
      await File.downloadFileAsync(`${CLOUD_URL}/v1/maps/${map.id}.bin`, new File(folder, name), {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => onProgress(bytesWritten, totalBytes > 0 ? totalBytes : map.sizeBytes),
      });
    },
    (uri, name) => HuaweiWear.inspectOfflineMap(uri, name),
  );
}
