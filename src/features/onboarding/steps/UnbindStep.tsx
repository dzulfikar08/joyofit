import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { GuideLink } from '@/features/device/GuideLink';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { AppleHealthImportSection } from '@/features/settings/AppleHealthImportSection';
import { HuaweiImportSection } from '@/features/settings/HuaweiImportSection';
import { HuaweiAccountSection } from '@/features/watchfaces/HuaweiAccountSection';
import { spacing } from '@/theme';
import { hasNative } from '@/wear';

/**
 * Release the watch from Huawei Health, and keep the old history: the things that cannot be done once the watch is paired here.
 * First the HUAWEI ID: a watch set up in Huawei Health asks "reset to pair with this phone?" when the connecting app sends a
 * different account (JoyoFit sends none by default, protocol/README.md 1A/05). With the same ID saved before pairing, the watch keeps
 * its faces and data, and moving it between Huawei Health and JoyoFit later needs no reset either.
 */
export function UnbindStep() {
  const { t } = useTranslation('onboarding');
  const [importing, setImporting] = useState(false);
  const accountSupported = !isIos && hasNative('getHuaweiAccount');
  return (
    <>
      <StepIntro icon="unlink" tint="heart" title={t('unbind.title')}>
        {t('unbind.intro')}
      </StepIntro>
      {accountSupported ? (
        <>
          <AppText variant="body">{t('unbind.accountAndroid')}</AppText>
          <HuaweiAccountSection />
        </>
      ) : null}
      <Card>
        <View style={styles.list}>
          <Bullet label="1">
            {t('unbind.step1')}
          </Bullet>
          <Bullet label="2">
            {t('unbind.step2')}
          </Bullet>
          <Bullet label="3">
            {t('unbind.step3')}
          </Bullet>
        </View>
      </Card>
      <Button
        label={importing ? t('unbind.hideImport') : t('unbind.showImport')}
        variant="secondary"
        icon={importing ? 'chevron-up' : 'cloud-download'}
        onPress={() => setImporting((v) => !v)}
      />
      {importing ? (
        <>
          <HuaweiImportSection />
          {isIos ? <AppleHealthImportSection /> : null}
        </>
      ) : null}
      <AppText variant="caption" muted>
        {t('unbind.note')}
      </AppText>
      <GuideLink />
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
