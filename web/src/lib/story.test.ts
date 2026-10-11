// Story progress: node states, chapter locks, gauntlet completion flags.
import {
  acceptPlacement, chapterNodes, chapterUnlocked, completeGauntlet, declinePlacement,
  gauntletDone, loadPlacement, nodeStates, placementOffer, placementTier, type StoryNode,
} from './story';
import { recordStars } from './stars';
import { STORY_CHAPTERS } from '../data/story';
import type { LessonCard } from '../types';

const card = (slug: string, completed: string | null = null): LessonCard => ({
  slug, title: slug, summary: '', category: 'basics', level: 'beginner', minutes: 5,
  requires: [], unit: null, practice: null, steps: 3, step: 0, completed,
});

const chapter = STORY_CHAPTERS[0];

describe('chapterNodes', () => {
  test('the sequence is lessons in catalog order, then the gauntlet, then the boss', () => {
    const nodes = chapterNodes(chapter, [card('a'), card('b')], {});
    expect(nodes.map(n => n.kind)).toEqual(['lesson', 'lesson', 'gauntlet', 'boss']);
    expect(nodes.map(n => n.lesson?.slug)).toEqual(['a', 'b', undefined, undefined]);
  });

  test('done flags come from the catalog, the gauntlet flag and the boss stars', () => {
    completeGauntlet(chapter.id);
    recordStars(chapter.bossBotId, 2);
    try {
      const nodes = chapterNodes(chapter, [card('a', '2026-01-01'), card('b')]);
      expect(nodes.map(n => n.done)).toEqual([true, false, true, true]);
    } finally {
      localStorage.clear();
    }
  });
});

describe('nodeStates', () => {
  const nodes = (done: boolean[]): StoryNode[] => done.map(d => ({ kind: 'lesson', done: d }));

  test('within an unlocked chapter the first unfinished node is current, the rest locked', () => {
    expect(nodeStates(nodes([true, false, false]), true)).toEqual(['done', 'current', 'locked']);
  });

  test('a locked chapter has no current node; only its completed nodes show done', () => {
    expect(nodeStates(nodes([true, false, false]), false)).toEqual(['done', 'locked', 'locked']);
  });

  test('a fully completed chapter is all done', () => {
    expect(nodeStates(nodes([true, true]), true)).toEqual(['done', 'done']);
  });
});

describe('chapterUnlocked', () => {
  test('chapter 1 is always open; later chapters need the previous boss beaten', () => {
    expect(chapterUnlocked(0, STORY_CHAPTERS, {})).toBe(true);
    expect(chapterUnlocked(1, STORY_CHAPTERS, {})).toBe(false);
    expect(chapterUnlocked(1, STORY_CHAPTERS, { [STORY_CHAPTERS[0].bossBotId]: 1 })).toBe(true);
    // Beating a later boss does not skip a chapter.
    expect(chapterUnlocked(2, STORY_CHAPTERS, { [STORY_CHAPTERS[1].bossBotId]: 3 })).toBe(true);
    expect(chapterUnlocked(2, STORY_CHAPTERS, { [STORY_CHAPTERS[0].bossBotId]: 3 })).toBe(false);
  });
});

describe('gauntlet completion flag', () => {
  test('completeGauntlet marks only that chapter', () => {
    try {
      expect(gauntletDone('first-moves')).toBe(false);
      completeGauntlet('first-moves');
      expect(gauntletDone('first-moves')).toBe(true);
      expect(gauntletDone('the-mating-net')).toBe(false);
    } finally {
      localStorage.clear();
    }
  });
});

describe('placementTier', () => {
  test('below 1200 there is no offer; tiers unlock through chapters 2, 4 and 6', () => {
    expect(placementTier(1100)).toBeNull();
    expect(placementTier(1199)).toBeNull();
    expect(placementTier(1200)).toBe(2);
    expect(placementTier(1399)).toBe(2);
    expect(placementTier(1400)).toBe(4);
    expect(placementTier(1699)).toBe(4);
    expect(placementTier(1700)).toBe(6);
    expect(placementTier(2400)).toBe(6);
  });
});

describe('placement record', () => {
  test('unset until answered; accept and decline both stick', () => {
    try {
      expect(loadPlacement()).toBeNull();
      acceptPlacement(4);
      expect(loadPlacement()).toEqual({ unlockedThrough: 4 });
      declinePlacement();
      expect(loadPlacement()).toEqual({ declined: true });
    } finally {
      localStorage.clear();
    }
  });

  test('a corrupt record reads as unset', () => {
    try {
      localStorage.setItem('story-placement', '{oops');
      expect(loadPlacement()).toBeNull();
    } finally {
      localStorage.clear();
    }
  });
});

describe('chapterUnlocked with a placement override', () => {
  test('the override opens chapters up to unlockedThrough, no further', () => {
    acceptPlacement(4);
    try {
      expect(chapterUnlocked(0, STORY_CHAPTERS, {})).toBe(true);
      expect(chapterUnlocked(1, STORY_CHAPTERS, {})).toBe(true);
      expect(chapterUnlocked(3, STORY_CHAPTERS, {})).toBe(true);
      expect(chapterUnlocked(4, STORY_CHAPTERS, {})).toBe(false);
      expect(chapterUnlocked(6, STORY_CHAPTERS, {})).toBe(false);
    } finally {
      localStorage.clear();
    }
  });

  test('the override never removes an unlock the boss stars earned', () => {
    acceptPlacement(2);
    recordStars(STORY_CHAPTERS[4].bossBotId, 1);
    try {
      // Chapter 6 stays open via the boss star even though the override only reaches chapter 2.
      expect(chapterUnlocked(5, STORY_CHAPTERS)).toBe(true);
      expect(chapterUnlocked(6, STORY_CHAPTERS)).toBe(false);
    } finally {
      localStorage.clear();
    }
  });
});

describe('placementOffer', () => {
  test('offers the tier while chapter 2 is locked and the offer is unanswered', () => {
    expect(placementOffer(1500, STORY_CHAPTERS, {})).toBe(4);
  });

  test('no offer below the first tier or once chapter 2 is open', () => {
    expect(placementOffer(1100, STORY_CHAPTERS, {})).toBeNull();
    expect(placementOffer(2000, STORY_CHAPTERS, { [STORY_CHAPTERS[0].bossBotId]: 1 })).toBeNull();
  });

  test('no second offer after accept or decline', () => {
    try {
      acceptPlacement(2);
      expect(placementOffer(1500, STORY_CHAPTERS, {})).toBeNull();
      declinePlacement();
      expect(placementOffer(1500, STORY_CHAPTERS, {})).toBeNull();
    } finally {
      localStorage.clear();
    }
  });
});
