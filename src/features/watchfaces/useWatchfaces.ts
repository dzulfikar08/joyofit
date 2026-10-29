import { useEventListener } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { getDocumentAsync } from '@/documentPicker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { installFailureText } from '@/features/watchfaces/installError';
import { errorMessage } from '@/format';
import { t } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type UploadProgressEvent, type WatchfaceInstallResult, type WatchfaceList } from '@/wear';

/** What the screen is waiting for: reading the list, installing a file, or an operation on one face. */
export type WatchfaceBusy = 'list' | 'install' | { id: string; action: 'activate' | 'delete' } | null;

/**
 * The watch's faces: read whenever the screen gains focus with a connected watch, replaced by the
 * list every operation returns. `install` asks for a file, uploads it and reports progress.
 */
export function useWatchfaces() {
  const { linkState } = useWatch();
  const connected = linkState === 'connected' || linkState === 'syncing';
  const [list, setList] = useState<WatchfaceList | null>(null);
  const [busy, setBusy] = useState<WatchfaceBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgressEvent | null>(null);

  useEventListener(HuaweiWear, 'onUploadProgress', (event) => setProgress(event));

  const run = useCallback(async (kind: WatchfaceBusy, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const refresh = useCallback(
    () => run('list', async () => setList(await HuaweiWear.listWatchfaces())),
    [run],
  );

  const setActive = useCallback(
    (id: string) => run({ id, action: 'activate' }, async () => setList(await HuaweiWear.setActiveWatchface(id))),
    [run],
  );

  const remove = useCallback(
    (id: string) => run({ id, action: 'delete' }, async () => setList(await HuaweiWear.deleteWatchface(id))),
    [run],
  );

  /** Installs a watch face from an explicit URI (file://, content://, or http/https URL). */
  const installFromUri = useCallback(
    async (uri: string, signature?: string, fileName?: string): Promise<WatchfaceInstallResult | null> => {
      setProgress({ bytes: 0, total: 0 });
      let outcome: WatchfaceInstallResult | null = null;
      await run('install', async () => {
        try {
          const result = await HuaweiWear.installWatchface(uri, signature, fileName);
          if (result.list) setList(result.list);
          if (result.listed) {
            setNotice(t('watch:faces.installResult', { name: result.name, message: result.message }));
            outcome = result;
          } else {
            setError(t('watch:faces.installResult', { name: result.name, message: installFailureText(result.message, t('watch:faces.signatureRefused')) }));
          }
        } catch (e) {
          setError(installFailureText(errorMessage(e), t('watch:faces.signatureRefused')));
        } finally {
          setProgress(null);
        }
      });
      return outcome;
    },
    [run],
  );

  /** Installs a picked .hwt; `signature` + `fileName` replay a captured Huawei signature (see installWatchface). */
  const install = useCallback(async (signature?: string, fileName?: string) => {
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];
    await installFromUri(asset.uri, signature, fileName);
  }, [installFromUri]);

  const initialFetchDone = useRef(false);

  useEffect(() => {
    if (!connected) {
      initialFetchDone.current = false;
    }
  }, [connected]);

  useFocusEffect(
    useCallback(() => {
      if (connected && !initialFetchDone.current) {
        initialFetchDone.current = true;
        void refresh();
      }
    }, [connected, refresh]),
  );

  return { connected, list, busy, error, notice, progress, refresh, setActive, remove, install, installFromUri };
}
