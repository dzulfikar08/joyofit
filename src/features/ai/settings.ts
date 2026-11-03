import type { KvStore } from './kv';
import { PROVIDER_IDS, type Engine, type ProviderId } from './types';

const KEY = 'joyofit.ai.settings';

export interface ConsentRecord {
  /** `CONSENT_VERSION` the person said yes to. */
  version: number;
  /** Unix seconds. */
  at: number;
  /** The endpoint host the yes covers (a custom URL is a different recipient). */
  host: string;
  /** The person confirmed they are 18 or older. */
  adult: true;
}

/** The yes of this phone to the hosted Joyo AI (JoyoRogo's server and Cloudflare Workers AI); see `hostedConsent.ts`. */
export interface HostedConsentRecord {
  /** `HOSTED_CONSENT_VERSION` the person said yes to. */
  version: number;
  /** Unix seconds. */
  at: number;
}

export interface AiSettings {
  engine: Engine;
  provider: ProviderId | null;
  /** The chosen model per provider. */
  models: Partial<Record<ProviderId, string>>;
  /** The endpoint of the `custom` provider. */
  customBaseUrl: string;
  /** A key is stored for the provider (the key itself lives in the secure store). */
  keySaved: Partial<Record<ProviderId, true>>;
  consents: Partial<Record<ProviderId, ConsentRecord>>;
  /** Null until the person agreed (or after they withdrew): nothing goes to the hosted engine then. */
  hostedConsent: HostedConsentRecord | null;
  insightDaily: boolean;
  insightWeekly: boolean;
  /** Ask thinking models to answer without long reasoning: faster and cheaper, sometimes less thorough. */
  fastMode: boolean;
  /** A JSON object sent in place of the built-in fast-mode fields, for a server that wants something else (`{"reasoning_effort":"low"}`). Empty = the built-in ones. */
  fastFields: string;
  /** Provider calls per day the phone allows itself (tool rounds count). */
  dailyCeiling: number;
  /** `provider:model` pairs that answered "no tool calling": they run on the digest alone. */
  noTools: string[];
}

export const DEFAULT_CEILING = 40;
export const MIN_CEILING = 5;
export const MAX_CEILING = 200;

export const DEFAULT_SETTINGS: AiSettings = {
  engine: 'rogo',
  provider: null,
  models: {},
  customBaseUrl: '',
  keySaved: {},
  consents: {},
  hostedConsent: null,
  insightDaily: false,
  insightWeekly: false,
  fastMode: true,
  fastFields: '',
  dailyCeiling: DEFAULT_CEILING,
  noTools: [],
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isProvider = (v: unknown): v is ProviderId => typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v);

/** Builds settings from stored JSON, keeping every field that is valid and falling back per field, so one bad value never loses the rest. */
export function parseSettings(value: unknown): AiSettings {
  if (!isObject(value)) return DEFAULT_SETTINGS;
  const models: AiSettings['models'] = {};
  const keySaved: AiSettings['keySaved'] = {};
  const consents: AiSettings['consents'] = {};
  if (isObject(value.models)) for (const [k, v] of Object.entries(value.models)) if (isProvider(k) && typeof v === 'string' && v.length <= 200) models[k] = v;
  if (isObject(value.keySaved)) for (const [k, v] of Object.entries(value.keySaved)) if (isProvider(k) && v === true) keySaved[k] = true;
  if (isObject(value.consents)) {
    for (const [k, v] of Object.entries(value.consents)) {
      if (isProvider(k) && isObject(v) && typeof v.version === 'number' && typeof v.at === 'number' && typeof v.host === 'string' && v.adult === true) {
        consents[k] = { version: v.version, at: v.at, host: v.host, adult: true };
      }
    }
  }
  const hosted = value.hostedConsent;
  const hostedConsent: HostedConsentRecord | null =
    isObject(hosted) && typeof hosted.version === 'number' && Number.isFinite(hosted.version) && typeof hosted.at === 'number' ? { version: hosted.version, at: hosted.at } : null;
  const ceiling = typeof value.dailyCeiling === 'number' && Number.isFinite(value.dailyCeiling) ? Math.round(value.dailyCeiling) : DEFAULT_CEILING;
  return {
    engine: value.engine === 'byok' ? 'byok' : 'rogo',
    provider: isProvider(value.provider) ? value.provider : null,
    models,
    customBaseUrl: typeof value.customBaseUrl === 'string' ? value.customBaseUrl.slice(0, 300) : '',
    keySaved,
    consents,
    hostedConsent,
    insightDaily: value.insightDaily === true,
    insightWeekly: value.insightWeekly === true,
    // On unless the person turned it off: a thinking model that thinks for 30 s is the usual cause of a slow answer.
    fastMode: value.fastMode !== false,
    fastFields: typeof value.fastFields === 'string' ? value.fastFields.slice(0, 300) : '',
    dailyCeiling: Math.min(MAX_CEILING, Math.max(MIN_CEILING, ceiling)),
    noTools: Array.isArray(value.noTools) ? value.noTools.filter((x): x is string => typeof x === 'string').slice(-50) : [],
  };
}

/** The settings of Joyo AI on this phone. Never synced: they name the provider the person trusts and their consent. */
export function createSettingsStore(kv: KvStore) {
  let cache: AiSettings | null = null;
  const listeners = new Set<() => void>();
  const read = (): AiSettings => {
    if (cache) return cache;
    let raw: unknown = null;
    try {
      const text = kv.getItem(KEY);
      raw = text === null ? null : JSON.parse(text);
    } catch {
      raw = null;
    }
    cache = parseSettings(raw);
    return cache;
  };
  return {
    get: read,
    update(patch: Partial<AiSettings> | ((current: AiSettings) => Partial<AiSettings>)): AiSettings {
      const current = read();
      const next = parseSettings({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) });
      cache = next;
      kv.setItem(KEY, JSON.stringify(next));
      for (const listener of listeners) listener();
      return next;
    },
    /** Back to the defaults (delete everything). */
    reset(): void {
      cache = DEFAULT_SETTINGS;
      kv.removeItem(KEY);
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
export type SettingsStore = ReturnType<typeof createSettingsStore>;

export const toolKey = (provider: ProviderId, model: string): string => `${provider}:${model}`;

/** Fields a person's own fast-mode JSON may never set: they would change what is asked, not how hard the model thinks. */
const FORBIDDEN_FAST_KEYS = ['model', 'messages', 'stream', 'stream_options', 'tools', 'tool_choice', 'max_tokens', 'max_completion_tokens', 'n', 'functions', 'function_call'];

/** The fast-mode fields the person typed: a JSON object without the forbidden keys, or null (empty, broken, or not an object). */
export function parseFastFields(text: string): Record<string, unknown> | null {
  if (text.trim() === '') return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!FORBIDDEN_FAST_KEYS.includes(k)) out[k] = v;
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}
