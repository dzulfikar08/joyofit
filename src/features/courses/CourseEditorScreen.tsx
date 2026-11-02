import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Input';
import { KeyValue } from '@/components/KeyValue';
import { Divider, Section } from '@/components/Screen';
import { LoadingState, Notice } from '@/components/States';
import { BlockEditor } from '@/features/courses/BlockEditor';
import {
  blockLabel,
  buildCourse,
  formatMetres,
  formatSeconds,
  MAX_NAME_BYTES,
  newBlock,
  newIntervalGroup,
  newStep,
  presets,
  summarize,
  type BlockDraft,
  type CourseDraft,
  type Preset,
  type StepDraft,
} from '@/features/courses/courseModel';
import { useCourseDraft } from '@/features/courses/useCourseDraft';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { fmtInt } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';
import { HuaweiWear, type RunningCoursePushResult } from '@/wear';
import { appAlert } from '@/components/AppAlert';

type Outcome = { kind: 'sent'; result: RunningCoursePushResult } | { kind: 'failed'; message: string } | null;

/** `list` with the item at `index` moved one place, or unchanged at either end. */
function moved<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * The experimental running-course editor: build blocks of steps, check them against the contract's ranges and send the
 * course to the watch. The draft is kept on the phone. Nothing here is verified on a real watch.
 */
export function CourseEditorScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation(['watch', 'common']);
  const { linkState } = useWatch();
  const connected = linkState === 'connected' || linkState === 'syncing';
  const { draft, setDraft, loaded, saveError } = useCourseDraft();
  const [courses, setCourses] = useState(() => HuaweiWear.getCourses());
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  useNativeRefresh(useCallback(() => setCourses(HuaweiWear.getCourses()), []));

  const built = useMemo(() => buildCourse(draft), [draft, i18n.language]);
  const summary = useMemo(() => summarize(draft), [draft]);

  /** Every edit goes through here so a result for an older version of the course is never left on screen. */
  const edit = (update: (previous: CourseDraft) => CourseDraft) => {
    setOutcome(null);
    setDraft(update);
  };

  const editBlock = (blockId: string, update: (block: BlockDraft) => BlockDraft) =>
    edit((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === blockId ? update(b) : b)) }));

  const confirmReplace = (title: string, apply: () => void) => {
    if (draft.blocks.length === 0) return apply();
    appAlert(title, t('watch:courses.replaceMessage'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('watch:courses.replace'), style: 'destructive', onPress: apply },
    ]);
  };

  const applyPreset = (preset: Preset) =>
    confirmReplace(t('watch:courses.usePreset', { name: preset.name }), () =>
      edit((d) => ({ ...preset.build(), name: d.name.trim() || preset.name })),
    );

  const send = async () => {
    if (built.course === null) return;
    setSending(true);
    setOutcome(null);
    try {
      setOutcome({ kind: 'sent', result: await HuaweiWear.pushRunningCourse(built.course) });
    } catch (e) {
      const code = typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined;
      const message = errorMessage(e);
      setOutcome({
        kind: 'failed',
        message: typeof code === 'string' && !message.includes(code) ? `${message} (${code})` : message,
      });
    } finally {
      setSending(false);
      setCourses(HuaweiWear.getCourses());
    }
  };

  if (!loaded) return <LoadingState label={t('watch:courses.opening')} />;

  const touched = draft.name.trim() !== '' || draft.blocks.length > 0;
  const total = summary.total;
  const gate = (set: boolean) => t(set ? 'watch:courses.gateSet' : 'watch:courses.gateNotSet');

  return (
    <>
      <Notice>{t('watch:courses.unverified')}</Notice>
      {!courses.enabled ? <Notice tone="danger">{t('watch:courses.disabled')}</Notice> : null}
      {saveError ? <Notice tone="danger">{t('watch:courses.saveError', { error: saveError })}</Notice> : null}

      <Section title={t('watch:courses.title')} icon="flag" tint="workouts">
        <Field
          label={t('watch:courses.name')}
          value={draft.name}
          onChangeText={(name) => edit((d) => ({ ...d, name }))}
          maxLength={MAX_NAME_BYTES}
          icon="pricetag"
          hint={t('watch:courses.nameHint')}
        />
        <AppText variant="label" muted>
          {t('watch:courses.startPreset')}
        </AppText>
        <View style={styles.chips}>
          {presets().map((preset) => (
            <Chip key={preset.id} label={preset.name} selected={false} onPress={() => applyPreset(preset)} />
          ))}
        </View>
        {summary.total ? (
          <>
            <Divider />
            <KeyValue icon="layers" label={t('watch:courses.stepsTotal')} value={String(summary.steps)} />
            <KeyValue
              icon="time"
              label={t('watch:courses.total')}
              value={
                total?.kind === 'time'
                  ? formatSeconds(total.value)
                  : total?.kind === 'distance'
                    ? formatMetres(total.value)
                    : total?.kind === 'mixed'
                      ? t('watch:courses.mixed')
                      : t('watch:courses.noTargets')
              }
            />
          </>
        ) : null}
      </Section>

      <Section title={t('watch:courses.steps')} icon="list" tint="workouts">
        {draft.blocks.length === 0 ? (
          <AppText variant="caption" muted>
            {t('watch:courses.noSteps')}
          </AppText>
        ) : null}
        {draft.blocks.map((block, index) => (
          <View key={block.id} style={styles.item}>
            {index > 0 ? <Divider /> : null}
            <BlockEditor
              label={blockLabel(draft, index)}
              block={block}
              isFirst={index === 0}
              isLast={index === draft.blocks.length - 1}
              onMove={(direction) => edit((d) => ({ ...d, blocks: moved(d.blocks, index, direction) }))}
              onRemove={() => edit((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== block.id) }))}
              onRepeat={(repeat) => editBlock(block.id, (b) => ({ ...b, repeat }))}
              onAddStep={() => editBlock(block.id, (b) => ({ ...b, steps: [...b.steps, newStep()] }))}
              onStepChange={(stepId: string, patch: Partial<StepDraft>) =>
                editBlock(block.id, (b) => ({
                  ...b,
                  steps: b.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
                }))
              }
              onStepMove={(stepId, direction) =>
                editBlock(block.id, (b) => ({
                  ...b,
                  steps: moved(
                    b.steps,
                    b.steps.findIndex((s) => s.id === stepId),
                    direction,
                  ),
                }))
              }
              onStepRemove={(stepId) =>
                editBlock(block.id, (b) => ({ ...b, steps: b.steps.filter((s) => s.id !== stepId) }))
              }
            />
          </View>
        ))}
        <Divider />
        <Button
          label={t('watch:courses.addStep')}
          icon="add"
          variant="primary"
          onPress={() => edit((d) => ({ ...d, blocks: [...d.blocks, newBlock([newStep()])] }))}
        />
        <Button
          label={t('watch:courses.addGroup')}
          icon="repeat"
          onPress={() => edit((d) => ({ ...d, blocks: [...d.blocks, newIntervalGroup()] }))}
        />
        <AppText variant="caption" muted>
          {t('watch:courses.groupHint')}
        </AppText>
        {draft.blocks.length > 0 ? (
          <Button
            label={t('watch:courses.clear')}
            icon="trash"
            variant="destructive"
            onPress={() => confirmReplace(t('watch:courses.clearTitle'), () => edit((d) => ({ ...d, blocks: [] })))}
          />
        ) : null}
      </Section>

      <Section title={t('watch:courses.sendTitle')} icon="send" tint="link">
        <KeyValue label="ExpandCapability 41" value={gate(courses.gate41)} /> {/* i18n-ok: protocol identifier */}
        <KeyValue label="ExpandCapability 169" value={gate(courses.gate169)} /> {/* i18n-ok: protocol identifier */}
        <AppText variant="caption" muted>
          {t('watch:courses.gateHint')}
        </AppText>
        {!connected ? (
          <Notice icon="bluetooth" action={{ label: t('watch:openWatch'), onPress: () => router.navigate('/watch') }}>
            {t('watch:courses.connect')}
          </Notice>
        ) : null}
        {built.error !== null ? (
          touched ? (
            <Notice tone="danger">{built.error}</Notice>
          ) : (
            <AppText variant="caption" muted>
              {t('watch:courses.addFirst')}
            </AppText>
          )
        ) : null}
        <Button
          label={t('watch:courses.send')}
          icon="send"
          variant="primary"
          loading={sending}
          disabled={!connected || !courses.enabled || built.course === null}
          onPress={() => void send()}
        />
        {outcome?.kind === 'sent' ? (
          <View style={styles.result}>
            <Notice icon="checkmark-circle">
              {outcome.result.uploadStatus === null
                ? t('watch:courses.sentNoStatus')
                : t('watch:courses.sentStatus', { status: outcome.result.uploadStatus })}
            </Notice>
            <KeyValue label={t('watch:courses.uploadStatus')} value={outcome.result.uploadStatus === null ? null : String(outcome.result.uploadStatus)} />
            <KeyValue label={t('watch:courses.answered')} value={outcome.result.answered ? t('watch:courses.yes') : t('watch:courses.no')} />
            <KeyValue label={t('watch:courses.answer')} value={outcome.result.answerHex} />
            <KeyValue label={t('watch:courses.file')} value={t('watch:courses.fileValue', { name: outcome.result.fileName, bytes: fmtInt(outcome.result.bytes) })} />
            <AppText variant="caption" muted>
              {t('watch:courses.statusHint')}
            </AppText>
          </View>
        ) : null}
        {outcome?.kind === 'failed' ? <Notice tone="danger">{outcome.message}</Notice> : null}
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: { gap: spacing.md },
  result: { gap: spacing.sm },
});
