import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider, Section } from '@/components/Screen';
import { SwitchRow } from '@/components/SwitchRow';
import { pushLog, useLogBuffer } from '@/state/logStore';
import { spacing, useColors } from '@/theme';

import type { DiscoveredDevice } from '../discovery';
import { scaleHub } from '../instance';
import { ScaleRecorder } from '../recorder';
import { buildRecordingReport, scaleLogLines } from '../report';

interface RecordSectionProps {
  devices: readonly DiscoveredDevice[];
}

/**
 * "Rekam data timbangan": for a scale JoyoFit does not read yet. The person ticks the devices from the search list, records while stepping
 * on the scale, then copies or shares the log lines (address, name, services, manufacturer data and every notification as hex).
 */
export function RecordSection({ devices }: RecordSectionProps) {
  const { t } = useTranslation('scale');
  const colors = useColors();
  const log = useLogBuffer();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [connect, setConnect] = useState(true);
  const [recording, setRecording] = useState(false);
  const [copied, setCopied] = useState(false);
  const recorder = useRef<ScaleRecorder | null>(null);

  useEffect(
    () => () => {
      recorder.current?.stop();
    },
    [],
  );

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const start = async () => {
    recorder.current?.stop();
    recorder.current = new ScaleRecorder(scaleHub, (line) =>
      pushLog({ ts: line.ts, direction: line.direction, serviceId: null, commandId: null, hex: line.hex, message: line.message }),
    );
    setRecording(true);
    try {
      await recorder.current.start([...picked], { connect });
    } catch {
      setRecording(false);
    }
  };

  const stop = () => {
    recorder.current?.stop();
    setRecording(false);
  };

  const events = log.map((e) => e.event);
  const lineCount = scaleLogLines(events).length;
  const report = () =>
    buildRecordingReport(events, {
      platform: Platform.OS,
      osVersion: Platform.Version,
      appVersion: Constants.expoConfig?.version ?? null,
      now: Date.now(),
    });

  const copy = async () => {
    const text = report();
    if (!text) return;
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const share = async () => {
    const text = report();
    if (text) await Share.share({ message: text, title: t('record.shareTitle') });
  };

  return (
    <Section title={t('record.title')} icon="radio-outline">
      <AppText variant="caption" muted>
        {t('record.body')}
      </AppText>
      {devices.length === 0 ? (
        <AppText variant="caption" muted>
          {t('record.none')}
        </AppText>
      ) : (
        <View>
          <AppText variant="label" muted>
            {t('record.pick')}
          </AppText>
          {devices.map((device, index) => {
            const on = picked.has(device.id);
            return (
              <View key={device.id}>
                {index > 0 ? <Divider /> : null}
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: recording }}
                  disabled={recording}
                  onPress={() => toggle(device.id)}
                  style={styles.row}>
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.mutedForeground} />
                  <View style={styles.text}>
                    <AppText variant="bodyStrong">{device.name ?? t('picker.unnamed')}</AppText>
                    <AppText variant="caption" muted selectable>
                      {device.id}
                    </AppText>
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
      <SwitchRow label={t('record.connect')} hint={t('record.connectHint')} value={connect} onValueChange={setConnect} disabled={recording} />
      {recording ? (
        <>
          <AppText variant="caption">{t('record.recording', { count: picked.size })}</AppText>
          <Button label={t('record.stop')} icon="stop-circle-outline" onPress={stop} />
        </>
      ) : (
        <Button label={t('record.start')} icon="radio-button-on" variant="primary" disabled={picked.size === 0} onPress={() => void start()} />
      )}
      {lineCount > 0 ? (
        <>
          <AppText variant="caption" muted>
            {t('record.lines', { count: lineCount })}
          </AppText>
          <Button label={copied ? t('record.copied') : t('record.copy')} icon="copy-outline" done={copied} onPress={() => void copy()} />
          <Button label={t('record.share')} icon="share-outline" onPress={() => void share()} />
        </>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, minHeight: 48 },
  text: { flex: 1, gap: 1 },
});
