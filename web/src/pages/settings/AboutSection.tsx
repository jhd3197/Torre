// About: which Torre this is and what its latest release changed, where its data lives, the engines
// it runs, the keyboard shortcuts, and the open projects it is built on, with their licences.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useGameData, useToast } from '../../state/AppData';
import { anchorId, Row, Subheading } from './controls';

/** GET /api/about (api_games.about). */
interface About {
  name: string;
  version: string | null;
  dataDir: string;
  release: { title: string; date: string | null; summary: string } | null;
}

/** The keys that do something, and where (the board's own controls are under Help on board pages). */
const SHORTCUTS = [['[', 'rail'], ['← →', 'step'], ['F', 'flip'], ['Esc', 'clear']] as const;

/** What Torre is built on; installed engines are credited from their own entries below these. */
const CREDITS = [
  { name: 'python-chess', license: 'GPL-3.0', url: 'https://github.com/niklasf/python-chess', key: 'pythonChess' },
  { name: 'Lichess puzzle database', license: 'CC0', url: 'https://database.lichess.org/#puzzles', key: 'puzzles' },
  { name: 'Kokoro', license: 'Apache-2.0', url: 'https://github.com/hexgrad/kokoro', key: 'kokoro' },
  { name: 'FSRS', license: 'MIT', url: 'https://github.com/open-spaced-repetition/py-fsrs', key: 'fsrs' },
] as const;

export function AboutSection() {
  const { t } = useTranslation('settings');
  const toast = useToast();
  const { engines } = useGameData();
  const [about, setAbout] = useState<About | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<About>('api/about').then(setAbout).catch(() => setFailed(true));
  }, []);
  const installed = engines.filter(engine => engine.installed);

  async function copyPath() {
    if (!about) return;
    try { await navigator.clipboard.writeText(about.dataDir); toast(t('about.copied')); } catch { toast(t('about.copyBlocked')); }
  }

  if (failed) return <p className="settings-section-note" role="alert">{t('about.unavailable')}</p>;
  if (!about) return <p className="settings-section-note" role="status">{t('about.loading')}</p>;
  const release = about.release;
  return (
    <>
      <Row id={anchorId('about.version')} label={t('about.version')} note={release?.date ? t('about.released', { date: release.date }) : ''} keepNote>
        <strong className="settings-value">{about.name} {about.version}</strong>
      </Row>
      {release?.title && (
        <div className="settings-block" id={anchorId('about.whatsNew')}>
          <Subheading>{t('about.whatsNew')}</Subheading>
          <p className="settings-release"><strong>{release.title}</strong> {release.summary}</p>
        </div>
      )}
      <Row id={anchorId('about.data')} label={t('about.data')} note={t('about.dataNote')} keepNote>
        <button type="button" className="button" onClick={() => void copyPath()}>{t('about.copy')}</button>
      </Row>
      <code className="settings-path">{about.dataDir}</code>

      <Subheading id={anchorId('about.engines')}>{t('about.engines')}</Subheading>
      {installed.length ? (
        <ul className="settings-about-list">
          {installed.map(engine => (
            <li key={engine.id}>
              <strong>{engine.name}</strong>
              <span>{engine.version ?? t('about.noVersion')}</span>
              <a href={engine.repo_url} target="_blank" rel="noreferrer">{engine.license}</a>
            </li>
          ))}
        </ul>
      ) : <p className="settings-section-note">{t('about.noEngines')}</p>}

      <Subheading id={anchorId('about.shortcuts')}>{t('about.shortcuts')}</Subheading>
      <dl className="settings-shortcuts">
        {SHORTCUTS.map(([keys, what]) => [
          <dt key={what}>{keys.split(' ').map(key => <kbd key={key}>{key}</kbd>)}</dt>,
          <dd key={`${what}-d`}>{t(`about.keys.${what}`)}</dd>,
        ])}
      </dl>

      <Subheading id={anchorId('about.credits')}>{t('about.credits')}</Subheading>
      <ul className="settings-about-list">
        {CREDITS.map(credit => (
          <li key={credit.key}>
            <strong>{credit.name}</strong>
            <span>{t(`about.uses.${credit.key}`)}</span>
            <a href={credit.url} target="_blank" rel="noreferrer">{credit.license}</a>
          </li>
        ))}
      </ul>
    </>
  );
}
