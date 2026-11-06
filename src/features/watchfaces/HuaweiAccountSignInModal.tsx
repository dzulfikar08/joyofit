import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { spacing, useColors } from '@/theme';
import { HuaweiWear, hasNative } from '@/wear';
import { extractUserIdFromCookies } from '@/features/watchfaces/huaweiAccount';

/**
 * Huawei Cloud. Signed out it sends you to the Huawei ID login and back; once signed in it sets the `userId` cookie, the account
 * id Gadgetbridge's guide copies by hand. The account centre (`id1.cloud.huawei.com`) does not set it, so it is not the start page.
 */
const SIGN_IN_URL = 'https://cloud.huawei.com/';

/**
 * A desktop browser identity. With a phone user agent, cloud.huawei.com's own script sends the page to `/wap`, a landing page with no
 * sign-in at all (seen 2026-11-06 in the app's WebView and in headless Chromium); with a desktop one it stays on the desktop page, whose
 * sign-in form sets `userId`. The WebView scales that page to the screen.
 */
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** Hosts whose cookies may carry `userId`. */
const COOKIE_URLS = ['https://cloud.huawei.com/', 'https://id1.cloud.huawei.com/', 'https://id7.cloud.huawei.com/', 'https://huawei.com/'];

const POLL_MS = 1500;

/**
 * Second route: posts `document.cookie` to the app on load and every 1.5 s. Only reads the cookie string, never form fields. It cannot
 * see HttpOnly cookies, which is why the native cookie store is read as well.
 */
const READ_COOKIE_JS = `(function(){
  function send(){ try { window.ReactNativeWebView.postMessage(document.cookie || ''); } catch (e) {} }
  send();
  setInterval(send, ${POLL_MS});
  true;
})();`;

interface Props {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** The footer button: close this and open the manual entry field. */
  readonly onManual: () => void;
  /** Called with the validated account id once it is seen in the cookies. */
  readonly onCapture: (id: string) => void;
}

export function HuaweiAccountSignInModal({ visible, onClose, onManual, onCapture }: Props) {
  const { t } = useTranslation(['watch', 'common']);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const captured = useRef(false);

  const accept = useCallback(
    (cookies: string) => {
      if (captured.current) return;
      const result = extractUserIdFromCookies(cookies);
      if (result.ok) {
        captured.current = true;
        onCapture(result.id);
      }
    },
    [onCapture],
  );

  /** Reads the WebView's cookie store natively (HttpOnly included) for every Huawei host that may hold `userId`. */
  const readNative = useCallback(async () => {
    if (captured.current || !hasNative('readWebCookies')) return;
    for (const url of COOKIE_URLS) {
      try {
        accept(await HuaweiWear.readWebCookies(url));
      } catch {
        // A store that cannot be read leaves the JavaScript route and manual entry.
      }
      if (captured.current) return;
    }
  }, [accept]);

  useEffect(() => {
    if (!visible) return;
    captured.current = false;
    void readNative();
    const id = setInterval(() => void readNative(), POLL_MS);
    return () => clearInterval(id);
  }, [visible, readNative]);

  const onMessage = (event: WebViewMessageEvent) => accept(event.nativeEvent.data);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
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
          userAgent={DESKTOP_USER_AGENT}
          injectedJavaScript={READ_COOKIE_JS}
          onMessage={onMessage}
          onLoadEnd={() => void readNative()}
          onNavigationStateChange={() => void readNative()}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          incognito={false}
          startInLoadingState
          renderLoading={() => (
            <View style={[styles.loading, { backgroundColor: colors.background }]}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
          style={styles.web}
        />
        <View style={[styles.footer, { borderTopColor: colors.hairline }]}>
          <Button label={t('watch:faces.account.enterManually')} variant="ghost" onPress={onManual} />
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
  loading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  footer: { padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
