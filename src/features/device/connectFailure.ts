import { errorMessage } from '@/format';
import { t } from '@/i18n';

/** What the Watch tab does with a rejected `HuaweiWear.connect`. */
export type ConnectFailure =
  /** The watch does not know this phone: ask the user before a bind replaces its current phone pairing. */
  | { kind: 'bind' }
  /** The Bluetooth link came up but the watch never answered the first request: the checklist and the report button. */
  | { kind: 'silent'; message: string }
  /** The watch could not be reached or refused the link: say what to check, offer Retry. */
  | { kind: 'unreachable'; message: string }
  /** Android has no Bluetooth pairing with the Classic watch any more: say so and what to do; Retry asks Android to pair again. */
  | { kind: 'unpaired'; message: string }
  /** Anything else (Bluetooth off, not allowed, unsupported model, ...): the plain message. */
  | { kind: 'other'; message: string };

export const BIND_CONFIRMATION = 'ERR_BIND_CONFIRMATION';

/** Android: a Classic watch could not be reached while Android has no Bluetooth pairing with it (nothing was removed or reset). */
export const NOT_PAIRED = 'ERR_NOT_PAIRED';

/** The one place that tells the person what usually blocks a connect: the watch's single link is held elsewhere. */
export const watchBusyHint = () => t('watch:device.hint.busy');

const UNREACHABLE_CODES: Record<string, true> = {
  ERR_CONNECT_FAILED: true,
  ERR_TIMEOUT: true,
  ERR_DISCONNECTED: true,
  ERR_AUTH_FAILED: true,
};

export function errorCode(e: unknown): string | null {
  if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string') return e.code;
  return null;
}

/**
 * The link is up and notifications are on, but the watch never answered LinkParams, the first request of the handshake
 * ("Authentication timed out: LinkParams: no response (service 0x01, command 0x01) within 10000 ms"). The Swift and the Kotlin
 * authenticators both word it that way; the part after "no response" differs by build.
 */
export function isSilentWatch(e: unknown): boolean {
  return errorCode(e) === 'ERR_TIMEOUT' && /LinkParams: no response/.test(errorMessage(e));
}

/** The checks for a watch that connects and then says nothing, most likely first. iOS has the Bluetooth settings entry to forget. */
export function silentWatchSteps(platform: 'ios' | 'android'): string[] {
  const steps = [t('watch:device.silent.step.release')];
  if (platform === 'ios') steps.push(t('watch:device.silent.step.forgetIos'));
  steps.push(t('watch:device.silent.step.restart'), t('watch:device.silent.step.bluetooth'));
  return steps;
}

export function describeConnectFailure(e: unknown): ConnectFailure {
  const code = errorCode(e);
  if (code === BIND_CONFIRMATION) return { kind: 'bind' };
  if (code === NOT_PAIRED) return { kind: 'unpaired', message: t('watch:device.hint.notPaired') };
  if (isSilentWatch(e)) return { kind: 'silent', message: t('watch:device.silent.short') };
  if (code !== null && UNREACHABLE_CODES[code]) return { kind: 'unreachable', message: watchBusyHint() };
  return { kind: 'other', message: errorMessage(e) };
}

/** Shown when the list has no watch that is in reach on iOS (a watch linked to another phone does not advertise). */
export const noWatchFoundHint = () => t('watch:device.hint.noWatchIos');

/** Android: a scan that saw no watch. The same cause as on iOS, a watch linked to another phone or app does not advertise. */
export const noWatchFoundScanHint = () => t('watch:device.hint.noWatchScan');
