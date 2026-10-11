// The app's languages. UI strings live in locales/<lang>/<namespace>.json, one namespace per
// area of the app; English is the source. The chosen language is a setting (LANGUAGES below):
// switching it re-renders every t().
//
// Locales load on demand: at startup only the active language's UI namespaces are fetched (one
// chunk per language, see vite.config.ts), another language when the reader switches to it, and
// the large `content` namespace (bot, opening and story copy) only once a data module that uses
// it is imported (requireContent, called by i18n/content.ts). There is no runtime fallback
// language: parity.test.ts keeps every es namespace key-for-key with en.
import i18n, { type BackendModule, type ReadCallback } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { createSetting } from '../lib/settings';

export const LANGUAGES = ['en', 'es'] as const;
export type Language = typeof LANGUAGES[number];
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', es: 'Español' };

const loaders = import.meta.glob<Record<string, unknown>>('./locales/*/*.json', { import: 'default' });

/** Every namespace, read off the English files. */
export const NAMESPACES = Object.keys(loaders)
  .map(path => path.match(/^\.\/locales\/en\/([\w-]+)\.json$/)?.[1])
  .filter((ns): ns is string => Boolean(ns));

/** The namespace too big to load up front; see requireContent. */
const CONTENT_NS = 'content';

const lazyLocales: BackendModule = {
  type: 'backend',
  init() { /* nothing to configure */ },
  read(lng: string, ns: string, callback: ReadCallback) {
    const load = loaders[`./locales/${lng}/${ns}.json`];
    if (!load) { callback(null, {}); return; }
    load().then(data => callback(null, data), (error: Error) => callback(error, false));
  },
};

const apply = (lang: Language) => {
  void i18n.changeLanguage(lang);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
};
export const language = createSetting<Language>('chess-jd-language', 'en', LANGUAGES, apply);

/** Resolves once the active language's UI namespaces are loaded. */
export const i18nReady: Promise<unknown> = i18n.use(lazyLocales).use(initReactI18next).init({
  lng: language.get(),
  supportedLngs: [...LANGUAGES],
  fallbackLng: false,
  defaultNS: 'common',
  ns: NAMESPACES.filter(ns => ns !== CONTENT_NS),
  interpolation: { escapeValue: false },
  returnNull: false,
  // Re-render t() users when a namespace lands (the content namespace arrives after first paint).
  react: { bindI18nStore: 'added' },
});
if (typeof document !== 'undefined') document.documentElement.lang = language.get();

let contentLoading: Promise<unknown> | null = null;

/** Start loading the content namespace (idempotent). Once requested, it also loads on language switches. */
export function requireContent(): Promise<unknown> {
  contentLoading ??= i18nReady.then(() => i18n.loadNamespaces(CONTENT_NS));
  return contentLoading;
}

/** Resolves when the content namespace is loaded, if anything has asked for it; otherwise at once. */
export function contentSettled(): Promise<unknown> {
  return contentLoading ?? Promise.resolve();
}

export default i18n;
