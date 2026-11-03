import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { isPermissionError, isUploadedAvatar, type AvatarUploadInput } from '@/cloud/avatar';
import { authClient } from '@/cloud/auth';
import { rogo } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NoticeDialog } from '@/components/NoticeDialog';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { errorMessage } from '@/format';
import { pickAvatar } from '@/features/settings/pickAvatar';
import { spacing } from '@/theme';

interface ProfilePhotoProps {
  /** Shows the short confirmation toast the screen owns. */
  onNotify: (text: string) => void;
}

/** What went wrong, as the notice under the photo says it: no access to the gallery (with the way to the settings), or a message. */
type Problem = { denied: true } | { denied: false; text: string };

/**
 * The profile photo of the signed-in JoyoRogo account: its picture, name and email, "Change photo" and, for a photo that was
 * uploaded (a Google photo cannot be removed), "Remove photo". "Change photo" explains first what happens to the photo, in a notice
 * whose one button always opens the gallery (no Cancel before the phone's photo access; the person can still back out of the gallery
 * itself and nothing is sent until a photo is picked). The picked photo goes up through `avatar.upload`, then the session is read again so the
 * Settings hub, the Social profile and every post, comment and group member show it at once. Renders nothing signed out.
 */
export function ProfilePhoto({ onNotify }: ProfilePhotoProps) {
  const { t } = useTranslation('settings');
  const session = authClient.useSession();
  const user = session.data?.user;
  const [explaining, setExplaining] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  if (!user) return null;
  const name = user.name?.trim() ?? '';

  // JoyoRogo keeps the session in a cookie cache for 5 minutes; skipping it is what shows the new photo now, not then.
  const refreshSession = () => session.refetch({ query: { disableCookieCache: true } });

  const choose = async () => {
    setExplaining(false);
    setProblem(null);
    setBusy('upload');
    try {
      let input: AvatarUploadInput | null;
      try {
        input = await pickAvatar();
      } catch (e) {
        setProblem(isPermissionError(e) ? { denied: true } : { denied: false, text: t('account.photo.error.process', { error: errorMessage(e) }) });
        return;
      }
      // Backing out of the gallery is not an error.
      if (!input) return;
      try {
        await rogo.avatar.upload(input);
      } catch (e) {
        setProblem({ denied: false, text: t('account.photo.error.upload', { error: errorMessage(e) }) });
        return;
      }
      await refreshSession();
      onNotify(t('account.photo.updated'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setConfirmingRemove(false);
    setProblem(null);
    setBusy('remove');
    try {
      await rogo.avatar.remove();
      await refreshSession();
      onNotify(t('account.photo.removed'));
    } catch (e) {
      setProblem({ denied: false, text: t('account.photo.error.remove', { error: errorMessage(e) }) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title={t('account.photo.title')} icon="person-circle">
      <View style={styles.identity}>
        <Avatar name={name || user.email} image={user.image} size="xl" />
        <View style={styles.text}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {name || user.email}
          </AppText>
          {name ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {user.email}
            </AppText>
          ) : null}
        </View>
      </View>
      {problem ? (
        <Notice
          tone="danger"
          action={problem.denied ? { label: t('account.photo.openSettings'), onPress: () => void Linking.openSettings() } : undefined}>
          {problem.denied ? t('account.photo.denied') : problem.text}
        </Notice>
      ) : null}
      <Button
        label={t('account.photo.change')}
        icon="image"
        loading={busy === 'upload'}
        disabled={busy !== null}
        onPress={() => setExplaining(true)}
      />
      {isUploadedAvatar(user.image) ? (
        <Button
          label={t('account.photo.remove')}
          icon="trash"
          variant="destructive"
          loading={busy === 'remove'}
          disabled={busy !== null}
          onPress={() => setConfirmingRemove(true)}
        />
      ) : null}
      <NoticeDialog
        visible={explaining}
        title={t('account.photo.askTitle')}
        message={t('account.photo.askBody')}
        confirmLabel={t('account.photo.continue')}
        onConfirm={() => void choose()}
      />
      <ConfirmDialog
        visible={confirmingRemove}
        title={t('account.photo.removeTitle')}
        message={t('account.photo.removeBody')}
        confirmLabel={t('account.photo.remove')}
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirmingRemove(false)}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 1 },
});
