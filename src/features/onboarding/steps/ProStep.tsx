import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { JOYOROGO_URL } from '@/cloud/config';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { fetchProConfig, priceLine, proOffer, scansLine, type ProConfig } from '@/features/onboarding/pro';
import { proUpgradeAction } from '@/features/pro/offer';
import { openUpgrade } from '@/features/pro/openUpgrade';
import { useCloud } from '@/state/CloudProvider';
import { spacing } from '@/theme';
import { HuaweiWear } from '@/wear';

const PLATFORM = isIos ? 'ios' : 'android';
const OFFER = proOffer(PLATFORM, HuaweiWear.distribution);

/**
 * JoyoRogo Pro, described honestly and never required. The button goes through `openUpgrade` like every other Pro offer in JoyoFit: the
 * in-app paywall on iOS (StoreKit) and in the Play build (Google Play Billing), else, in a sideloaded build, the JoyoRogo app's own
 * Pro screen when it is installed or the web page (see `proOffer` for the stores' rules). Prices and limits come from JoyoRogo's live
 * config, never from this app's code; the store's price is shown on the paywall only.
 */
export function ProStep() {
  const { t } = useTranslation('onboarding');
  const cloud = useCloud();
  const [config, setConfig] = useState<ProConfig | null>(null);

  useEffect(() => {
    let live = true;
    void fetchProConfig(JOYOROGO_URL).then((next) => live && setConfig(next));
    return () => {
      live = false;
    };
  }, []);

  const action = useMemo(() => proUpgradeAction(PLATFORM, HuaweiWear.distribution, 'onboarding'), []);
  const price = OFFER === 'web' ? priceLine(config) : null;
  const active = cloud.signedIn && !cloud.locked && cloud.lastSyncAt !== null;

  return (
    <>
      <StepIntro icon="cloud-upload" tint="link" title={t('pro.title')} badge={t('badge.optionalPaid')}>
        {t('pro.intro')}
      </StepIntro>
      <Card>
        <AppText variant="heading">{t('pro.addsTitle')}</AppText>
        <View style={styles.bullets}>
          <Bullet label={'\u2022'}>
            {t('pro.adds1')}
          </Bullet>
          <Bullet label={'\u2022'}>
            {t('pro.adds2')}
          </Bullet>
          <Bullet label={'\u2022'}>{scansLine(config)}</Bullet>
        </View>
        {price ? <AppText variant="bodyStrong">{price}</AppText> : null}
      </Card>
      {active ? <Notice icon="checkmark-circle">{t('pro.active')}</Notice> : null}
      {cloud.signedIn && cloud.locked ? (
        <Notice icon="lock-closed">{t('pro.locked')}</Notice>
      ) : null}
      {!cloud.signedIn ? <Notice icon="information-circle">{t('pro.signInFirst')}</Notice> : null}
      {OFFER === 'iap' ? <Button label={t('pro.see')} variant="secondary" icon="arrow-forward" onPress={() => void openUpgrade(action)} /> : null}
      {OFFER === 'web' ? <Button label={t('pro.see')} variant="secondary" icon="open-outline" onPress={() => void openUpgrade(action)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  bullets: { gap: spacing.sm },
});
