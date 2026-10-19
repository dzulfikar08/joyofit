import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider, Section } from '@/components/Screen';
import { fmtDecimal } from '@/i18n/format';
import type { Granted } from '@/features/sensors/permissions';
import { Signal } from '@/features/sensors/ui/parts';
import { spacing } from '@/theme';

import type { DiscoveredDevice } from '../discovery';
import type { Discovery } from './useDiscovery';

interface ScalePickerProps {
  discovery: Discovery;
  /** The id of the scale already in use. */
  currentId: string | null;
  onPermission: (granted: Granted) => void;
  onPick: (device: DiscoveredDevice) => void;
}

/** Search for a scale and pick it. The first search is preceded by what it does and a "Lanjut" (it is what raises the iOS prompt). */
export function ScalePicker({ discovery, currentId, onPermission, onPick }: ScalePickerProps) {
  const { t } = useTranslation('scale');
  const [explained, setExplained] = useState(false);
  const scales = discovery.devices.filter((d) => d.protocolId !== null);
  const startedOnce = discovery.searching || discovery.devices.length > 0;

  const begin = async () => {
    onPermission(await discovery.start());
  };

  return (
    <Section title={t('picker.title')} icon="search">
      {!explained && !startedOnce ? (
        <>
          <AppText variant="caption" muted>
            {t('picker.explain')}
          </AppText>
          <Button
            label={t('picker.continue')}
            variant="primary"
            onPress={() => {
              setExplained(true);
              void begin();
            }}
          />
        </>
      ) : (
        <>
          <AppText variant="caption" muted>
            {t('picker.hint')}
          </AppText>
          {discovery.searching ? (
            <Button label={t('picker.stopSearch')} icon="stop-circle-outline" onPress={discovery.stop} />
          ) : (
            <Button label={t('picker.search')} icon="search" variant="primary" onPress={() => void begin()} />
          )}
          {discovery.searching && scales.length === 0 ? (
            <AppText variant="caption" muted>
              {discovery.devices.length === 0 ? t('picker.none') : t('picker.searching')}
            </AppText>
          ) : null}
          {scales.length > 0 ? (
            <View style={styles.list}>
              <AppText variant="label" muted>
                {t('picker.scales')}
              </AppText>
              {scales.map((device, index) => (
                <View key={device.id}>
                  {index > 0 ? <Divider /> : null}
                  <View style={styles.row}>
                    <View style={styles.text}>
                      <AppText variant="bodyStrong">{device.name ?? t('picker.unnamed')}</AppText>
                      <AppText variant="caption" muted>
                        {device.protocolLabel}
                      </AppText>
                      {device.preview ? (
                        <AppText variant="caption">{t('picker.reading', { value: fmtDecimal(device.preview.weightKg, 1) })}</AppText>
                      ) : null}
                      <Signal rssi={device.rssi} />
                    </View>
                    <Button
                      label={device.id === currentId ? t('picker.chosen') : t('picker.pick')}
                      variant={device.id === currentId ? 'secondary' : 'primary'}
                      disabled={device.id === currentId}
                      onPress={() => onPick(device)}
                    />
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  text: { flex: 1, gap: 2 },
});
