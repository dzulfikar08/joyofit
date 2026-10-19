import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

import { APP_BUILD } from '@/cloud/build';
import { ATUR_FEEDBACK_TOKEN, ATUR_FEEDBACK_URL, ATUR_REPORTS_ENABLED } from '@/features/device/aturConfig';
import { buildReport, sendReport, type PendingReport, type Reporter } from '@/features/device/aturReport';
import { createReportQueue, type Submitted } from '@/features/device/aturReportQueue';
import { getLocale } from '@/i18n';
import { HuaweiWear } from '@/wear';

export { ReportRefusedError } from '@/features/device/aturReportQueue';

const QUEUE_KEY = 'support.aturQueue';

const queue = createReportQueue({
  store: {
    read: () => Storage.getItem(QUEUE_KEY),
    write: (value) => Storage.setItem(QUEUE_KEY, value),
  },
  send: (report: PendingReport) =>
    sendReport(report, {
      fetch,
      baseUrl: ATUR_FEEDBACK_URL,
      token: ATUR_FEEDBACK_TOKEN,
      writeTempFile: (name, text) => {
        const file = new File(Paths.cache, name);
        file.write(text);
        return { uri: file.uri, remove: () => file.delete() };
      },
    }),
});

/**
 * Collects the support report (the native side redacts Bluetooth addresses and the serial number) and files it in Atur.
 * `queued` means there was no usable network: it is stored and goes out by itself. Throws `ReportRefusedError` when Atur refuses it.
 */
export async function sendSupportReport(message: string, reporter: Reporter): Promise<Submitted> {
  if (!ATUR_REPORTS_ENABLED) throw new Error('Atur reports are not configured');
  const report = await HuaweiWear.getSupportReport();
  return queue.submit(
    buildReport(report, {
      id: Crypto.randomUUID(),
      now: Date.now(),
      message,
      reporter,
      env: {
        appVersion: Constants.expoConfig?.version ?? null,
        build: APP_BUILD,
        platform: Platform.OS,
        os: String(Platform.Version),
        locale: getLocale(),
      },
    }),
  );
}

/** Sends the reports parked while the phone was offline; a no-op when there are none or no board is configured. */
export async function flushSupportReports(): Promise<void> {
  if (!ATUR_REPORTS_ENABLED) return;
  await queue.flush().catch(() => 0);
}
