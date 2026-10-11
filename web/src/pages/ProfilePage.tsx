// /profile — the player at a glance: name, level and streak, the ratings, the record and openings
// from the archive, awards, recent games and the opponents met most, then doorways to the rest.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProfile } from '../hooks/useProfile';
import { useHostedAccount } from '../hooks/useHostedAccount';
import { usePhone } from '../hooks/usePhone';
import { FlameIcon } from '../components/story/Streak';
import { ALL_BOTS, botPicture } from '../data/bots';
import { botCollections } from '../data/collections';
import { api } from '../lib/api';
import { badgeImage, progress, TIER_NAMES, type Award } from '../lib/awards';
import { loadEvents } from '../lib/events';
import { displayDate, formatNumber } from '../lib/format';
import { gamePath } from '../lib/routes';
import { useGameData, useInsights } from '../state/AppData';
import type { GameSummary, InsightsData, Profile, PuzzleCatalog } from '../types';

/** A doorway card; its title and text are the `cards.<key>` strings. */
interface ProfileCard { to: string; art: string; key: string }

// Everything demoted from the rail lives here, one tappable card each.
const CARDS: ProfileCard[] = [
  { to: '/games', art: 'art/topics/games.webp', key: 'games' },
  { to: '/coach/progress', art: 'art/topics/insights.webp', key: 'insights' },
  { to: '/awards', art: 'art/ui3d/achievement.webp', key: 'awards' },
  { to: '/lessons', art: 'art/topics/opening.webp', key: 'lessons' },
  { to: '/train', art: 'art/topics/train.webp', key: 'train' },
  { to: '/settings', art: 'art/ui3d/settings.webp', key: 'settings' },
];

type Result = 'win' | 'draw' | 'loss';
const resultOf = (score: number | null | undefined): Result | null =>
  score === 1 ? 'win' : score === 0.5 ? 'draw' : score === 0 ? 'loss' : null;
const percent = (part: number, whole: number) => (whole ? Math.round(100 * part / whole) : 0);
/** Score: a win is a point, a draw half. */
const score = (w: number, d: number, games: number) => percent(w + d / 2, games);
const change = (delta: number) => `${delta > 0 ? '↑' : delta < 0 ? '↓' : '±'} ${formatNumber(Math.abs(delta))}`;
const DAY = 86_400_000;
const gameTime = (date?: string) => (date ? Date.parse(date.replaceAll('.', '-')) : NaN);

function usePuzzles() {
  const [catalog, setCatalog] = useState<PuzzleCatalog | null>(null);
  useEffect(() => {
    let live = true;
    api<PuzzleCatalog>('api/puzzles').then(c => { if (live) setCatalog(c); }, () => { /* the tile stays hidden */ });
    return () => { live = false; };
  }, []);
  return catalog;
}

function useAwards() {
  const [awards, setAwards] = useState<Award[] | null>(null);
  useEffect(() => {
    let live = true;
    api<{ awards: Award[] }>('api/achievements').then(d => { if (live) setAwards(d.awards); }, () => { /* the section stays hidden */ });
    return () => { live = false; };
  }, []);
  return awards;
}

export function ProfilePage() {
  const { t } = useTranslation('profile');
  const profile = useProfile();
  const { games, gamesLoaded } = useGameData();
  const { insights } = useInsights();
  const puzzles = usePuzzles();
  const awards = useAwards();
  const account = useHostedAccount();
  const phone = usePhone();
  const { t: tn } = useTranslation('nav');
  useEffect(() => { document.body.dataset.page = 'profile'; }, []);

  const name = insights?.user?.trim();
  const initials = name ? name.slice(0, 2).toUpperCase() : null;

  return (
    <section id="profile" className="profile-page" aria-label={t('label')}>
      <header className="profile-hero">
        {initials && <span className="profile-avatar" aria-hidden="true">{initials}</span>}
        <div className="profile-who">
          <h1>{name || t('title')}</h1>
          {gamesLoaded && <p>{games.length ? t('archive', { count: games.length, value: formatNumber(games.length) }) : t('archiveEmpty')}</p>}
        </div>
        <LevelCard profile={profile} />
      </header>

      <Ratings games={games} insights={insights} puzzles={puzzles} awards={awards} />

      {gamesLoaded && !games.length ? (
        <section className="profile-panel profile-empty" aria-labelledby="profile-empty-title">
          <h2 id="profile-empty-title">{t('empty.title')}</h2>
          <p>{t('empty.text')}</p>
          <div className="profile-empty-actions">
            <Link className="button primary" to="/import">{t('empty.import')}</Link>
            <Link className="button" to="/play/bots">{t('empty.play')}</Link>
          </div>
        </section>
      ) : games.length > 0 && (
        <div className="profile-pair">
          <Record games={games} />
          {insights && insights.openings.length > 0 && <Openings insights={insights} />}
        </div>
      )}

      {awards && awards.length > 0 && <Milestones awards={awards} />}

      {games.length > 0 && (
        <div className="profile-pair">
          <RecentGames games={games} />
          {insights && insights.opponents.some(o => o.opp !== '?') && <Opponents insights={insights} />}
        </div>
      )}

      <EventCrests />

      <section className="profile-more" aria-labelledby="profile-more-title">
        <h2 id="profile-more-title">{t('more')}</h2>
        <div className="profile-grid">
          {CARDS.map(card => (
            <Link key={card.to} className="profile-card" to={card.to} viewTransition>
              <img src={card.art} alt="" width="48" height="48" />
              <div>
                <h3>{t(`cards.${card.key}.title`)}</h3>
                <p>{t(`cards.${card.key}.text`)}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* On a desk the rail's account menu signs out; a phone has no rail, so it is here. Plain
          links: the sign-in gateway answers these, not the app's router. */}
      {phone && account && (
        <section className="profile-account" aria-label={t('account.label')}>
          <p>{t('account.signedIn', { email: account.email })}</p>
          <div className="profile-account-actions">
            {account.admin && <a className="button" href="admin">{tn('rail.admin')}</a>}
            <a className="button danger" href="logout">{tn('rail.signOut')}</a>
          </div>
        </section>
      )}
    </section>
  );
}

/** Level, XP toward the next one, and the day streak. */
function LevelCard({ profile }: { profile: Profile | null }) {
  const { t } = useTranslation('profile');
  const streak = profile?.streak;
  const pct = profile && profile.xpForLevel > 0 ? Math.min(100, Math.round(100 * profile.xpIntoLevel / profile.xpForLevel)) : 0;
  return (
    <div className="profile-level-card">
      <div className="profile-progress-row">
        <span className="profile-level" aria-label={profile ? t('level', { level: profile.level }) : t('levelUnknown')}>
          {profile?.level ?? '–'}
        </span>
        <strong>{profile ? t('level', { level: profile.level }) : t('progress')}</strong>
        <span className="profile-xp">{profile ? t('xp', { xp: profile.xp }) : '…'}</span>
      </div>
      <div className="profile-xp-bar" role="progressbar" aria-label={t('progressLabel')}
        aria-valuemin={0} aria-valuemax={profile?.xpForLevel ?? 100} aria-valuenow={profile?.xpIntoLevel ?? 0}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p>{profile ? t('toNext', { xp: profile.xpIntoLevel, goal: profile.xpForLevel, level: profile.level + 1 }) : t('loading')}</p>
      {streak && (
        <div className="profile-streak">
          <FlameIcon lit={streak.count > 0} size={22} />
          <strong>{t('streak.days', { count: streak.count })}</strong>
          <span>{streak.doneToday ? t('streak.goalMet') : t('streak.progress', { xp: streak.xpToday, goal: streak.goal })}</span>
        </div>
      )}
    </div>
  );
}

interface Tile { key: string; to: string; value: string; sub: string; trend?: 'up' | 'down' }

/** The headline numbers, each a door to its page. Only the ones with data show. */
function Ratings({ games, insights, puzzles, awards }: {
  games: GameSummary[]; insights: InsightsData | null | undefined; puzzles: PuzzleCatalog | null; awards: Award[] | null;
}) {
  const { t } = useTranslation('profile');
  const tiles: Tile[] = [];
  const trend = (delta: number) => (delta > 0 ? 'up' : delta < 0 ? 'down' : undefined);

  // Play rating: your rating in the newest rated game, and its change over 30 days.
  const rated = games.filter(g => Number(g.user_rating) > 0);
  if (rated.length) {
    const latest = rated[0], current = Number(latest.user_rating);
    const since = gameTime(latest.date) - 30 * DAY;
    const before = rated.find(g => gameTime(g.date) < since);
    const recent = Date.now() - gameTime(latest.date) <= 30 * DAY;
    const delta = before && recent ? current - Number(before.user_rating) : null;
    tiles.push({ key: 'play', to: '/play/bots', value: formatNumber(current),
      sub: delta === null ? t('ratings.play.last', { date: displayDate(latest.date) }) : t('ratings.play.month', { change: change(delta) }),
      trend: delta === null ? undefined : trend(delta) });
  }
  if (puzzles && puzzles.rated > 0) {
    const delta = puzzles.trend.length > 1 ? puzzles.rating - puzzles.trend[0] : null;
    tiles.push({ key: 'puzzles', to: '/puzzles', value: formatNumber(puzzles.rating),
      sub: delta === null ? t('ratings.puzzles.count', { count: puzzles.rated, value: formatNumber(puzzles.rated) })
        : t('ratings.puzzles.trend', { change: change(delta), count: puzzles.trend.length }),
      trend: delta === null ? undefined : trend(delta) });
  }
  if (insights?.avgAcc != null) {
    tiles.push({ key: 'accuracy', to: '/coach/progress', value: `${insights.avgAcc.toFixed(1)}%`,
      sub: t('ratings.accuracy.games', { count: insights.coverage.analyzed, value: formatNumber(insights.coverage.analyzed) }) });
  }
  if (awards?.length) {
    const earned = awards.filter(a => a.level > 0).length;
    const next = awards.filter(a => a.next !== null).sort((a, b) => progress(b) - progress(a))[0];
    tiles.push({ key: 'awards', to: '/awards', value: `${earned} / ${awards.length}`,
      sub: next ? t('ratings.awards.next', { title: next.title }) : t('ratings.awards.done') });
  }
  if (!tiles.length) return null;

  return (
    <nav className="profile-ratings" aria-label={t('ratings.label')}>
      {tiles.map(tile => (
        <Link key={tile.key} className="profile-rating" to={tile.to}>
          <span className="profile-rating-label">{t(`ratings.${tile.key}.title`)}</span>
          <strong>{tile.value}</strong>
          <small className={tile.trend ? `trend-${tile.trend}` : undefined}>{tile.sub}</small>
        </Link>
      ))}
    </nav>
  );
}

/** A white panel with a heading and an optional "see all" link. */
function Panel({ id, title, link, className = '', children }: {
  id: string; title: string; link?: { to: string; label: string }; className?: string; children: ReactNode;
}) {
  return (
    <section className={`profile-panel ${className}`} aria-labelledby={id}>
      <div className="profile-panel-head">
        <h2 id={id}>{title}</h2>
        {link && <Link to={link.to}>{link.label} →</Link>}
      </div>
      {children}
    </section>
  );
}

/** Wins, draws and losses across the archive, and the last 20 games as a strip (oldest first). */
function Record({ games }: { games: GameSummary[] }) {
  const { t } = useTranslation('profile');
  const scored = games.filter(g => resultOf(g.user_result));
  const counts = { win: 0, draw: 0, loss: 0 };
  for (const g of scored) counts[resultOf(g.user_result)!]++;
  const form = scored.slice(0, 20).reverse();
  const results: Result[] = ['win', 'draw', 'loss'];
  return (
    <Panel id="profile-record-title" title={t('record.title')} link={{ to: '/coach/progress', label: t('record.all') }}>
      <div className="profile-record-bar" aria-hidden="true">
        {results.map(r => counts[r] > 0 && <span key={r} className={`is-${r}`} style={{ flexGrow: counts[r] }} />)}
      </div>
      <div className="profile-record-cells">
        {results.map(r => (
          <div key={r} className={`profile-record-cell is-${r}`}>
            <span>{t(`record.${r}`)}</span>
            <strong>{formatNumber(counts[r])}</strong>
            <small>{percent(counts[r], scored.length)}%</small>
          </div>
        ))}
      </div>
      {form.length > 0 && (
        <div className="profile-form">
          <span>{t('record.last', { count: form.length })}</span>
          <ol>
            {form.map(g => {
              const r = resultOf(g.user_result)!;
              return (
                <li key={g.id} className={`is-${r}`} title={t('record.tip', { result: t(`games.result.${r}`), opponent: g.opponent ?? '?', date: displayDate(g.date) })}>
                  {t(`record.short.${r}`)}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Panel>
  );
}

/** The openings you play most, by colour, with your score in each. */
function Openings({ insights }: { insights: InsightsData }) {
  const { t } = useTranslation('profile');
  return (
    <Panel id="profile-openings-title" title={t('openings.title')} link={{ to: '/coach/progress/openings', label: t('openings.all') }}>
      <ul className="profile-openings">
        {insights.openings.slice(0, 6).map(o => {
          const pct = score(o.w, o.d, o.games);
          return (
            <li key={`${o.eco}-${o.color}`}>
              <span className={`profile-side is-${o.color === 'black' ? 'black' : 'white'}`}
                title={o.color === 'black' ? t('openings.black') : t('openings.white')} />
              <span className="profile-row-text">
                <strong>{o.name}</strong>
                <small>{t('openings.games', { count: o.games, value: formatNumber(o.games) })}</small>
              </span>
              <span className="profile-meter" aria-hidden="true">
                <i className={pct >= 60 ? 'is-good' : pct >= 45 ? 'is-even' : 'is-low'} style={{ width: `${pct}%` }} />
              </span>
              <span className="profile-num" aria-label={t('openings.score', { score: pct })}>{pct}%</span>
            </li>
          );
        })}
      </ul>
      <p className="profile-note">{t('openings.note')}</p>
    </Panel>
  );
}

/** Awards: the earned ones first (highest tier first), then the closest locked ones. */
function Milestones({ awards }: { awards: Award[] }) {
  const { t } = useTranslation('profile');
  const earned = awards.filter(a => a.level > 0).sort((a, b) => b.level - a.level);
  const locked = awards.filter(a => a.level === 0).sort((a, b) => progress(b) - progress(a));
  const shown = [...earned, ...locked].slice(0, 8);
  return (
    <section className="profile-milestones" aria-labelledby="profile-milestones-title">
      <div className="profile-section-head">
        <h2 id="profile-milestones-title">{t('awards.title')}</h2>
        <span>{t('awards.earned', { earned: earned.length, total: awards.length })}</span>
        <Link to="/awards">{t('awards.all')} →</Link>
      </div>
      <ul className="profile-award-grid">
        {shown.map(award => (
          <li key={award.id} className={`profile-award${award.level ? '' : ' is-locked'}`}>
            <img src={badgeImage(award.id, award.tier)} alt="" width="42" height="42" loading="lazy" />
            <span className="profile-row-text">
              <strong>{award.title}</strong>
              <small>{award.level
                ? TIER_NAMES[award.tier]
                : t('awards:toNext', { value: formatNumber(award.count), next: formatNumber(award.next), unit: award.unit })}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The opponent's face: a bot's picture when the name is a bot's, otherwise its first letter. */
function Face({ name }: { name: string }) {
  const bot = ALL_BOTS.find(b => b.name === name);
  return bot
    ? <img className="profile-face" src={botPicture(bot)} alt="" width="34" height="34" />
    : <span className="profile-face" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

/** The six newest games, each with a replay link. */
function RecentGames({ games }: { games: GameSummary[] }) {
  const { t } = useTranslation('profile');
  return (
    <Panel id="profile-games-title" title={t('games.title')} link={{ to: '/games', label: t('games.all') }}>
      <ul className="profile-rows">
        {games.slice(0, 6).map(g => {
          const r = resultOf(g.user_result);
          const opponent = g.opponent || '?';
          const meta = [displayDate(g.date), g.plies ? t('games.moves', { count: Math.ceil(g.plies / 2) }) : null,
            g.user_accuracy != null ? `${Math.round(g.user_accuracy)}%` : null].filter(Boolean).join(' · ');
          return (
            <li key={g.id} className="profile-game">
              <Face name={opponent} />
              <span className="profile-row-text">
                <strong>{t('games.vs', { opponent })}</strong>
                <small className="profile-num">{meta}</small>
              </span>
              {r && <span className={`profile-result is-${r}`}>{t(`games.result.${r}`)}</span>}
              <Link className="button" to={gamePath(g.id)} aria-label={t('games.replayLabel', { opponent })}>{t('games.replay')}</Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** The opponents you have met most, with your record and score against each. */
function Opponents({ insights }: { insights: InsightsData }) {
  const { t } = useTranslation('profile');
  return (
    <Panel id="profile-opponents-title" title={t('opponents.title')}>
      <ul className="profile-rows">
        {insights.opponents.filter(o => o.opp !== '?').slice(0, 6).map(o => (
          <li key={o.opp} className="profile-opponent">
            <Face name={o.opp} />
            <span className="profile-row-text">
              <strong>{o.opp}</strong>
              <small className="profile-num">{t('opponents.record', { count: o.games, value: formatNumber(o.games), record: `${o.w}–${o.d}–${o.l}` })}</small>
            </span>
            <span className="profile-wdl" aria-hidden="true">
              <i className="is-win" style={{ width: `${percent(o.w, o.games)}%` }} />
              <i className="is-draw" style={{ width: `${percent(o.d, o.games)}%` }} />
              <i className="is-loss" style={{ width: `${percent(o.l, o.games)}%` }} />
            </span>
            <span className="profile-num" aria-label={t('openings.score', { score: score(o.w, o.d, o.games) })}>{score(o.w, o.d, o.games)}%</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The crests earned in the bot lobby's events: beating enough of an event's bots while it was on. */
function EventCrests() {
  const { t } = useTranslation('profile');
  const crests = Object.entries(loadEvents().crests).flatMap(([event, years]) => years.map(year => ({ event, year })));
  if (!crests.length) return null;
  const events = botCollections().filter(c => c.kind === 'season');
  return (
    <section className="profile-crests" aria-labelledby="crests-title">
      <h2 id="crests-title">{t('crests.title')}</h2>
      <div className="profile-crest-row">{crests.map(({ event, year }) => {
        const collection = events.find(c => c.id === event);
        const face = collection?.bots[collection.bots.length - 1];
        return (
          <Link key={`${event}-${year}`} className="profile-crest" data-theme={collection?.theme} to={`/play/bots/${event}`}>
            {face && <img src={botPicture(face)} alt="" />}
            <span><strong>{collection?.title ?? event}</strong><small>{year}</small></span>
          </Link>
        );
      })}</div>
    </section>
  );
}
