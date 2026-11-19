import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { HeaderBackButton } from '@/components/HiddenTabHeader';
import { Card, Divider, Screen } from '@/components/Screen';
import { PRIVACY_URL } from '@/features/pro/billingCore';
import { getLocale } from '@/i18n';
import { spacing, useColors } from '@/theme';
import { HOSTED_CONSENT_CATEGORIES, HOSTED_PRIVACY_ANCHOR } from '../hostedConsent';

/** The privacy policy at the section that describes the hosted Joyo AI, in the language of the app. */
export const hostedPrivacyUrl = (): string => `${PRIVACY_URL}#${getLocale() === 'en' ? HOSTED_PRIVACY_ANCHOR.en : HOSTED_PRIVACY_ANCHOR.id}`;

/**
 * What the person agrees to before JoyoFit sends anything to the hosted Joyo AI (Apple 5.1.1(i), 5.1.2(i)): who receives the data, every
 * kind of data one question carries, what is never sent, why and how long, and the privacy policy. The list is
 * `HOSTED_CONSENT_CATEGORIES`, tied to `HOSTED_CONSENT_VERSION`. The buttons belong to the caller.
 */
export function HostedConsentDetails() {
  const { t } = useTranslation('ai');
  return (
    <View style={styles.wrap}>
      <AppText variant="caption" muted>
        {t('hosted.intro')}
      </AppText>
      <AppText variant="bodyStrong">{t('hosted.toTitle')}</AppText>
      <AppText variant="caption">{t('hosted.to')}</AppText>
      <Divider />
      <AppText variant="bodyStrong">{t('hosted.lead')}</AppText>
      <View style={styles.list}>
        {HOSTED_CONSENT_CATEGORIES.map((id) => (
          <AppText key={id} variant="caption">
            {`\u2022 ${t(`hosted.data.${id}`)}`}
          </AppText>
        ))}
      </View>
      <Divider />
      <AppText variant="bodyStrong">{t('hosted.notSentTitle')}</AppText>
      <AppText variant="caption" muted>
        {t('hosted.notSent')}
      </AppText>
      <AppText variant="bodyStrong">{t('hosted.whyTitle')}</AppText>
      <AppText variant="caption" muted>
        {t('hosted.why')}
      </AppText>
      <AppText variant="caption" muted>
        {t('hosted.choice')}
      </AppText>
      <Button label={t('hosted.privacy')} variant="ghost" icon="shield-checkmark-outline" onPress={() => void Linking.openURL(hostedPrivacyUrl())} />
    </View>
  );
}

interface HostedConsentCardProps {
  onAgree: () => void;
  onLater: () => void;
}

/** The consent with its two answers: Agree (carry on) and Not now (nothing is sent, the chat stays closed). */
export function HostedConsentCard({ onAgree, onLater }: HostedConsentCardProps) {
  const { t } = useTranslation('ai');
  return (
    <View style={styles.wrap}>
      <AppText variant="heading" accessibilityRole="header">
        {t('hosted.title')}
      </AppText>
      <HostedConsentDetails />
      <Button label={t('hosted.agree')} variant="primary" icon="checkmark" onPress={onAgree} />
      <Button label={t('hosted.later')} variant="secondary" onPress={onLater} />
    </View>
  );
}

/**
 * The whole Joyo AI chat screen while the hosted engine would answer and this phone has no yes (`chatGate` = `rogoConsent`): no
 * conversation, no history, no input field, only the question "allow?", what is sent, to whom, why, and Allow / Not now pinned at the
 * bottom. Every way into the chat (Today, Workouts, a workout or a night, Coach, Settings, the chat history) reaches this before the first
 * hosted request (Apple 5.1.1(i), 5.1.2(i)).
 */
export function HostedConsentGate({ onAllow, onNotNow }: { onAllow: () => void; onNotNow: () => void }) {
  const { t } = useTranslation('ai');
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs, backgroundColor: colors.background }]}>
        <HeaderBackButton />
        <AppText variant="bodyStrong" numberOfLines={1} style={styles.headerTitle}>
          {t('hosted.screenTitle')}
        </AppText>
      </View>
      <Screen
        footer={
          <View style={styles.footer}>
            <Button label={t('hosted.agree')} variant="primary" icon="checkmark" onPress={onAllow} />
            <Button label={t('hosted.later')} variant="secondary" onPress={onNotNow} />
          </View>
        }>
        <View style={styles.hero}>
          <Ionicons name="shield-checkmark" size={36} color={colors.primary} accessibilityElementsHidden importantForAccessibility="no" />
          <AppText variant="heading" accessibilityRole="header">
            {t('hosted.title')}
          </AppText>
        </View>
        <Card>
          <HostedConsentDetails />
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  list: { gap: spacing.xs },
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  headerTitle: { flex: 1, minWidth: 0 },
  hero: { gap: spacing.sm, paddingBottom: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.sm },
});
