import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Input';
import { NavRow } from '@/components/NavRow';
import { Card, Screen, Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice, Skeleton } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useToast } from '@/components/Toast';
import { useCoachAccess } from '@/features/coach/useCoachAccess';
import { fmtInt } from '@/i18n';
import { spacing } from '@/theme';
import { modelFor } from '../access';
import { chooseModel, listProviderModels } from '../engine';
import { hasHostedConsent, withdrawHostedConsent } from '../hostedConsent';
import { useAiSettings, useByokAccess } from '../hooks';
import { PROVIDER_ORDER } from '../providers';
import { parseFastFields } from '../settings';
import { aiDeleteEverything, aiDeleteMemory, aiNotes, aiRemoveProvider, aiSettings, aiUsage } from '../stores';
import type { ModelInfo, ProviderId } from '../types';
import { viewAiError } from './errors';
import { ModelPicker } from './ModelPicker';
import { RadioRow } from './RadioRow';
import { CEILING_CHOICES, INSIGHT_TOKENS, modelShort } from './status';
import { useRogoStatus } from './useRogoStatus';
import { OPEN_IN_STACK } from '@/components/navigation';

type Confirm = { kind: 'memory' } | { kind: 'all' } | { kind: 'key'; provider: ProviderId } | null;

/** The model list of the provider in use, loaded with the saved key; choosing one takes effect from the next message. */
function ModelSection({ provider, onDone }: { provider: ProviderId; onDone: () => void }) {
  const { t } = useTranslation('ai');
  const settings = useAiSettings();
  const { toast, show } = useToast();
  const [models, setModels] = useState<readonly ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProviderModels(provider)
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(viewAiError(e, t, { provider, ceiling: aiSettings.get().dailyCeiling }).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, t]);

  const value = modelFor(settings, provider);
  return (
    <>
      <Section title={t('model.title')} icon="options" tint="link">
        <ModelPicker
          provider={provider}
          value={value}
          onChange={(model) => {
            chooseModel(provider, model);
            show(t('prefs.modelSaved', { model: modelShort(model) }));
          }}
          models={models}
          loading={loading}
          error={error}
        />
        <Button label={t('prefs.modelDone')} onPress={onDone} />
      </Section>
      {toast}
    </>
  );
}

/** Settings, Joyo AI: which engine answers, the scheduled insights, the daily limit, and the data Joyo AI keeps on this phone. */
export function AiSettingsScreen() {
  const { t } = useTranslation('ai');
  const router = useRouter();
  const params = useLocalSearchParams<{ model?: string }>();
  const { access, settings } = useByokAccess();
  const coachAccess = useCoachAccess();
  const [rogoUsage] = useRogoStatus(coachAccess === 'pro');
  const { toast, show } = useToast();
  const [pickModel, setPickModel] = useState(params.model === '1');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState(() => ({ notes: aiNotes.list().length, usage: aiUsage.today(Math.floor(Date.now() / 1000)) }));

  // Notes and today's use change on other screens (and on this one after a delete): read them again when this one comes back.
  const readSnapshot = useCallback(() => setSnapshot({ notes: aiNotes.list().length, usage: aiUsage.today(Math.floor(Date.now() / 1000)) }), []);
  useFocusEffect(readSnapshot);
  const noteCount = snapshot.notes;
  const usage = snapshot.usage;

  if (access === null) {
    return (
      <Screen>
        <Skeleton width="100%" height={220} radius="card" />
      </Screen>
    );
  }

  const minor = !access.ok && access.reason === 'minor';
  const provider = settings.provider;
  const configured = provider !== null && settings.keySaved[provider] === true;
  const ownReady = access.ok;
  const hostedOn = hasHostedConsent(settings);
  const keyed = PROVIDER_ORDER.filter((id) => settings.keySaved[id] === true);

  const rogoLine =
    coachAccess === 'pro'
      ? rogoUsage
        ? t('prefs.engine.rogoUsed', { used: fmtInt(rogoUsage.used), cap: fmtInt(rogoUsage.cap) })
        : t('prefs.engine.rogoPro')
      : coachAccess === 'signedOut'
        ? t('prefs.engine.rogoSignedOut')
        : coachAccess === 'free'
          ? t('prefs.engine.rogoFree')
          : t('prefs.engine.rogoChecking');
  const ownLine = !configured
    ? t('prefs.engine.ownNone')
    : access.ok
      ? t('prefs.engine.ownLine', { provider: t(`provider.${provider}`), model: modelShort(access.model) })
      : t('prefs.engine.ownBlocked', {
          line: t('prefs.engine.ownLine', { provider: t(`provider.${provider}`), model: modelShort(modelFor(settings, provider)) }),
          reason: access.reason === 'minor' ? '' : t(`prefs.engine.block.${access.reason}`),
        });
  const switchOff = access.ok ? null : access.reason === 'minor' ? null : t(`prefs.style.off.${access.reason}`);

  const confirmed = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'memory') {
        aiDeleteMemory();
        show(t('prefs.data.memoryDeleted'));
      } else if (confirm.kind === 'all') {
        await aiDeleteEverything();
        show(t('prefs.data.allDeleted'));
      } else {
        await aiRemoveProvider(confirm.provider);
        show(t('prefs.data.keyDeleted'));
      }
    } catch {
      show(t('prefs.data.deleteFailed'));
    } finally {
      setBusy(false);
      setConfirm(null);
      readSnapshot();
    }
  };

  const confirmName = confirm?.kind === 'key' ? t(`provider.${confirm.provider}`) : '';

  return (
    <View style={styles.root}>
      <Screen>
        <Section title={t('prefs.engine.title')} icon="chatbubbles" tint="link">
          <View accessibilityRole="radiogroup" style={styles.group}>
            <RadioRow title={t('prefs.engine.rogo')} subtitle={rogoLine} selected={settings.engine === 'rogo'} onPress={() => aiSettings.update({ engine: 'rogo' })} />
            {minor ? null : (
              <RadioRow
                title={t('prefs.engine.own')}
                subtitle={ownLine}
                selected={settings.engine === 'byok'}
                onPress={() => (ownReady ? aiSettings.update({ engine: 'byok' }) : router.push('/settings/ai-setup', OPEN_IN_STACK))}
              />
            )}
          </View>
          {minor ? (
            <Notice icon="person">{t('gate.minor.body')}</Notice>
          ) : configured ? (
            <ButtonRow>
              <Button label={t('prefs.engine.change')} icon="key" onPress={() => router.push('/settings/ai-setup', OPEN_IN_STACK)} />
              <Button label={t('prefs.engine.pickModel')} icon="options" onPress={() => setPickModel((v) => !v)} />
            </ButtonRow>
          ) : (
            <Button label={t('prefs.engine.setup')} variant="primary" icon="key" onPress={() => router.push('/settings/ai-setup', OPEN_IN_STACK)} />
          )}
          {!minor && configured && provider === 'gemini' ? <Notice tone="danger" icon="warning">{t('consent.gemini')}</Notice> : null}
          {minor ? null : (
            <AppText variant="caption" muted>
              {t('prefs.engine.free')}
            </AppText>
          )}
        </Section>

        <Section title={t('hosted.settings.title')} icon="shield-checkmark" tint="link">
          <SwitchRow
            label={t('hosted.settings.label')}
            hint={hostedOn ? t('hosted.settings.on') : t('hosted.settings.off')}
            value={hostedOn}
            onValueChange={(value) => {
              if (value) {
                router.push('/settings/ai-consent', OPEN_IN_STACK);
              } else {
                withdrawHostedConsent(aiSettings);
                show(t('hosted.withdrawn'));
              }
            }}
          />
          <Button label={t('hosted.settings.review')} icon="eye" onPress={() => router.push('/settings/ai-consent', OPEN_IN_STACK)} />
        </Section>

        {pickModel && configured && provider && !minor ? <ModelSection key={provider} provider={provider} onDone={() => setPickModel(false)} /> : null}

        {minor ? null : (
          <Section title={t('prefs.style.title')} icon="newspaper" tint="link">
            <SwitchRow
              label={t('prefs.style.daily')}
              hint={switchOff ?? t('prefs.style.hint', { tokens: fmtInt(INSIGHT_TOKENS.daily) })}
              value={settings.insightDaily}
              disabled={!ownReady}
              onValueChange={(value) => aiSettings.update({ insightDaily: value })}
            />
            <SwitchRow
              label={t('prefs.style.weekly')}
              hint={switchOff ?? t('prefs.style.hint', { tokens: fmtInt(INSIGHT_TOKENS.weekly) })}
              value={settings.insightWeekly}
              disabled={!ownReady}
              onValueChange={(value) => aiSettings.update({ insightWeekly: value })}
            />
            <AppText variant="caption" muted>
              {t('prefs.style.where')}
            </AppText>
            <SwitchRow
              label={t('prefs.style.fast')}
              hint={t('prefs.style.fastHint')}
              value={settings.fastMode}
              disabled={!ownReady}
              onValueChange={(value) => aiSettings.update({ fastMode: value })}
            />
            {settings.fastMode && provider === 'custom' ? (
              <Field
                label={t('prefs.style.fastFields')}
                hint={settings.fastFields.trim() !== '' && parseFastFields(settings.fastFields) === null ? t('prefs.style.fastFieldsBad') : t('prefs.style.fastFieldsHint')}
                value={settings.fastFields}
                onChangeText={(value) => aiSettings.update({ fastFields: value })}
                placeholder={'{"reasoning_effort":"low"}'} // i18n-ok: JSON example
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />
            ) : null}
            <AppText variant="bodyStrong">{t('prefs.style.ceiling')}</AppText>
            <Segmented
              value={settings.dailyCeiling}
              onChange={(value) => aiSettings.update({ dailyCeiling: value })}
              options={CEILING_CHOICES.map((value) => ({ value, label: fmtInt(value) }))}
            />
            <AppText variant="caption" muted>
              {t('prefs.style.ceilingHint')}
            </AppText>
          </Section>
        )}

        <View style={styles.data}>
          <AppText variant="heading" accessibilityRole="header">
            {t('prefs.data.title')}
          </AppText>
          {minor ? null : (
            <>
              <Card style={styles.flush}>
                <NavRow icon="document-text" title={t('prefs.data.notes', { n: fmtInt(noteCount) })} subtitle={t('prefs.data.notesHint')} onPress={() => router.push('/settings/ai-notes', OPEN_IN_STACK)} />
                <NavRow icon="eye" title={t('prefs.data.sent')} subtitle={t('prefs.data.sentHint')} onPress={() => router.push('/settings/ai-data', OPEN_IN_STACK)} />
              </Card>
              <AppText variant="caption" muted>
                {t('prefs.data.usage', { tokens: fmtInt(usage.inputTokens + usage.outputTokens), calls: fmtInt(usage.calls) })}
              </AppText>
            </>
          )}
          <Card style={styles.flush}>
            <NavRow icon="trash-outline" destructive title={t('prefs.data.deleteMemory')} onPress={() => setConfirm({ kind: 'memory' })} />
            {keyed.map((id) => (
              <NavRow key={id} icon="key-outline" destructive title={t('prefs.data.deleteKey', { provider: t(`provider.${id}`) })} onPress={() => setConfirm({ kind: 'key', provider: id })} />
            ))}
            <NavRow icon="trash-outline" destructive title={t('prefs.data.deleteAll')} onPress={() => setConfirm({ kind: 'all' })} />
          </Card>
        </View>
      </Screen>
      {toast}
      <ConfirmDialog
        visible={confirm !== null}
        destructive
        busy={busy}
        title={confirm?.kind === 'key' ? t('prefs.data.deleteKeyTitle', { provider: confirmName }) : confirm?.kind === 'all' ? t('prefs.data.deleteAllTitle') : t('prefs.data.deleteMemoryTitle')}
        message={confirm?.kind === 'key' ? t('prefs.data.deleteKeyMessage', { provider: confirmName }) : confirm?.kind === 'all' ? t('prefs.data.deleteAllMessage') : t('prefs.data.deleteMemoryMessage')}
        confirmLabel={confirm?.kind === 'key' ? t('prefs.data.deleteKeyConfirm') : confirm?.kind === 'all' ? t('prefs.data.deleteAllConfirm') : t('prefs.data.deleteMemoryConfirm')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void confirmed()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  group: { gap: spacing.xs },
  flush: { padding: 0, gap: 0, overflow: 'hidden' },
  data: { gap: spacing.sm },
});
