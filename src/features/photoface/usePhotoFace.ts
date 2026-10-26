import { useEventListener } from 'expo';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { CropSource } from '@/features/photoface/CropEditor';
import { isExactScreenSize, type CropRect } from '@/features/photoface/cropMath';
import { errorMessage } from '@/format';
import { t } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type PhotoFace, type UploadProgressEvent } from '@/wear';

/** What the screen waits for: reading the face, preparing a picked photo, sending one, or an operation on one photo. */
export type PhotoFaceBusy = 'read' | 'prepare' | 'send' | 'activate' | { name: string } | null;

/** Pictures are shrunk to this on the long side before cropping: a 50 MP photo is no use at 408 x 480 and costs memory. */
const WORKING_SIDE = 2400;

/**
 * The watch's photo face: read whenever the screen gains focus with a connected watch and replaced by what each operation
 * returns. `pick` opens the gallery; the picked picture goes to the crop screen (`cropSource`), and `sendCrop` cuts the chosen
 * part to the watch's screen size and uploads it. A picture that already has the screen's size is uploaded as it is.
 */
export function usePhotoFace() {
  const { linkState } = useWatch();
  const connected = linkState === 'connected' || linkState === 'syncing';
  const [face, setFace] = useState<PhotoFace | null>(null);
  const [busy, setBusy] = useState<PhotoFaceBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgressEvent | null>(null);
  const [cropSource, setCropSource] = useState<CropSource | null>(null);

  useEventListener(HuaweiWear, 'onUploadProgress', (event) => setProgress(event));

  const run = useCallback(async (kind: PhotoFaceBusy, action: () => Promise<void>) => {
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

  const refresh = useCallback(() => run('read', async () => setFace(await HuaweiWear.getPhotoFace())), [run]);

  const activate = useCallback(() => run('activate', async () => setFace(await HuaweiWear.setPhotoFaceActive())), [run]);

  /** Shows the face an add or delete returned; a refused apply afterwards (the photos are saved) is shown as the error. */
  const showSaved = useCallback((result: PhotoFace, success: string | null) => {
    setFace(result);
    if (result.applyError) setError(t('watch:photo.notApplied', { reason: result.applyError }));
    else if (success) setNotice(success);
  }, []);

  const remove = useCallback(
    (name: string) => run({ name }, async () => showSaved(await HuaweiWear.deletePhoto(name), null)),
    [run, showSaved],
  );

  /** Opens the gallery and hands the pick to the crop screen, with its orientation applied and its size capped. */
  const pick = useCallback(async () => {
    let picked: ImagePicker.ImagePickerResult;
    try {
      picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];
    await run('prepare', async () => {
      const context = ImageManipulator.manipulate(asset.uri);
      const longest = Math.max(asset.width, asset.height);
      if (longest > WORKING_SIDE) {
        context.resize(asset.width >= asset.height ? { width: WORKING_SIDE } : { height: WORKING_SIDE });
      }
      const rendered = await context.renderAsync();
      if (face && isExactScreenSize(rendered, face)) {
        // Already the watch's screen size (a picture from JoyoFit Studio's photo-face export, for one): no crop, no resampling.
        setProgress({ bytes: 0, total: 0 });
        try {
          const png = await rendered.saveAsync({ format: SaveFormat.PNG });
          showSaved(await HuaweiWear.addPhoto(png.uri), t('watch:photo.added'));
        } finally {
          setProgress(null);
        }
        return;
      }
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
      setCropSource({ uri: saved.uri, width: saved.width, height: saved.height });
    });
  }, [face, run, showSaved]);

  const sendCrop = useCallback(
    async (rect: CropRect) => {
      if (!cropSource || !face) return;
      setProgress({ bytes: 0, total: 0 });
      await run('send', async () => {
        try {
          const cut = await ImageManipulator.manipulate(cropSource.uri)
            .crop(rect)
            .resize({ width: face.width, height: face.height })
            .renderAsync();
          const png = await cut.saveAsync({ format: SaveFormat.PNG });
          const result = await HuaweiWear.addPhoto(png.uri);
          setCropSource(null);
          showSaved(result, t('watch:photo.added'));
        } finally {
          setProgress(null);
        }
      });
    },
    [cropSource, face, run, showSaved],
  );

  useFocusEffect(
    useCallback(() => {
      if (connected) void refresh();
    }, [connected, refresh]),
  );

  return {
    connected,
    face,
    busy,
    error,
    notice,
    progress,
    cropSource,
    cancelCrop: () => setCropSource(null),
    refresh,
    activate,
    remove,
    pick,
    sendCrop,
  };
}
