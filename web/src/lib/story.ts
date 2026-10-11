// Story progress: what is done, what is current, what is locked.
// Lesson completion comes from the server catalog; gauntlet completion is a
// localStorage flag per chapter; boss completion reuses the bot-stars record
// (lib/stars.ts) that PlayPage already writes after every bot game.
import { loadStars } from './stars';
import type { StoryChapter } from '../data/story';
import type { LessonCard } from '../types';

const gauntletKey = (chapterId: string) => `story-gauntlet-${chapterId}`;

export function gauntletDone(chapterId: string): boolean {
  try { return localStorage.getItem(gauntletKey(chapterId)) === '1'; } catch { return false; }
}

export function completeGauntlet(chapterId: string) {
  try { localStorage.setItem(gauntletKey(chapterId), '1'); } catch { /* storage unavailable */ }
}

/** Stars earned against the chapter boss (0–3); the boss falls at one star. */
export const bossStars = (chapter: StoryChapter, stars: Record<string, number> = loadStars()) =>
  stars[chapter.bossBotId] ?? 0;

export const bossBeaten = (chapter: StoryChapter, stars?: Record<string, number>) => bossStars(chapter, stars) > 0;

export type StoryNodeKind = 'lesson' | 'gauntlet' | 'boss';
export type StoryNodeState = 'done' | 'current' | 'locked';

export interface StoryNode {
  kind: StoryNodeKind;
  /** Set on lesson nodes. */
  lesson?: LessonCard;
  done: boolean;
}

/** The chapter's node sequence: its lessons (catalog order), then the gauntlet, then the boss. */
export function chapterNodes(chapter: StoryChapter, lessons: LessonCard[], stars?: Record<string, number>): StoryNode[] {
  return [
    ...lessons.map(lesson => ({ kind: 'lesson' as const, lesson, done: !!lesson.completed })),
    { kind: 'gauntlet' as const, done: gauntletDone(chapter.id) },
    { kind: 'boss' as const, done: bossBeaten(chapter, stars) },
  ];
}

/**
 * Locks are hard inside Story: chapter N+1 stays locked until chapter N's boss
 * falls; within a chapter the path is strictly linear, one current node at a time.
 */
export function nodeStates(
  nodes: StoryNode[],
  unlocked: boolean,
): StoryNodeState[] {
  const current = nodes.findIndex(node => !node.done);
  return nodes.map((node, i) => {
    if (node.done) return 'done';
    if (!unlocked || i !== current) return 'locked';
    return 'current';
  });
}

/** A chapter is unlocked when the previous chapter's boss is beaten (chapter 1 always is).
 *  A placement offer (see below) can open early chapters too; it is additive and never
 *  removes an unlock the boss stars already earned. */
export function chapterUnlocked(index: number, chapters: StoryChapter[], stars?: Record<string, number>): boolean {
  if (index === 0 || bossBeaten(chapters[index - 1], stars)) return true;
  const through = loadPlacement()?.unlockedThrough ?? 0;
  return index + 1 <= Math.min(through, chapters.length);
}

// ── Placement offer ──────────────────────────────────────────────────────────
// Experienced players (by puzzle rating) get a one-time offer to skip ahead
// instead of grinding from chapter 1. The answer is stored once, for good.

const PLACEMENT_KEY = 'story-placement';

export interface StoryPlacement { unlockedThrough?: number; declined?: boolean }

export function loadPlacement(): StoryPlacement | null {
  try {
    const saved = JSON.parse(localStorage.getItem(PLACEMENT_KEY) ?? 'null');
    return saved && typeof saved === 'object' ? saved as StoryPlacement : null;
  } catch {
    return null;
  }
}

function savePlacement(placement: StoryPlacement) {
  try { localStorage.setItem(PLACEMENT_KEY, JSON.stringify(placement)); } catch { /* storage unavailable */ }
}

export const acceptPlacement = (unlockedThrough: number) => savePlacement({ unlockedThrough });
export const declinePlacement = () => savePlacement({ declined: true });

/** How far a placement offer reaches, by puzzle rating; null means no offer. */
export function placementTier(rating: number): number | null {
  if (rating >= 1700) return 6;
  if (rating >= 1400) return 4;
  if (rating >= 1200) return 2;
  return null;
}

/** The chapter count to offer, or null when the offer must not appear: already
 *  answered, chapter 2 already open, or the rating below the first tier. */
export function placementOffer(rating: number, chapters: StoryChapter[], stars?: Record<string, number>): number | null {
  if (loadPlacement() !== null) return null;
  if (chapterUnlocked(1, chapters, stars)) return null;
  return placementTier(rating);
}

// ── Lesson focus flag ────────────────────────────────────────────────────────
// Lesson steps navigate to /lessons/<slug>/<step> internally, so focus mode for
// lessons keys off this flag rather than the URL: set when a story node is
// entered, cleared on exit, on the story map, or when another lesson opens.

let focusSlug: string | null = null;

export const enterStoryLesson = (slug: string) => { focusSlug = slug; };
export const leaveStoryLesson = () => { focusSlug = null; };
export const storyLessonFocus = (slug: string | undefined) => !!slug && slug === focusSlug;
