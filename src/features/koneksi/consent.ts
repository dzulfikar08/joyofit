import type { AiSettings, SettingsStore } from '@/features/ai/settings';
import { MCP_DATA_SCOPES } from './scopes';

/**
 * The version of the AI connector consent text and of the list of data an AI app can read through JoyoRogo's connector. Change
 * {@link CONNECTOR_CONSENT_SCOPES} (that is `MCP_DATA_SCOPES`, which follows JoyoRogo's) and this number together: `consent.test.ts`
 * pins the list to the version, so a changed list without a new version fails the build, and everyone is asked again
 * (Apple 5.1.1(i), 5.1.2(i)).
 */
export const CONNECTOR_CONSENT_VERSION = 1;

/** The kinds of data the consent card lists, in order (`koneksi:scope.<key>`). */
export const CONNECTOR_CONSENT_SCOPES = MCP_DATA_SCOPES;

/** Section of the privacy policy that describes the AI connector (`site/src/Privasi.tsx`, ids `koneksi-ai` and `koneksi-ai-en`). */
export const CONNECTOR_PRIVACY_ANCHOR = { id: 'koneksi-ai', en: 'koneksi-ai-en' } as const;

/** The connector address is shown (and can be copied) only after a yes for the current {@link CONNECTOR_CONSENT_VERSION}. */
export function hasConnectorConsent(settings: Pick<AiSettings, 'connectorConsent'>): boolean {
  return settings.connectorConsent?.version === CONNECTOR_CONSENT_VERSION;
}

/** Records the explicit yes of this phone (a tap on "Agree and show address" after the card listed the data and the recipients). */
export function grantConnectorConsent(store: SettingsStore, nowSec: number): void {
  store.update({ connectorConsent: { version: CONNECTOR_CONSENT_VERSION, at: nowSec } });
}

/** Withdraws the yes: the address is hidden again. Disconnecting the apps already connected is the caller's part (`rogo.mcp.revoke`). */
export function withdrawConnectorConsent(store: SettingsStore): void {
  store.update({ connectorConsent: null });
}

/** What the connector section shows: the upgrade card (no Pro), the consent card (Pro, no yes yet) or the address (Pro and a yes). */
export type ConnectorView = 'upgrade' | 'consent' | 'address';

export function connectorView(unlocked: boolean, settings: Pick<AiSettings, 'connectorConsent'>): ConnectorView {
  if (!unlocked) return 'upgrade';
  return hasConnectorConsent(settings) ? 'address' : 'consent';
}
