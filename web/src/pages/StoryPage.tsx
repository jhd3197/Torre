// /story — the campaign map: seven chapters, each a winding path of its lessons
// followed by a puzzle gauntlet and a boss game. Locks are hard inside Story.
// Also home to the focus-mode route wrappers (gate, entry, gauntlet, boss).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { chapterBoss, chapterById, STORY_CHAPTERS, type StoryChapter } from '../data/story';
import {
  bossStars, chapterNodes, chapterUnlocked, enterStoryLesson, leaveStoryLesson, loadPlacement,
  acceptPlacement, declinePlacement, placementTier,
  nodeStates, storyLessonFocus, type StoryNode, type StoryNodeState,
} from '../lib/story';
import { api } from '../lib/api';
import { lessonArt, STORY_ART, STORY_BIOMES, storyChapterArt } from '../lib/art';
import { chapterScenery, pathLayout } from '../lib/storyScenery';
import { lessonPath } from '../lib/routes';
import { loadStars } from '../lib/stars';
import type { Lesson, LessonCard, LessonCatalog } from '../types';
import { Stars } from '../components/Reward';
import { LessonsPage } from './LessonsPage';
import { FocusMode } from '../components/story/FocusMode';
import { PlacementModal } from '../components/story/Placement';
import { GauntletNode, GAUNTLET_SIZE } from '../components/story/GauntletNode';
import { BossNode } from '../components/story/BossNode';
import { useProfile } from '../hooks/useProfile';
import { PathTrail, SceneryItem, useReveal, useWidth } from '../components/story/Scenery';
import { StorySidebar, type StoryTotals } from '../components/story/Sidebar';

/** Rated puzzles needed before the skip-ahead offer trusts the puzzle rating. */
const PLACEMENT_MIN_RATED = 10;

function useCatalog() {
  const [catalog, setCatalog] = useState<LessonCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<LessonCatalog>('api/lessons')
      .then(c => { if (live) { setCatalog(c); setError(null); } })
      .catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, []);
  return { catalog, error };
}

// The list endpoint has no stars (they are derived from the step ledger per
// lesson), so completed lessons' stars are fetched once and cached here.
const starsCache = new Map<string, number>();

function useLessonStars(catalog: LessonCatalog | null): Record<string, number> {
  const [stars, setStars] = useState<Record<string, number>>({});
  const wanted = (catalog?.lessons ?? []).filter(l => l.completed).map(l => l.slug).join(',');
  useEffect(() => {
    const slugs = wanted ? wanted.split(',') : [];
    const collect = () => Object.fromEntries(slugs.map(s => [s, starsCache.get(s) ?? 0]));
    const missing = slugs.filter(s => !starsCache.has(s));
    if (!missing.length) { setStars(collect()); return; }
    let live = true;
    Promise.all(missing.map(slug => api<Lesson>(`api/lessons/${encodeURIComponent(slug)}`)
      .then(l => starsCache.set(slug, typeof l.stars === 'number' ? l.stars : 0))
      .catch(() => starsCache.set(slug, 0))))
      .then(() => { if (live) setStars(collect()); });
    return () => { live = false; };
  }, [wanted]);
  return stars;
}

export function StoryPage() {
  const { t } = useTranslation('story');
  const { catalog, error } = useCatalog();
  const lessonStars = useLessonStars(catalog);
  const profile = useProfile();
  const page = useRef<HTMLElement>(null);
  const [offer, setOffer] = useState<{ rating: number; through: number } | null>(null);
  useReveal(page, [catalog, lessonStars]);
  // Arriving at the map always clears a stale lesson-focus flag.
  useEffect(() => {
    document.body.dataset.page = 'story';
    leaveStoryLesson();
    return () => { document.body.dataset.page = 'board'; };
  }, []);
  // The one-time placement offer: only worth fetching the rating while chapter 2
  // is still locked and the offer has never been answered.
  useEffect(() => {
    if (loadPlacement() !== null || chapterUnlocked(1, STORY_CHAPTERS, loadStars())) return;
    let live = true;
    api<{ rating: number; rated?: number }>('api/puzzles')
      .then(summary => {
        if (!live) return;
        // A fresh install starts at the default rating without having solved anything: only a
        // rating earned on enough rated puzzles says the early chapters would be a warm-up.
        if ((summary.rated ?? 0) < PLACEMENT_MIN_RATED) return;
        const through = placementTier(summary.rating);
        if (through) setOffer({ rating: summary.rating, through });
      })
      .catch(() => { /* no rating, no offer */ });
    return () => { live = false; };
  }, []);
  if (error) return <p className="lessons-empty" role="alert">{error}</p>;
  if (!catalog) return <p className="lessons-empty" role="status">{t('page.loading')}</p>;
  const botStars = loadStars();
  const storyLessons = catalog.lessons.filter(l => STORY_CHAPTERS.some(c => c.category === l.category));
  const totals: StoryTotals = {
    lessonsDone: storyLessons.filter(l => l.completed).length, lessons: storyLessons.length,
    stars: Object.values(lessonStars).reduce((sum, n) => sum + n, 0) + STORY_CHAPTERS.reduce((sum, c) => sum + bossStars(c, botStars), 0),
    chaptersDone: STORY_CHAPTERS.filter(c => chapterNodes(c, catalog.lessons.filter(l => l.category === c.category), botStars).every(n => n.done)).length,
    chapters: STORY_CHAPTERS.length,
  };

  return (
    <section id="story" ref={page} className="story" aria-label={t('page.label')}>
      {offer && (
        <PlacementModal rating={offer.rating} through={offer.through}
          onAccept={() => { acceptPlacement(offer.through); setOffer(null); }}
          onDecline={() => { declinePlacement(); setOffer(null); }} />
      )}
      <div className="story-main">
        <header className="story-hero">
          <div className="story-hero-text">
            <h1 className="story-hero-title">{t('page.title')}</h1>
            <p>{t('page.lead')}</p>
          </div>
          <div className="story-hero-art" aria-hidden="true">
            <img className="hero-cloud a" src={STORY_ART.cloud} alt="" />
            <img className="hero-cloud b" src={STORY_ART.cloud} alt="" />
            <img className="hero-birds" src={STORY_ART.birds} alt="" />
            <img className="hero-rook" src={STORY_ART.hero} alt="" />
          </div>
        </header>
        {STORY_CHAPTERS.map((chapter, index) => (
          <ChapterPath key={chapter.id} chapter={chapter} index={index}
            lessons={catalog.lessons.filter(l => l.category === chapter.category)}
            unlocked={chapterUnlocked(index, STORY_CHAPTERS, botStars)}
            previousBoss={index > 0 ? chapterBoss(STORY_CHAPTERS[index - 1])?.name : undefined}
            botStars={botStars} lessonStars={lessonStars} />
        ))}
        <p className="story-library"><Trans t={t} i18nKey="page.library" components={{ library: <Link className="text-button" to={lessonPath()} /> }} /></p>
      </div>
      <StorySidebar profile={profile} totals={totals} />
    </section>
  );
}

function ChapterPath({ chapter, index, lessons, unlocked, previousBoss, botStars, lessonStars }: {
  chapter: StoryChapter; index: number; lessons: LessonCard[]; unlocked: boolean; previousBoss?: string;
  botStars: Record<string, number>; lessonStars: Record<string, number>;
}) {
  const { t } = useTranslation('story');
  const boss = chapterBoss(chapter);
  const nodes = chapterNodes(chapter, lessons, botStars);
  const states = nodeStates(nodes, unlocked);
  const earned = lessons.reduce((sum, l) => sum + (lessonStars[l.slug] ?? 0), 0) + bossStars(chapter, botStars);
  const available = lessons.length * 3 + 3;
  const done = nodes.filter(node => node.done).length;
  const complete = nodes.every(node => node.done);
  const map = useRef<HTMLDivElement>(null);
  const width = useWidth(map, 860);
  const layout = pathLayout(nodes.length, width);
  const biome = STORY_BIOMES[chapter.category];
  const scenery = biome ? chapterScenery(chapter.id, biome, layout) : [];
  const current = states.indexOf('current');
  const walked = current >= 0 ? current : done;
  return (
    <section className={`story-chapter unit-${chapter.category}${unlocked ? '' : ' locked'}`}
      aria-labelledby={`story-${chapter.id}`} aria-label={unlocked ? undefined : t('chapter.lockedLabel', { number: index + 1 })}>
      <div className="story-card">
        <div className="story-card-text">
          <span className="story-card-kicker">{t('chapter.kicker', { number: index + 1 })}</span>
          <h2 id={`story-${chapter.id}`}>{chapter.title}</h2>
          <p>{chapter.tagline}</p>
          {unlocked ? (
            <div className="story-card-meter">
              <span className="story-card-bar"><i style={{ width: `${nodes.length ? (done / nodes.length) * 100 : 0}%` }} /></span>
              <span>{t('chapter.steps', { done, total: nodes.length })}</span>
              <span className="story-card-stars" aria-label={t('chapter.stars', { earned, available })}>
                <img src="art/stars/star-gold.png" alt="" width="18" height="18" />{earned} / {available}
              </span>
            </div>
          ) : (
            <p className="story-card-lock">
              <img src="art/ui3d/locked.webp" alt={t('chapter.locked')} width="20" height="20" />
              {previousBoss ? t('chapter.beatBoss', { boss: previousBoss }) : t('chapter.finishPrevious')}
            </p>
          )}
        </div>
        <img className="story-card-scene" src={complete ? STORY_ART.complete : storyChapterArt(chapter.id)} alt="" aria-hidden="true" />
        {boss?.avatar && unlocked && (
          <span className="story-card-boss" title={t('chapter.boss', { name: boss.name })}>
            <img src={boss.avatar} alt={t('chapter.boss', { name: boss.name })} width="36" height="36" />
          </span>
        )}
      </div>
      {unlocked && (
        <div className="story-map" ref={map} style={{ height: layout.height, '--map-scale': layout.scale, '--edge-band': `${layout.edgeBand}px` } as CSSProperties}>
          <PathTrail layout={layout} walked={walked} />
          {scenery.map((decor, k) => <SceneryItem key={k} decor={decor} />)}
          {nodes.map((node, i) => (
            <NodeView key={node.lesson?.slug ?? node.kind} chapter={chapter} node={node} number={i + 1} state={states[i]}
              at={layout.points[i]} width={(layout.width - 2 * layout.gutter) / layout.cols} botStars={botStars}
              stars={node.lesson ? lessonStars[node.lesson.slug] ?? 0 : undefined} />
          ))}
        </div>
      )}
    </section>
  );
}

function NodeView({ chapter, node, number, state, at, width, botStars, stars }: {
  chapter: StoryChapter; node: StoryNode; number: number; state: StoryNodeState; at: [number, number]; width: number;
  botStars: Record<string, number>; stars?: number;
}) {
  const { t } = useTranslation('story');
  const boss = node.kind === 'boss' ? chapterBoss(chapter) : undefined;
  const to = node.kind === 'lesson' ? `/story/lesson/${node.lesson!.slug}`
    : node.kind === 'gauntlet' ? `/story/gauntlet/${chapter.id}`
    : `/story/boss/${chapter.id}`;
  const art = node.kind === 'lesson' ? lessonArt(node.lesson!.slug, node.lesson!.unit)
    : node.kind === 'gauntlet' ? STORY_ART.gauntlet
    : boss?.avatar ?? STORY_ART.bossGate;
  const title = node.kind === 'lesson' ? node.lesson!.title
    : node.kind === 'gauntlet' ? t('node.gauntlet')
    : t('node.boss', { name: boss?.name ?? chapter.bossBotId });
  const meta = node.kind === 'lesson' ? t('node.minutes', { count: node.lesson!.minutes })
    : node.kind === 'gauntlet' ? t('node.puzzles', { count: GAUNTLET_SIZE })
    : boss ? t('node.rated', { elo: boss.elo }) : '';
  const shown = node.kind === 'boss' ? bossStars(chapter, botStars) : stars;
  const body = (
    <>
      <span className="trail-number">{node.kind === 'boss' ? '★' : number}</span>
      <span className="trail-circle">
        <img src={art} alt="" width="58" height="58" />
        {state === 'done' && <span className="trail-badge done" aria-hidden="true">✓</span>}
        {state === 'locked' && <img className="trail-badge" src="art/ui3d/locked.webp" alt="" width="22" height="22" />}
      </span>
      <span className="trail-label">
        <strong>{title}</strong>
        {meta && <span className="trail-meta">{node.kind === 'lesson' && <ClockIcon />}{meta}</span>}
        {shown !== undefined && <Stars count={shown} size={16} label={t('node.stars', { stars: shown })} />}
      </span>
      {state === 'current' && <span className="trail-start">{t('node.start')}</span>}
    </>
  );
  const className = `trail-node ${state}${node.kind !== 'lesson' ? ` ${node.kind}` : ''} reveal`;
  const style = { left: at[0], top: at[1], width: Math.min(280, width - 12) } as CSSProperties;
  return state === 'locked'
    ? <span className={className} style={style} aria-label={t('node.locked', { title })}>{body}</span>
    : <Link className={className} style={style} to={to}>{body}</Link>;
}

function ClockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  );
}

// ── Focus-mode routes ────────────────────────────────────────────────────────

/** /story/lesson/<slug> — the story entrance to a lesson; hands over to the
 *  lesson route, where LessonFocusGate renders it shell-less while the flag holds. */
export function StoryLessonEntry() {
  const { slug, step } = useParams();
  if (!slug) return <Navigate to="/story" replace />;
  enterStoryLesson(slug);
  const index = step && Number.isInteger(Number(step)) ? Number(step) - 1 : undefined;
  return <Navigate to={lessonPath(slug, index)} replace />;
}

/** The lessons route element: the normal page, or — while a story lesson holds
 *  the focus flag — the same page in focus mode (no rail, no header). */
export function LessonFocusGate() {
  const { slug, step } = useParams();
  const { t } = useTranslation('story');
  const focused = storyLessonFocus(slug);
  const [progress, setProgress] = useState<number | undefined>(undefined);

  // Another lesson (or the library list) opens: the story run is over.
  useEffect(() => { if (slug && !focused) leaveStoryLesson(); }, [slug, focused]);

  useEffect(() => {
    if (!focused || !slug) { setProgress(undefined); return; }
    let live = true;
    api<Lesson>(`api/lessons/${encodeURIComponent(slug)}`)
      .then(lesson => {
        if (!live) return;
        const reached = step === 'done' ? lesson.steps.length : step ? Number(step) : lesson.step;
        setProgress(lesson.steps.length ? Math.min(1, reached / lesson.steps.length) : 0);
      })
      .catch(() => { if (live) setProgress(undefined); });
    return () => { live = false; };
  }, [focused, slug, step]);

  if (!focused) return <LessonsPage />;
  return (
    <FocusMode label={t('focus.lesson')} progress={progress} onExit={() => { leaveStoryLesson(); }}>
      <LessonsPage />
    </FocusMode>
  );
}

/** /story/gauntlet/<chapterId> — three puzzles on the chapter's themes, shell-less. */
export function StoryGauntletPage() {
  const { chapterId } = useParams();
  const { t } = useTranslation('story');
  const chapter = chapterById(chapterId);
  const [progress, setProgress] = useState(0);
  if (!chapter) return <Navigate to="/story" replace />;
  return (
    <FocusMode label={t('focus.gauntlet', { chapter: chapter.title })} progress={progress}>
      <GauntletNode chapter={chapter} onProgress={setProgress} />
    </FocusMode>
  );
}

/** /story/boss/<chapterId> — the boss intro, launching the existing bot game. */
export function StoryBossPage() {
  const { chapterId } = useParams();
  const { t } = useTranslation('story');
  const chapter = chapterById(chapterId);
  if (!chapter) return <Navigate to="/story" replace />;
  return (
    <FocusMode label={t('focus.boss', { chapter: chapter.title })}>
      <BossNode chapter={chapter} />
    </FocusMode>
  );
}
