// The Story campaign: seven chapters, one per lesson category, in a fixed
// pedagogical order. Each chapter ends with a puzzle gauntlet on its themes and
// a boss game against a character bot; boss strength rises strictly monotonically.
import { botById, isPlayable, type Bot } from './bots';
import type { LessonCategory } from '../types';
import { translatable } from '../i18n/content';

export interface StoryChapter {
  id: string;
  title: string;
  category: LessonCategory;
  tagline: string;
  /** Puzzle pack slugs (puzzles/*.json) the gauntlet draws from, cycled in order. */
  gauntletThemes: string[];
  /** Character bot id (data/bots.ts) guarding the chapter. */
  bossBotId: string;
}

export const STORY_CHAPTERS: StoryChapter[] = ([
  {
    id: 'first-moves', title: 'First Moves', category: 'basics',
    tagline: 'Meet the pieces, learn the rules, and see how a game is won.',
    gauntletThemes: ['hanging-piece', 'mate-in-1'],
    bossBotId: 'charlie-scout',
  },
  {
    id: 'the-mating-net', title: 'The Mating Net', category: 'checkmates',
    tagline: 'Every king can be cornered. Learn the patterns that end games.',
    gauntletThemes: ['mate-in-1', 'back-rank-mate', 'mate-in-2'],
    bossBotId: 'alon-luz',
  },
  {
    id: 'opening-ideas', title: 'Opening Ideas', category: 'openings',
    tagline: 'Centre, develop, castle, and dodge the traps waiting for those who don’t.',
    gauntletThemes: ['trapped-piece', 'mate-in-2'],
    bossBotId: 'rosie-reed',
  },
  {
    id: 'tricks-of-the-trade', title: 'Tricks of the Trade', category: 'tactics',
    tagline: 'Forks, pins and skewers: the shortcuts to winning material.',
    gauntletThemes: ['pin', 'fork', 'skewer'],
    bossBotId: 'hazel-snap',
  },
  {
    id: 'the-quiet-board', title: 'The Quiet Board', category: 'strategy',
    tagline: 'Win without fireworks: squares, structures and slow plans.',
    gauntletThemes: ['quiet-move', 'defensive-move'],
    bossBotId: 'marcus-moss',
  },
  {
    id: 'the-last-twenty-moves', title: 'The Last Twenty Moves', category: 'endgames',
    tagline: 'Simplify, squeeze, convert. Endgames are where games are decided.',
    gauntletThemes: ['pawn-endgame', 'rook-endgame'],
    bossBotId: 'paloma-sol',
  },
  {
    id: 'the-immortals', title: 'The Immortals', category: 'history',
    tagline: 'Walk the games that made chess what it is, then make your own.',
    gauntletThemes: ['sacrifice', 'deflection', 'attraction'],
    bossBotId: 'esperanza-gil',
  },
] as StoryChapter[]).map(chapter => translatable(chapter, `story.${chapter.id}`, ['title', 'tagline']));

export const chapterById = (id: string | undefined) => STORY_CHAPTERS.find(chapter => chapter.id === id);

/** The boss of a chapter, when the id resolves to a playable character. */
export const chapterBoss = (chapter: StoryChapter): Bot | undefined => {
  const bot = botById(chapter.bossBotId);
  return bot && isPlayable(bot) && bot.avatar ? bot : undefined;
};
