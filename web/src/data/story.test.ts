// The story campaign config: real bosses on a rising curve, real puzzle packs.
import { chapterBoss, chapterById, STORY_CHAPTERS } from './story';
import { PUZZLE_ART } from '../lib/art';

describe('STORY_CHAPTERS', () => {
  test('there is one chapter per lesson category, in the fixed pedagogical order', () => {
    expect(STORY_CHAPTERS.map(chapter => chapter.category)).toEqual([
      'basics', 'checkmates', 'openings', 'tactics', 'strategy', 'endgames', 'history',
    ]);
    expect(new Set(STORY_CHAPTERS.map(chapter => chapter.id)).size).toBe(STORY_CHAPTERS.length);
  });

  test('boss ratings rise strictly monotonically across the campaign', () => {
    const elos = STORY_CHAPTERS.map(chapter => chapterBoss(chapter)?.elo);
    for (let i = 1; i < elos.length; i++) {
      expect(elos[i], `chapter ${i + 1} boss should outrate chapter ${i}`).toBeGreaterThan(elos[i - 1]!);
    }
  });

  test('every boss is a playable character bot', () => {
    for (const chapter of STORY_CHAPTERS) {
      const boss = chapterBoss(chapter);
      expect(boss, `${chapter.id}: unknown or unplayable boss ${chapter.bossBotId}`).toBeDefined();
      expect(boss!.avatar).toBeTruthy();
    }
  });

  test('gauntlet themes are real puzzle packs (they all have theme art)', () => {
    for (const chapter of STORY_CHAPTERS) {
      expect(chapter.gauntletThemes.length).toBeGreaterThan(0);
      for (const theme of chapter.gauntletThemes) {
        expect(PUZZLE_ART, `${chapter.id}: unknown puzzle theme ${theme}`).toHaveProperty(theme);
      }
    }
  });

  test('chapterById resolves ids and tolerates junk', () => {
    expect(chapterById(STORY_CHAPTERS[0].id)?.title).toBe(STORY_CHAPTERS[0].title);
    expect(chapterById('no-such-chapter')).toBeUndefined();
    expect(chapterById(undefined)).toBeUndefined();
  });
});
