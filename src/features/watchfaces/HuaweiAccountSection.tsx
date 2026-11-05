import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Input } from '@/components/Input';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { HuaweiAccountSignInModal } from '@/features/watchfaces/HuaweiAccountSignInModal';
import { normalizeHuaweiAccountId } from '@/features/watchfaces/huaweiAccount';
import { spacing } from '@/theme';
import { HuaweiWear, hasNative } from '@/wear';

/** Masks all but the last 4 digits, so the saved id is recognisable without printing it in full. */
function maskAccount(id: string): string {
  return id.length <= 4 ? id : `${'•'.repeat(id.length - 4)}${id.slice(-4)}`;
}

/**
 * Lets the user attach their Huawei account id so JoyoFit sends it to the watch at connect (like Gadgetbridge's authentication field).
 * In-app sign-in reads the `userId` cookie; a manual field is the fallback (and the only path when Huawei marks the cookie httpOnly).
 */
export function HuaweiAccountSection() {
  const { t } = useTranslation(['watch', 'common']);
  const supported = hasNative('getHuaweiAccount');
  const [account, setAccount] = useState<string | null>(() => (supported ? HuaweiWear.getHuaweiAccount() : null));
  const [signInOpen, setSignInOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!supported) return null;

  const save = async (id: string | null) => {
    setError(null);
    await HuaweiWear.setHuaweiAccount(id);
    setAccount(id);
    setSaved(true);
  };

  const onCapture = (id: string) => {
    setSignInOpen(false);
    void save(id);
  };

  const saveManual = () => {
    const result = normalizeHuaweiAccountId(manualText);
    if (!result.ok) {
      setError(t(`watch:faces.account.invalid.${result.reason}`));
      return;
    }
    setManualOpen(false);
    setManualText('');
    void save(result.id);
  };

  const remove = () => {
    setManualOpen(false);
    setSaved(false);
    void save(null);
  };

  return (
    <Section title={t('watch:faces.account.title')} icon="person-circle-outline">
      <KeyValue
        icon="key-outline"
        label={t('watch:faces.account.status')}
        value={account ? maskAccount(account) : t('watch:faces.account.notSet')}
      />

      {saved && account ? <Notice tone="info" icon="checkmark-circle">{t('watch:faces.account.savedReconnect')}</Notice> : null}

      <Notice tone="danger" icon="alert-circle">
        {t('watch:faces.account.resetWarning')}
      </Notice>

      <View style={styles.actions}>
        <Button
          label={account ? t('watch:faces.account.signInAgain') : t('watch:faces.account.signIn')}
          variant="primary"
          icon="log-in-outline"
          style={{ flex: 1 }}
          onPress={() => {
            setError(null);
            setSignInOpen(true);
          }}
        />
        {account ? (
          <Button label={t('watch:faces.account.remove')} variant="ghost" icon="trash-outline" onPress={remove} />
        ) : null}
      </View>

      {manualOpen ? (
        <View style={styles.manual}>
          <Input
            icon="keypad-outline"
            value={manualText}
            onChangeText={setManualText}
            placeholder={t('watch:faces.account.manualPlaceholder')}
            keyboardType="number-pad"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <View style={styles.actions}>
            <Button label={t('common:actions.save')} variant="primary" style={{ flex: 1 }} onPress={saveManual} />
            <Button
              label={t('common:actions.cancel')}
              variant="ghost"
              onPress={() => {
                setManualOpen(false);
                setError(null);
              }}
            />
          </View>
        </View>
      ) : (
        <Button
          label={t('watch:faces.account.enterManually')}
          variant="ghost"
          icon="create-outline"
          onPress={() => {
            setError(null);
            setManualText(account ?? '');
            setManualOpen(true);
          }}
        />
      )}

      {error ? <Notice tone="danger" icon="close-circle">{error}</Notice> : null}

      <Details title={t('watch:faces.account.guideTitle')}>
        <AppText variant="caption" muted>
          {t('watch:faces.account.guide')}
        </AppText>
      </Details>

      <HuaweiAccountSignInModal visible={signInOpen} onClose={() => setSignInOpen(false)} onCapture={onCapture} />
    </Section>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  manual: { gap: spacing.sm },
});
