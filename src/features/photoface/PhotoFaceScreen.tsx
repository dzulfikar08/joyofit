import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Image, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { Card, Section, useContentPadding, useRefreshControl } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { CropEditor } from '@/features/photoface/CropEditor';
import { usePhotoFace } from '@/features/photoface/usePhotoFace';
import { fmtInt } from '@/i18n';
import { radius, spacing, tintColors, useColors, useTheme } from '@/theme';
import type { PhotoFacePhoto } from '@/wear';

/** One photo of the face: the local copy when this phone uploaded it, otherwise a labelled stand-in. */
function PhotoTile({
  photo,
  ratio,
  disabled,
  deleting,
  onDelete,
}: {
  photo: PhotoFacePhoto;
  ratio: number;
  disabled: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const { t } = useTranslation('watch');
  const { colors, radius: themeRadius } = useTheme();
  return (
    <View style={styles.tile}>
      <View style={[styles.thumb, { aspectRatio: ratio, backgroundColor: colors.muted, borderRadius: themeRadius.tile }]}>
        {photo.uri ? (
          <Image source={{ uri: photo.uri }} style={styles.fill} resizeMode="cover" accessibilityLabel={t('photo.photoA11y', { n: photo.index })} />
        ) : (
          <View style={styles.standIn}>
            <IconChip icon="image" />
            <AppText variant="caption" muted style={styles.centered}>
              {t('photo.noPreview')}
            </AppText>
          </View>
        )}
      </View>
      <Button
        label={t('photo.deleteN', { n: photo.index })}
        icon="trash"
        variant="destructive"
        disabled={disabled}
        loading={deleting}
        onPress={onDelete}
      />
    </View>
  );
}

/** Adds, lists and deletes the photos of the watch's photo face. */
export function PhotoFaceScreen() {
  const router = useRouter();
  const { t } = useTranslation(['watch', 'common']);
  const colors = useColors();
  const padding = useContentPadding(false);
  const { connected, face, busy, error, notice, progress, cropSource, cancelCrop, refresh, activate, remove, pick, sendCrop } =
    usePhotoFace();
  const refreshControl = useRefreshControl({ refreshing: busy === 'read', onRefresh: () => void refresh(), enabled: connected });
  const idle = busy === null;
  const full = face !== null && face.maxPhotos > 0 && face.photos.length >= face.maxPhotos;
  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.bytes / progress.total) * 100)) : 0;
  const link = tintColors(colors, 'link');

  // Deleting re-applies the photo face (it becomes the watch's face) unless that empties a face that is not on the screen.
  const confirmDelete = (photo: PhotoFacePhoto) => {
    const switches = face !== null && !face.face.active && face.photos.length > 1;
    Alert.alert(
      t('watch:photo.deleteTitle'),
      t(switches ? 'watch:photo.deleteMessageSwitch' : 'watch:photo.deleteMessage', { n: photo.index }),
      [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('common:actions.delete'), style: 'destructive', onPress: () => void remove(photo.name) },
      ],
    );
  };

  return (
    <>
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[padding, styles.content]}
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}>
        <Section title={t('watch:photo.title')} icon="images">
          {!connected ? (
            <Notice icon="bluetooth" action={{ label: t('watch:openWatch'), onPress: () => router.navigate('/watch') }}>
              {t('watch:photo.connect')}
            </Notice>
          ) : null}
          {busy === 'read' && face === null ? (
            <View style={styles.skeletons}>
              <Skeleton width="60%" height={18} />
              <Skeleton width="40%" height={13} />
            </View>
          ) : null}
          {face ? (
            <>
              <View style={styles.faceHeader}>
                <View style={styles.faceText}>
                  <AppText variant="bodyStrong" numberOfLines={2}>
                    {face.face.name}
                  </AppText>
                  <AppText variant="caption" muted>
                    {t('watch:photo.summary', { used: face.photos.length, max: face.maxPhotos, width: face.width, height: face.height })}
                  </AppText>
                </View>
                {face.face.active ? (
                  <View style={[styles.pill, { backgroundColor: link.soft }]}>
                    <AppText variant="label" color={link.text}>
                      {t('watch:faces.active')}
                    </AppText>
                  </View>
                ) : null}
              </View>
              <View style={styles.actions}>
                <Button
                  label={t('watch:photo.add')}
                  icon="add-circle"
                  variant="primary"
                  disabled={!connected || !idle || full}
                  loading={busy === 'prepare'}
                  onPress={() => void pick()}
                />
                {!face.face.active ? (
                  <Button
                    label={t('watch:photo.show')}
                    icon="checkmark-circle"
                    disabled={!connected || !idle}
                    loading={busy === 'activate'}
                    onPress={() => void activate()}
                  />
                ) : null}
              </View>
              {full ? <AppText variant="caption" muted>{t('watch:photo.full', { max: face.maxPhotos })}</AppText> : null}
            </>
          ) : null}
          {busy === 'send' && progress ? (
            <View style={styles.progress}>
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: percent }}
                style={[styles.track, { backgroundColor: colors.muted }]}>
                <View style={[styles.bar, { backgroundColor: colors.primary, width: `${percent}%` }]} />
              </View>
              <AppText variant="caption" muted>
                {progress.total > 0
                  ? t('watch:faces.progress', { percent: fmtInt(percent), bytes: fmtInt(progress.bytes), total: fmtInt(progress.total) })
                  : t('watch:photo.waiting')}
              </AppText>
            </View>
          ) : null}
          {notice ? <Notice icon="checkmark-circle">{notice}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </Section>

        {face ? (
          <Section title={t('watch:photo.listTitle')} icon="image">
            {face.photos.length === 0 ? (
              <EmptyState
                icon="image"
                title={t('watch:photo.none')}
                description={t('watch:photo.noneHint')}
              />
            ) : (
              <View style={styles.grid}>
                {face.photos.map((photo) => (
                  <PhotoTile
                    key={photo.name}
                    photo={photo}
                    ratio={face.width / face.height}
                    disabled={!connected || !idle}
                    deleting={typeof busy === 'object' && busy !== null && busy.name === photo.name}
                    onDelete={() => confirmDelete(photo)}
                  />
                ))}
              </View>
            )}
          </Section>
        ) : (
          <Card>
            <EmptyState
              icon="images"
              title={connected ? t('watch:photo.notRead') : t('watch:faces.notConnected')}
              description={
                connected
                  ? t('watch:photo.notReadHint')
                  : t('watch:photo.notConnectedHint')
              }
              action={connected ? { label: t('watch:faces.read'), icon: 'refresh', onPress: () => void refresh() } : undefined}
            />
          </Card>
        )}
      </ScrollView>

      <CropEditor
        source={cropSource}
        target={{ width: face?.width ?? 408, height: face?.height ?? 480 }}
        busy={busy === 'send'}
        onCancel={cancelCrop}
        onConfirm={(rect) => void sendCrop(rect)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  skeletons: { gap: spacing.sm },
  faceHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  faceText: { flex: 1, gap: 2 },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  progress: { gap: spacing.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: 8, borderRadius: radius.pill },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { width: '47%', flexGrow: 1, gap: spacing.sm },
  thumb: { width: '100%', overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  standIn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md },
  centered: { textAlign: 'center' },
});
