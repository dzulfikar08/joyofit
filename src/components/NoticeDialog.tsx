import { useCallback, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { overlay, spacing, useTheme } from '@/theme';

interface NoticeDialogProps {
  visible: boolean;
  title: string;
  message: string;
  /** The one button; it always carries on to what the notice announces. */
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * A centered card with one button and no way out: a tap outside does nothing and Back counts as the button. For the explanation shown
 * before a system permission request (Apple 5.1.1(iv): the person must always proceed to the system prompt, so there is no Cancel or
 * "Not now"). A decision that may be refused (data consent, a purchase) uses `ConfirmDialog`.
 */
export function NoticeDialog({ visible, title, message, confirmLabel, onConfirm }: NoticeDialogProps) {
  const { colors, radius } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onConfirm} statusBarTranslucent>
      <View style={styles.scrim}>
        <View
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.hairline, borderRadius: radius.card }]}>
          <AppText variant="heading" accessibilityRole="header">
            {title}
          </AppText>
          <AppText variant="body">{message}</AppText>
          <View style={styles.actions}>
            <Button label={confirmLabel} onPress={onConfirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * State for a {@link NoticeDialog}: `show(request)` resolves once the person pressed its button, `request` is what to render while it is
 * open (null when closed), `done` is the button's handler.
 */
export function useNotice<T>() {
  const [request, setRequest] = useState<T | null>(null);
  const resolver = useRef<(() => void) | null>(null);
  const show = useCallback((next: T): Promise<void> => {
    resolver.current?.();
    return new Promise<void>((resolve) => {
      resolver.current = resolve;
      setRequest(next);
    });
  }, []);
  const done = useCallback(() => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.();
  }, []);
  return { request, show, done };
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: overlay.scrim, justifyContent: 'center', padding: spacing.lg },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
});
