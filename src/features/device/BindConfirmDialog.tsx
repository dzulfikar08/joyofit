import { useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { isIos } from '@/components/IosUnavailable';
import { useWatch } from '@/state/WatchProvider';

/**
 * Asks before a first bind (ERR_BIND_CONFIRMATION): binding replaces the watch's current phone pairing. Shown by the Watch tab and by
 * the setup guide, whichever is on screen (both stay mounted in the tab navigator); `confirmBind` then connects again and the watch
 * asks for its own accept. A watch that forgot this phone's binding (`lost`) gets the text that names the usual cause, Huawei Health
 * re-pairing it by itself (JRG-414), so the person stops that before binding again.
 */
export function BindConfirmDialog() {
  const { t } = useTranslation('watch');
  const watch = useWatch();
  const focused = useIsFocused();
  return (
    <ConfirmDialog
      visible={focused && watch.bindRequest !== null}
      title={t('device.bind.title')}
      message={t(bindMessageKey(watch.bindRequest?.lost === true))}
      confirmLabel={t('device.bind.continue')}
      onConfirm={() => void watch.confirmBind()}
      onCancel={watch.cancelBind}
    />
  );
}

function bindMessageKey(lost: boolean) {
  if (lost) return isIos ? 'device.bind.lostIos' : 'device.bind.lostAndroid';
  return isIos ? 'device.bind.messageIos' : 'device.bind.messageAndroid';
}
