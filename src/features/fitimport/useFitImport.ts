import { getDocumentAsync } from '@/documentPicker';
import { File } from 'expo-file-system';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { dbHealth, isCorruptionError } from '@/db/recovery';
import { errorMessage } from '@/format';
import { t } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';

import { importFit, type FitImportResult } from './importFit';

/** A ride is a few MB at most; anything bigger is not a FIT activity and is not read into memory. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Opens the file the picker or another app handed over (`file://` or `content://`) and imports it. */
export async function importFitFromUri(db: Parameters<typeof importFit>[0], uri: string): Promise<FitImportResult> {
  let bytes: Uint8Array;
  try {
    const file = new File(uri);
    if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'not-fit', message: t('sharing:fitImport.tooLarge') };
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    return { ok: false, reason: 'unreadable', message: t('sharing:fitImport.cannotOpen', { error: errorMessage(e) }) };
  }
  return importFit(db, bytes);
}

/** The system file picker, any type: bike computers name files `.fit` but Android often reports them as octet-stream. */
export async function pickFitFile(): Promise<{ uri: string; name: string } | null> {
  const picked = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || picked.assets.length === 0) return null;
  const asset = picked.assets[0];
  return { uri: asset.uri, name: asset.name };
}

/** State of the FIT import screen: the running flag, the last result and the two ways to start one. */
export function useFitImport() {
  const db = useSQLiteContext();
  const { dataChanged } = useWatch();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FitImportResult | null>(null);

  const run = useCallback(
    async (uri: string) => {
      setRunning(true);
      setResult(null);
      try {
        let outcome: FitImportResult;
        try {
          outcome = await importFitFromUri(db, uri);
        } catch (e) {
          if (!isCorruptionError(e)) throw e;
          // The database file is damaged: repair it (the notice says what happened), then the same file once more.
          await dbHealth.repair();
          outcome = await importFitFromUri(db, uri);
        }
        setResult(outcome);
        if (outcome.ok) dataChanged();
      } catch (e) {
        setResult({ ok: false, reason: 'unreadable', message: errorMessage(e) });
      } finally {
        setRunning(false);
      }
    },
    [db, dataChanged],
  );

  const pick = useCallback(async () => {
    try {
      const picked = await pickFitFile();
      if (picked) await run(picked.uri);
    } catch (e) {
      setResult({ ok: false, reason: 'unreadable', message: errorMessage(e) });
    }
  }, [run]);

  return { running, result, run, pick };
}
