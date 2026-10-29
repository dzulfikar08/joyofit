import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { rogo, type RogoAttachable } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { IconChip } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { Notice, Skeleton } from '@/components/States';
import { CommentAttachmentCard } from '@/features/social/CommentAttachmentCard';
import { ATTACHMENT_ICON, ATTACH_KINDS, attachmentTitle } from '@/features/social/commentAttachment';
import { ownPhotoUrl } from '@/features/social/commentPhotoUrl';
import { BottomSheet } from '@/features/strength/ui/Sheet';
import { errorMessage } from '@/format';
import { HIT, spacing } from '@/theme';

type Kind = (typeof ATTACH_KINDS)[number];

interface AttachSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The person chose the gallery; the screen opens the picker once this sheet is gone. */
  onPickPhoto: () => void;
  /** The person chose one of their own items. */
  onPickItem: (item: RogoAttachable) => void;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: RogoAttachable[] };

/**
 * "Lampirkan": a photo from the gallery, or "Dari aplikasi": the person's own recent workouts, routes, meals, weigh-ins and
 * weekly recaps, as JoyoRogo lists them for the account. Each item shows the preview other people will see.
 */
export function AttachSheet({ visible, onClose, onPickPhoto, onPickItem }: AttachSheetProps) {
  const { t } = useTranslation('social');
  const [kind, setKind] = useState<Kind>('workout');
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  // A new request (opened, or another kind) shows loading until its answer arrives.
  const [seen, setSeen] = useState({ visible, kind });
  if (seen.visible !== visible || seen.kind !== kind) {
    setSeen({ visible, kind });
    if (visible) setLoad({ status: 'loading' });
  }

  useEffect(() => {
    if (!visible) return;
    let live = true;
    rogo.social.commentAttachables(kind).then(
      (answer) => live && setLoad({ status: 'ready', items: answer.items }),
      (e: unknown) => live && setLoad({ status: 'error', message: errorMessage(e) }),
    );
    return () => {
      live = false;
    };
  }, [visible, kind]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('comments.attach.title')}>
      <PressableScale accessibilityRole="button" accessibilityLabel={t('comments.attach.photo')} onPress={onPickPhoto} style={styles.row}>
        <IconChip icon={ATTACHMENT_ICON.image} tint="link" size="sm" />
        <AppText variant="bodyStrong" style={styles.rowLabel}>
          {t('comments.attach.photo')}
        </AppText>
      </PressableScale>

      <AppText variant="label" muted accessibilityRole="header">
        {t('comments.attach.fromApp')}
      </AppText>
      <View style={styles.chips}>
        {ATTACH_KINDS.map((k) => (
          <Chip key={k} label={t(`comments.attach.kind.${k}`)} selected={kind === k} onPress={() => setKind(k)} role="radio" />
        ))}
      </View>

      {load.status === 'loading' ? (
        <Skeleton width="100%" height={72} radius="card" />
      ) : load.status === 'error' ? (
        <Notice tone="danger">{load.message}</Notice>
      ) : load.items.length === 0 ? (
        <AppText variant="caption" muted>
          {t('comments.attach.emptyList')}
        </AppText>
      ) : (
        load.items.map((item) => (
          <PressableScale
            key={`${item.kind}:${item.refId}`}
            accessibilityRole="button"
            accessibilityLabel={t('comments.attach.pick', { title: attachmentTitle(item.preview) })}
            onPress={() => onPickItem(item)}>
            <View pointerEvents="none">
              <CommentAttachmentCard attachment={item.preview} photo={item.photoId ? { uri: ownPhotoUrl(item.photoId), local: false } : null} />
            </View>
          </PressableScale>
        ))
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowLabel: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
