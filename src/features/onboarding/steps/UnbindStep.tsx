import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { GuideLink } from '@/features/device/GuideLink';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { AppleHealthImportSection } from '@/features/settings/AppleHealthImportSection';
import { HuaweiImportSection } from '@/features/settings/HuaweiImportSection';
import { HuaweiAccountSection } from '@/features/watchfaces/HuaweiAccountSection';
import { spacing } from '@/theme';
import { HuaweiWear, hasNative } from '@/wear';

/**
 * Release the watch from Huawei Health, and keep the old history: the things that cannot be done once the watch is paired here.
 * First the HUAWEI ID: a watch set up in Huawei Health asks "reset to pair with this phone?" when the connecting app sends a
 * different account (JoyoFit sends none by default, protocol/README.md 1A/05). With the same ID saved before pairing, the watch keeps
 * its faces and data, and moving it between Huawei Health and JoyoFit later needs no reset either. The person either connects it or
 * says they use none ("I don't use a HUAWEI ID"); until then Continue stays grey (flow.ts `huaweiIdPending`). On iOS the same step
 * speaks of "your watch account" (the brand-free overlay, docs/app-store.md 4.1(b)).
 */
export function UnbindStep({ huaweiId }: { huaweiId: HuaweiIdChoice }) {
  const { t } = useTranslation('onboarding');
  const [importing, setImporting] = useState(false);
  return (
    <>
      <StepIntro icon="unlink" tint="heart" title={t('unbind.title')}>
        {t('unbind.intro')}
      </StepIntro>
      {huaweiId.supported ? (
        huaweiId.skipped && !huaweiId.id ? (
          <>
            <Notice tone="info" icon="information-circle">
              {t('unbind.accountSkipped')}
            </Notice>
            <Button label={t('unbind.accountUndo')} variant="ghost" icon="log-in-outline" onPress={() => huaweiId.setSkipped(false)} />
          </>
        ) : (
          <>
            <AppText variant="body">{t('unbind.account')}</AppText>
            <HuaweiAccountSection onChange={huaweiId.setId} />
            {huaweiId.id ? null : (
              <>
                <Button label={t('unbind.accountNone')} variant="secondary" icon="close-circle-outline" onPress={() => huaweiId.setSkipped(true)} />
                <AppText variant="caption" muted>
                  {t('unbind.accountChoose')}
                </AppText>
              </>
            )}
          </>
        )
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

export interface HuaweiIdChoice {
  /** This build can send an account at connect (the native `getHuaweiAccount`); older native builds hide the whole part. */
  supported: boolean;
  /** The saved account id, or null. */
  id: string | null;
  /** The person said they use no HUAWEI ID. */
  skipped: boolean;
  /** Continue waits: supported, nothing saved, not declined. */
  pending: boolean;
  setId: (id: string | null) => void;
  setSkipped: (skipped: boolean) => void;
}

/** The unbind step's HUAWEI ID answer, held by the guide screen so it survives Back and drives the footer. */
export function useHuaweiIdChoice(): HuaweiIdChoice {
  const [supported] = useState(() => hasNative('getHuaweiAccount'));
  const [id, setId] = useState<string | null>(() => (supported ? HuaweiWear.getHuaweiAccount() : null));
  const [skipped, setSkipped] = useState(false);
  return { supported, id, skipped, pending: supported && !id && !skipped, setId, setSkipped };
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
