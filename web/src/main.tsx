import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applySavedSettings } from './lib/settings';
import { initMusic } from './lib/music';
import { i18nReady } from './i18n';
import './styles/main.scss';

applySavedSettings();
initMusic();
// The first paint waits for the active language's strings (one small chunk), so no raw keys flash.
void i18nReady.finally(() => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>));
