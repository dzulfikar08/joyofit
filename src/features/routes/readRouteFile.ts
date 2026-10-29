import { getDocumentAsync } from '@/documentPicker';
import { File } from 'expo-file-system';

import { errorMessage } from '@/format';
import { t } from '@/i18n';

import { parseRouteFile, type ParseRouteResult } from './parseRouteFile';

/** A route file is a few hundred KB; anything over 20 MB is not one and is not read into memory. */
export const MAX_ROUTE_FILE_BYTES = 20 * 1024 * 1024;

export type ReadRouteResult = ParseRouteResult | { ok: false; reason: 'too-large' | 'unreadable'; message: string };

/** Opens the file the picker or another app handed over (`file://` or `content://`) and reads the route out of it. */
export async function readRouteFromUri(uri: string): Promise<ReadRouteResult> {
  let bytes: Uint8Array;
  try {
    const file = new File(uri);
    if (file.size > MAX_ROUTE_FILE_BYTES) return { ok: false, reason: 'too-large', message: t('routes:import.tooLarge') };
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    return { ok: false, reason: 'unreadable', message: t('routes:import.unreadable', { message: errorMessage(e) }) };
  }
  return parseRouteFile(bytes);
}

/** The system file picker, any type: Android often reports a `.gpx` as octet-stream, so the type is not filtered. Null when cancelled. */
export async function pickRouteFile(): Promise<{ uri: string; name: string } | null> {
  const picked = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || picked.assets.length === 0) return null;
  const asset = picked.assets[0];
  return { uri: asset.uri, name: asset.name };
}
