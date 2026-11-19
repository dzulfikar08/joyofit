import { hasConnectorConsent } from '@/features/koneksi/consent';
import type { ByokAccess } from './access';
import { CONSENT_VERSION } from './consent';
import { hasHostedConsent } from './hostedConsent';
import { PROVIDER_ORDER } from './providers';
import type { AiSettings } from './settings';
import type { ProviderId } from './types';

/**
 * What the Joyo AI chat screen shows instead of the conversation, decided before anything can be sent:
 * - `rogoConsent`: the hosted engine would answer (Pro) but this phone has no yes for the current list of data. The chat is
 *   replaced by the full-screen consent (`HostedConsentGate`): no history, no composer, nothing sent until Allow.
 * - `blocked`: the own-key engine cannot answer (no key, no consent for that provider, under 18, bad URL); its card leads to setup,
 *   where the provider's own consent is given.
 * Apple 5.1.1(i), 5.1.2(i): every AI request is behind one of these yeses.
 */
export type ChatGate = 'checking' | 'rogoSignIn' | 'rogoUpsell' | 'rogoConsent' | 'blocked' | 'ready';

export function chatGate(input: {
  settings: Pick<AiSettings, 'engine' | 'hostedConsent'>;
  access: ByokAccess | null;
  coachAccess: 'checking' | 'signedOut' | 'free' | 'pro';
}): ChatGate {
  const { settings, access, coachAccess } = input;
  if (settings.engine === 'rogo') {
    if (coachAccess === 'checking') return 'checking';
    if (coachAccess === 'signedOut') return 'rogoSignIn';
    if (coachAccess === 'free') return 'rogoUpsell';
    return hasHostedConsent(settings) ? 'ready' : 'rogoConsent';
  }
  if (access === null) return 'checking';
  return access.ok ? 'ready' : 'blocked';
}

/** One recipient of personal data through an AI feature, as Settings, "AI and your data" lists it. */
export type AiRecipient =
  | { kind: 'hosted'; granted: boolean; at: number | null }
  | { kind: 'own'; provider: ProviderId; host: string; at: number }
  | { kind: 'connector'; granted: boolean; at: number | null };

/**
 * Every AI recipient this phone may send data to, and whether the person said yes: the hosted Joyo AI (JoyoRogo's server and
 * Cloudflare Workers AI), each own-key provider with a valid yes (current `CONSENT_VERSION`), and the AI connector (Claude, ChatGPT or
 * another MCP app reading the JoyoRogo account). Own-key providers without a valid yes are left out: nothing can go to them.
 */
export function aiRecipients(settings: Pick<AiSettings, 'hostedConsent' | 'consents' | 'connectorConsent'>): AiRecipient[] {
  const hosted = hasHostedConsent(settings);
  const connector = hasConnectorConsent(settings);
  const own: AiRecipient[] = [];
  for (const provider of PROVIDER_ORDER) {
    const record = settings.consents[provider];
    if (record && record.version === CONSENT_VERSION) own.push({ kind: 'own', provider, host: record.host, at: record.at });
  }
  return [
    { kind: 'hosted', granted: hosted, at: hosted ? (settings.hostedConsent?.at ?? null) : null },
    ...own,
    { kind: 'connector', granted: connector, at: connector ? (settings.connectorConsent?.at ?? null) : null },
  ];
}
