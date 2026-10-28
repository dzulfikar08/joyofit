import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { spacing, useColors } from '@/theme';

import { SUPPORTED_LIST_URL, WATCH_FAMILIES, WATCH_REQUEST_URL } from './watchFamilies';

/**
 * Which watches work, in short, with the two next steps for someone whose watch is missing or only experimental: the full list on
 * the website, and a request to get a model supported (a prefilled GitHub issue). Used by the setup guide and the Watch tab's intro.
 * iOS lists no models (the app names no watch maker, App Store guideline 4.1(b)): the website's list is the one shown there.
 */
export function SupportedWatches() {
  const { t } = useTranslation('nowatch');
  const colors = useColors();
  return (
    <Card>
      <AppText variant="heading">{t('supported.title')}</AppText>
      {isIos ? null : (
        <View style={styles.list}>
          {WATCH_FAMILIES.map((family) => (
            <View key={family.id} style={styles.row} accessible accessibilityLabel={`${family.name}. ${t(`supported.status.${family.support}`)}`}>
              <Ionicons
                name={family.support === 'tested' ? 'checkmark-circle' : family.support === 'experimental' ? 'flask-outline' : 'close-circle-outline'}
                size={18}
                color={family.support === 'tested' ? colors.link : colors.mutedForeground}
                style={styles.icon}
              />
              <View style={styles.text}>
                <AppText variant="bodyStrong">{family.name}</AppText>
                <AppText variant="caption" muted>
                  {t(`supported.status.${family.support}`)}
                </AppText>
              </View>
            </View>
          ))}
        </View>
      )}
      <Details>
        <AppText variant="caption" muted>
          {t('supported.intro')}
        </AppText>
        <AppText variant="caption" muted>
          {t('supported.footer')}
        </AppText>
      </Details>
      <ButtonRow>
        <Button label={t('supported.fullList')} icon="list" lines={2} onPress={() => void Linking.openURL(SUPPORTED_LIST_URL)} />
        <Button label={t('supported.request')} icon="logo-github" lines={2} onPress={() => void Linking.openURL(WATCH_REQUEST_URL)} />
      </ButtonRow>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, marginVertical: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  icon: { marginTop: 2 },
  text: { flex: 1, gap: 0 },
});
