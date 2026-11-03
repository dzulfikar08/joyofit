import { HostedConsentError, hasHostedConsent } from './hostedConsent';
import type { AiSettings } from './settings';

/**
 * The one door to the hosted Joyo AI. Wraps the function that really sends a chat turn (JoyoRogo's `coach/chat`) so that it cannot run
 * without the person's consent: the settings are read at the moment of the call, not when the screen was drawn, so a withdrawal or a
 * new consent version closes it at once. Nothing is built or sent before the check passes (the callers build the snapshot inside the
 * argument list, which is cheap and local; the check throws before `send` sees it).
 */
export function guardHosted<Args extends unknown[], R>(settings: { get(): Pick<AiSettings, 'hostedConsent'> }, send: (...args: Args) => Promise<R>): (...args: Args) => Promise<R> {
  return async (...args) => {
    if (!hasHostedConsent(settings.get())) throw new HostedConsentError();
    return send(...args);
  };
}
