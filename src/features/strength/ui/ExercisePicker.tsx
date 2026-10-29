import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Image, KeyboardAvoidingView, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ChipRow } from '@/components/ChipRow';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconChip } from '@/components/IconChip';
import { Field, Input } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { EmptyState } from '@/components/States';
import { Segmented } from '@/components/Segmented';
import { exerciseImageUrl, muscleList } from '@/features/coach/exercises';
import { useLocale, type Locale } from '@/i18n';
import { HIT, spacing, useColors } from '@/theme';

import { exercisesUsed } from '../calc';
import type { Catalog, CatalogExercise } from '../catalog';
import { deleteCustomExercise, listStrengthWorkouts, newId, saveCustomExercise } from '../store';
import type { CustomExercise, Equipment, Muscle } from '../types';
import { BottomSheet } from './Sheet';

interface ExercisePickerProps {
  visible: boolean;
  onClose: () => void;
  onPick: (exerciseIds: string[]) => void;
  /** Ids already in the workout: marked, but they can be picked again. */
  selected?: readonly string[];
  multi?: boolean;
  catalog: Catalog;
  /** Called after a custom exercise was created, edited or deleted, so the caller rebuilds the catalog. */
  onCatalogChange: () => void;
}

const EQUIPMENT: readonly Equipment[] = ['bodyweight', 'dumbbell', 'barbell', 'machine', 'cable', 'kettlebell', 'band', 'bench', 'bar', 'other'];
const RECENT_COUNT = 8;
const ROW_HEIGHT = 64;
const HEADER_HEIGHT = 36;
const SEARCH_DELAY_MS = 200;

type Item = { kind: 'header'; key: string; label: string } | { kind: 'row'; key: string; exercise: CatalogExercise };

export function ExercisePicker({ visible, onClose, onPick, selected = [], multi = false, catalog, onCatalogChange }: ExercisePickerProps) {
  const { t } = useTranslation(['strength', 'coach']);
  const locale = useLocale();
  const db = useSQLiteContext();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [customOnly, setCustomOnly] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [editing, setEditing] = useState<CatalogExercise | 'new' | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Each time the sheet opens it starts from a clean search.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setQuery('');
      setDebounced('');
      setMuscle(null);
      setEquipment(null);
      setCustomOnly(false);
      setPicked([]);
    }
  }

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    listStrengthWorkouts(db, 80).then(
      (workouts) => {
        if (!cancelled) setRecent(exercisesUsed(workouts).slice(0, RECENT_COUNT).map((e) => e.exerciseId));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [visible, db]);

  const filtered = !!debounced.trim() || muscle !== null || equipment !== null || customOnly;
  const items = useMemo<Item[]>(() => {
    const found = catalog.search({ query: debounced, muscle, equipment, customOnly }, locale);
    const list: Item[] = [];
    if (!filtered) {
      const offered = new Set(catalog.all().map((e) => e.id));
      const recentRows = recent.filter((id) => offered.has(id)).map((id) => catalog.get(id)).filter((e): e is CatalogExercise => e !== null);
      if (recentRows.length > 0) {
        list.push({ kind: 'header', key: 'h-recent', label: t('strength:picker.recent') });
        for (const exercise of recentRows) list.push({ kind: 'row', key: `r-${exercise.id}`, exercise });
        list.push({ kind: 'header', key: 'h-all', label: t('strength:picker.all') });
      }
    }
    for (const exercise of found) list.push({ kind: 'row', key: exercise.id, exercise });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` follows `locale`
  }, [catalog, debounced, muscle, equipment, customOnly, locale, recent, filtered]);

  const layout = useMemo(() => {
    let offset = 0;
    return items.map((item) => {
      const length = item.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
      const entry = { length, offset };
      offset += length;
      return entry;
    });
  }, [items]);

  const toggle = useCallback(
    (id: string) => {
      if (!multi) {
        onPick([id]);
        onClose();
        return;
      }
      setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
    },
    [multi, onPick, onClose],
  );

  const edit = useCallback((exercise: CatalogExercise) => setEditing(exercise), []);

  const confirm = () => {
    onPick(picked);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <PressableScale accessibilityRole="button" accessibilityLabel={t('strength:picker.close')} onPress={onClose} style={styles.iconButton}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </PressableScale>
          <AppText variant="heading" accessibilityRole="header" style={styles.headerTitle}>
            {multi ? t('strength:picker.titleMulti') : t('strength:picker.titleOne')}
          </AppText>
          <PressableScale accessibilityRole="button" accessibilityLabel={t('strength:picker.new')} onPress={() => setEditing('new')} style={styles.iconButton}>
            <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
          </PressableScale>
        </View>

        <View style={styles.search}>
          <Input
            icon="search"
            value={query}
            onChangeText={setQuery}
            placeholder={t('strength:picker.search')}
            accessibilityLabel={t('strength:picker.search')}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        <View style={styles.filters}>
          <ChipRow
            bleed={false}
            items={[
              { key: 'mine', label: t('strength:picker.mine'), selected: customOnly, role: 'checkbox', onPress: () => setCustomOnly((v) => !v) },
              ...muscleList.map((m) => ({ key: m, label: t(`coach:muscle.${m}`), selected: muscle === m, onPress: () => setMuscle(muscle === m ? null : m) })),
            ]}
          />
          <ChipRow
            bleed={false}
            items={EQUIPMENT.map((e) => ({ key: e, label: t(`coach:equipment.${e}`), selected: equipment === e, onPress: () => setEquipment(equipment === e ? null : e) }))}
          />
        </View>

        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          getItemLayout={(_, index) => ({ length: layout[index]?.length ?? ROW_HEIGHT, offset: layout[index]?.offset ?? 0, index })}
          initialNumToRender={14}
          windowSize={7}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <EmptyState
              icon="search"
              title={t('strength:picker.emptyTitle')}
              description={t('strength:picker.emptyBody')}
              action={{ label: t('strength:picker.new'), icon: 'add', onPress: () => setEditing('new') }}
            />
          }
          renderItem={({ item }) =>
            item.kind === 'header' ? (
              <View style={styles.sectionHeader}>
                <AppText variant="label" muted>
                  {item.label}
                </AppText>
              </View>
            ) : (
              <PickerRow
                exercise={item.exercise}
                locale={locale}
                inWorkout={selected.includes(item.exercise.id)}
                checked={picked.includes(item.exercise.id)}
                multi={multi}
                onToggle={toggle}
                onEdit={edit}
              />
            )
          }
        />

        {multi ? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm, backgroundColor: colors.background, borderTopColor: colors.hairline }]}>
            <Button
              label={picked.length > 0 ? t('strength:picker.add', { count: picked.length }) : t('strength:picker.pickSome')}
              variant="primary"
              icon="add"
              disabled={picked.length === 0}
              onPress={confirm}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <ExerciseForm
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={(id) => {
          setEditing(null);
          onCatalogChange();
          if (id !== null) {
            if (multi) setPicked((current) => (current.includes(id) ? current : [...current, id]));
          }
        }}
        onDeleted={(id) => {
          setEditing(null);
          setPicked((current) => current.filter((x) => x !== id));
          onCatalogChange();
        }}
      />
    </Modal>
  );
}

interface PickerRowProps {
  exercise: CatalogExercise;
  locale: Locale;
  inWorkout: boolean;
  checked: boolean;
  multi: boolean;
  onToggle: (id: string) => void;
  onEdit: (exercise: CatalogExercise) => void;
}

const PickerRow = memo(function PickerRow({ exercise, locale, inWorkout, checked, multi, onToggle, onEdit }: PickerRowProps) {
  const { t } = useTranslation(['strength', 'coach']);
  const colors = useColors();
  const name = exercise.name[locale];
  const muscles = exercise.primary.map((m) => t(`coach:muscle.${m}`)).join(', ');
  const hasImage = exercise.def !== null && exercise.def.images > 0;
  return (
    <View style={styles.row}>
      <PressableScale
        accessibilityRole={multi ? 'checkbox' : 'button'}
        accessibilityLabel={name}
        accessibilityState={multi ? { checked } : undefined}
        onPress={() => onToggle(exercise.id)}
        scaleTo={0.985}
        style={styles.rowMain}>
        {hasImage ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: exerciseImageUrl(exercise.id, 0) }}
            style={[styles.thumb, { backgroundColor: colors.muted }]}
            resizeMode="cover"
          />
        ) : (
          <IconChip icon={exercise.custom ? 'person' : 'barbell'} size="lg" />
        )}
        <View style={styles.rowText}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {name}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {[muscles, t(`coach:equipment.${exercise.equipment}`)].filter(Boolean).join(' - ')}
          </AppText>
        </View>
        {inWorkout ? <Ionicons name="checkmark-circle" size={20} color={colors.mutedForeground} accessibilityLabel={t('strength:picker.inWorkout')} /> : null}
        {multi ? (
          <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={24} color={checked ? colors.primary : colors.mutedForeground} />
        ) : null}
      </PressableScale>
      {exercise.custom ? (
        <PressableScale accessibilityRole="button" accessibilityLabel={t('strength:picker.edit', { name })} onPress={() => onEdit(exercise)} style={styles.iconButton}>
          <Ionicons name="create-outline" size={20} color={colors.mutedForeground} />
        </PressableScale>
      ) : null}
    </View>
  );
});

interface ExerciseFormProps {
  /** `new` creates, an exercise edits, null closes. */
  target: CatalogExercise | 'new' | null;
  onClose: () => void;
  /** The id of the saved exercise. */
  onSaved: (id: string | null) => void;
  onDeleted: (id: string) => void;
}

/** The sheet to create, edit or delete an exercise of the person's own. */
function ExerciseForm({ target, onClose, onSaved, onDeleted }: ExerciseFormProps) {
  const { t } = useTranslation(['strength', 'coach', 'common']);
  const db = useSQLiteContext();
  const [name, setName] = useState('');
  const [primary, setPrimary] = useState<Muscle[]>([]);
  const [equipment, setEquipment] = useState<Equipment>('dumbbell');
  const [timed, setTimed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const existing = target !== null && target !== 'new' ? target : null;

  // Opening for another target (or the first one) fills the form from it.
  const [seenTarget, setSeenTarget] = useState<typeof target | undefined>(undefined);
  if (seenTarget !== target) {
    setSeenTarget(target);
    if (target !== null) {
      setName(existing?.name.id ?? '');
      setPrimary(existing ? [...existing.primary] : []);
      setEquipment(existing?.equipment ?? 'dumbbell');
      setTimed(existing?.timed ?? false);
      setConfirmDelete(false);
    }
  }

  const valid = name.trim().length > 0 && primary.length > 0;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const now = Date.now();
      const doc: CustomExercise = {
        id: existing?.id ?? newId('custom_', now),
        name: name.trim(),
        primary,
        equipment,
        timed,
        updatedAt: now,
        deletedAt: null,
      };
      await saveCustomExercise(db, doc);
      onSaved(doc.id);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await deleteCustomExercise(db, {
        id: existing.id,
        name: existing.name.id,
        primary: [...existing.primary],
        equipment: existing.equipment,
        timed: existing.timed,
        updatedAt: Date.now(),
        deletedAt: null,
      });
      onDeleted(existing.id);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <BottomSheet visible={target !== null} onClose={onClose} title={existing ? t('strength:picker.formEdit') : t('strength:picker.formNew')}>
        <Field label={t('strength:picker.formName')} value={name} onChangeText={setName} autoCapitalize="sentences" maxLength={60} returnKeyType="done" />
        <AppText variant="label" muted>
          {t('strength:picker.formMuscles')}
        </AppText>
        <View style={styles.wrap}>
          {muscleList.map((m) => (
            <Chip
              key={m}
              label={t(`coach:muscle.${m}`)}
              selected={primary.includes(m)}
              role="checkbox"
              onPress={() => setPrimary((current) => (current.includes(m) ? current.filter((x) => x !== m) : [...current, m]))}
            />
          ))}
        </View>
        <AppText variant="label" muted>
          {t('strength:picker.formEquipment')}
        </AppText>
        <View style={styles.wrap}>
          {EQUIPMENT.map((e) => (
            <Chip key={e} label={t(`coach:equipment.${e}`)} selected={equipment === e} onPress={() => setEquipment(e)} />
          ))}
        </View>
        <AppText variant="label" muted>
          {t('strength:picker.formMeasure')}
        </AppText>
        <Segmented
          options={[
            { value: 'reps', label: t('strength:table.reps') },
            { value: 'time', label: t('strength:table.time') },
          ]}
          value={timed ? 'time' : 'reps'}
          onChange={(value) => setTimed(value === 'time')}
        />
        <AppText variant="caption" muted>
          {t('strength:picker.formMeasureHint')}
        </AppText>
        <Button label={t('common:actions.save')} variant="primary" disabled={!valid} loading={busy} onPress={() => void save()} />
        {existing ? <Button label={t('common:actions.delete')} variant="destructive" icon="trash-outline" onPress={() => setConfirmDelete(true)} /> : null}
      </BottomSheet>
      <ConfirmDialog
        visible={confirmDelete}
        title={t('strength:picker.deleteTitle')}
        message={t('strength:picker.deleteMessage')}
        confirmLabel={t('common:actions.delete')}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, minHeight: 56 },
  headerTitle: { flex: 1, textAlign: 'center' },
  iconButton: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  search: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  filters: { gap: 2, paddingBottom: spacing.xs },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  sectionHeader: { height: HEADER_HEIGHT, justifyContent: 'flex-end', paddingBottom: 4 },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center' },
  rowMain: { flex: 1, height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 1 },
  thumb: { width: 48, height: 48, borderRadius: 24 },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
