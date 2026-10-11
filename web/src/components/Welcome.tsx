// The first-run welcome: pick the app's language, optionally download the coach's voice for it
// (with its size, Duolingo-style), then start. Shown once per data folder, over whatever page
// opened first; the server remembers it was answered (POST api/setup).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { language, LANGUAGE_NAMES, LANGUAGES } from '../i18n';
import { Mascot } from './Reward';
import { usePacks, VoicePackList } from './VoicePacks';
import { Flag } from './Flag';

export function FirstRun() {
  const [show, setShow] = useState(false);
  // Only an explicit "not onboarded" shows the welcome; a server without the endpoint skips it.
  useEffect(() => {
    let live = true;
    api<{ onboarded: boolean }>('api/setup')
      .then(state => { if (live) setShow(state.onboarded === false); })
      .catch(() => { /* no setup endpoint: nothing to ask */ });
    return () => { live = false; };
  }, []);
  if (!show) return null;
  return <Welcome onDone={() => setShow(false)} />;
}

function Welcome({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('setup');
  const lang = language.use();
  const packs = usePacks();
  const downloading = !!packs.state?.job.running;
  const finish = () => { void api('api/setup', { onboarded: true }).finally(onDone); };
  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        <Mascot pose="wave" size={110} />
        <h1 id="welcome-title">{t('title')}</h1>
        <p className="welcome-lead">{t('lead')}</p>

        <h2>{t('language')}</h2>
        <div className="welcome-languages" role="radiogroup" aria-label={t('language')}>
          {LANGUAGES.map(code => (
            <button key={code} type="button" role="radio" aria-checked={lang === code}
              className={`welcome-language${lang === code ? ' chosen' : ''}`} onClick={() => language.set(code)}>
              <Flag lang={code} size={42} />
              <span>{LANGUAGE_NAMES[code]}</span>
            </button>
          ))}
        </div>

        <h2>{t('voice')}</h2>
        <p className="welcome-note">{t('voiceNote')}</p>
        <VoicePackList lang={lang} packs={packs} />

        <button type="button" className="button primary squishy welcome-start" disabled={downloading} onClick={finish}>
          {downloading ? t('waiting') : t('start')}
        </button>
        <button type="button" className="text-button welcome-skip" onClick={finish}>{t('skip')}</button>
      </div>
    </div>
  );
}
