import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { overlay, spacing, useTheme } from '@/theme';

export interface AppAlertButton {
  text: string;
  /** `cancel` is the way out (also Back and a tap outside); `destructive` paints the button red. */
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface Pending {
  title: string;
  message?: string;
  buttons?: readonly AppAlertButton[];
}

// One alert at a time, later ones wait their turn, like the system dialog they replace.
let queue: readonly Pending[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * The app's styled dialog for code outside a screen's own state (providers, callbacks): same arguments as `Alert.alert`,
 * drawn like `ConfirmDialog` by the `AppAlertHost` mounted at the root. Without buttons it shows a single OK.
 */
export function appAlert(title: string, message?: string, buttons?: readonly AppAlertButton[]): void {
  queue = [...queue, { title, message, buttons }];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function current(): Pending | undefined {
  return queue[0];
}

function close(then?: () => void) {
  queue = queue.slice(1);
  emit();
  then?.();
}

/** Renders the alert at the head of the queue. Mount once, inside the theme and i18n providers. */
export function AppAlertHost() {
  const alert = useSyncExternalStore(subscribe, current, current);
  const { t } = useTranslation('common');
  const { colors, radius } = useTheme();
  if (!alert) return null;
  const buttons = alert.buttons?.length ? alert.buttons : [{ text: t('actions.ok') }];
  const cancel = buttons.find((b) => b.style === 'cancel');
  // The recommended answer first, the way out last: the same order as ConfirmDialog and ChoiceDialog.
  const ordered = [...buttons.filter((b) => b.style !== 'cancel'), ...(cancel ? [cancel] : [])];
  const primaryIndex = ordered.findIndex((b) => b.style !== 'cancel');
  const dismiss = () => close(cancel?.onPress);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={cancel ? dismiss : undefined} accessibilityLabel={cancel?.text}>
        {/* A press on the card itself must not reach the scrim. */}
        <Pressable
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.hairline, borderRadius: radius.card }]}
          onPress={() => {}}>
          <AppText variant="heading" accessibilityRole="header">
            {alert.title}
          </AppText>
          {alert.message ? <AppText variant="body">{alert.message}</AppText> : null}
          <View style={styles.actions}>
            {ordered.map((button, i) => (
              <Button
                key={`${i}:${button.text}`}
                label={button.text}
                lines={2}
                variant={button.style === 'destructive' ? 'destructive' : i === primaryIndex ? 'primary' : 'secondary'}
                onPress={() => close(button.onPress)}
              />
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: overlay.scrim, justifyContent: 'center', padding: spacing.lg },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
});
