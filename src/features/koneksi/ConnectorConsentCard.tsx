import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider } from '@/components/Screen';
import { PRIVACY_URL } from '@/features/pro/billingCore';
import { getLocale } from '@/i18n';
import { spacing } from '@/theme';
import { CONNECTOR_CONSENT_SCOPES, CONNECTOR_PRIVACY_ANCHOR } from './consent';
import { mcpScopeKey } from './scopes';

/** The privacy policy at the section that describes the AI connector, in the language of the app. */
export const connectorPrivacyUrl = (): string =>
  `${PRIVACY_URL}#${getLocale() === 'en' ? CONNECTOR_PRIVACY_ANCHOR.en : CONNECTOR_PRIVACY_ANCHOR.id}`;

/**
 * What the person agrees to before JoyoFit shows the AI connector address (Apple 5.1.1(i), 5.1.2(i)): who receives the data, every kind
 * of data a connected AI app can read (`CONNECTOR_CONSENT_SCOPES`, tied to `CONNECTOR_CONSENT_VERSION`), when it is read, what is never
 * shared, how to withdraw, and the privacy policy. Same structure as the hosted Joyo AI consent (`ai/ui/HostedConsentCard`). The buttons
 * belong to the caller.
 */
export function ConnectorConsentDetails() {
  const { t } = useTranslation('koneksi');
  return (
    <View style={styles.wrap}>
      <AppText variant="caption" muted>
        {t('consent.intro')}
      </AppText>
      <AppText variant="bodyStrong">{t('consent.toTitle')}</AppText>
      <AppText variant="caption">{t('consent.to')}</AppText>
      <Divider />
      <AppText variant="bodyStrong">{t('consent.lead')}</AppText>
      <View style={styles.list}>
        {CONNECTOR_CONSENT_SCOPES.map((scope) => {
          const key = mcpScopeKey(scope);
          return (
            <AppText key={scope} variant="caption">
              {`\u2022 ${t(`scope.${key}.label`)}: ${t(`scope.${key}.desc`)}`}
            </AppText>
          );
        })}
      </View>
      <Divider />
      <AppText variant="bodyStrong">{t('consent.howTitle')}</AppText>
      <AppText variant="caption" muted>
        {t('consent.how')}
      </AppText>
      <AppText variant="bodyStrong">{t('consent.notSentTitle')}</AppText>
      <AppText variant="caption" muted>
        {t('consent.notSent')}
      </AppText>
      <AppText variant="caption" muted>
        {t('consent.choice')}
      </AppText>
      <Button label={t('consent.privacy')} variant="ghost" icon="shield-checkmark-outline" onPress={() => void Linking.openURL(connectorPrivacyUrl())} />
    </View>
  );
}

interface ConnectorConsentCardProps {
  onAgree: () => void;
  onLater: () => void;
}

/** The consent with its two answers: Agree (the address appears) and Not now (the address stays hidden). */
export function ConnectorConsentCard({ onAgree, onLater }: ConnectorConsentCardProps) {
  const { t } = useTranslation('koneksi');
  return (
    <View style={styles.wrap}>
      <AppText variant="heading" accessibilityRole="header">
        {t('consent.title')}
      </AppText>
      <ConnectorConsentDetails />
      <Button label={t('consent.agree')} variant="primary" icon="checkmark" onPress={onAgree} />
      <Button label={t('consent.later')} variant="secondary" onPress={onLater} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  list: { gap: spacing.xs },
});
