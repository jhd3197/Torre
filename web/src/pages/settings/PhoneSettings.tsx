// Settings on a phone (Torre Mobile Settings): a list of sections in four groups, each with an icon and
// what it is set to now, and a page per section with the same rows as on a desk, laid out for a thumb.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { language, LANGUAGE_NAMES } from '../../i18n';
import { analysisDepth, boardTheme, puzzleHelp, quietCoach, uiSize } from '../../lib/settings';
import { masterVolume, muteAll } from '../../lib/audio';
import { coachVoice } from '../../lib/voice';
import { usePieceSet } from '../../lib/pieces';
import { settingsPath } from '../../lib/routes';
import { initials, useHostedAccount } from '../../hooks/useHostedAccount';
import { BACK_ICON } from '../../components/workspace/PhoneParts';
import type { SectionId } from './search';

type Tone = 'green' | 'amber' | 'grey';

/** Each section's icon (one SVG path) and tile colour. */
const ICONS: Record<Exclude<SectionId, 'sidebar'>, [string, Tone]> = {
  general: ['M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6', 'grey'],
  display: ['M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18', 'green'],
  sound: ['M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14', 'amber'],
  voice: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3', 'green'],
  learning: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'amber'],
  ai: ['M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9zM19 3v4M17 5h4', 'grey'],
  analysis: ['M3 3v18h18M7 15l4-4 3 3 5-6', 'green'],
  engines: ['M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4', 'amber'],
  accessibility: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'green'],
  data: ['M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3', 'grey'],
  about: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01', 'amber'],
};

/** The sidebar section is left out: a phone has a tab bar, not a sidebar. */
const GROUPS: [string, (keyof typeof ICONS)[]][] = [
  ['app', ['general', 'display', 'sound']],
  ['coach', ['voice', 'learning', 'ai']],
  ['engine', ['analysis', 'engines']],
  ['more', ['accessibility', 'data', 'about']],
];

export const isPhoneSection = (id: SectionId): id is keyof typeof ICONS => id in ICONS;

function Tile({ id }: { id: keyof typeof ICONS }) {
  const [path, tone] = ICONS[id];
  return (
    <span className={`phone-settings-tile ${tone}`} aria-hidden="true">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>
    </span>
  );
}

const CHEVRON = <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>;

/** What each section is set to now, in a few words beside its name. */
function useSummaries(): Partial<Record<SectionId, string>> {
  const { t } = useTranslation('settings');
  const lang = language.use(), theme = boardTheme.use(), pieces = usePieceSet(), muted = muteAll.use(), volume = masterVolume.use();
  const voice = coachVoice.use(), quiet = quietCoach.use(), help = puzzleHelp.use(), depth = analysisDepth.use(), size = uiSize.use();
  return {
    general: LANGUAGE_NAMES[lang],
    display: `${t(`board.themes.${theme}`)} · ${t(`pieces.sets.${pieces}.name`)}`,
    sound: muted ? t('phone.muted') : `${volume}%`,
    voice: quiet ? t('phone.quiet') : t(`voice.${voice}`),
    learning: t(`learning.helps.${help}`),
    analysis: t(`analysis.depths.${depth}`),
    accessibility: t(`accessibility.sizes.${size}`),
  };
}

/** /settings on a phone: back home, the search box, who you are (on torre.sh), and the sections;
 *  while searching, what the search found in the sections' place. */
export function PhoneSettingsHome({ search, results }: { search: ReactNode; results?: ReactNode }) {
  const { t } = useTranslation('settings');
  const account = useHostedAccount();
  const summaries = useSummaries();
  return (
    <>
      <header className="phone-settings-head">
        <Link className="phone-icon-button" to="/" aria-label={t('phone.home')}>{BACK_ICON}</Link>
        <h1>{t('title')}</h1>
      </header>
      {search}
      {results ?? <>
      {account && (
        <Link className="phone-settings-account" to="/profile">
          <span className="phone-settings-avatar" aria-hidden="true">{initials(account.name)}</span>
          <span><strong>{account.name}</strong><small>{account.email}</small></span>
          {CHEVRON}
        </Link>
      )}
      {GROUPS.map(([group, ids]) => (
        <section key={group} className="phone-settings-group" aria-label={t(`phone.groups.${group}`)}>
          <h2>{t(`phone.groups.${group}`)}</h2>
          <ul className="phone-settings-list">
            {ids.map(id => (
              <li key={id}>
                <Link to={settingsPath(id)}>
                  <Tile id={id} />
                  <strong>{t(`${id}.title`)}</strong>
                  {summaries[id] && <small>{summaries[id]}</small>}
                  {CHEVRON}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      </>}
    </>
  );
}

/** One section on a phone: a header that stays put while its rows scroll beneath. */
export function PhoneSettingsSection({ id, children }: { id: keyof typeof ICONS; children: ReactNode }) {
  const { t } = useTranslation('settings');
  return (
    <>
      <header className="phone-settings-head sub">
        <Link className="phone-icon-button" to={settingsPath()} aria-label={t('phone.back')}>{BACK_ICON}</Link>
        <Tile id={id} />
        <h1 id={`settings-${id}-title`}>{t(`${id}.title`)}</h1>
      </header>
      <section id={`settings-${id}`} className="settings-group phone-settings-section" aria-labelledby={`settings-${id}-title`}>
        {children}
      </section>
      <p className="phone-settings-saved">{t('phone.saved')}</p>
    </>
  );
}
