import * as Linking from 'expo-linking';
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { JOYOROGO_URL } from '@/cloud/config';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { IconChip } from '@/components/IconChip';
import { isIos } from '@/components/IosUnavailable';
import { Card, Screen } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SignInButtons } from '@/features/settings/SignInButtons';
import { useCloud } from '@/state/CloudProvider';
import { spacing } from '@/theme';

import { appleBillingSupported, buyPro, loadProducts, manageSubscriptions, restorePurchases, type StoreProducts } from './appleBilling';
import {
  AppleBillingError,
  APPLE_TERMS_URL,
  fetchAppleBilling,
  PRIVACY_URL,
  yearlySavingPercent,
  type ProPlan,
} from './appleBillingCore';
import { PlanOption } from './PlanOption';

/** Whether JoyoRogo's `/api/config` says Apple billing is on: `loading` until it answers, `unknown` when it could not be read. */
type BillingSwitch = 'loading' | 'on' | 'off' | 'unknown';

interface Message {
  tone: 'info' | 'danger';
  text: string;
}

/**
 * The JoyoRogo Pro paywall on iOS (the only place JoyoFit sells it). Pro is one entitlement on the JoyoRogo account, shared with the
 * JoyoRogo app and website; JoyoFit sells it with its own StoreKit subscriptions (docs/pro-ios.md). States: signed out (sign in
 * first), already Pro (active, manage subscription), Apple billing switched off on JoyoRogo or no StoreKit module in this binary (a
 * neutral notice, never a link out), and the plans with Buy and Restore. Android has no paywall: it keeps the JoyoRogo app, store
 * listing or web page, so the route redirects away there.
 */
export function ProPaywallScreen() {
  if (!isIos) return <Redirect href="/" />;
  return <Paywall />;
}

function Paywall() {
  const { t } = useTranslation('pro');
  const cloud = useCloud();
  const pro = cloud.pro === true;
  const [billing, setBilling] = useState<BillingSwitch>('loading');
  const [products, setProducts] = useState<StoreProducts | null>(null);
  const [plan, setPlan] = useState<ProPlan>('yearly');
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [attempt, setAttempt] = useState(0);

  const canSell = appleBillingSupported && cloud.signedIn && !pro;

  useEffect(() => {
    if (!canSell) return;
    let live = true;
    void fetchAppleBilling(JOYOROGO_URL).then((on) => live && setBilling(on === null ? 'unknown' : on ? 'on' : 'off'));
    return () => {
      live = false;
    };
  }, [canSell, attempt]);

  useEffect(() => {
    if (billing !== 'on') return;
    let live = true;
    void loadProducts().then((next) => live && setProducts(next));
    return () => {
      live = false;
    };
  }, [billing, attempt]);

  const retry = useCallback(() => {
    setBilling('loading');
    setAttempt((n) => n + 1);
  }, []);

  const failed = useCallback(
    (error: unknown) => setMessage({ tone: 'danger', text: error instanceof AppleBillingError ? error.message : t('error.failed') }),
    [t],
  );

  const buy = useCallback(async () => {
    setBusy('buy');
    setMessage(null);
    try {
      const outcome = await buyPro(plan);
      if (outcome === 'pending') setMessage({ tone: 'info', text: t('paywall.pending') });
      if (outcome === 'bought' || outcome === 'trial') {
        setMessage({ tone: 'info', text: t('paywall.activated') });
        void cloud.refreshPro();
        if (outcome === 'trial') Alert.alert(t('paywall.sandbox.title'), t('paywall.sandbox.body'));
      }
    } catch (error) {
      failed(error);
    } finally {
      setBusy(null);
    }
  }, [plan, cloud, t, failed]);

  const restore = useCallback(async () => {
    setBusy('restore');
    setMessage(null);
    try {
      const { accepted, rejected } = await restorePurchases();
      if (accepted > 0) {
        setMessage({ tone: 'info', text: t('paywall.restored') });
        void cloud.refreshPro();
      } else {
        setMessage({ tone: rejected > 0 ? 'danger' : 'info', text: rejected > 0 ? t('paywall.restoredOtherAccount') : t('paywall.restoredNone') });
      }
    } catch (error) {
      failed(error);
    } finally {
      setBusy(null);
    }
  }, [cloud, t, failed]);

  const chosen = products?.[plan] ?? null;
  const saving = products?.monthly && products.yearly ? yearlySavingPercent(products.monthly.price, products.yearly.price) : null;
  const unlocks = ['coach', 'cloud', 'koneksi', 'family'] as const;

  return (
    <Screen>
      <HiddenTabHeader title={t('paywall.title')} />
      <View style={styles.intro}>
        <IconChip icon="sparkles" tint="link" size="lg" />
        <AppText variant="title" accessibilityRole="header">
          {t('paywall.title')}
        </AppText>
        <AppText variant="body" muted>
          {t('paywall.intro')}
        </AppText>
      </View>

      <Card>
        <AppText variant="heading">{t('paywall.unlocksTitle')}</AppText>
        <View style={styles.bullets}>
          {unlocks.map((key) => (
            <View key={key} style={styles.bullet}>
              <AppText variant="label">{'\u2022'}</AppText>
              <AppText variant="caption" style={styles.bulletText}>
                {t(`paywall.unlocks.${key}`)}
              </AppText>
            </View>
          ))}
        </View>
        <AppText variant="caption" muted>
          {t('paywall.sameAccount')}
        </AppText>
      </Card>

      {message ? <Notice tone={message.tone} icon={message.tone === 'info' ? 'checkmark-circle' : undefined}>{message.text}</Notice> : null}

      {!appleBillingSupported && !pro ? <Notice icon="information-circle">{t('paywall.oldVersion')}</Notice> : null}

      {appleBillingSupported && !cloud.sessionPending && !cloud.signedIn ? (
        <Card>
          <AppText variant="heading">{t('paywall.signIn.title')}</AppText>
          <AppText variant="caption" muted>
            {t('paywall.signIn.body')}
          </AppText>
          <SignInButtons />
        </Card>
      ) : null}

      {pro ? (
        <Card>
          <View style={styles.activeHead}>
            <IconChip icon="checkmark-circle" tint="steps" />
            <AppText variant="heading" style={styles.grow}>
              {t('paywall.active.title')}
            </AppText>
          </View>
          <AppText variant="caption" muted>
            {t('paywall.active.body')}
          </AppText>
          {appleBillingSupported ? (
            <>
              <Button label={t('paywall.manage')} variant="secondary" icon="card-outline" onPress={() => void manageSubscriptions()} />
              <Button label={t('paywall.restore')} variant="ghost" onPress={() => void restore()} loading={busy === 'restore'} disabled={busy !== null} />
            </>
          ) : null}
        </Card>
      ) : null}

      {canSell && billing === 'loading' ? <ActivityIndicator accessibilityLabel={t('paywall.title')} /> : null}
      {canSell && billing === 'unknown' ? (
        <Notice icon="cloud-offline-outline" action={{ label: t('paywall.retry'), onPress: retry }}>
          {t('paywall.offline')}
        </Notice>
      ) : null}
      {canSell && billing === 'off' ? <Notice icon="information-circle">{t('paywall.unavailable')}</Notice> : null}

      {canSell && billing === 'on' ? (
        <>
          <AppText variant="heading">{t('paywall.plansTitle')}</AppText>
          {products && !products.monthly && !products.yearly ? (
            <Notice icon="information-circle" action={{ label: t('paywall.retry'), onPress: retry }}>
              {t('paywall.productsMissing')}
            </Notice>
          ) : null}
          <View style={styles.plans} accessibilityRole="radiogroup">
            <PlanOption
              title={t('paywall.plan.yearly')}
              price={products?.yearly ? t('paywall.plan.perYear', { price: products.yearly.displayPrice }) : null}
              missing={products ? t('paywall.plan.missing') : '\u2026'}
              badge={saving ? t('paywall.plan.save', { percent: saving }) : null}
              selected={plan === 'yearly'}
              disabled={busy !== null}
              onSelect={() => setPlan('yearly')}
            />
            <PlanOption
              title={t('paywall.plan.monthly')}
              price={products?.monthly ? t('paywall.plan.perMonth', { price: products.monthly.displayPrice }) : null}
              missing={products ? t('paywall.plan.missing') : '\u2026'}
              selected={plan === 'monthly'}
              disabled={busy !== null}
              onSelect={() => setPlan('monthly')}
            />
          </View>
          <Button label={t('paywall.buy')} variant="primary" icon="card-outline" onPress={() => void buy()} loading={busy === 'buy'} disabled={chosen === null || busy !== null} />
          <Button label={t('paywall.restore')} variant="secondary" onPress={() => void restore()} loading={busy === 'restore'} disabled={busy !== null} />
          <AppText variant="caption" muted>
            {t('paywall.disclosure')}
          </AppText>
        </>
      ) : null}

      <View style={styles.links}>
        <Button label={t('paywall.terms')} variant="ghost" onPress={() => void Linking.openURL(APPLE_TERMS_URL)} style={styles.grow} />
        <Button label={t('paywall.privacy')} variant="ghost" onPress={() => void Linking.openURL(PRIVACY_URL)} style={styles.grow} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: spacing.sm },
  bullets: { gap: spacing.sm },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bulletText: { flex: 1 },
  activeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  plans: { gap: spacing.sm },
  links: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
});
