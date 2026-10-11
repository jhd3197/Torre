import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { resetSettings } from '../lib/settings';
import { resetSounds } from '../hooks/useSounds';
import i18n, { i18nReady, language, LANGUAGES, NAMESPACES } from '../i18n';

// Role queries over a full board (64 buttons plus the layout) are slow in jsdom.
configure({ asyncUtilTimeout: 4000 });

// Locales load lazily in the app; tests get every language and namespace up front, so renders
// and language switches stay synchronous.
beforeAll(async () => {
  await i18nReady;
  await i18n.loadNamespaces(NAMESPACES);
  await i18n.loadLanguages([...LANGUAGES]);
});

// Unmounting after the last test can read a setting back into its cache, so each test starts from storage.
beforeEach(resetSettings);

afterEach(() => {
  resetSounds();
  language.set('en');
  resetSettings();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
