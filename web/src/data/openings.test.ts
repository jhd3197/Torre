import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OPENING_STORIES } from './openings';
import { openingKey } from '../lib/art';

const lessons = new Set(readdirSync(join(__dirname, '../../../torre/content/lessons')).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')));

test('every opening story links only to lessons that exist', () => {
  for (const [key, story] of Object.entries(OPENING_STORIES)) {
    if (story.course) expect(lessons, `${key} course`).toContain(story.course);
    if (story.game) expect(lessons, `${key} game`).toContain(story.game.lesson);
  }
});

test('the openings in Insights find their story', () => {
  expect(OPENING_STORIES[openingKey('London System', 'D02')].name).toBe('London System');
  expect(OPENING_STORIES[openingKey('East Indian Defense', 'A48')].name).toBe("Queen's Pawn Game");
  expect(OPENING_STORIES[openingKey('Philidor Defense', 'C41')].course).toBe('philidor-setup');
});
