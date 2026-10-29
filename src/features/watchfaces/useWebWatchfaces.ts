import { useCallback, useEffect, useState } from 'react';

import { downloadWebWatchface, listWebWatchfaces } from '@/cloud/webWatchfaces';
import { errorMessage } from '@/format';
import { useCloud } from '@/state/CloudProvider';

import { webLibraryState, type WebFace, type WebLibraryLoad } from './webLibraryModel';

/**
 * The account's web watch face library: loaded once the account is signed in (and again on `reload`), and a `fetch`
 * that downloads one face into the cache for the shared import step.
 */
export function useWebWatchfaces(enabled: boolean) {
  const { configured, signedIn, sessionPending } = useCloud();
  const [load, setLoad] = useState<WebLibraryLoad>({ status: 'idle' });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      setLoad({ status: 'loaded', faces: await listWebWatchfaces() });
    } catch {
      setLoad({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    if (!enabled || !configured || !signedIn) return;
    // Deferred so the loading state is not set synchronously inside the effect body.
    const id = setTimeout(() => void reload(), 0);
    return () => clearTimeout(id);
  }, [enabled, configured, signedIn, reload]);

  /** Downloads the face; resolves null (with `downloadError` set) when it failed. */
  const fetchFace = useCallback(async (face: WebFace) => {
    setDownloadingId(face.id);
    setDownloadError(null);
    try {
      return await downloadWebWatchface(face);
    } catch (e) {
      setDownloadError(errorMessage(e));
      return null;
    } finally {
      setDownloadingId(null);
    }
  }, []);

  return {
    state: webLibraryState({ configured, signedIn, sessionPending, load }),
    faces: load.status === 'loaded' ? load.faces : [],
    reload,
    fetchFace,
    downloadingId,
    downloadError,
  };
}
