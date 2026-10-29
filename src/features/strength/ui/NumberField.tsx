import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, TextInput, type StyleProp, type ViewStyle } from 'react-native';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { fontSize, useTheme } from '@/theme';

import { clampReps, digitsClock, digitsFromSeconds, inputText, MAX_DURATION_DIGITS, parseNumber, parseWeight, secondsFromDigits, timerText, weightInputText } from '../logFormat';
import { useWeightUnit } from '../useWeightUnit';

export type FieldKind = 'weight' | 'reps' | 'seconds';

interface NumberFieldProps {
  kind: FieldKind;
  value: number | null;
  /** Shown in grey while the field is empty: what ticking the row would copy. */
  hint?: string;
  label: string;
  done: boolean;
  /** Bumps to make the field shake and turn red (a refused tick). */
  flash: number;
  onChange: (value: number | null) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * What the box keeps as text: digits for a time (see `secondsFromDigits`), the typed number otherwise. A weight is typed and shown in
 * the chosen unit while `value` and `onChange` stay kg.
 */
const parse = (kind: FieldKind, text: string): number | null => {
  if (kind === 'seconds') return secondsFromDigits(text);
  if (kind === 'weight') return parseWeight(text);
  return clampReps(parseNumber(text));
};

const textOf = (kind: FieldKind, value: number | null): string =>
  kind === 'seconds' ? digitsFromSeconds(value) : kind === 'weight' ? weightInputText(value) : inputText(value);

/**
 * A number box of the set table: comma or dot decimals, everything selected on focus. A time is typed like a kitchen timer ("1", "3", "0"
 * read 0:01, 0:13, 1:30) and shown as `m:ss`, also when not being edited. Weight and reps keep what is typed ("7," stays "7,"); the value
 * goes up on every keystroke.
 */
export function NumberField({ kind, value, hint, label, done, flash, onChange, style }: NumberFieldProps) {
  const { colors, fonts, radius } = useTheme();
  const reduced = useReducedMotion();
  // The box is memoised with its row: a switch of kg and lb has to reach it from here (the text is shown again in the new unit).
  const unit = useWeightUnit();
  const [text, setText] = useState(() => textOf(kind, value));
  const [focused, setFocused] = useState(false);
  const [shake] = useState(() => new Animated.Value(0));
  const [warn, setWarn] = useState(false);
  const lastFlash = useRef(flash);

  // The value changed from outside (a tap on "previous", a tick that filled the row, a stopwatch): show it.
  const [synced, setSynced] = useState({ value, kind, unit });
  if (synced.value !== value || synced.kind !== kind || synced.unit !== unit) {
    setSynced({ value, kind, unit });
    if (parse(kind, text) !== value) setText(textOf(kind, value));
  }

  useEffect(() => {
    if (flash === lastFlash.current) return;
    lastFlash.current = flash;
    setWarn(true);
    const timeout = setTimeout(() => setWarn(false), 900);
    if (!reduced) {
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 90, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]).start();
    }
    return () => clearTimeout(timeout);
  }, [flash, reduced, shake]);

  const shown = kind === 'seconds' ? (focused ? digitsClock(text) : value !== null ? timerText(value) : '') : text;
  return (
    <Animated.View
      style={[
        styles.box,
        {
          backgroundColor: warn ? colors.destructiveSoft : done ? colors.workoutsSoft : colors.muted,
          borderRadius: radius.input,
          borderColor: warn ? colors.destructive : 'transparent',
          transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) }],
        },
        style,
      ]}>
      <TextInput
        accessibilityLabel={label}
        value={shown}
        placeholder={hint}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        keyboardType={kind === 'weight' ? 'decimal-pad' : 'number-pad'}
        selectTextOnFocus
        maxLength={kind === 'seconds' ? MAX_DURATION_DIGITS + 2 : 8}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={(next) => {
          const clean = kind === 'weight' ? next.replace(/[^0-9.,]/g, '') : next.replace(/[^0-9]/g, '');
          const kept = kind === 'seconds' ? clean.slice(0, MAX_DURATION_DIGITS) : clean;
          setText(kept);
          onChange(parse(kind, kept));
        }}
        style={[styles.input, { color: colors.foreground, fontFamily: fonts.bold }]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { height: 40, justifyContent: 'center', borderWidth: 1.5, minWidth: 0 },
  input: { fontSize: fontSize.base, padding: 0, textAlign: 'center', height: 40 },
});
