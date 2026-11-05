import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { IconChip } from '@/components/IconChip';
import { Card, Section, useContentPadding, useRefreshControl } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { EmptyState, Notice } from '@/components/States';
import { InstalledFaceCard } from '@/features/watchfaces/InstalledFaceCard';
import { LibraryFaceCard } from '@/features/watchfaces/LibraryFaceCard';
import { HuaweiAccountSection } from '@/features/watchfaces/HuaweiAccountSection';
import { ThemedDialog, type CustomDialogState } from '@/features/watchfaces/ThemedDialog';
import { shouldWarnUnsigned } from '@/features/watchfaces/unsignedWarning';
import { WatchfacePreviewModal } from '@/features/watchfaces/WatchfacePreviewModal';
import { WebFacesSection } from '@/features/watchfaces/WebFacesSection';
import { WatchStorageCard } from '@/features/watchfaces/WatchStorageCard';
import { FaceSkeleton } from '@/features/watchfaces/WatchThumbnail';
import { libraryEntry, type WatchfaceItem } from '@/features/watchfaces/watchfaceModel';
import { useWatchfaceImport } from '@/features/watchfaces/useWatchfaceImport';
import { useWatchfaceLibrary, type DownloadedFace } from '@/features/watchfaces/useWatchfaceLibrary';
import { useWatchfaces } from '@/features/watchfaces/useWatchfaces';
import { useWebWatchfaces } from '@/features/watchfaces/useWebWatchfaces';
import type { WebFace } from '@/features/watchfaces/webLibraryModel';
import { radius, spacing, useColors } from '@/theme';
import { hasNative, type WatchfaceInfo } from '@/wear';
import { OPEN_IN_STACK } from '@/components/navigation';

type TabMode = 'installed' | 'library';


const SKELETON_ROWS = [0, 1, 2];

/** Matches an installed watch hardware face to a downloaded library entry. */
export function findFaceMatch(
  face: WatchfaceInfo,
  library: readonly DownloadedFace[],
): WatchfaceItem | undefined {
  const normFaceName = face.name.toLowerCase().trim();
  return library.find(
    (l) =>
      l.hardwareId === face.id ||
      l.id === face.id ||
      l.title.toLowerCase().trim() === normFaceName ||
      normFaceName.includes(l.title.toLowerCase().trim()) ||
      l.title.toLowerCase().trim().includes(normFaceName),
  );
}

/** Finds whether a library/catalog face is installed on the active watch. */
export function findInstalledFace(
  face: { id: string; title: string; hardwareId?: string },
  faces: readonly WatchfaceInfo[] | undefined,
): WatchfaceInfo | undefined {
  if (!faces || faces.length === 0) return undefined;
  const targetTitle = face.title.toLowerCase().trim();
  return faces.find(
    (f) =>
      (face.hardwareId && f.id === face.hardwareId) ||
      f.id === face.id ||
      f.name.toLowerCase().trim() === targetTitle ||
      targetTitle.includes(f.name.toLowerCase().trim()) ||
      f.name.toLowerCase().trim().includes(targetTitle),
  );
}

/** Lists, activates, deletes and installs watch faces on the connected watch. */
export function WatchfacesScreen() {
  const router = useRouter();
  const { t } = useTranslation(['watch', 'common']);
  const colors = useColors();
  const padding = useContentPadding(false);
  const { connected, list, busy, error, notice, progress, refresh, setActive, remove, install, installFromUri } =
    useWatchfaces();
  const { library, saveToLibrary, removeFromLibrary } = useWatchfaceLibrary();
  const [tab, setTab] = useState<TabMode>('installed');
  const tabOptions = [
    { value: 'installed' as const, label: t('watch:faces.onWatchTab') },
    { value: 'library' as const, label: t('watch:faces.library') },
  ];
  const [installingUrl, setInstallingUrl] = useState<string | null>(null);
  const [previewFace, setPreviewFace] = useState<WatchfaceItem | null>(null);
  const [dialog, setDialog] = useState<CustomDialogState | null>(null);

  const refreshControl = useRefreshControl({
    refreshing: busy === 'list',
    onRefresh: () => void refresh(),
    enabled: connected,
  });
  // The iOS module cannot read a .hwt (parseWatchfacePackage is ERR_UNSUPPORTED there), so a file cannot be saved into
  // the library; it is sent to the watch straight from the picker instead.
  const entry = libraryEntry(Platform.OS, hasNative('parseWatchfacePackage'));
  const canImport = entry === 'import';
  const installFromFile = entry === 'install';
  const idle = busy === null;
  const installing = busy === 'install';
  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.bytes / progress.total) * 100)) : 0;

  const web = useWebWatchfaces(tab === 'library');

  const { handleImportToMyWatch, importPackage } = useWatchfaceImport({
    list,
    saveToLibrary,
    onInstall: (face) => void handleInstall(face),
    setDialog,
  });

  /** Web library item: download, then the same validate, save and install-prompt step as a picked file. */
  const handleInstallFromWeb = async (face: WebFace) => {
    const file = await web.fetchFace(face);
    if (file) await importPackage({ ...file, size: face.size });
  };

  /** Runs `proceed` straight away, or after the user chose "try anyway" when the watch deletes unsigned faces. */
  const confirmUnsigned = (proceed: () => void) => {
    if (!shouldWarnUnsigned(list, 'user-hwt')) {
      proceed();
      return;
    }
    setDialog({
      visible: true,
      icon: 'shield-checkmark-outline',
      title: t('watch:faces.unsignedTitle'),
      message: t('watch:faces.unsignedBody'),
      closeLabel: t('common:actions.close'),
      cancelLabel: t('watch:faces.unsignedTryAnyway'),
      onCancel: proceed,
      confirmLabel: t('watch:faces.unsignedUsePhoto'),
      confirmVariant: 'primary',
      onConfirm: () => router.push('/watch/photos', OPEN_IN_STACK),
    });
  };

  const handleInstall = async (face: WatchfaceItem) => confirmUnsigned(() => void installLibraryFace(face));

  const installLibraryFace = async (face: WatchfaceItem) => {
    if (!face.downloadUrl) return;
    setInstallingUrl(face.downloadUrl);
    const outcome = await installFromUri(face.downloadUrl);
    if (outcome) {
      saveToLibrary({
        id: face.id,
        title: face.title,
        author: face.author,
        width: face.width,
        height: face.height,
        sizeLabel: face.sizeLabel,
        description: face.description,
        downloadUrl: face.downloadUrl,
        previewUrl: face.previewUrl,
        category: face.category,
      });
    } else {
      setDialog({
        visible: true,
        icon: 'close-circle-outline',
        title: t('watch:faces.installRejected'),
        message: t('watch:faces.installRejectedHint', { name: face.title }),
        confirmLabel: t('common:actions.ok'),
        confirmVariant: 'primary',
        onConfirm: () => setDialog(null),
      });
    }
    setInstallingUrl(null);
  };

  const confirmDeleteFromWatch = (face: WatchfaceInfo) => {
    setDialog({
      visible: true,
      icon: 'trash-outline',
      title: t('watch:faces.deleteTitle'),
      message: t('watch:faces.deleteMessage', { name: face.name }),
      confirmLabel: t('common:actions.delete'),
      confirmVariant: 'destructive',
      cancelLabel: t('common:actions.cancel'),
      onConfirm: () => void remove(face.id),
    });
  };

  const confirmDeleteFromLibrary = (face: DownloadedFace) => {
    const isOnWatch = Boolean(findInstalledFace(face, list?.faces));
    setDialog({
      visible: true,
      icon: 'trash-outline',
      title: t('watch:faces.deleteFromStorage'),
      message: isOnWatch
        ? t('watch:faces.deleteFromStorageOnWatch', { title: face.title })
        : t('watch:faces.deleteFromStorageOnly', { title: face.title }),
      confirmLabel: t('watch:faces.deleteFromPhone'),
      confirmVariant: 'destructive',
      cancelLabel: t('common:actions.cancel'),
      onConfirm: () => removeFromLibrary(face.id),
    });
  };

  const listMeta = list
    ? [
        list.width && list.height ? t('watch:faces.screenSize', { width: list.width, height: list.height }) : null,
        list.faces ? t('watch:faces.onWatchCount', { count: list.faces.length }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const header = (
    <View style={styles.header}>
      <Segmented options={tabOptions} value={tab} onChange={setTab} />

      {tab === 'installed' ? (
        !connected ? (
          <Notice icon="bluetooth" action={{ label: t('watch:openWatch'), onPress: () => router.navigate('/watch') }}>
            {t('watch:faces.connect')}
          </Notice>
        ) : null
      ) : (
        <Section title={t('watch:faces.personalLibrary')} icon="folder-open-outline">
          {canImport ? (
            <View style={styles.actionRow}>
              <Button
                label={t('watch:faces.importHwt')}
                variant="primary"
                icon="document-attach-outline"
                style={{ flex: 1 }}
                onPress={() => void handleImportToMyWatch()}
              />
            </View>
          ) : installFromFile ? (
            <View style={styles.actionRow}>
              <Button
                label={t('watch:faces.install')}
                variant="primary"
                icon="document-attach-outline"
                style={{ flex: 1 }}
                disabled={!connected || !idle}
                loading={installing}
                onPress={() => confirmUnsigned(() => void install())}
              />
            </View>
          ) : (
            <AppText variant="caption">{t('watch:faces.updateApp')}</AppText>
          )}
          <Details>{installFromFile ? t('watch:faces.installFromFileHint') : t('watch:faces.personalLibraryHint')}</Details>
        </Section>
      )}

      {canImport || installFromFile ? <HuaweiAccountSection /> : null}

      {tab === 'library' && canImport ? (
        <WebFacesSection
          state={web.state}
          faces={web.faces}
          installedFaces={list?.faces}
          connected={connected}
          idle={idle}
          downloadingId={web.downloadingId}
          downloadError={web.downloadError}
          onRetry={() => void web.reload()}
          onInstall={(face) => void handleInstallFromWeb(face)}
        />
      ) : null}

      {installing && progress ? (
        <View style={styles.progress}>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            style={[styles.track, { backgroundColor: colors.muted }]}>
            <View style={[styles.bar, { backgroundColor: colors.primary, width: `${percent}%` }]} />
          </View>
          <AppText variant="caption" muted>
            {progress.total > 0
              ? `Transferring: ${percent}% (${progress.bytes.toLocaleString()} of ${progress.total.toLocaleString()} bytes)`
              : t('watch:faces.waiting')}
          </AppText>
        </View>
      ) : null}
      {notice ? <Notice icon="checkmark-circle">{notice}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <View style={styles.listTitle}>
        <View style={styles.listTitleRow} accessibilityRole="header">
          <IconChip icon={tab === 'installed' ? 'watch' : 'folder'} size="sm" />
          <AppText variant="heading">
            {tab === 'installed' ? t('watch:faces.onWatch') : t('watch:faces.library')}
          </AppText>
        </View>
        {tab === 'installed' && listMeta ? (
          <AppText variant="caption" muted>
            {listMeta}
          </AppText>
        ) : null}
      </View>
      {tab === 'installed' && list ? <WatchStorageCard list={list} library={library} /> : null}
    </View>
  );

  const matchedPreview = previewFace ? findInstalledFace(previewFace, list?.faces) : undefined;

  const installedEmpty = (() => {
    if (list === null && !connected) {
      return (
        <Card>
          <EmptyState
            icon="watch"
            title={t('watch:faces.notConnected')}
            description={t('watch:faces.notConnectedHint')}
          />
        </Card>
      );
    }
    if (busy === 'list' && list === null) {
      return (
        <View style={styles.skeletons}>
          {SKELETON_ROWS.map((row) => (
            <FaceSkeleton key={row} />
          ))}
        </View>
      );
    }
    return (
      <Card>
        {list === null ? (
          <EmptyState
            icon="watch"
            title={t('watch:faces.notRead')}
            description={t('watch:faces.notReadHint')}
            action={{ label: t('watch:faces.read'), icon: 'refresh', onPress: () => void refresh() }}
          />
        ) : (
          <EmptyState
            icon="watch"
            title={t('watch:faces.none')}
            description={t('watch:faces.noneHint')}
          />
        )}
      </Card>
    );
  })();

  const libraryEmpty = (
    <Card>
      <EmptyState
        icon="folder"
        title={t('watch:faces.noSaved')}
        description={installFromFile ? t('watch:faces.noSavedHintIos') : t('watch:faces.noSavedHint')}
        action={
          canImport
            ? {
                label: t('watch:faces.importHwt'),
                icon: 'document-attach-outline',
                onPress: () => void handleImportToMyWatch(),
              }
            : installFromFile
              ? { label: t('watch:faces.install'), icon: 'document-attach-outline', onPress: () => confirmUnsigned(() => void install()) }
              : undefined
        }
      />
    </Card>
  );

  return (
    <>
      {tab === 'installed' ? (
        <FlatList
          style={{ backgroundColor: colors.background }}
          contentContainerStyle={padding}
          data={list?.faces ?? []}
          keyExtractor={(face) => face.id}
          ListHeaderComponent={header}
          ListEmptyComponent={installedEmpty}
          ItemSeparatorComponent={Separator}
          refreshControl={refreshControl}
          initialNumToRender={8}
          windowSize={7}
          maxToRenderPerBatch={8}
          removeClippedSubviews={Platform.OS === 'android'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item: face }) => (
            <InstalledFaceCard
              face={face}
              match={findFaceMatch(face, library)}
              screenWidth={list?.width}
              screenHeight={list?.height}
              busy={busy}
              connected={connected}
              idle={idle}
              onPreview={setPreviewFace}
              onSetActive={(id) => void setActive(id)}
              onCustomize={(id, name) =>
                router.push({ pathname: '/watch/face-edit', params: { id, name } }, OPEN_IN_STACK)
              }
              onDelete={confirmDeleteFromWatch}
            />
          )}
        />
      ) : (
        <FlatList
          style={{ backgroundColor: colors.background }}
          contentContainerStyle={padding}
          data={library}
          keyExtractor={(face) => face.id}
          ListHeaderComponent={header}
          ListEmptyComponent={libraryEmpty}
          ItemSeparatorComponent={Separator}
          refreshControl={refreshControl}
          initialNumToRender={8}
          windowSize={7}
          maxToRenderPerBatch={8}
          removeClippedSubviews={Platform.OS === 'android'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item: face }) => (
            <LibraryFaceCard
              face={face}
              matchedWatchFace={findInstalledFace(face, list?.faces)}
              screenWidth={list?.width}
              screenHeight={list?.height}
              busy={busy}
              connected={connected}
              idle={idle}
              installing={installing}
              installingUrl={installingUrl}
              onPreview={setPreviewFace}
              onSetActive={(id) => void setActive(id)}
              onInstall={handleInstall}
              onDelete={confirmDeleteFromLibrary}
            />
          )}
        />
      )}

      <WatchfacePreviewModal
        previewFace={previewFace}
        list={list}
        tab={tab}
        connected={connected}
        idle={idle}
        installing={installing}
        installingUrl={installingUrl}
        matchedFace={matchedPreview}
        onClose={() => setPreviewFace(null)}
        onInstall={handleInstall}
        onSetActive={(id) => void setActive(id)}
      />

      <ThemedDialog dialog={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  header: { gap: spacing.lg, marginBottom: spacing.md },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  listTitle: { gap: spacing.xs },
  listTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  separator: { height: spacing.md },
  skeletons: { gap: spacing.md },
  progress: { gap: spacing.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: 8, borderRadius: radius.pill },
});
