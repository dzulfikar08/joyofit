import { openDatabaseSync } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import type { WatchCategory, WatchfaceItem } from '@/features/watchfaces/watchfaceModel';
import { HuaweiWear, hasNative } from '@/wear';

export interface DownloadedFace extends WatchfaceItem {
  readonly savedAt: number;
}

const db = openDatabaseSync('joyofit_library.db');

function initDb() {
  db.execSync(
    'CREATE TABLE IF NOT EXISTS downloaded_faces (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);',
  );
}

export function useWatchfaceLibrary() {
  const [library, setLibrary] = useState<readonly DownloadedFace[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLibrary = useCallback(() => {
    try {
      initDb();
      const rows = db.getAllSync<{ json: string }>('SELECT json FROM downloaded_faces ORDER BY rowid DESC');
      const items: DownloadedFace[] = [];
      for (const row of rows) {
        try {
          items.push(JSON.parse(row.json) as DownloadedFace);
        } catch {
          // ignore corrupted json
        }
      }
      setLibrary(items);
      const canParse = hasNative('parseWatchfacePackage');
      for (const item of items) {
        if (canParse && item.downloadUrl && !item.previewUrl) {
          void HuaweiWear.parseWatchfacePackage(item.downloadUrl, false)
            .then((parsed) => {
              if (parsed.previewUri) {
                const repaired: DownloadedFace = {
                  ...item,
                  previewUrl: parsed.previewUri,
                  description:
                    parsed.description && parsed.description.trim() !== '{}' && parsed.description.trim() !== '[]'
                      ? parsed.description
                      : item.description,
                };
                db.runSync('UPDATE downloaded_faces SET json = ? WHERE id = ?', [
                  JSON.stringify(repaired),
                  item.id,
                ]);
                setLibrary((prev) => prev.map((f) => (f.id === item.id ? repaired : f)));
              }
            })
            .catch(() => {});
        }
      }
    } catch {
      setLibrary([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so the synchronous load does not set state inside the effect body.
    const id = setTimeout(loadLibrary, 0);
    return () => clearTimeout(id);
  }, [loadLibrary]);

  const saveToLibrary = useCallback(
    (face: Omit<DownloadedFace, 'savedAt'>) => {
      try {
        initDb();
        const existing = library.find(
          (f) =>
            f.id === face.id ||
            f.title.toLowerCase().trim() === face.title.toLowerCase().trim(),
        );

        const resolvedDownloadUrl = face.downloadUrl || existing?.downloadUrl || '';
        const resolvedPreviewUrl = face.previewUrl || existing?.previewUrl;
        const resolvedId = existing ? existing.id : face.id;
        const resolvedHardwareId = face.hardwareId || existing?.hardwareId;

        const item: DownloadedFace = {
          ...face,
          id: resolvedId,
          hardwareId: resolvedHardwareId,
          downloadUrl: resolvedDownloadUrl,
          previewUrl: resolvedPreviewUrl,
          savedAt: Date.now(),
        };
        if (existing && existing.id !== item.id) {
          db.runSync('DELETE FROM downloaded_faces WHERE id = ?', [existing.id]);
        }
        db.runSync('INSERT OR REPLACE INTO downloaded_faces (id, json) VALUES (?, ?)', [
          item.id,
          JSON.stringify(item),
        ]);
        setLibrary((prev) => [
          item,
          ...prev.filter(
            (f) =>
              f.id !== item.id &&
              f.title.toLowerCase().trim() !== item.title.toLowerCase().trim(),
          ),
        ]);
      } catch {
        // database fallback
      }
    },
    [library],
  );

  const removeFromLibrary = useCallback(
    (id: string) => {
      try {
        initDb();
        const faceToDelete = library.find((f) => f.id === id);
        const canDelete = hasNative('deleteLocalWatchfaceFile');
        if (faceToDelete) {
          if (canDelete && faceToDelete.downloadUrl?.startsWith('file://')) {
            void HuaweiWear.deleteLocalWatchfaceFile(faceToDelete.downloadUrl);
          }
          if (canDelete && faceToDelete.previewUrl?.startsWith('file://')) {
            void HuaweiWear.deleteLocalWatchfaceFile(faceToDelete.previewUrl);
          }
        }
        db.runSync('DELETE FROM downloaded_faces WHERE id = ?', [id]);
        setLibrary((prev) => prev.filter((f) => f.id !== id));
      } catch {
        // database fallback
      }
    },
    [library],
  );

  const isSaved = useCallback(
    (idOrTitle: string) =>
      library.some((f) => f.id === idOrTitle || f.title.toLowerCase() === idOrTitle.toLowerCase()),
    [library],
  );
  return {
    library,
    loading,
    saveToLibrary,
    removeFromLibrary,
    isSaved,
  };
}
