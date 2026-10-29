import { getDocumentAsync } from '@/documentPicker';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { CustomDialogState } from '@/features/watchfaces/ThemedDialog';
import { resolveCategory, type WatchfaceItem } from '@/features/watchfaces/watchfaceModel';
import type { DownloadedFace } from '@/features/watchfaces/useWatchfaceLibrary';
import { HuaweiWear, type WatchfaceList } from '@/wear';

interface UseWatchfaceImportParams {
  list: WatchfaceList | null;
  saveToLibrary: (face: DownloadedFace) => void;
  onInstall: (face: WatchfaceItem) => void;
  setDialog: (dialog: CustomDialogState | null) => void;
}

export function useWatchfaceImport({
  list,
  saveToLibrary,
  onInstall,
  setDialog,
}: UseWatchfaceImportParams) {
  const { t } = useTranslation(['watch', 'common']);
  const promptInstallAfterSave = useCallback(
    (savedFace: DownloadedFace) => {
      const hasWatchScreen = Boolean(list?.width && list?.height);
      const targetW = list?.width ?? 0;
      const targetH = list?.height ?? 0;
      const isCompatible =
        hasWatchScreen &&
        savedFace.width > 0 &&
        savedFace.height > 0 &&
        savedFace.width === targetW &&
        savedFace.height === targetH;

      if (!isCompatible) {
        const message =
          hasWatchScreen && savedFace.width > 0 && savedFace.height > 0
            ? t('watch:faces.savedIncompatibleHint', {
                title: savedFace.title,
                faceW: savedFace.width,
                faceH: savedFace.height,
                watchW: targetW,
                watchH: targetH,
              })
            : t('watch:faces.savedUnknownHint', {
                title: savedFace.title,
                watchW: targetW || '—',
                watchH: targetH || '—',
              });
        setDialog({
          visible: true,
          icon: 'alert-circle-outline',
          title: t('watch:faces.savedToMyWatch'),
          message,
          confirmLabel: t('common:actions.ok'),
          confirmVariant: 'primary',
          onConfirm: () => setDialog(null),
        });
        return;
      }

      setDialog({
        visible: true,
        icon: 'checkmark-circle-outline',
        title: t('watch:faces.savedToMyWatch'),
        message: t('watch:faces.savedInstallPrompt', { title: savedFace.title }),
        confirmLabel: t('watch:faces.installToWatchNow'),
        confirmVariant: 'primary',
        cancelLabel: t('watch:faces.keepInMyWatch'),
        onConfirm: () => void onInstall(savedFace),
      });
    },
    [list, onInstall, setDialog, t],
  );

  /**
   * The shared import step: validates the `.hwt` (extension, native package parse), saves it to the phone library (same
   * duplicate handling) and asks whether to install. The file picker and the web library both end here.
   */
  const importPackage = useCallback(
    async (file: { uri: string; name: string; size?: number | null }) => {
      const isHwt = file.name.toLowerCase().endsWith('.hwt');
      if (!isHwt) {
        const isZip = file.name.toLowerCase().endsWith('.zip');
        setDialog({
          visible: true,
          icon: 'alert-circle-outline',
          title: t('watch:faces.invalidFileExt'),
          message: isZip
            ? t('watch:faces.zipWarning', { name: file.name })
            : t('watch:faces.notHwtWarning', { name: file.name }),
          confirmLabel: t('common:actions.ok'),
          confirmVariant: 'primary',
          onConfirm: () => setDialog(null),
        });
        return;
      }

      let parsed;
      try {
        parsed = await HuaweiWear.parseWatchfacePackage(file.uri, true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('watch:faces.invalidPackage');
        setDialog({
          visible: true,
          icon: 'close-circle-outline',
          title: t('watch:faces.invalidPackage'),
          message: t('watch:faces.invalidPackageHint', { name: file.name, error: msg }),
          confirmLabel: t('common:actions.ok'),
          confirmVariant: 'primary',
          onConfirm: () => setDialog(null),
        });
        return;
      }

      const title = parsed.title || file.name.replace(/\.hwt$/i, '');
      const author = parsed.author || t('watch:faces.customImport');
      const width = parsed.width || 0;
      const height = parsed.height || 0;
      const previewUrl = parsed.previewUri || undefined;
      const downloadPath = parsed.localUri || file.uri;
      const description =
        parsed.description && parsed.description.trim() !== '{}' && parsed.description.trim() !== '[]'
          ? parsed.description
          : t('watch:faces.noDescription');
      const sizeLabel = file.size ? `${Math.round(file.size / 1024)} KB` : t('watch:faces.customSize');

      const newFace: DownloadedFace = {
        id: `local_${Date.now()}`,
        title,
        author,
        width,
        height,
        sizeLabel,
        description,
        downloadUrl: downloadPath,
        previewUrl,
        category: resolveCategory(width),
        savedAt: Date.now(),
      };

      saveToLibrary(newFace);
      promptInstallAfterSave(newFace);
    },
    [promptInstallAfterSave, saveToLibrary, setDialog, t],
  );

  const handleImportToMyWatch = useCallback(async () => {
    try {
      const picked = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (picked.canceled || picked.assets.length === 0) return;
      const asset = picked.assets[0];
      await importPackage({ uri: asset.uri, name: asset.name, size: asset.size });
    } catch {
      // ignore picker cancel
    }
  }, [importPackage]);

  return { handleImportToMyWatch, importPackage, promptInstallAfterSave };
}
