import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { overlay, spacing, useTheme } from '@/theme';

import { MAX_NAME_LENGTH } from '../routineEdit';

interface RoutineNameDialogProps {
  visible: boolean;
  title: string;
  placeholder: string;
  confirmLabel: string;
  /** The name to start from (a rename), or an empty string. */
  initial: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

/** A small dialog with one text field, for a folder's name. The card sits in the upper part of the screen so the keyboard never covers it. */
export function RoutineNameDialog({ visible, title, placeholder, confirmLabel, initial, onConfirm, onCancel }: RoutineNameDialogProps) {
  const { t } = useTranslation('common');
  const { colors, radius } = useTheme();
  const [text, setText] = useState(initial);
  // Opening, or a new starting name, puts the starting name in the field.
  const [seen, setSeen] = useState({ visible, initial });
  if (seen.visible !== visible || seen.initial !== initial) {
    setSeen({ visible, initial });
    if (visible) setText(initial);
  }
  const name = text.trim();
  const confirm = () => {
    if (name.length > 0) onConfirm(name);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={t('actions.cancel')}>
        <Pressable
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.hairline, borderRadius: radius.card }]}
          onPress={() => {}}>
          <AppText variant="heading" accessibilityRole="header">
            {title}
          </AppText>
          <Input
            autoFocus
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            accessibilityLabel={title}
            maxLength={MAX_NAME_LENGTH}
            returnKeyType="done"
            onSubmitEditing={confirm}
          />
          <View style={styles.actions}>
            <Button label={confirmLabel} variant="primary" disabled={name.length === 0} onPress={confirm} />
            <Button label={t('actions.cancel')} onPress={onCancel} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: overlay.scrim, justifyContent: 'flex-start', paddingTop: '22%', paddingHorizontal: spacing.lg },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  actions: { gap: spacing.sm, paddingTop: spacing.xs },
});
