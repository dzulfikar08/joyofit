import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Input';
import { Section } from '@/components/Screen';
import { Details } from '@/components/Details';
import { Notice } from '@/components/States';
import type { ProtocolSecret, SecretField } from '@/features/scale/types';
import type { ScaleSecretState } from '@/state/ScaleProvider';
import { spacing } from '@/theme';

interface SecretSectionProps {
  kind: ProtocolSecret['kind'];
  /** What to ask on this phone (`secretFieldsFor`). */
  fields: readonly SecretField[];
  state: Exclude<ScaleSecretState, 'none' | 'loading'>;
  /** Resolves false when the text is not a valid key. */
  onSave: (values: Record<string, string>) => Promise<boolean>;
  onClear: () => Promise<void>;
}

const typedLength = (field: SecretField, text: string): number => (field.hex ? text.replace(/[\s:-]/g, '') : text.trim()).length;

/** Advanced: the key(s) a scale that encrypts needs. They stay on this phone, in the secure store. */
export function SecretSection({ kind, fields, state, onSave, onClear }: SecretSectionProps) {
  const { t } = useTranslation('scale');
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const complete = fields.every((field) => (values[field.id] ?? '').trim().length > 0);

  const save = async () => {
    const ok = await onSave(values);
    setInvalid(!ok);
    if (ok) {
      setValues({});
      setShown(false);
    }
  };

  return (
    <Section title={t('secret.title')} icon="key-outline">
      <AppText variant="caption">{t(`secret.${kind}.summary`)}</AppText>
      {state === 'saved' || state === 'rejected' ? (
        <>
          {state === 'rejected' ? <Notice tone="danger">{t('secret.rejected')}</Notice> : <AppText variant="bodyStrong">{t('secret.saved')}</AppText>}
          <Button label={t('secret.remove')} icon="trash-outline" variant="ghost" onPress={() => void onClear()} />
        </>
      ) : (
        <>
          {fields.map((field) => {
            const text = values[field.id] ?? '';
            return (
              <Field
                key={field.id}
                label={t(`secret.fields.${field.id}`)}
                hint={t('secret.length', { length: typedLength(field, text), max: field.length })}
                value={text}
                onChangeText={(value) => {
                  setValues((v) => ({ ...v, [field.id]: value }));
                  setInvalid(false);
                }}
                secureTextEntry={!shown}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                importantForAutofill="no"
                maxLength={field.maxLength}
              />
            );
          })}
          {invalid ? <Notice tone="danger">{t(`secret.${kind}.invalid`)}</Notice> : null}
          <View style={styles.actions}>
            <Button label={shown ? t('secret.hide') : t('secret.show')} icon={shown ? 'eye-off-outline' : 'eye-outline'} onPress={() => setShown((v) => !v)} />
            <Button label={t('secret.save')} icon="checkmark" variant="primary" disabled={!complete} onPress={() => void save()} />
          </View>
        </>
      )}
      <Details>
        {t(`secret.${kind}.explain`)}
        {fields.some((field) => field.onlyWithoutAddress) ? ` ${t('secret.addressExplain')}` : ''}
      </Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
});
