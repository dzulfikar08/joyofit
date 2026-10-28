import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Screen';
import {
  ActivePill,
  FactoryThumbnail,
  WatchThumbnail,
} from '@/features/watchfaces/WatchThumbnail';
import { resolveCategory, type WatchfaceItem } from '@/features/watchfaces/watchfaceModel';
import type { WatchfaceBusy } from '@/features/watchfaces/useWatchfaces';
import { spacing } from '@/theme';
import type { WatchfaceInfo } from '@/wear';

interface InstalledFaceCardProps {
  readonly face: WatchfaceInfo;
  readonly match?: WatchfaceItem;
  readonly screenWidth?: number | null;
  readonly screenHeight?: number | null;
  readonly busy: WatchfaceBusy;
  readonly connected: boolean;
  readonly idle: boolean;
  readonly onPreview: (item: WatchfaceItem) => void;
  readonly onSetActive: (id: string) => void;
  readonly onCustomize: (id: string, name: string) => void;
  readonly onDelete: (face: WatchfaceInfo) => void;
}

/** Card rendering an installed hardware watchface on the connected watch. */
export const InstalledFaceCard = memo(function InstalledFaceCard({
  face,
  match,
  screenWidth,
  screenHeight,
  busy,
  connected,
  idle,
  onPreview,
  onSetActive,
  onCustomize,
  onDelete,
}: InstalledFaceCardProps) {
  const { t } = useTranslation(['watch', 'common']);
  const working = typeof busy === 'object' && busy !== null && busy.id === face.id;
  const action = typeof busy === 'object' && busy !== null ? busy.action : null;

  const displayTitle = match
    ? match.title
    : face.factory
      ? `Firmware Face ${face.id}`
      : `Watch Face ${face.name}`;
  const displayAuthor = match
    ? match.author
    : face.factory
      ? t('watch:faces.builtInAuthor')
      : 'Custom Watchface';

  const previewTarget: WatchfaceItem = match ?? {
    id: face.id,
    title: displayTitle,
    author: displayAuthor,
    width: screenWidth ?? 194,
    height: screenHeight ?? 368,
    sizeLabel: 'Installed',
    description: face.factory
      ? 'Preinstalled firmware watch face on your watch hardware.'
      : `Watch face installed on your watch (ID ${face.id}).`,
    downloadUrl: '',
    category: resolveCategory(screenWidth ?? 194),
    savedAt: Date.now(),
  };

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Preview ${displayTitle}`}
        onPress={() => onPreview(previewTarget)}
        style={styles.cardHeaderPressable}>
        {match?.previewUrl ? (
          <WatchThumbnail face={match} active={face.active} />
        ) : (
          <FactoryThumbnail
            face={face}
            active={face.active}
            screenWidth={screenWidth}
            screenHeight={screenHeight}
          />
        )}
        <View style={styles.faceText}>
          <View style={styles.titleLine}>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {displayTitle}
            </AppText>
            {face.active ? <ActivePill /> : null}
          </View>
          <AppText variant="caption" muted>
            {match ? `by ${match.author} · ` : ''}ID {face.id} v{face.version}
            {face.factory ? ' · preinstalled' : ''}
            {face.tryout ? ' · trial' : ''}
            {face.photo ? ' · photo' : ''}
          </AppText>
        </View>
      </Pressable>
      {previewTarget.description ? (
        <AppText variant="caption">{previewTarget.description}</AppText>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={face.active ? t('watch:faces.active') : t('watch:faces.setActive')}
          icon={face.active ? 'checkmark-circle' : 'checkmark-circle-outline'}
          variant={face.active ? 'secondary' : 'primary'}
          disabled={!connected || !idle || face.active}
          loading={working && action === 'activate'}
          onPress={() => onSetActive(face.id)}
        />
        {face.editable ? (
          <Button
            label={t('watch:faces.customize')}
            icon="color-palette"
            disabled={!connected || !idle}
            onPress={() => onCustomize(face.id, face.name)}
          />
        ) : null}
        {!face.factory ? (
          <Button
            label={t('common:actions.delete')}
            icon="trash-outline"
            variant="destructive"
            disabled={!connected || !idle}
            loading={working && action === 'delete'}
            onPress={() => onDelete(face)}
          />
        ) : null}
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  cardHeaderPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  faceText: {
    flex: 1,
    gap: 2,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
