import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { cloudStepState } from '@/features/onboarding/cloudStep';
import { proOffer } from '@/features/onboarding/pro';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { SignInButtons } from '@/features/settings/SignInButtons';
import { proUpgradeAction } from '@/features/pro/offer';
import { openUpgrade } from '@/features/pro/openUpgrade';
import { useCloud } from '@/state/CloudProvider';
import { spacing } from '@/theme';
import { HuaweiWear } from '@/wear';

const PLATFORM = isIos ? 'ios' : 'android';
const OFFER = proOffer(PLATFORM, HuaweiWear.distribution);

/**
 * JoyoRogo Cloud: every workout, with its analysis, kept in the person's JoyoRogo account. Three faces (see `cloudStepState`): the
 * switch for Pro, an explanation and a store-compliant way to get Pro for Free (same rules as the Pro step), and sign-in. Never blocks.
 */
export function CloudStep() {
  const { t } = useTranslation('onboarding');
  const cloud = useCloud();
  const action = useMemo(() => proUpgradeAction(PLATFORM, HuaweiWear.distribution, 'onboarding-cloud'), []);
  const state = cloudStepState({ signedIn: cloud.signedIn, unlocked: cloud.cloudWorkouts?.unlocked ?? null, locked: cloud.locked });

  // Pro: the switch is on from the start. Turning it on also starts the sync (a Wi-Fi only choice is respected), which is the backfill
  // of the workouts already on the phone. Once per visit; the switch below is the way to turn it off.
  const started = useRef(false);
  useEffect(() => {
    if (state !== 'pro' || started.current) return;
    started.current = true;
    cloud.setAutoSync(true);
  }, [state, cloud]);

  return (
    <>
      <StepIntro icon="cloud-upload" tint="link" title={t('cloud.title')} badge={t('cloud.badge')}>
        {t('cloud.intro')}
      </StepIntro>
      <Card>
        <AppText variant="heading">{t('cloud.whyTitle')}</AppText>
        <AppText variant="body" muted>
          {t('cloud.whyIntro')}
        </AppText>
        <View style={styles.bullets}>
          <Bullet label={'\u2022'}>
            {t('cloud.why1')}
          </Bullet>
          <Bullet label={'\u2022'}>{t('cloud.why2')}</Bullet>
          <Bullet label={'\u2022'}>{t('cloud.why3')}</Bullet>
        </View>
      </Card>
      {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
      {state === 'pro' ? (
        <>
          <Card>
            <SwitchRow
              label={t('cloud.backup')}
              hint={t('cloud.backupHint')}
              icon="cloud-upload"
              value={cloud.autoSync}
              onValueChange={cloud.setAutoSync}
              disabled={cloud.wiping}
            />
            <SwitchRow
              label={t('cloud.wifiOnly')}
              hint={t('cloud.wifiOnlyHint')}
              icon="wifi"
              value={cloud.wifiOnly}
              onValueChange={cloud.setWifiOnly}
              disabled={!cloud.autoSync}
            />
          </Card>
          {cloud.progress ? (
            <Notice icon="cloud-upload">{t('cloud.uploading', { done: cloud.progress.done, total: cloud.progress.total })}</Notice>
          ) : cloud.autoSync ? (
            <Notice icon="checkmark-circle">
              {t('cloud.backupOn')}
            </Notice>
          ) : (
            <Notice icon="information-circle">{t('cloud.backupOff')}</Notice>
          )}
        </>
      ) : null}
      {state === 'checking' ? <Notice icon="information-circle">{t('cloud.checking')}</Notice> : null}
      {state === 'free' ? (
        <>
          <Notice icon="lock-closed">
            {t('cloud.free')}
          </Notice>
          {OFFER === 'iap' ? <Button label={t('cloud.see')} variant="secondary" icon="arrow-forward" onPress={() => void openUpgrade(action)} /> : null}
          {OFFER === 'store' ? (
            <>
              <AppText variant="caption" muted>
                {t('cloud.managedStore')}
              </AppText>
              <Button label={t('cloud.openOnPlay')} variant="secondary" icon="logo-google-playstore" onPress={() => void openUpgrade(action)} />
            </>
          ) : null}
          {OFFER === 'web' ? (
            <Button label={t('cloud.see')} variant="secondary" icon="open-outline" onPress={() => void openUpgrade(action)} />
          ) : null}
        </>
      ) : null}
      {state === 'signin' ? (
        <>
          <Notice icon="information-circle">{t('cloud.signIn')}</Notice>
          <SignInButtons label={t('cloud.signInButton')} prompt={t('cloud.signInPrompt')} />
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  bullets: { gap: spacing.sm },
});
