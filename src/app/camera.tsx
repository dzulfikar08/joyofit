import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { NoticeDialog, useNotice } from '@/components/NoticeDialog';
import {
  cameraRemoteState,
  cameraRemoteStatus,
  clearOpenCameraNotification,
  notifyOpenCamera,
  reportPhoneCamera,
} from '@/features/camera/cameraRemote';
import { ensurePhotosAccess, PhotosDeniedError } from '@/features/stickers/share/shareImage';
import { useWatch } from '@/state/WatchProvider';
import { overlay, radius, spacing } from '@/theme';
import { HuaweiWear, type CameraRemoteEvent } from '@/wear';

type PhotosState = 'unknown' | 'granted' | 'denied';

/** A hidden tab stays mounted after Back: the camera (and what the watch is told) lives only while the screen is in front. */
export default function CameraScreen() {
  return useIsFocused() ? <CameraRemoteScreen /> : <View style={styles.black} />;
}

/**
 * The phone's viewfinder for the watch's Remote shutter. Opened by the watch (CameraRemoteRunner) or from the Watch hub. While it is on
 * screen the watch is told the camera runs (`setPhoneCameraOpen(true)`), so its shutter button takes a picture here; each photo goes to
 * the photo library. A close on the watch closes this screen; leaving it tells the watch the camera stopped.
 */
function CameraRemoteScreen() {
  const { t } = useTranslation(['watch', 'sharing']);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const watch = useWatch();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastUri, setLastUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotosState>('unknown');
  const photosNotice = useNotice<'save'>();
  const camera = useRef<CameraView>(null);
  const busyRef = useRef(false);
  const closing = useRef(false);

  const linked = watch.linkState === 'connected' || watch.linkState === 'syncing';
  const supported = linked && cameraRemoteStatus().supported;

  useEffect(() => {
    cameraRemoteState.setScreenMounted(true);
    void clearOpenCameraNotification();
    return () => {
      cameraRemoteState.setScreenMounted(false);
      void reportPhoneCamera(false);
    };
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/watch');
  }, [router]);

  const takePicture = useCallback(async () => {
    if (!camera.current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const picture = await camera.current.takePictureAsync({ quality: 0.92, exif: false });
      if (!picture) return;
      setLastUri(picture.uri);
      if (photos !== 'denied') {
        await MediaLibrary.Asset.create(picture.uri);
      }
    } catch (e) {
      setError(e instanceof PhotosDeniedError ? t('camera.photosOff') : t('camera.failed'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [photos, t]);

  useEventListener(HuaweiWear, 'onCameraRemote', (event: CameraRemoteEvent) => {
    if (event.action === 'close') close();
    else if (event.action === 'shutter') {
      // In the background the camera is stopped; the press is dropped rather than fired later by surprise.
      if (AppState.currentState !== 'active') return;
      if (ready) void takePicture();
      else cameraRemoteState.queueShutter();
    } else if (AppState.currentState !== 'active') {
      // The screen is open behind another app: bring JoyoFit forward.
      void notifyOpenCamera();
    } else if (ready) {
      // The watch reopened its shutter while this screen was already up: tell it again that the camera runs.
      void reportPhoneCamera(true);
    }
  });

  // Photos first (one notice with a single button, then the system request on iOS): the watch's shutter must not stop at a dialog.
  const granted = permission?.granted === true;
  const showPhotosNotice = photosNotice.show;
  const photosAsked = useRef(false);
  useEffect(() => {
    if (!granted || photosAsked.current) return;
    photosAsked.current = true;
    void (async () => {
      try {
        await ensurePhotosAccess('save', () => showPhotosNotice('save'));
        setPhotos('granted');
      } catch {
        setPhotos('denied');
      }
    })();
  }, [granted, showPhotosNotice]);

  // In the background the system stops the camera: the watch is told, and told again when JoyoFit is back in front.
  useEffect(() => {
    if (!ready) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reportPhoneCamera(true);
      else if (state === 'background') void reportPhoneCamera(false);
    });
    return () => subscription.remove();
  }, [ready]);

  const onReady = useCallback(() => {
    setReady(true);
    void reportPhoneCamera(true);
    if (cameraRemoteState.takePendingShutter()) void takePicture();
  }, [takePicture]);

  // A flip restarts the preview; the watch keeps its shutter (the phone camera did not stop).
  const flip = () => setFacing((f) => (f === 'back' ? 'front' : 'back'));

  const top = (
    <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('camera.close')} onPress={close} hitSlop={12} style={styles.round}>
        <Ionicons name="close" size={26} color={overlay.ink} />
      </Pressable>
      <View style={styles.status}>
        <Ionicons name="watch-outline" size={16} color={overlay.ink} />
        <AppText variant="caption" style={styles.ink} numberOfLines={2}>
          {!linked ? t('camera.notConnected') : supported ? t('camera.ready') : t('camera.unsupported')}
        </AppText>
      </View>
    </View>
  );

  if (!permission) return <View style={styles.black} />;

  if (!permission.granted) {
    return (
      <View style={[styles.black, styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {top}
        <View style={styles.ask}>
          <Ionicons name="camera" size={44} color={overlay.ink} />
          <AppText variant="heading" style={[styles.ink, styles.textCenter]}>
            {t('camera.permissionTitle')}
          </AppText>
          <AppText variant="body" style={[styles.inkSoft, styles.textCenter]}>
            {permission.canAskAgain ? t('camera.permissionBody') : t('camera.permissionDenied')}
          </AppText>
          {permission.canAskAgain ? (
            <Button variant="primary" label={t('camera.continue')} onPress={() => void requestPermission()} />
          ) : (
            <Button variant="primary" icon="settings" label={t('camera.openSettings')} onPress={() => void Linking.openSettings()} />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.black}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} mode="picture" onCameraReady={onReady} />
      {top}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}>
        {photos === 'denied' ? (
          <Pressable onPress={() => void Linking.openSettings()} style={styles.banner}>
            <AppText variant="caption" style={styles.ink}>
              {t('camera.photosOff')}
            </AppText>
          </Pressable>
        ) : error ? (
          <View style={styles.banner}>
            <AppText variant="caption" style={styles.ink}>
              {error}
            </AppText>
          </View>
        ) : null}
        <View style={styles.controls}>
          <View style={styles.side}>
            {lastUri ? <Image source={{ uri: lastUri }} style={styles.thumb} accessibilityLabel={t('camera.lastPhoto')} /> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('camera.shutter')}
            disabled={!ready || busy}
            onPress={() => void takePicture()}
            style={({ pressed }) => [styles.shutter, (pressed || busy) && styles.shutterPressed]}>
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.side}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('camera.flip')} onPress={flip} hitSlop={12} style={styles.round}>
              <Ionicons name="camera-reverse-outline" size={26} color={overlay.ink} />
            </Pressable>
          </View>
        </View>
      </View>
      <NoticeDialog
        visible={photosNotice.request !== null}
        title={t('sharing:share.photosDialog.title')}
        message={t('camera.photosNotice')}
        confirmLabel={t('sharing:share.photosDialog.confirm')}
        onConfirm={photosNotice.done}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: overlay.scrimInk },
  center: { justifyContent: 'center' },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  status: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: overlay.chip,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: overlay.chip },
  ink: { color: overlay.ink },
  inkSoft: { color: overlay.inkSoft },
  textCenter: { textAlign: 'center' },
  ask: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: spacing.md, paddingHorizontal: spacing.lg },
  banner: { alignSelf: 'center', backgroundColor: overlay.chip, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { width: 64, alignItems: 'center' },
  thumb: { width: 52, height: 52, borderRadius: 10, borderWidth: 2, borderColor: overlay.ink },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: overlay.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterPressed: { opacity: 0.6 },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: overlay.ink },
});
