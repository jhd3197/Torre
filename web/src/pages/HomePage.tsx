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

export function HomePage() {
  const { t } = useTranslation('home');
  useEffect(() => { document.body.dataset.page = 'home'; }, []);
  const catalog = useLessonCatalog();
  const saved = resumablePlay();
  const savedBot = saved?.botId ? botById(saved.botId)?.name : undefined;

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
