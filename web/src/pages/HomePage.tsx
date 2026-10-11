// / — a router, not a dashboard: resume a game in progress, the next story
// node as the hero, quick practice islands, this week's streak and the journey
// so far, in a little clay world (art/prompts/home.md) scattered around them.
import { useEffect, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { PieceStage, lessonPiece } from '../components/PieceStage';
import { chapterBoss, STORY_CHAPTERS, type StoryChapter } from '../data/story';
import { botById } from '../data/bots';
import { useProfile } from '../hooks/useProfile';
import { api } from '../lib/api';
import { HOME_ART, STORY_ART, storyChapterArt } from '../lib/art';
import { chapterNodes, chapterUnlocked, nodeStates, type StoryNode } from '../lib/story';
import { loadStars } from '../lib/stars';
import { resumablePlay } from '../lib/storage';
import type { LessonCatalog, PuzzleCatalog, TodayPlan } from '../types';
import { FlameIcon } from '../components/story/Streak';
import { streakWeek } from '../components/story/Sidebar';
import { Mascot } from '../components/Reward';
import { MiniBoard } from '../components/MiniBoard';
import { usePosition } from '../hooks/useChess';
import { useHostedAccount } from '../hooks/useHostedAccount';
import { usePhone } from '../hooks/usePhone';
import { PAGE_ART } from '../lib/art';
import { gamePath } from '../lib/routes';
import { sideToMove } from '../lib/format';
import { useGameData } from '../state/AppData';
import type { GameSummary } from '../types';

export interface ContinueNode { chapter: StoryChapter; index: number; node: StoryNode }

/** The current story node: the first uncompleted node of the first unlocked,
 *  incomplete chapter; null when the whole journey is done. */
export function continueNode(catalog: LessonCatalog, stars: Record<string, number> = loadStars()): ContinueNode | null {
  for (let index = 0; index < STORY_CHAPTERS.length; index++) {
    const chapter = STORY_CHAPTERS[index];
    if (!chapterUnlocked(index, STORY_CHAPTERS, stars)) break;
    const nodes = chapterNodes(chapter, catalog.lessons.filter(l => l.category === chapter.category), stars);
    const states = nodeStates(nodes, true);
    const current = nodes.findIndex((_, i) => states[i] === 'current');
    if (current >= 0) return { chapter, index, node: nodes[current] };
  }
  return null;
}

const nodePath = ({ chapter, node }: ContinueNode) =>
  node.kind === 'lesson' ? `/story/lesson/${node.lesson!.slug}`
    : node.kind === 'gauntlet' ? `/story/gauntlet/${chapter.id}`
      : `/story/boss/${chapter.id}`;

const nodeTitle = ({ chapter, node }: ContinueNode, t: TFunction<'home'>) =>
  node.kind === 'lesson' ? node.lesson!.title
    : node.kind === 'gauntlet' ? t('hero.gauntletTitle')
      : t('hero.bossTitle', { name: chapterBoss(chapter)?.name ?? chapter.bossBotId });

const nodeKind = (node: StoryNode) => node.kind === 'lesson' ? 'lesson' : node.kind === 'gauntlet' ? 'gauntlet' : 'boss';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type CatalogState = LessonCatalog | null | 'failed';

/** The lesson catalog the hero and the journey both read: null while loading, 'failed' when unreachable. */
function useLessonCatalog(): CatalogState {
  const [catalog, setCatalog] = useState<CatalogState>(null);
  useEffect(() => {
    let live = true;
    api<LessonCatalog>('api/lessons')
      .then(c => { if (live) setCatalog(c); })
      .catch(() => { if (live) setCatalog('failed'); });
    return () => { live = false; };
  }, []);
  return catalog;
}

/** A piece of the clay world: decoration only, so screen readers skip it. */
function Decor({ src, className }: { src: string; className: string }) {
  return <img className={`home-deco ${className}`} src={src} alt="" aria-hidden="true" />;
}

/** The hero: what should I do right now? One node on its chapter's colours, one big START. */
function ContinueHero({ catalog }: { catalog: CatalogState }) {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const [hop, setHop] = useState(false);

  if (catalog === 'failed') {
    return (
      <section className="home-hero quiet" aria-label={t('hero.label')}>
        <div className="home-hero-text">
          <h1>{t('hero.failedTitle')}</h1>
          <p className="home-hero-sub">{t('hero.failedText')}</p>
          <Link className="home-start-btn" to="/story">{t('hero.openStory')}</Link>
        </div>
      </section>
    );
  }
  if (!catalog) {
    return (
      <section className="home-hero quiet loading" aria-label={t('hero.label')} aria-busy="true">
        <div className="home-hero-text"><h1>{t('hero.loading')}</h1></div>
      </section>
    );
  }
  const current = continueNode(catalog);
  if (!current) {
    return (
      <section className="home-hero unit-basics" aria-label={t('hero.label')}>
        <div className="home-hero-text">
          <p className="home-hero-chapter">{t('hero.doneEyebrow')}</p>
          <h1>{t('hero.doneTitle')}</h1>
          <p className="home-hero-sub">{t('hero.doneText')}</p>
          <Link className="home-start-btn" to="/story">{t('hero.revisit')}</Link>
        </div>
        <div className="home-hero-art"><img className="home-hero-scene" src={STORY_ART.complete} alt="" /></div>
      </section>
    );
  }
  const kind = nodeKind(current.node);
  const piece = kind === 'lesson' ? lessonPiece(current.node.lesson?.slug) : null;
  const boss = kind === 'boss' ? chapterBoss(current.chapter) : undefined;
  const to = nodePath(current);
  // The one memorable moment: the piece hops to a square it can reach, then the lesson opens.
  const start = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!piece || reducedMotion() || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    setHop(true);
    window.setTimeout(() => navigate(to), 460);
  };
  return (
    <section className={`home-hero unit-${current.chapter.category}`} aria-label={t('hero.label')}>
      <div className="home-hero-text">
        <p className="home-hero-chapter">{t('hero.chapter', { number: current.index + 1, title: current.chapter.title, kind: t(`hero.kind.${kind}`) })}</p>
        <h1>{nodeTitle(current, t)}</h1>
        <p className="home-hero-sub">{current.node.lesson?.summary ?? current.chapter.tagline}</p>
        <Link className="home-start-btn" to={to} onClick={start}>{t(`hero.start.${kind}`)}</Link>
      </div>
      <div className="home-hero-art">
        <img className="home-hero-scene" src={kind === 'gauntlet' ? STORY_ART.gauntlet : kind === 'boss' ? STORY_ART.bossGate : storyChapterArt(current.chapter.id)} alt="" />
        {piece && <PieceStage piece={piece} hop={hop} />}
        {boss?.avatar && <img className="home-hero-boss" src={boss.avatar} alt="" width="96" height="96" />}
      </div>
    </section>
  );
}

/** Three quick doors for the drill user, as islands along a trail: puzzles, review, a bot game. */
function PracticeRow() {
  const { t } = useTranslation('home');
  const [rating, setRating] = useState<number | null>(null);
  const [due, setDue] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    api<PuzzleCatalog>('api/puzzles').then(c => { if (live) setRating(c.rating); }, () => { /* stat stays hidden */ });
    api<TodayPlan>('api/today').then(p => { if (live) setDue(p.todo); }, () => { /* stat stays hidden */ });
    return () => { live = false; };
  }, []);
  const doors = [
    { to: '/puzzles', art: HOME_ART.puzzles, title: t('practice.puzzles.title'), text: rating != null ? t('practice.puzzles.rating', { rating }) : t('practice.puzzles.text') },
    { to: '/train', art: HOME_ART.train, title: t('practice.review.title'), text: due != null ? (due ? t('practice.review.due', { count: due }) : t('practice.review.caughtUp')) : t('practice.review.text') },
    { to: '/play/bots', art: HOME_ART.bots, title: t('practice.bot.title'), text: t('practice.bot.text') },
  ];
  return (
    <section className="home-practice" aria-labelledby="home-practice-title">
      <h2 id="home-practice-title">{t('practice.heading')}</h2>
      <nav className="home-doors" aria-label={t('practice.label')}>
        <svg className="home-trail" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
          <path d="M70 60 C 230 0, 330 120, 500 96 S 780 0, 930 56" />
        </svg>
        {doors.map(door => (
          <Link key={door.to} className="home-door" to={door.to} viewTransition>
            <img src={door.art} alt="" width="220" height="220" />
            <span><strong>{door.title}</strong>{' '}<small>{door.text}</small></span>
          </Link>
        ))}
        <Decor src={HOME_ART.butterflies} className="home-deco-butterflies" />
        <Decor src={HOME_ART.paperPlane} className="home-deco-plane" />
        <Decor src={HOME_ART.isletTree} className="home-deco-islet-left" />
        <Decor src={HOME_ART.isletWaterfall} className="home-deco-islet-right" />
      </nav>
    </section>
  );
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** This week as seven cells, a flame on every streak day, plus today's goal, by the campfire. */
function TodayStrip() {
  const { t } = useTranslation('home');
  const profile = useProfile();
  const streak = profile?.streak;
  if (!profile || !streak) return null;
  const week = streakWeek(streak);
  const todayIndex = (new Date().getDay() + 6) % 7;
  const pct = streak.goal > 0 ? Math.min(100, Math.round(100 * streak.xpToday / streak.goal)) : 0;
  return (
    <section className="home-today home-panel" aria-label={t('today.label')}>
      <img className="home-panel-art" src={HOME_ART.campfire} alt="" width="150" height="150" />
      <div className="home-today-head">
        <strong className={streak.count ? '' : 'cold'}>{t('today.streak', { count: streak.count })}</strong>
        <span>{streak.doneToday ? t('today.goalMet') : t('today.progress', { xp: streak.xpToday, goal: streak.goal })}</span>
      </div>
      <ol className="home-week">
        {DAYS.map((day, i) => (
          <li key={day} className={`${week[i] ? 'on' : ''}${i === todayIndex ? ' today' : ''}`}>
            <span className="home-week-cell">
              {week[i] ? <FlameIcon lit size={22} />
                : i === todayIndex ? <i className="home-week-goal" style={{ height: `${pct}%` }} /> : null}
            </span>
            <small>{t(`today.days.${day}`)}</small>
          </li>
        ))}
      </ol>
      <div className="home-today-bar" role="progressbar" aria-label={t('today.goalLabel')}
        aria-valuemin={0} aria-valuemax={streak.goal} aria-valuenow={Math.min(streak.xpToday, streak.goal)}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </section>
  );
}

/** The seven chapters as a row of islands: cleared, the one you're on, and the ones still ahead. */
function JourneyStrip({ catalog }: { catalog: CatalogState }) {
  const { t } = useTranslation('home');
  if (!catalog || catalog === 'failed') return null;
  const current = continueNode(catalog);
  const at = current ? current.index : STORY_CHAPTERS.length;
  return (
    <section className="home-journey home-panel" aria-labelledby="home-journey-title">
      <img className="home-panel-art" src={HOME_ART.journey} alt="" width="150" height="150" />
      <div className="home-journey-head">
        <strong id="home-journey-title">{t('journey.title')}</strong>
        <span>{current ? t('journey.progress', { number: at + 1, total: STORY_CHAPTERS.length }) : t('journey.done')}</span>
      </div>
      <ol className="home-chapters">
        {STORY_CHAPTERS.map((chapter, i) => {
          const state = i < at ? 'done' : i === at ? 'current' : 'locked';
          return (
            <li key={chapter.id} className={state} title={chapter.title}>
              <img src={storyChapterArt(chapter.id)} alt={t(`journey.state.${state}`, { title: chapter.title })} width="72" height="72" />
            </li>
          );
        })}
      </ol>
      <Link className="home-journey-link" to="/story" viewTransition>{t('journey.open')}</Link>
    </section>
  );
}

/** Someone different drops by the meadow each day. */
const VISITORS = ['queenReading', 'bishopTelescope', 'leapfrog', 'robot', 'knightSneak', 'pawnCloud', 'tumbling'] as const;
const visitorOfTheDay = (date = new Date()) => HOME_ART[VISITORS[Math.floor(date.getTime() / 86_400_000) % VISITORS.length]];

const isNight = (date = new Date()) => date.getHours() >= 19 || date.getHours() < 6;

const GEAR = (
  <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
const CHEVRON = <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>;

const greeting = (date = new Date()) => date.getHours() < 5 ? 'evening' : date.getHours() < 12 ? 'morning' : date.getHours() < 18 ? 'afternoon' : 'evening';

/** The phone's hero: Rooky with today's step, and one button to take it. */
function PhoneHero({ catalog, name }: { catalog: CatalogState; name: string | null }) {
  const { t } = useTranslation('home');
  const hello = name ? t(`phone.hello.${greeting()}`, { name }) : t(`phone.helloPlain.${greeting()}`);
  const current = catalog && catalog !== 'failed' ? continueNode(catalog) : null;
  const kind = current ? nodeKind(current.node) : null;
  const [title, say, to, button] = catalog === 'failed' ? [t('hero.failedTitle'), t('hero.failedText'), '/story', t('hero.openStory')]
    : !catalog ? [t('hero.loading'), null, null, null]
      : !current ? [t('hero.doneTitle'), t('hero.doneText'), '/story', t('hero.revisit')]
        : [t(`phone.ready.${kind}`), <><strong>{nodeTitle(current, t)}</strong> {current.node.lesson?.summary ?? current.chapter.tagline}</>, nodePath(current), t(`hero.start.${kind}`)];
  return (
    <section className={`phone-hero${current ? ` unit-${current.chapter.category}` : ''}`} aria-label={t('hero.label')} aria-busy={!catalog}>
      <span className="phone-hero-hello">{hello}</span>
      <h1>{title}</h1>
      {say && <p className="phone-hero-say"><span>{say}</span></p>}
      {to && <Link className="phone-hero-go" to={to}>{button}{CHEVRON}</Link>}
      <span className="phone-hero-rooky" aria-hidden="true"><Mascot pose={current ? 'wave' : catalog === 'failed' ? 'shrug' : 'trophy'} size={104} /></span>
    </section>
  );
}

/** The game you left, its position in a corner: one tap back to the board. */
function PhoneResume() {
  const { t } = useTranslation('home');
  const saved = resumablePlay();
  const { board } = usePosition(saved?.initialFen ?? '', saved?.moves ?? [], !!saved);
  if (!saved) return null;
  const bot = (saved.botId ? botById(saved.botId)?.name : undefined) ?? saved.botName ?? 'Stockfish';
  const ply = saved.moves.length;
  const whiteToMove = (ply % 2 === 0) === (sideToMove(saved.initialFen) === 'white');
  const yourTurn = whiteToMove === (saved.playerColor === 'white');
  return (
    <Link className="phone-resume" to="/play">
      <span className="phone-resume-board">{board && <MiniBoard fen={board.fen} />}</span>
      <span className="phone-resume-text">
        <small>{t('phone.continue')}</small>
        <strong>{t('phone.versus', { name: bot, move: Math.floor(ply / 2) + 1 })}</strong>
        <span>{yourTurn ? t('phone.yourTurn') : t('phone.theirTurn', { name: bot })}</span>
      </span>
      {CHEVRON}
    </Link>
  );
}

const resultOf = (game: GameSummary) => game.user_result === 1 ? 'won' : game.user_result === 0 ? 'lost' : game.user_result === 0.5 ? 'drew' : null;

/** Your last few games, each opening its review. */
function PhoneRecent({ games }: { games: GameSummary[] }) {
  const { t, i18n } = useTranslation('home');
  if (!games.length) return null;
  const recent = [...games].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 3);
  // PGN dates ("2026.10.10") are calendar days: read them as local dates, not UTC midnight.
  const day = (date?: string) => {
    const [y, m, d] = (date ?? '').split(/[.-]/).map(Number);
    return y && m && d ? new Date(y, m - 1, d).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' }) : null;
  };
  return (
    <section className="phone-recent" aria-labelledby="phone-recent-title">
      <div className="phone-section-head"><h2 id="phone-recent-title">{t('phone.recent')}</h2><Link to="/games">{t('phone.seeAll')}</Link></div>
      <ul>{recent.map(game => {
        const result = resultOf(game);
        return (
          <li key={game.id}><Link to={gamePath(String(game.id))}>
            <span className={`phone-result ${result ?? 'unknown'}`}>{t(`phone.result.${result ?? 'unknown'}`)}</span>
            <span className="phone-recent-text">
              <strong>{t('phone.vs', { name: game.opponent ?? '?' })}</strong>
              <small>{[day(game.date), game.plies ? t('phone.moves', { count: Math.ceil(game.plies / 2) }) : null].filter(Boolean).join(' · ')}</small>
            </span>
            {game.user_accuracy != null && <span className="phone-recent-score" title={t('phone.accuracy')}>{Math.round(game.user_accuracy)}%</span>}
          </Link></li>
        );
      })}</ul>
    </section>
  );
}

/** Home on a phone: hello, today's step, the game you left, four doors, and your last games. */
function PhoneHome({ catalog }: { catalog: CatalogState }) {
  const { t } = useTranslation('home');
  const profile = useProfile();
  const account = useHostedAccount();
  const { insights, games } = useGameData();
  const [rating, setRating] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    api<PuzzleCatalog>('api/puzzles').then(c => { if (live) setRating(c.rating); }, () => { /* the tile keeps its plain line */ });
    return () => { live = false; };
  }, []);
  const name = account?.name || insights?.user || null;
  const streak = profile?.streak?.count ?? 0;
  const last = [...games].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
  const doors = [
    { to: '/play/bots', art: HOME_ART.bots, title: t('practice.bot.title'), text: t('phone.doors.bot') },
    { to: '/puzzles', art: HOME_ART.puzzles, title: t('practice.puzzles.title'), text: rating != null ? t('practice.puzzles.rating', { rating }) : t('phone.doors.puzzles') },
    { to: '/arena', art: PAGE_ART.Arena, title: t('phone.doors.arenaTitle'), text: t('phone.doors.arena') },
    { to: last ? gamePath(String(last.id)) : '/games', art: PAGE_ART.Games, title: t('phone.doors.reviewTitle'), text: last ? t('phone.doors.review') : t('phone.doors.noGames') },
  ];
  return (
    <section id="home" className="phone-home" aria-label={t('label')}>
      <header className="phone-home-head">
        <img src="art/logo/mark.png" alt="" width="34" height="34" />
        <span className="phone-home-brand">TORRE</span>
        <Link className={`phone-streak${streak ? '' : ' cold'}`} to="/profile" aria-label={t('today.streak', { count: streak })}>
          <FlameIcon lit={streak > 0} size={15} />{t('phone.days', { count: streak })}
        </Link>
        <Link className="phone-icon-button" to="/settings" aria-label={t('phone.settings')}>{GEAR}</Link>
      </header>
      <PhoneHero catalog={catalog} name={name} />
      <PhoneResume />
      <nav className="phone-doors" aria-label={t('practice.label')}>
        {doors.map(door => (
          <Link key={door.title} className="phone-door" to={door.to} viewTransition>
            <img src={door.art} alt="" width="46" height="46" />
            <strong>{door.title}</strong>
            <small>{door.text}</small>
          </Link>
        ))}
      </nav>
      <PhoneRecent games={games} />
    </section>
  );
}

export function HomePage() {
  const { t } = useTranslation('home');
  useEffect(() => { document.body.dataset.page = 'home'; }, []);
  const catalog = useLessonCatalog();
  const phone = usePhone();
  const saved = resumablePlay();
  const savedBot = saved?.botId ? botById(saved.botId)?.name : undefined;
  if (phone) return <PhoneHome catalog={catalog} />;

  return (
    <section id="home" className="home" aria-label={t('label')}>
      <div className="home-sky" aria-hidden="true">
        <Decor src={HOME_ART.cloudLong} className="home-deco-cloud" />
        <Decor src={isNight() ? HOME_ART.moon : HOME_ART.sun} className="home-deco-sun" />
        <Decor src={HOME_ART.cloudPuff} className="home-deco-puff" />
        <Decor src={HOME_ART.balloon} className="home-deco-balloon" />
      </div>
      {saved && (
        <Link className="home-resume" to="/play">
          <img src={HOME_ART.break} alt="" width="52" height="52" />
          <span><Trans t={t} i18nKey={saved.moves.length <= 2 ? 'resume.oneMove' : 'resume.moves'} components={{ strong: <strong /> }}
            values={{ bot: savedBot ?? 'Stockfish', count: Math.ceil(saved.moves.length / 2) }} /></span>
          <span className="home-resume-go">{t('resume.continue')}</span>
        </Link>
      )}
      <ContinueHero catalog={catalog} />
      <PracticeRow />
      <div className="home-below">
        <TodayStrip />
        <JourneyStrip catalog={catalog} />
        <Decor src={HOME_ART.kingBush} className="home-deco-king" />
      </div>
      <div className="home-meadow" aria-hidden="true">
        <Decor src={HOME_ART.rookNap} className="home-deco-nap" />
        <Decor src={HOME_ART.leaves} className="home-deco-leaves" />
        <Decor src={visitorOfTheDay()} className="home-deco-visitor" />
        <Decor src={HOME_ART.picnic} className="home-deco-picnic" />
      </div>
    </section>
  );
}
