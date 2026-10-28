// Hermes has no Intl.PluralRules, which i18next needs for plural suffixes. Installs only when missing,
// and must load before i18next resolves a plural (this app has no custom entry file).
import 'intl-pluralrules';
import i18next from 'i18next';
import type { i18n as I18n, TFunction } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LOCALE, deviceLanguages, LOCALES, resolveLocale, type Locale } from './locale';
import { applyOverlay } from './overlay';
import { platformOverlay } from './platformOverlay';
import { DEFAULT_NAMESPACE, NAMESPACES, resources, type Namespace } from './resources';
import './types';

export type { TFunction } from 'i18next';

const OPTIONS = {
  resources: applyOverlay(resources, platformOverlay),
  supportedLngs: [...LOCALES],
  fallbackLng: DEFAULT_LOCALE,
  ns: NAMESPACES,
  defaultNS: DEFAULT_NAMESPACE,
  // React Native does not escape; the strings never reach HTML.
  interpolation: { escapeValue: false },
  returnNull: false as const,
  // Resources are bundled, so init is synchronous: t() works on the first render.
  initAsync: false,
  react: { useSuspense: false },
};

/**
 * The app's instance. Starts in the device language so t() works at once; `native.ts`
 * applies the stored Settings choice before the first screen mounts.
 */
export const i18n: I18n = i18next.createInstance();
i18n.use(initReactI18next);
void i18n.init({ ...OPTIONS, lng: resolveLocale({ device: deviceLanguages() }) });

let active: Locale = i18n.language as Locale;

/** The language the UI renders in right now. */
export function getLocale(): Locale {
  return active;
}

const listeners = new Set<() => void>();

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Switches the UI language; mounted `useTranslation`/`useLocale` consumers re-render. */
export async function applyLocale(locale: Locale): Promise<void> {
  if (locale === active) return;
  active = locale;
  await i18n.changeLanguage(locale);
  for (const listener of listeners) listener();
}

/** Translator for the current language, for code outside components (notifications, errors, stores). */
export const t: I18n['t'] = i18n.t; // i18next binds its members, so this is safe to detach

/** Translator pinned to one locale, independent of the current language. */
export function getT<N extends Namespace = typeof DEFAULT_NAMESPACE>(locale: Locale, ns?: N): TFunction<N> {
  return i18n.getFixedT(locale, ns ?? DEFAULT_NAMESPACE) as TFunction<N>;
}
