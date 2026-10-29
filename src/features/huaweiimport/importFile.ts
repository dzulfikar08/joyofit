import { File, FileMode } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { HuaweiImportSummary } from '@/wear';

import { applyImportFile, type ImportRunOptions, type ImportSource } from './importFileCore';

export { IMPORT_CONTENT_TYPE, ImportFileError, type ImportFileErrorCode, type ImportFileProgress } from './importFileCore';

/** A file the picker, a download or another app handed over (`file://` or `content://`), read from the start in chunks. */
export function openImportSource(uri: string): ImportSource {
  const file = new File(uri);
  const size = file.size;
  const handle = file.open(FileMode.ReadOnly);
  return {
    size,
    seek: (offset) => {
      handle.offset = offset;
    },
    read: (length) => handle.readBytes(length),
    close: () => handle.close(),
  };
}

/**
 * Applies the import file at `uri` to `db` (`docs/huawei-web-import.md`): checks it first and writes nothing when it is refused
 * (`ImportFileError`), then writes the batches one transaction at a time. Resolves with the file's summary plus what writing did.
 */
export function applyImportFileAt(db: Pick<SQLiteDatabase, 'withExclusiveTransactionAsync'>, uri: string, options?: ImportRunOptions): Promise<HuaweiImportSummary> {
  return applyImportFile(db, () => openImportSource(uri), options);
}
