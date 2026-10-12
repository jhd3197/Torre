import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applySavedSettings } from './lib/settings';
import { initMusic } from './lib/music';
import { i18nReady } from './i18n';
import './styles/main.scss';

// Vela serves Torre below /apps/chess/, while torre.sh serves it at /. The
// injected <base> keeps one worker confined to the right app in either place.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const script = new URL('sw.js', document.baseURI);
    navigator.serviceWorker.register(script.href).catch(() => {
      // Torre still works online when a browser does not support the worker.
    });
  });
}

applySavedSettings();
initMusic();
// The first paint waits for the active language's strings (one small chunk), so no raw keys flash.
void i18nReady.finally(() => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>));
