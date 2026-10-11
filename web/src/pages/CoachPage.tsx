import { Link, useNavigate } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ModelMenu, useCoach } from '../components/CoachCard';
import { CoachHome } from '../components/CoachHome';
import { Segments } from '../components/Segments';
import { useProfile } from '../hooks/useProfile';
import { PROGRESS_ART, PAGE_ART } from '../lib/art';
import { InsightsPage } from './InsightsPage';
import { useInsights } from '../state/AppData';
import { GRADES } from '../lib/grades';

type Mode = 'plan' | 'progress' | 'learn';

const TABS: { mode: Mode; to: string }[] = [
  { mode: 'plan', to: '/coach' },
  { mode: 'progress', to: '/coach/progress' },
  { mode: 'learn', to: '/coach/learn' },
];

const CENTERS = [
  { key: 'lessons', to: '/lessons', art: PROGRESS_ART.study },
  { key: 'puzzles', to: '/puzzles', art: PROGRESS_ART.target },
  { key: 'train', to: '/train', art: PROGRESS_ART.calendar },
  { key: 'openings', to: '/openings', art: 'art/topics/opening.webp' },
  { key: 'endgames', to: '/endgames', art: PROGRESS_ART.victory },
  { key: 'story', to: '/story', art: PAGE_ART.Story },
] as const;

export function CoachPage({ mode = 'plan' }: { mode?: Mode }) {
  const { t } = useTranslation('coach');
  useEffect(() => { document.body.dataset.page = 'coach'; }, []);
  return <section className="coach-hub" aria-label={t('hub.label')}>
    {mode === 'plan' ? <CoachPlan /> : <>
      <CoachHead mode={mode} />
      {mode === 'progress' ? <InsightsPage basePath="/coach/progress" />
        : <div className="coach-centers">{CENTERS.map(center => <Link className="coach-center" key={center.key} to={center.to}>
          <img src={center.art} alt="" width="76" height="76" />
          <div><h3>{t(`centers.${center.key}.title`)}</h3><p>{t(`centers.${center.key}.body`)}</p><span>{t('hub.open')} →</span></div>
        </Link>)}</div>}
    </>}
  </section>;
}

/** The tabs and a line on what this tab is for; the plan adds your level and the coach's model. */
function CoachHead({ mode, children }: { mode: Mode; children?: ReactNode }) {
  const { t } = useTranslation('coach');
  const navigate = useNavigate();
  return <header className="coach-head">
    <div className="coach-head-main">
      <Segments className="bots-segments coach-tabs" role="group" aria-label={t('hub.navigation')}>
        {TABS.map(tab => <button key={tab.mode} type="button" aria-pressed={tab.mode === mode} className={tab.mode === mode ? 'selected' : ''}
          onClick={() => navigate(tab.to)}>{t(`hub.${tab.mode}`)}</button>)}
      </Segments>
      <h1>{t('hub.label')}</h1>
      {mode === 'progress' ? <Coverage /> : <p>{t(`hub.${mode}Intro`)}</p>}
    </div>
    {children && <div className="coach-head-side">{children}</div>}
  </header>;
}

/** How much of your archive the stats stand on. */
function Coverage() {
  const { t } = useTranslation('coach');
  const { insights } = useInsights();
  if (!insights) return <p>{t('hub.progressIntro')}</p>;
  const { analyzed, total } = insights.coverage;
  const moves = GRADES.reduce((sum, key) => sum + (insights.grades?.[key] ?? 0), 0);
  return <p>{moves ? t('hub.coverageMoves', { analyzed, total, moves: moves.toLocaleString() }) : t('hub.coverage', { analyzed, total })}</p>;
}

/** The plan reads the AI coach once, for the header's model menu and the page below. */
function CoachPlan() {
  const coach = useCoach();
  return <>
    <CoachHead mode="plan"><PlanBadges /><ModelMenu state={coach} /></CoachHead>
    <CoachHome coach={coach} />
  </>;
}

/** Your level and how far into it you are. */
function PlanBadges() {
  const { t } = useTranslation('coach');
  const profile = useProfile();
  if (!profile) return null;
  const pct = profile.xpForLevel ? Math.min(100, Math.round(profile.xpIntoLevel / profile.xpForLevel * 100)) : 0;
  return <Link className="coach-level" to="/profile" aria-label={t('hub.levelLabel', { level: profile.level, xp: profile.xpIntoLevel, goal: profile.xpForLevel })}>
    <span className="coach-level-badge" aria-hidden="true">{profile.level}</span>
    <span className="coach-level-text">
      <strong>{t('hub.level', { level: profile.level })}</strong>
      <span><span className="coach-level-bar"><span style={{ width: `${pct}%` }} /></span>
        <small>{t('hub.xpLevel', { xp: profile.xpIntoLevel, goal: profile.xpForLevel })}</small></span>
    </span>
  </Link>;
}
