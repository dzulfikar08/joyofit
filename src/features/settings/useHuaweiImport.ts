import { useEventListener } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CloudHttpError, NotSignedInError } from '@/cloud/api';
import { RogoError, rogo } from '@/cloud/rogo';
import { deleteWebImport, downloadWebImport, listWebImports, type CloudImport } from '@/cloud/webImports';
import { applyImportFileAt, ImportFileError, type ImportFileProgress } from '@/features/huaweiimport/importFile';
import { pendingImportCounts, syncImportedToRogo, type ImportPushOutcome } from '@/features/huaweiimport/rogoQueue';
import { profileFromExport } from '@/features/huaweiimport/profileFromExport';
import { DEFAULT_STEP_GOAL } from '@/features/today/stepGoal';
import { holdScreenOn, releaseScreen } from '@/features/strength/keepAwake';
import { errorMessage } from '@/format';
import { t } from '@/i18n';
import { isIos } from '@/components/IosUnavailable';
import { HuaweiWear, type HuaweiImportProgressEvent, type HuaweiImportSummary } from '@/wear';
import { useCloud } from '@/state/CloudProvider';

const KEEP_AWAKE_TAG = 'huawei-import';

/** Offline, signed out, a timeout: quiet and retried; a server answer (`RogoError`) is a real error and is shown. */
const isUnavailable = (error: unknown): boolean => error instanceof NotSignedInError || !(error instanceof RogoError);

/** What is waiting for JoyoRogo after an import, and what the last send did. */
export interface RogoSendState {
  waiting: number;
  sending: boolean;
  outcome: ImportPushOutcome | null;
}

export interface PickedExport {
  uri: string;
  name: string;
  /** Bytes, when the provider says. */
  size: number | null;
}

/** What a rejected `importHuaweiExport` means for the user. The native codes are listed in `HuaweiWearModule.ts`. */
export function importErrorMessage(e: unknown): string {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';
  switch (code) {
    case 'ERR_IMPORT_PASSWORD':
      return t('settings:huaweiImport.errors.password');
    case 'ERR_IMPORT_FORMAT':
      return t('settings:huaweiImport.errors.format');
    case 'ERR_BUSY':
      return t('settings:huaweiImport.errors.busy');
    default:
      return errorMessage(e);
  }
}

/** What a refused or failed web import means for the user (`ImportFileError` codes: `importFileCore.ts`). */
export function webImportErrorMessage(e: unknown): string {
  if (e instanceof ImportFileError) {
    switch (e.code) {
      case 'format':
        return t('settings:huaweiImport.web.errors.format');
      case 'version':
        return t('settings:huaweiImport.web.errors.version');
      case 'truncated':
        return t('settings:huaweiImport.web.errors.truncated');
      case 'line':
        return t('settings:huaweiImport.web.errors.line');
      case 'corrupt':
        return t('settings:huaweiImport.web.errors.corrupt');
    }
  }
  if (e instanceof CloudHttpError && e.status === 404) return t('settings:huaweiImport.web.errors.gone');
  if (e instanceof NotSignedInError) return t('settings:huaweiImport.web.errors.signIn');
  return errorMessage(e);
}

/** Asks the account for its import files from the web; a failure is a state to show, not a throw. */
async function webListState(): Promise<WebListState> {
  try {
    return { status: 'ready', items: await listWebImports() };
  } catch (e) {
    return e instanceof NotSignedInError ? { status: 'signedOut' } : { status: 'error', message: webImportErrorMessage(e) };
  }
}

/** The account's import files from the web the phone can apply. */
export type WebListState = { status: 'signedOut' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: CloudImport[] };

/**
 * State of the "Import from Huawei Health" screen. The ZIP is opened in place (`copyToCacheDirectory: false`): an export
 * can be several GB. The password lives in this hook's state only, is sent to the native import and is cleared when the
 * import succeeds, is cancelled, or the screen goes away; it is never written to storage or logged.
 */
export function useHuaweiImport() {
  const [file, setFile] = useState<PickedExport | null>(null);
  const [password, setPassword] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<HuaweiImportProgressEvent | null>(null);
  const [summary, setSummary] = useState<HuaweiImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const db = useSQLiteContext();
  const [rogoSend, setRogoSend] = useState<RogoSendState>({ waiting: 0, sending: false, outcome: null });
  const [profileFilled, setProfileFilled] = useState<number | null>(null);

  useEventListener(HuaweiWear, 'onHuaweiImportProgress', (event) => setProgress(event));

  const countWaiting = useCallback(async () => {
    const c = await pendingImportCounts(db);
    return c.weighIns + c.meals + c.water;
  }, [db]);

  /** Sends the imported weigh-ins, meals and water to JoyoRogo (idempotent); what could not go stays waiting for the next try. */
  const sendToRogo = useCallback(async () => {
    setRogoSend((s) => ({ ...s, sending: true }));
    try {
      const outcome = await syncImportedToRogo(db, rogo, isUnavailable);
      setRogoSend({ waiting: await countWaiting(), sending: false, outcome });
    } catch {
      setRogoSend({ waiting: await countWaiting().catch(() => 0), sending: false, outcome: null });
    }
  }, [db, countWaiting]);

  // Rows an earlier import left waiting (signed out then, server not updated yet) show their count and the send button on opening.
  useEffect(() => {
    void countWaiting().then((waiting) => setRogoSend((s) => ({ ...s, waiting }))).catch(() => undefined);
  }, [countWaiting]);

  const pick = useCallback(async () => {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false, multiple: false });
      if (picked.canceled || picked.assets.length === 0) return;
      const asset = picked.assets[0];
      setFile({ uri: asset.uri, name: asset.name, size: asset.size ?? null });
      setSummary(null);
      setProgress(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  /**
   * Preselects a ZIP another app opened with or shared to JoyoFit; the password is still asked for. A `content://` URI ends in an
   * opaque id (`1ec426fd-...`), so the name the sender gave the file comes from the provider (`huaweiExportDisplayName`).
   */
  const select = useCallback((uri: string) => {
    let name = 'export.zip'; // i18n-ok: fallback file name
    let size: number | null = null;
    try {
      const f = new File(uri);
      name = f.name || name;
      size = f.size ?? null;
    } catch {
      // the import itself reports an unreadable file
    }
    setFile({ uri, name, size });
    setError(null);
    setSummary(null);
    setProgress(null);
    if (!isIos) {
      const apply = (shown: string | null) => {
        if (shown) setFile((current) => (current?.uri === uri ? { ...current, name: shown } : current));
      };
      try {
        void HuaweiWear.huaweiExportDisplayName(uri).then(apply, () => undefined);
      } catch {
        // an older binary has no such call: the name above stays
      }
    }
  }, []);

  /** What follows an import, native or web: the profile is filled when the phone has none (its height is never replaced), then JoyoRogo gets its part. */
  const finishImport = useCallback(
    async (result: HuaweiImportSummary) => {
      setSummary(result);
      setPassword('');
      const filled = profileFromExport(HuaweiWear.getUserProfile(), result.profile, DEFAULT_STEP_GOAL, new Date().getFullYear());
      if (filled) {
        await HuaweiWear.setUserProfile(filled).then(() => setProfileFilled(filled.heightCm)).catch(() => undefined);
      }
      void sendToRogo();
    },
    [sendToRogo],
  );

  const start = useCallback(async () => {
    if (!file || running) return;
    setRunning(true);
    setError(null);
    setSummary(null);
    setProgress(null);
    // A large export takes minutes; a screen that turns off lets the system stop the app mid-import.
    void holdScreenOn(KEEP_AWAKE_TAG);
    try {
      await finishImport(await HuaweiWear.importHuaweiExport(file.uri, password));
    } catch (e) {
      setError(importErrorMessage(e));
    } finally {
      void releaseScreen(KEEP_AWAKE_TAG);
      setRunning(false);
    }
  }, [file, password, running, finishImport]);

  // The web path: an import file made in the browser (`docs/huawei-web-import.md`), from a file on the phone or from the account.
  const [webFile, setWebFile] = useState<PickedExport | null>(null);
  const [webProgress, setWebProgress] = useState<ImportFileProgress | null>(null);
  /** The id being applied from the account (or `file`), null when nothing runs; `downloading` while its bytes come in. */
  const [webWorking, setWebWorking] = useState<{ id: string; downloading: boolean } | null>(null);
  const [webError, setWebError] = useState<string | null>(null);
  const [webNote, setWebNote] = useState<{ kind: 'removed' } | { kind: 'kept'; message: string } | null>(null);
  const [webList, setWebList] = useState<WebListState>({ status: 'loading' });
  const webCancelled = useRef(false);
  const webRunning = useRef(false);
  const { signedIn } = useCloud();

  const refreshWebList = useCallback(async () => {
    setWebList({ status: 'loading' });
    setWebList(await webListState());
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void webListState().then((state) => live && setWebList(state));
    return () => {
      live = false;
    };
  }, [signedIn]);

  const pickWebFile = useCallback(async () => {
    setWebError(null);
    try {
      // Any type: providers often lose the mime type of a `.gz`. Copied into the cache so the file is read by path; tens of MB at most.
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || picked.assets.length === 0) return;
      const asset = picked.assets[0];
      setWebFile({ uri: asset.uri, name: asset.name, size: asset.size ?? null });
      setSummary(null);
      setWebNote(null);
    } catch (e) {
      setWebError(errorMessage(e));
    }
  }, []);

  /**
   * Applies one import file and says whether all of it was written. `open` gives its uri; a `download` is deleted from the cache when
   * done, a picked copy is left for the caller. `afterApplied` runs only when the whole file was written (the account file is deleted
   * from the server then; a refused, failed or cancelled apply keeps it for another try).
   */
  const runWeb = useCallback(
    async (id: string, open: () => Promise<string>, { download, afterApplied }: { download: boolean; afterApplied?: () => Promise<void> }): Promise<boolean> => {
      if (running || webRunning.current) return false;
      webRunning.current = true;
      webCancelled.current = false;
      setRunning(true);
      setError(null);
      setWebError(null);
      setSummary(null);
      setProgress(null);
      setWebProgress(null);
      setWebNote(null);
      setWebWorking({ id, downloading: download });
      void holdScreenOn(KEEP_AWAKE_TAG);
      let downloaded: string | null = null;
      let applied = false;
      try {
        const uri = await open();
        if (download) downloaded = uri;
        setWebWorking({ id, downloading: false });
        const result = await applyImportFileAt(db, uri, { onProgress: setWebProgress, isCancelled: () => webCancelled.current });
        await finishImport(result);
        applied = !result.cancelled;
        if (applied && afterApplied) await afterApplied();
      } catch (e) {
        setWebError(webImportErrorMessage(e));
      } finally {
        if (downloaded) {
          try {
            new File(downloaded).delete();
          } catch {
            // a copy left in the cache is cleared with it
          }
        }
        webRunning.current = false;
        setWebProgress(null);
        setWebWorking(null);
        void releaseScreen(KEEP_AWAKE_TAG);
        setRunning(false);
      }
      return applied;
    },
    [db, running, finishImport],
  );

  const startWebFile = useCallback(async () => {
    if (!webFile) return;
    if (await runWeb('file', () => Promise.resolve(webFile.uri), { download: false })) {
      try {
        new File(webFile.uri).delete();
      } catch {
        // the picker's cache copy is cleared with the cache
      }
      setWebFile(null);
    }
  }, [webFile, runWeb]);

  const startWebImport = useCallback(
    (item: CloudImport) =>
      runWeb(item.id, () => downloadWebImport(item), {
        download: true,
        afterApplied: async () => {
          try {
            await deleteWebImport(item.id);
            setWebNote({ kind: 'removed' });
          } catch (e) {
            // Applied, so nothing is lost; the file stays listed and applying it again adds nothing.
            setWebNote({ kind: 'kept', message: webImportErrorMessage(e) });
          }
          await refreshWebList();
        },
      }),
    [runWeb, refreshWebList],
  );

  const cancel = useCallback(() => {
    if (webRunning.current) webCancelled.current = true;
    else HuaweiWear.cancelHuaweiImport();
  }, []);

  return {
    file,
    password,
    setPassword,
    running,
    progress,
    summary,
    error,
    pick,
    select,
    start,
    cancel,
    rogoSend,
    sendToRogo,
    profileFilled,
    web: { file: webFile, error: webError, progress: webProgress, working: webWorking, note: webNote, list: signedIn ? webList : ({ status: 'signedOut' } as const), pickFile: pickWebFile, startFile: startWebFile, startImport: startWebImport, refreshList: refreshWebList },
  };
}
