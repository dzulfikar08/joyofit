import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, PermissionsAndroid, type Permission } from 'react-native';

import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { isIos } from '@/components/IosUnavailable';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { locationGranted } from '@/features/sensors/permissions';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';

const { PERMISSIONS, RESULTS } = PermissionsAndroid;

/**
 * Asks for [required] and then for the optional ones in the same dialog sequence. Resolves with
 * whether every required permission is granted and whether Android will no longer show the dialog.
 */
async function ask(required: Permission[], optional: Permission[]) {
  const results = await PermissionsAndroid.requestMultiple([...required, ...optional]);
  const granted = required.every((p) => results[p] === RESULTS.GRANTED);
  const blocked = required.some((p) => results[p] === RESULTS.NEVER_ASK_AGAIN);
  return { granted, blocked };
}

/** Find my phone, incoming calls on the watch and call control from the watch. */
export function PhoneSection() {
  return isIos ? <PhoneSectionIos /> : <PhoneSectionAndroid />;
}

/** What iOS does not allow, said once per feature instead of three switches that cannot work. */
function PhoneSectionIos() {
  const { t } = useTranslation('settings');
  const [gps, setGps] = useState<boolean | null>(null);
  const checkGps = useCallback(() => {
    void locationGranted().then(setGps);
  }, []);
  useEffect(checkGps, [checkGps]);
  useNativeRefresh(checkGps);

  return (
    <Section title={t('phone.title')} icon="call">
      <PairGrid>
        <Pair label={t('phone.gps')} value={gps === null ? null : gps ? t('phone.granted') : t('phone.notGranted')} />
      </PairGrid>
      {gps === false ? (
        <Button
          label={t('phone.appSettings')}
          variant="secondary"
          icon="settings-outline"
          onPress={() => void Linking.openSettings()}
        />
      ) : null}
      <Notice icon="locate">{t('phone.iosFind')}</Notice>
      <Notice icon="call">{t('phone.iosCalls')}</Notice>
      <Details>{t('phone.iosDetails')}</Details>
    </Section>
  );
}

function PhoneSectionAndroid() {
  const { t } = useTranslation('settings');
  const [features, setFeatures] = useState(() => HuaweiWear.getPhoneFeatures());
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const [gps, setGps] = useState<boolean | null>(null);
  const checkGps = useCallback(
    () => void PermissionsAndroid.check(PERMISSIONS.ACCESS_FINE_LOCATION).then(setGps),
    [],
  );
  useEffect(checkGps, [checkGps]);

  const refresh = useCallback(() => {
    setFeatures(HuaweiWear.getPhoneFeatures());
    checkGps();
  }, [checkGps]);
  useNativeRefresh(refresh);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      refresh();
    }
  };

  const toggleCalls = (enabled: boolean) =>
    run(async () => {
      setBlocked(false);
      if (enabled) {
        const result = await ask(
          [PERMISSIONS.READ_PHONE_STATE],
          features.callerIdSupported ? [PERMISSIONS.READ_CALL_LOG, PERMISSIONS.READ_CONTACTS] : [],
        );
        if (!result.granted) {
          setBlocked(result.blocked);
          setError(t('phone.errPhoneState'));
          return;
        }
      }
      await HuaweiWear.setCallsEnabled(enabled);
    });

  const toggleCallControl = (enabled: boolean) =>
    run(async () => {
      setBlocked(false);
      if (enabled) {
        const result = await ask([PERMISSIONS.ANSWER_PHONE_CALLS], []);
        if (!result.granted) {
          setBlocked(result.blocked);
          setError(t('phone.errAnswer'));
          return;
        }
      }
      await HuaweiWear.setCallControlEnabled(enabled);
    });

  return (
    <Section title={t('phone.title')} icon="call">
      <SwitchRow
        icon="locate"
        label={t('phone.findPhone')}
        value={features.findPhoneEnabled}
        onValueChange={(enabled) => run(() => HuaweiWear.setFindPhoneEnabled(enabled))}
      />
      <SwitchRow
        icon="call"
        label={t('phone.showCalls')}
        value={features.callsEnabled}
        onValueChange={toggleCalls}
      />
      <SwitchRow
        icon="call-outline"
        label={t('phone.callControl')}
        value={features.callControlEnabled}
        onValueChange={toggleCallControl}
      />
      <PairGrid>
        <Pair label={t('phone.phoneState')} value={features.readPhoneState ? t('phone.granted') : t('phone.notGranted')} />
        <Pair label={t('phone.answerCalls')} value={features.answerPhoneCalls ? t('phone.granted') : t('phone.notGranted')} />
        {features.callerIdSupported ? (
          <>
            <Pair label={t('phone.callLog')} value={features.readCallLog ? t('phone.granted') : t('phone.notGranted')} />
            <Pair label={t('phone.contacts')} value={features.readContacts ? t('phone.granted') : t('phone.notGranted')} />
          </>
        ) : null}
        <Pair label={t('phone.gps')} value={gps === null ? null : gps ? t('phone.granted') : t('phone.notGranted')} />
      </PairGrid>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {gps === false || blocked ? (
        <ButtonRow>
          {gps === false ? (
            <Button
              label={t('phone.allowLocation')}
              variant="secondary"
              icon="location"
              onPress={() =>
                run(async () => {
                  setBlocked(false);
                  const result = await PermissionsAndroid.request(PERMISSIONS.ACCESS_FINE_LOCATION);
                  setBlocked(result === RESULTS.NEVER_ASK_AGAIN);
                })
              }
            />
          ) : null}
          {blocked ? (
            <Button
              label={t('phone.appSettings')}
              variant="secondary"
              icon="settings-outline"
              onPress={() => void Linking.openSettings()}
            />
          ) : null}
        </ButtonRow>
      ) : null}
      <Details>
        {`${features.callerIdSupported ? t('phone.callerIdDetails') : t('phone.noCallerIdDetails')}\n\n${t('phone.findDetails')}`}
      </Details>
    </Section>
  );
}
