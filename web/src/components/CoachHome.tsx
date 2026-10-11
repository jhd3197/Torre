// The Coach page's plan, from /api/coach/home (coach_home.py): Rooky's spoken briefing, today's
// session, the skills in focus with the moments behind them, and lessons made from your games.
// Everything here comes from one loop: the skill ledger feeds the focus, the focus builds the
// session, and every answer goes back into the ledger. Beside it: today's fixes (/api/today) and
// what the AI coach noticed (/api/coach), which also gives Rooky more to talk about.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { CoachCard, type CoachState } from './CoachCard';
import { CursorRook } from './CursorRook';
import { RookSpeaker } from './RookSpeaker';
import { TodayPlan, useTodayPlan } from './TodayPlan';
import { ALL_BOTS, botPicture } from '../data/bots';
import { api } from '../lib/api';
import { gamePath, lessonPath } from '../lib/routes';
import { useToast } from '../state/AppData';

export type SkillTrend = 'better' | 'worse' | 'steady' | 'new';

export interface SkillRow {
  skill: string; family: string; name: string; title: string; idea: string;
  mastery: number; confidence: number; trend: SkillTrend; events: number;
  week: { ok: number; missed: number; games_missed: number };
  evidence: { src: string; at: string; ref: { game?: string; ply?: number; opponent?: string | null; puzzle?: string } }[];
}

export interface FocusRow extends SkillRow {
  since: string; start: number; pinned: boolean; themes: string[]; lessons: string[];
  fresh: { count: number; ok: number; pct: number | null };
  goal: { count: number; pct: number };
}

export interface SessionCardData {
  slug: string; title: string; skill: string | null; steps: number; minutes: number; step: number;
  completed: string | null; kinds: string[];
}

export interface GameLessonCard {
  slug: string; game: string; opponent: string | null; date: string | null; result: number | null;
  color: string | null; moments: number; skills: string[]; completed: string | null; step: number;
}

export interface CoachHomeData {
  day: string;
  briefing: string[];
  focus: FocusRow[];
  session: SessionCardData | null;
  changes: { kind: 'graduated' | 'added' | 'expired'; skill: string; title: string }[];
  graduated: { skill: string; on: string; title: string }[];
  skills: SkillRow[];
  games: GameLessonCard[];
  hasGames: boolean;
}

export function useCoachHome() {
  const [home, setHome] = useState<CoachHomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((signal?: AbortSignal) =>
    api<CoachHomeData>('api/coach/home', undefined, signal)
      .then(data => { setHome(data); setError(null); })
      .catch(e => { if (!signal?.aborted) setError((e as Error).message); }), []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return { home, error, load, setHome };
}

const resultKey = (result: number | null) => (result === 1 ? 'win' : result === 0 ? 'loss' : result === 0.5 ? 'draw' : null);

/** One of the app's own bots, by the name a game recorded ("Duke" or "Duke-BOT"). */
const botPictureFor = (name: string | null | undefined) => {
  const plain = name?.replace(/-bot$/i, '').toLowerCase();
  const bot = plain ? ALL_BOTS.find(b => b.name.toLowerCase() === plain) : undefined;
  return bot ? botPicture(bot) : null;
};

export function OpponentFace({ name, size }: { name: string | null | undefined; size: number }) {
  const picture = botPictureFor(name);
  return <span className="rooky-face" style={{ width: size, height: size }} aria-hidden="true">
    {picture ? <img src={picture} alt="" /> : (name?.trim()[0] ?? '?').toUpperCase()}
  </span>;
}

type Topic = 'briefing' | 'focus' | 'strengths' | 'week';

export function CoachHome({ coach }: { coach: CoachState }) {
  const { t } = useTranslation('rooky');
  const { home, error, load, setHome } = useCoachHome();
  const today = useTodayPlan();
  const navigate = useNavigate();
  const toast = useToast();
  const [topic, setTopic] = useState<Topic>('briefing');

  if (!home) {
    return <div className="rooky-loading" role={error ? 'alert' : 'status'}>
      {error ? <>{t('home.failed')} <button type="button" className="text-button" onClick={() => load()}>{t('home.retry')}</button></> : t('home.loading')}
    </div>;
  }

  const act = (action: 'pin' | 'unpin' | 'skip', skill: string) =>
    api<CoachHomeData>('api/coach/focus', { action, skill }).then(setHome).catch(e => toast((e as Error).message));
  const practise = (skill: string) =>
    api<{ slug: string }>('api/coach/session', { skill }).then(({ slug }) => navigate(lessonPath(slug))).catch(e => toast((e as Error).message));

  // What Rooky can talk about: the day's briefing, and whatever the AI coach has written.
  const advice = coach.coach?.available ? coach.coach.advice : null;
  const topics: Record<Topic, string[]> = {
    briefing: home.briefing,
    focus: advice ? [advice.headline, ...advice.focus.map(area => `${area.title}: ${area.why}`)].filter(Boolean) : [],
    strengths: advice?.strengths ?? [],
    week: advice?.weekly_plan ?? [],
  };
  const offered = (Object.keys(topics) as Topic[]).filter(key => topics[key].length);
  const shown = topics[topic].length ? topic : 'briefing';
  const graduatedToday = home.changes.find(c => c.kind === 'graduated');

  return (
    <div className="rooky-home">
      {graduatedToday && <p className="rooky-news" role="status"><img src="art/ui3d/reward.webp" alt="" width="34" height="34" />
        {t('graduated.news', { skill: graduatedToday.title })}</p>}

      <div className="rooky-top">
        <section className="rooky-hero" aria-label={t('home.label')}>
          <RookSpeaker key={shown} className="rooky-briefing" lines={topics[shown]}
            autoKey={shown === 'briefing' ? `briefing:${home.day}` : null}
            figure={<span className="rooky-figure"><CursorRook size={128} /></span>} />
          {offered.length > 1 && <div className="rooky-asks" role="group" aria-label={t('asks.label')}>
            {offered.map(key => <button key={key} type="button" aria-pressed={key === shown} onClick={() => setTopic(key)}>{t(`asks.${key}`)}</button>)}
          </div>}
        </section>
        <SessionCard session={home.session} />
      </div>

      {home.focus.length > 0 && <section className="rooky-focus" aria-labelledby="rooky-focus-title">
        <div className="rooky-heading"><h2 id="rooky-focus-title">{t('focus.title')}</h2><p>{t('focus.intro')}</p></div>
        <div className="rooky-focus-list">
          {home.focus.map(row => <FocusCard key={row.skill} row={row} onAct={act} onPractise={practise} />)}
        </div>
      </section>}

      <div className="rooky-lower">
        <section className="rooky-games" aria-labelledby="rooky-games-title">
          <div className="rooky-heading"><h2 id="rooky-games-title">{t('games.title')}</h2>
            <p>{home.games.length ? t('games.intro') : t('games.empty')}</p></div>
          {home.games.length > 0 && <ul className="rooky-game-list">
            {home.games.map(game => {
              const result = resultKey(game.result);
              const skills = game.skills.map(s => home.skills.find(r => r.skill === s)?.title ?? s);
              return <li key={game.slug} className={`rooky-game${game.completed ? ' is-done' : ''}`}>
                <OpponentFace name={game.opponent} size={44} />
                <div className="rooky-game-who">
                  <strong>{game.opponent ?? '?'}{result && <span className={`rooky-chip result-${result}`}>{t(`games.result.${result}`)}</span>}</strong>
                  <small>{[game.date, t('games.moments', { count: game.moments })].filter(Boolean).join(' · ')}</small>
                </div>
                {skills.length > 0 && <span className="rooky-game-skills">{skills.map(s => <span key={s} className="rooky-chip is-skill">{s}</span>)}</span>}
                <div className="rooky-game-actions">
                  <Link className="text-button" to={gamePath(game.game)}>{t('games.review')}</Link>
                  <Link className={`button ${game.completed ? '' : 'primary'}`} to={lessonPath(game.slug)}>
                    {game.completed ? `✓ ${t('games.done')}` : t('games.open')}
                  </Link>
                </div>
              </li>;
            })}
          </ul>}
        </section>
        <aside className="rooky-side">
          {today && <TodayPlan plan={today} />}
          <CoachCard state={coach} />
        </aside>
      </div>

      <details className="rooky-skills">
        <summary>{t('skills.title')}</summary>
        <p className="rooky-intro">{t('skills.note')}</p>
        <ul>{home.skills.map(row => (
          <li key={row.skill}>
            <span>{row.title}</span>
            <progress value={row.mastery} max={100} aria-label={t('focus.masteryLabel', { skill: row.title })} />
            <b>{row.mastery}%</b>
            <small className={`rooky-trend trend-${row.trend}`}>{t(`focus.trend.${row.trend}`)}</small>
          </li>
        ))}</ul>
        {home.graduated.length > 0 && <p className="rooky-graduated"><strong>{t('graduated.title')}:</strong> {home.graduated.map(g => g.title).join(', ')}</p>}
      </details>
    </div>
  );
}

function SessionCard({ session }: { session: SessionCardData | null }) {
  const { t } = useTranslation('rooky');
  if (!session) {
    return <section className="rooky-session" aria-labelledby="rooky-session-title">
      <h2 id="rooky-session-title">{t('session.title')}</h2>
      <p>{t('session.none')}</p>
    </section>;
  }
  const label = session.completed ? t('session.again') : session.step > 0
    ? t('session.resume', { step: session.step, steps: session.steps }) : t('session.start');
  const path = lessonPath(session.slug, session.completed || !session.step ? undefined : session.step);
  const done = session.completed ? session.steps : session.step;
  return (
    <section className={`rooky-session${session.completed ? ' is-done' : ''}`} aria-labelledby="rooky-session-title">
      <header><h2 id="rooky-session-title">{t('session.title')}</h2><small>{t('session.meta', { steps: session.steps, minutes: session.minutes })}</small></header>
      <strong className="rooky-session-skill">{session.title}</strong>
      <p>{t('session.mix')}</p>
      <ol className="rooky-pips" aria-label={t('session.progress', { step: done, steps: session.steps })}>
        {Array.from({ length: session.steps }, (_, i) => <li key={i} className={i < done ? 'is-on' : ''} />)}
      </ol>
      {session.completed && <span className="rooky-done">✓ {t('session.done')}</span>}
      <Link className={`button ${session.completed ? '' : 'primary'} rooky-session-start`} to={path}>{label}</Link>
    </section>
  );
}

const RING = 2 * Math.PI * 15.5;

function FocusCard({ row, onAct, onPractise }: {
  row: FocusRow; onAct: (action: 'pin' | 'unpin' | 'skip', skill: string) => void; onPractise: (skill: string) => void;
}) {
  const { t } = useTranslation('rooky');
  const games = row.evidence.filter(e => e.src === 'game' && e.ref.game && e.ref.ply).slice(0, 3);
  const answered = Math.min(row.fresh.count, row.goal.count);
  return (
    <article className="rooky-focus-card">
      <header>
        <div className="rooky-ring" role="img" aria-label={t('focus.masteryLabel', { skill: row.title }) + `: ${row.mastery}%`}>
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle className="rooky-ring-track" cx="18" cy="18" r="15.5" />
            <circle className="rooky-ring-fill" cx="18" cy="18" r="15.5" strokeDasharray={`${(RING * row.mastery / 100).toFixed(1)} ${RING.toFixed(1)}`} />
          </svg>
          <span>{row.mastery}%</span>
        </div>
        <div>
          <h3>{row.title}</h3>
          <span className="rooky-tags">
            <span className={`rooky-chip rooky-trend trend-${row.trend}`}>{t(`focus.trend.${row.trend}`)}</span>
            {row.pinned && <span className="rooky-chip">{t('focus.pinned')}</span>}
          </span>
          <p className="rooky-idea">{row.idea}</p>
        </div>
      </header>
      <div className="rooky-toward">
        <span>{t('focus.toward')}</span>
        <ol className="rooky-pips" aria-label={t('focus.goalLabel', { skill: row.title })}>
          {Array.from({ length: row.goal.count }, (_, i) => <li key={i} className={i < answered ? 'is-on' : ''} />)}
        </ol>
        <b>{answered}/{row.goal.count}</b>
      </div>
      <small className="rooky-fresh">
        {row.fresh.count ? t('focus.fresh', { ok: row.fresh.ok, count: row.fresh.count }) : t('focus.freshNone')} · {t('focus.goal', { count: row.goal.count, pct: row.goal.pct })}
      </small>
      {games.length > 0 && <div className="rooky-evidence">
        <small>{t('focus.evidence')}</small>
        <ul>{games.map(e => {
          const move = Math.ceil(e.ref.ply! / 2);
          return <li key={`${e.ref.game}:${e.ref.ply}`}><Link to={gamePath(e.ref.game!, e.ref.ply)}>
            <OpponentFace name={e.ref.opponent} size={22} />
            {e.ref.opponent ? t('focus.move', { opponent: e.ref.opponent, move }) : t('focus.moveNoName', { move })}
          </Link></li>;
        })}</ul>
      </div>}
      <div className="rooky-focus-actions">
        <button type="button" className="button primary" onClick={() => onPractise(row.skill)}>{t('focus.practice')}</button>
        <button type="button" className="button" onClick={() => onAct('skip', row.skill)}>{t('focus.skip')}</button>
        <button type="button" className="text-button" onClick={() => onAct(row.pinned ? 'unpin' : 'pin', row.skill)}>
          {row.pinned ? t('focus.unpin') : t('focus.pin')}
        </button>
      </div>
    </article>
  );
}
