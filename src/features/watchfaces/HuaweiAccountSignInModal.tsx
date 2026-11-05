import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { spacing, useColors } from '@/theme';
import { extractUserIdFromCookies } from '@/features/watchfaces/huaweiAccount';

/** Huawei account centre. Signing in here sets the `userId` cookie we read. */
const SIGN_IN_URL = 'https://id1.cloud.huawei.com/CAS/portal/userCenter/index.html';

/**
 * Posts `document.cookie` to the app on load and every 1.5 s after, so we catch the `userId` cookie once the user has signed in. Only
 * reads the cookie string; it never touches the password field. If Huawei marks `userId` httpOnly it will not appear here, and the
 * caller's manual-entry fallback is used instead.
 */
const READ_COOKIE_JS = `(function(){
  function send(){ try { window.ReactNativeWebView.postMessage(document.cookie || ''); } catch (e) {} }
  send();
  setInterval(send, 1500);
  true;
})();`;

interface Props {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** Called with the validated 17-18 digit account id once it is seen in the cookies. */
  readonly onCapture: (id: string) => void;
}

export function HuaweiAccountSignInModal({ visible, onClose, onCapture }: Props) {
  const { t } = useTranslation(['watch', 'common']);
  const colors = useColors();
  const captured = useRef(false);

  const onMessage = (event: WebViewMessageEvent) => {
    if (captured.current) return;
    const result = extractUserIdFromCookies(event.nativeEvent.data);
    if (result.ok) {
      captured.current = true;
      onCapture(result.id);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => (captured.current = false)}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.hairline }]}>
          <AppText variant="heading" style={styles.title}>
            {t('watch:faces.account.signInTitle')}
          </AppText>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common:actions.close')} onPress={onClose} hitSlop={12}>
            <AppText variant="body" style={{ color: colors.primary }}>
              {t('common:actions.close')}
            </AppText>
          </Pressable>
        </View>
        <AppText variant="caption" muted style={styles.hint}>
          {t('watch:faces.account.signInHint')}
        </AppText>
        <WebView
          source={{ uri: SIGN_IN_URL }}
          injectedJavaScript={READ_COOKIE_JS}
          onMessage={onMessage}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          incognito={false}
          style={styles.web}
        />
        <View style={[styles.footer, { borderTopColor: colors.hairline }]}>
          <Button label={t('watch:faces.account.enterManually')} variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1 },
  hint: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  web: { flex: 1 },
  footer: { padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
