import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, Linking, Platform, StyleSheet, View } from 'react-native';

import { answersFileRequests, StravaUploadWebView, type FileRequest, type StravaUploadWebRef } from '../../../modules/strava-upload-web';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Notice } from '@/components/States';
import { useFloatingTabBarFootprint } from '@/components/useFloatingTabBarFootprint';
import { deviceExportIo } from '@/features/export/exportWorkoutFile';
import { EXPORT_MIME, saveFlow } from '@/features/export/workoutExport';
import { writeManualUploadFile, type WrittenManualFile } from '@/features/strava/manualFile';
import { getManualUploadMark, markManualUpload } from '@/features/strava/manualStore';
import {
  answerFileRequest,
  initialManualUpload,
  manualUploadReducer,
  STRAVA_UPLOAD_URL,
  type ManualFile,
} from '@/features/strava/manualUpload';
import { errorMessage } from '@/format';
import { fmtDate } from '@/i18n/format';
import { spacing, useTheme } from '@/theme';

/**
 * Manual Strava upload (`features/strava/manualUpload.ts`): strava.com's own upload page in a web view, and the workout's FIT file
 * handed to the page when its "Choose files" asks for one. The person logs in and taps everything on Strava themselves; the app
 * reads nothing from the page. "Already uploaded" marks the workout on this phone; "Open in browser" saves the file and opens
 * the page in the phone's browser instead.
 */
export default function StravaUploadScreen() {
  const { t } = useTranslation('sharing');
  const { colors } = useTheme();
  const db = useSQLiteContext();
  const router = useRouter();
  const bottom = useFloatingTabBarFootprint();
  const { id } = useLocalSearchParams<{ id: string }>();
  const workoutId = Number(id);
  // Android always, iOS from 18.4: the web view hands the page's file request to the app. Before, iOS shows its own picker and the
  // person saves the file to Files first.
  const direct = answersFileRequests;

  const [state, dispatch] = useReducer(manualUploadReducer, initialManualUpload);
  const [written, setWritten] = useState<WrittenManualFile | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [browserNote, setBrowserNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<'files' | 'browser' | 'mark' | null>(null);
  const web = useRef<StravaUploadWebRef>(null);
  // The file as the native event handler sees it, and a request that came before the file was written.
  const file = useRef<ManualFile>(state.file);
  const waiting = useRef<FileRequest | null>(null);

  useEffect(() => {
    let live = true;
    writeManualUploadFile(db, workoutId)
      .then(async (out) => {
        if (!live) return;
        setWritten(out);
        dispatch({ type: 'fileReady', uri: out.uri, name: out.name });
        const markedAt = await getManualUploadMark(db, out.workoutStart);
        if (live) dispatch({ type: 'markLoaded', markedAt });
      })
      .catch((e) => {
        if (live) dispatch({ type: 'fileFailed', error: errorMessage(e) });
      });
    return () => {
      live = false;
    };
  }, [db, workoutId]);

  const answer = useCallback((request: FileRequest, current: ManualFile) => {
    const decision = answerFileRequest(current, request);
    if (decision.kind === 'wait') {
      waiting.current = request;
      return;
    }
    web.current?.answerFileRequest(request.requestId, decision.kind === 'file' ? decision.uri : null).catch(() => {});
    if (decision.kind === 'file') dispatch({ type: 'handedOver' });
  }, []);

  useEffect(() => {
    file.current = state.file;
    const request = waiting.current;
    if (state.file.status === 'building' || !request) return;
    waiting.current = null;
    answer(request, state.file);
  }, [state.file, answer]);

  // Android's back button goes back inside Strava's pages first.
  useEffect(() => {
    if (Platform.OS !== 'android' || !canGoBack) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      web.current?.goBack().catch(() => {});
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  const saveToFiles = useCallback(async () => {
    if (!written) return;
    setActionError(null);
    setBusy('files');
    try {
      await deviceExportIo.share(written.uri, EXPORT_MIME.fit, written.name);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [written]);

  const openInBrowser = useCallback(async () => {
    if (!written) return;
    setActionError(null);
    setBusy('browser');
    try {
      if (saveFlow(Platform.OS) === 'folder') {
        const folder = await deviceExportIo.saveToFolder(written.name, EXPORT_MIME.fit, written.bytes, false);
        if (folder !== null) setBrowserNote(t('strava.manual.browserFolder', { file: written.name, folder }));
      } else {
        await deviceExportIo.share(written.uri, EXPORT_MIME.fit, written.name);
        setBrowserNote(t('strava.manual.browserFiles', { file: written.name }));
      }
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [written, t]);

  const markDone = useCallback(async () => {
    if (!written) return;
    setActionError(null);
    setBusy('mark');
    try {
      dispatch({ type: 'marked', at: await markManualUpload(db, written.workoutStart) });
      router.back();
    } catch (e) {
      setActionError(errorMessage(e));
      setBusy(null);
    }
  }, [db, written, router]);

  const ready = state.file.status === 'ready' ? state.file : null;
  const fileHint = ready
    ? state.handedOver > 0
      ? t('strava.manual.handedOver', { file: ready.name })
      : t(direct ? 'strava.manual.direct' : 'strava.manual.files', { file: ready.name })
    : null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.top}>
        {state.file.status === 'failed' ? <Notice tone="danger">{state.file.error}</Notice> : null}
        {state.file.status === 'building' ? (
          <AppText variant="caption" muted>
            {t('strava.manual.preparing')}
          </AppText>
        ) : null}
        {fileHint !== null ? (
          <Notice
            icon={state.handedOver > 0 ? 'checkmark-circle' : undefined}
            action={!direct && state.handedOver === 0 ? { label: t('strava.manual.saveToFiles'), onPress: () => void saveToFiles() } : undefined}>
            {fileHint}
          </Notice>
        ) : null}
        {state.markedAt !== null ? (
          <AppText variant="caption" muted>
            {t('strava.manual.markedOn', { date: fmtDate(state.markedAt, 'medium') })}
          </AppText>
        ) : null}
        {state.file.status !== 'failed' ? (
          <AppText variant="caption" muted>
            {t('strava.manual.loginHint')}
          </AppText>
        ) : null}
        {loadError !== null ? (
          <Notice
            tone="danger"
            action={{
              label: t('strava.manual.retry'),
              onPress: () => {
                setLoadError(null);
                web.current?.reload().catch(() => {});
              },
            }}>
            {t('strava.manual.loadError', { error: loadError })}
          </Notice>
        ) : null}
        {actionError !== null ? <Notice tone="danger">{actionError}</Notice> : null}
      </View>
      {state.file.status !== 'failed' ? (
        <StravaUploadWebView
          ref={web}
          style={[styles.web, { borderColor: colors.hairline }]}
          sourceUrl={STRAVA_UPLOAD_URL}
          onFileRequest={(event) => answer(event.nativeEvent, file.current)}
          onNavigation={(event) => {
            setCanGoBack(event.nativeEvent.canGoBack);
            if (event.nativeEvent.loading) setLoadError(null);
          }}
          onLoadError={(event) => setLoadError(event.nativeEvent.description)}
        />
      ) : (
        <View style={styles.web} />
      )}
      <View style={[styles.bottom, { paddingBottom: bottom + spacing.sm }]}>
        <ButtonRow>
          <Button
            label={t('strava.manual.openBrowser')}
            variant="secondary"
            icon="open-outline"
            onPress={() => void openInBrowser()}
            disabled={!written || busy !== null}
            loading={busy === 'browser' || busy === 'files'}
          />
          <Button
            label={t('strava.manual.markDone')}
            variant="primary"
            icon="checkmark-done"
            onPress={() => void markDone()}
            disabled={!written || busy !== null}
            loading={busy === 'mark'}
          />
        </ButtonRow>
      </View>
      <ConfirmDialog
        visible={browserNote !== null}
        title={t('strava.manual.browserTitle')}
        message={browserNote ?? ''}
        confirmLabel={t('strava.manual.browserConfirm')}
        onConfirm={() => {
          setBrowserNote(null);
          Linking.openURL(STRAVA_UPLOAD_URL).catch((e) => setActionError(errorMessage(e)));
        }}
        onCancel={() => setBrowserNote(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.xs },
  web: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  bottom: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
});
