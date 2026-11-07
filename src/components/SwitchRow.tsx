import { StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { MoreText } from '@/components/MoreText';
import { HIT, spacing, useColors } from '@/theme';

interface SwitchRowProps {
  label: string;
  /** One short line under the label: what it does, or why it is unavailable. Long hints show their first sentence and "More". */
  hint?: string;
  icon?: IconName;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export function SwitchRow({ label, hint, icon, value, onValueChange, disabled }: SwitchRowProps) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      {icon ? <IconChip icon={icon} size="sm" /> : null}
      <View style={styles.text}>
        <AppText variant="bodyStrong" muted={disabled}>
          {label}
        </AppText>
        {hint ? <MoreText muted>{hint}</MoreText> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.switchOff, true: colors.primary }}
        thumbColor={value ? colors.primaryForeground : colors.card}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: HIT },
  text: { flex: 1, gap: 1 },
});
